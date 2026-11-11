import { createSharedAccount, dispatchSharedAccount, sharedAccountView, validateSharedAccount } from '../dist/domain/shared-account.mjs';
import { hashInputPackage, stableStringify, WorkspaceError } from '../dist/domain/workspace.mjs';
import { validatePaperAccount } from '../dist/trading/runtime.mjs';

export const SHARED_WORKSPACE_ACTIONS = Object.freeze(['shared.account.create', 'deployment.attachShared', 'shared.sleeve.allocate', 'shared.sleeve.release', 'shared.account.reconcile', 'shared.order.cancel.request', 'shared.order.cancel.confirm']);
const SCALE = 100000000n, SYMBOL = 'BTCUSDT';
const clone = value => structuredClone(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e15;
const check = (condition, code, message) => { if (!condition) throw new WorkspaceError(code, message); };
const fields = (value, allowed, required = []) => { stableStringify(value); check(plain(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)), 'INVALID_SHARED_COMMAND', '공유 계좌 입력 항목과 필수 값을 확인하세요.'); };
const find = (items, target) => { const value = items.find(v => v.id === target); check(value, 'SHARED_RESOURCE_NOT_FOUND', '선택한 공유 계좌와 운용 봇을 확인하세요.'); return value; };
const number = units => Number(units) / Number(SCALE);
const internalKey = (key, operation) => `shared-${hashInputPackage({ key, operation })}`;
function unitString(value, label = '금액') {
  check(finite(value) && value >= 0, 'INVALID_SHARED_AMOUNT', `${label}의 범위를 확인하세요.`);
  const decimal = value.toFixed(8), tolerance = .50001e-8 + Number.EPSILON * Math.max(1, value) * 8;
  check(Math.abs(Number(decimal) - value) <= tolerance, 'SHARED_AMOUNT_PRECISION', `${label}의 소수 단위를 확인하세요.`);
  return decimal;
}
function unitsOf(value) { const [whole, fraction = ''] = unitString(value).split('.'); return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0')); }
function inputContext(workspace, options) {
  const now = options.now ?? new Date().toISOString(), ownerId = options.ownerId;
  check(iso(now) && identifier(ownerId) && Number.isSafeInteger(workspace?.revision) && Array.isArray(workspace.deployments) && Array.isArray(workspace.accounts) && Array.isArray(workspace.commandReceipts) && Array.isArray(workspace.activityEvents) && (workspace.sharedAccounts === undefined || Array.isArray(workspace.sharedAccounts)), 'INVALID_SHARED_CONTEXT', '공유 계좌 소유자와 운용 구성을 확인하세요.');
  check(Date.parse(now) >= Date.parse(workspace.updatedAt), 'INVALID_TIME', '최근 운용 변경 이후의 시각을 확인하세요.');
  for (const account of workspace.sharedAccounts ?? []) check(account.ownerId === ownerId && !validateSharedAccount(account).length, 'SHARED_ACCOUNT_OWNER_REQUIRED', '공유 계좌의 소유와 원장을 확인하세요.');
  return { now, ownerId };
}
function audit(workspace, eventType, sharedAccountId, deploymentId, now, ownerId, payload = {}, correlationId = null) {
  const record = { id: `shared-audit-${crypto.randomUUID()}`, eventType, schemaVersion: 1, occurredAt: now, recordedAt: now, actorId: ownerId, actorType: 'user', producer: 'shared-account-service', resourceType: 'shared-account', resourceId: sharedAccountId, deploymentId: deploymentId ?? null, aggregateVersion: workspace.revision, correlationId: correlationId ?? crypto.randomUUID(), causationId: null, status: 'recorded', payload: clone(payload) };
  workspace.activityEvents.push(record); return record;
}
function sharedCommand(account, type, payload, key, now, ownerId) { return dispatchSharedAccount(account, { type, payload, idempotencyKey: internalKey(key, type), expectedRevision: account.revision }, { now, actorId: ownerId }); }
function replaceShared(workspace, account) { const index = workspace.sharedAccounts.findIndex(a => a.id === account.id); check(index >= 0, 'SHARED_RESOURCE_NOT_FOUND', '공유 계좌를 확인하세요.'); workspace.sharedAccounts[index] = account; }
function projection(account, deployment) { const sleeve = account.sleeves.find(s => s.deploymentId === deployment.id); check(sleeve, 'SLEEVE_NOT_FOUND', '운용 봇의 공유 계좌 배분을 확인하세요.'); return sleeve; }
function verifyProjection(workspace, shared, deployment) {
  const account = find(workspace.accounts, deployment.accountId), sleeve = projection(shared, deployment);
  check(!validatePaperAccount(account).length && unitsOf(account.cash) === BigInt(sleeve.cashUnits) && unitsOf(account.btcQuantity) === BigInt(sleeve.positions[SYMBOL]) && unitsOf(account.feesPaid) === BigInt(sleeve.feesPaidUnits), 'SHARED_PROJECTION_MISMATCH', '공식 공유 계좌와 운용 봇의 잔고·수량·비용을 대조하세요.');
  return { account, sleeve };
}
function updateUntradedProjection(workspace, shared, deployment) {
  const account = find(workspace.accounts, deployment.accountId), sleeve = projection(shared, deployment), cash = number(sleeve.cashUnits);
  check(!account.ledger.length && !account.orders.length && account.btcQuantity === 0 && BigInt(sleeve.positions[SYMBOL]) === 0n && account.feesPaid === 0 && cash > 0, 'ATTACHED_CAPITAL_LOCKED', '공유 계좌 연결 이후 자금 변경은 첫 거래 전에 처리하고 양수 잔액을 유지하세요.');
  account.cash = cash; account.initialEquity = cash; account.dayStartEquity = cash; account.dayStartPrice = null; account.averageCost = 0; account.realizedPnl = 0; deployment.capitalAllocation = cash;
  check(!validatePaperAccount(account).length, 'SHARED_PROJECTION_MISMATCH', '초기 자금과 모의 원장을 대조하세요.');
}

export function dispatchSharedWorkspaceAction(workspace, command, options = {}) {
  const { now, ownerId } = inputContext(workspace, options);
  fields(command, ['type', 'payload', 'idempotencyKey', 'expectedRevision'], ['type', 'payload', 'idempotencyKey', 'expectedRevision']);
  check(SHARED_WORKSPACE_ACTIONS.includes(command.type) && identifier(command.idempotencyKey) && Number.isSafeInteger(command.expectedRevision), 'UNSUPPORTED_SHARED_ACTION', '공유 계좌의 등록된 관리 작업을 선택하세요.');
  const fingerprint = hashInputPackage({ type: command.type, payload: command.payload, ownerId }), receipt = workspace.commandReceipts.find(r => r.key === command.idempotencyKey);
  if (receipt) { check(receipt.type === command.type && receipt.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 공유 계좌 요청 ID의 내용이 변경되었습니다.'); return { workspace, result: clone(receipt.result), idempotent: true }; }
  check(command.expectedRevision === workspace.revision, 'REVISION_CONFLICT', '다른 실행이 운용 구성을 갱신했습니다. 최신 상태를 확인하세요.');
  const next = clone(workspace); next.sharedAccounts ??= []; next.revision++; next.updatedAt = now; const p = command.payload; let result;
  if (command.type === 'shared.account.create') {
    fields(p, ['initialCash', 'initialPositions'], ['initialCash']); check(p.initialPositions === undefined || plain(p.initialPositions) && Object.values(p.initialPositions).every(v => v === 0 || v === '0'), 'INITIAL_POSITIONS_UNSUPPORTED', '초기 BTC 수량은 거래 원장을 통해 등록하세요.');
    const account = createSharedAccount({ ownerId, initialCash: p.initialCash, now }); next.sharedAccounts.push(account); audit(next, 'SHARED_ACCOUNT_CREATED', account.id, null, now, ownerId, { initialBalances: account.initialBalances }); result = { sharedAccount: sharedAccountView(account) };
  } else {
    const allowed = command.type === 'deployment.attachShared' ? ['sharedAccountId', 'deploymentId'] : command.type.startsWith('shared.sleeve.') ? ['sharedAccountId', 'deploymentId', 'cash', 'positions', 'allocationRef'] : command.type === 'shared.account.reconcile' ? ['sharedAccountId', 'reportId', 'asOf', 'cash', 'positions', 'sourceRef'] : ['sharedAccountId', 'intentId', 'reportRef'];
    fields(p, allowed, ['sharedAccountId']); let shared = find(next.sharedAccounts, p.sharedAccountId); check(shared.ownerId === ownerId, 'SHARED_ACCOUNT_OWNER_REQUIRED', '공유 계좌 소유자의 권한을 확인하세요.');
    if (command.type === 'deployment.attachShared') {
      check(identifier(p.deploymentId), 'INVALID_SHARED_COMMAND', '공유 계좌에 연결할 운용 봇을 확인하세요.'); const deployment = find(next.deployments, p.deploymentId), account = find(next.accounts, deployment.accountId);
      check(deployment.executionMode === 'paper' && deployment.runtimeStatus !== 'running' && !deployment.sharedAccountId && !next.sharedAccounts.some(a => a.sleeves.some(s => s.deploymentId === deployment.id)), 'SHARED_ATTACH_STATE', '실행을 일시중지하고 연결되지 않은 모의 운용 봇을 선택하세요.');
      check(!validatePaperAccount(account).length && account.ledger.length === 0 && account.orders.length === 0 && account.btcQuantity === 0 && account.cash === account.initialEquity && account.feesPaid === 0, 'SHARED_ATTACH_TRADED_ACCOUNT', '거래 이력이 없는 독립 모의계좌를 연결하세요.');
      const allocation = sharedCommand(shared, 'sleeve.allocate', { deploymentId: deployment.id, cash: unitString(account.initialEquity), allocationRef: internalKey(command.idempotencyKey, 'attachment') }, command.idempotencyKey, now, ownerId); shared = allocation.state; replaceShared(next, shared);
      deployment.sharedAccountId = shared.id; deployment.sleeveId = allocation.result.id; deployment.accountingMode = 'shared-sleeve'; deployment.updatedAt = now; updateUntradedProjection(next, shared, deployment);
      audit(next, 'DEPLOYMENT_SHARED_ACCOUNT_ATTACHED', shared.id, deployment.id, now, ownerId, { accountId: deployment.accountId, sleeveId: deployment.sleeveId, cash: account.initialEquity }); result = { sharedAccount: sharedAccountView(shared), deployment: clone(deployment) };
    } else if (command.type.startsWith('shared.sleeve.')) {
      const deployment = find(next.deployments, p.deploymentId); check(deployment.sharedAccountId === shared.id && deployment.runtimeStatus !== 'running', 'SHARED_ATTACH_STATE', '연결된 모의 운용 봇을 일시중지하고 자금을 변경하세요.'); const checked = verifyProjection(next, shared, deployment);
      check(!checked.account.ledger.length && !checked.account.orders.length, 'ATTACHED_CAPITAL_LOCKED', '거래 이력이 있는 배분 자금은 입출금 원장 지원 후 변경할 수 있습니다.');
      check(p.positions === undefined || plain(p.positions) && Object.values(p.positions).every(v => v === 0 || v === '0'), 'POSITION_ALLOCATION_UNSUPPORTED', 'BTC 수량은 승인된 거래를 통해 변경하세요.');
      const type = command.type.endsWith('.allocate') ? 'sleeve.allocate' : 'sleeve.release', value = sharedCommand(shared, type, { deploymentId: deployment.id, cash: p.cash, allocationRef: p.allocationRef ?? internalKey(command.idempotencyKey, 'capital') }, command.idempotencyKey, now, ownerId); shared = value.state; replaceShared(next, shared); updateUntradedProjection(next, shared, deployment); deployment.updatedAt = now;
      audit(next, type === 'sleeve.allocate' ? 'SHARED_CAPITAL_ALLOCATED' : 'SHARED_CAPITAL_RELEASED', shared.id, deployment.id, now, ownerId, { sleeveId: deployment.sleeveId, cash: p.cash }); audit(next, 'PROPOSAL_INVALIDATED', shared.id, deployment.id, now, ownerId, { reason: '공유 계좌 자금 변경' }); result = { sharedAccount: sharedAccountView(shared), deployment: clone(deployment) };
    } else {
      const type = command.type === 'shared.account.reconcile' ? 'account.reconcile' : command.type.endsWith('.confirm') ? 'order.cancel.confirm' : 'order.cancel.request', payload = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'sharedAccountId'));
      const value = sharedCommand(shared, type, payload, command.idempotencyKey, now, ownerId); shared = value.state; replaceShared(next, shared); audit(next, type === 'account.reconcile' ? 'SHARED_ACCOUNT_RECONCILED' : type === 'order.cancel.confirm' ? 'SHARED_CANCEL_CONFIRMED' : 'SHARED_CANCEL_REQUESTED', shared.id, null, now, ownerId, { result: clone(value.result) }); result = { sharedAccount: sharedAccountView(shared), report: clone(value.result) };
    }
  }
  next.commandReceipts.push({ id: `shared-receipt-${crypto.randomUUID()}`, key: command.idempotencyKey, fingerprint, type: command.type, revision: next.revision, createdAt: now, result: clone(result) });
  return { workspace: next, result, idempotent: false };
}

function normalizedRuntimeAccount(previousAccount, changedAccount, shared, deployment, sourceFill, officialFill) {
  const next = clone(changedAccount), fill = next.ledger.at(-1), sleeve = projection(shared, deployment);
  const quantity = number(officialFill.quantityUnits), gross = number(officialFill.grossUnits), fee = number(officialFill.feeUnits), fillPrice = number(officialFill.priceUnits);
  const quantityTolerance = Number.EPSILON * Math.max(1, sourceFill.quantity) * 8, priceTolerance = .50001e-8 + Number.EPSILON * Math.max(1, sourceFill.fillPrice) * 8;
  const grossTolerance = quantity * priceTolerance + Math.abs(fillPrice) * quantityTolerance + 1.0001e-8 + Number.EPSILON * Math.max(1, sourceFill.gross) * 8;
  const expectedRate = sourceFill.gross ? sourceFill.fee / sourceFill.gross : 0, feeTolerance = grossTolerance * expectedRate + 1.0001e-8 + Number.EPSILON * Math.max(1, sourceFill.fee) * 8;
  check(Math.abs(quantity - sourceFill.quantity) <= quantityTolerance && Math.abs(fillPrice - sourceFill.fillPrice) <= priceTolerance && Math.abs(gross - sourceFill.gross) <= grossTolerance && Math.abs(fee - sourceFill.fee) <= feeTolerance, 'SHARED_ROUNDING_MISMATCH', '공식 정수 원장과 모의 체결의 가격·수량·비용 차이를 확인하세요.');
  const reportedGrossTolerance = Number.EPSILON * Math.max(1, sourceFill.gross) * 16;
  check(Math.abs(sourceFill.gross - sourceFill.quantity * sourceFill.fillPrice) <= reportedGrossTolerance, 'SHARED_GROSS_MISMATCH', '원본 모의 체결의 거래대금을 대조하세요.');
  const policyFeeBps = deployment.feeScheduleSnapshot.feeBps;
  check(Math.abs(sourceFill.fee - sourceFill.gross * policyFeeBps / 10000) <= Number.EPSILON * Math.max(1, sourceFill.fee) * 16, 'SHARED_FEE_MISMATCH', '체결 수수료와 배포에 고정한 요율을 대조하세요.');
  const cashDelta = number(sleeve.cashUnits) - changedAccount.cash, expectedCashDelta = (sourceFill.side === 'buy' ? -(gross - sourceFill.gross) : gross - sourceFill.gross) - (fee - sourceFill.fee);
  check(Math.abs(cashDelta - expectedCashDelta) <= Number.EPSILON * Math.max(1, previousAccount.cash, changedAccount.cash) * 32 && Math.abs(number(sleeve.positions[SYMBOL]) - changedAccount.btcQuantity) <= Number.EPSILON * Math.max(1, changedAccount.btcQuantity) * 32 && Math.abs(number(sleeve.feesPaidUnits) - changedAccount.feesPaid - (fee - sourceFill.fee)) <= Number.EPSILON * Math.max(1, changedAccount.feesPaid) * 32, 'SHARED_PROJECTION_ROUNDING_MISMATCH', '모의 잔고 차이가 체결 반올림 범위와 일치하는지 확인하세요.');
  const beforeQuantity = previousAccount.btcQuantity, afterQuantity = number(sleeve.positions[SYMBOL]);
  const realizedPnl = sourceFill.side === 'sell' ? gross - fee - quantity * previousAccount.averageCost : 0;
  const averageCost = sourceFill.side === 'buy' ? (beforeQuantity * previousAccount.averageCost + gross + fee) / afterQuantity : afterQuantity === 0 ? 0 : previousAccount.averageCost;
  const rounding = { priceDelta: fillPrice - sourceFill.fillPrice, grossDelta: gross - sourceFill.gross, feeDelta: fee - sourceFill.fee, cashDelta: number(sleeve.cashUnits) - changedAccount.cash, source: 'shared-account-integer-8-v1' };
  Object.assign(fill, { quantity, fillPrice, gross, fee, slippageCost: Math.abs(fillPrice - fill.referencePrice) * quantity, realizedPnl, cashAfter: number(sleeve.cashUnits), btcAfter: afterQuantity, averageCostAfter: averageCost, sharedAccountId: shared.id, sleeveId: sleeve.id, officialFillId: officialFill.id, rounding });
  next.cash = fill.cashAfter; next.btcQuantity = afterQuantity; next.averageCost = averageCost; next.realizedPnl = previousAccount.realizedPnl + realizedPnl; next.feesPaid = number(sleeve.feesPaidUnits);
  check(!validatePaperAccount(next).length, 'SHARED_RUNTIME_RECONCILIATION', '공식 공유 계좌와 모의 체결 원장을 대조하세요.'); return { account: next, rounding };
}

function sharedRisk(workspace, shared, fill, dayStartPrice) {
  const guards = [], fail = (code, message) => { const error = new WorkspaceError(code, message); error.guardResults = clone(guards); throw error; };
  const record = (id, ok, data) => { guards.push({ id, version: 'shared-spot-risk-v1', ok, ...data }); return ok; };
  const priorFillTime = shared.fills.reduce((latest, f) => Math.max(latest, Date.parse(f.occurredAt)), -Infinity);
  if (!record('shared-time-sequence', Date.parse(fill.at) >= priorFillTime, { fillAt: fill.at, latestFillAt: Number.isFinite(priorFillTime) ? new Date(priorFillTime).toISOString() : null })) fail('SHARED_TIME_REWIND', '공유 계좌의 마지막 체결 이후 시점을 선택하세요.');
  const referencePrice = fill.referencePrice;
  if (!record('reference-price', finite(referencePrice) && referencePrice > 0, { referencePrice: finite(referencePrice) ? referencePrice : null })) fail('SHARED_REFERENCE_PRICE_REQUIRED', '공유 계좌 평가 가격을 확인하세요.');
  const cashUnits = shared.sleeves.reduce((total, s) => total + BigInt(s.cashUnits), BigInt(shared.unallocated.cashUnits)), quantityUnits = shared.sleeves.reduce((total, s) => total + BigInt(s.positions[SYMBOL]), BigInt(shared.unallocated.positions[SYMBOL]));
  if (!record('shared-sleeve-totals', cashUnits === BigInt(shared.official.cashUnits) && quantityUnits === BigInt(shared.official.positions[SYMBOL]), { cashUnits: cashUnits.toString(), quantityUnits: quantityUnits.toString() })) fail('SHARED_TOTAL_MISMATCH', '공식 잔고와 모든 배분·미배분 자금의 합계를 대조하세요.');
  const qty = unitsOf(fill.quantity), price = unitsOf(fill.fillPrice), numerator = qty * price, gross = fill.side === 'buy' ? (numerator + SCALE - 1n) / SCALE : numerator / SCALE;
  const deployment = find(workspace.deployments, fill.deploymentId), feeRate = unitsOf(deployment.feeScheduleSnapshot.feeBps), fee = (gross * feeRate + 10000n * SCALE - 1n) / (10000n * SCALE);
  const nextCash = cashUnits + (fill.side === 'buy' ? -gross - fee : gross - fee), nextQuantity = quantityUnits + (fill.side === 'buy' ? qty : -qty), equity = number(cashUnits.toString()) + number(quantityUnits.toString()) * referencePrice, nextEquity = number(nextCash.toString()) + number(nextQuantity.toString()) * referencePrice;
  const exposure = equity > 0 ? number(quantityUnits.toString()) * referencePrice / equity : null, nextExposure = nextEquity > 0 ? number(nextQuantity.toString()) * referencePrice / nextEquity : null;
  if (!record('shared-spot-exposure', nextCash >= 0n && nextQuantity >= 0n && equity > 0 && nextEquity > 0 && exposure <= 1 + 1e-12 && nextExposure <= 1 + 1e-12, { equity, nextEquity, exposure, nextExposure, accountMaxExposure: 1, instrumentMaxExposure: 1 })) fail('SHARED_EXPOSURE_LIMIT', '공유 계좌의 현물 자금·보유·총 비중 한도를 확인하세요.');
  const dayStartAt = fill.at.slice(0, 10) + 'T00:00:00.000Z', dayStartTime = Date.parse(dayStartAt);
  let openingCash = BigInt(shared.initialBalances.cashUnits), openingQuantity = BigInt(shared.initialBalances.positions[SYMBOL]);
  for (const past of shared.fills.filter(f => Date.parse(f.occurredAt) < dayStartTime)) { const g = BigInt(past.grossUnits), f = BigInt(past.feeUnits), q = BigInt(past.quantityUnits); openingCash += past.side === 'buy' ? -g - f : g - f; openingQuantity += past.side === 'buy' ? q : -q; }
  const attached = workspace.deployments.filter(d => d.sharedAccountId === shared.id), limits = attached.map(d => workspace.riskPresetVersions.find(v => v.id === d.riskPresetVersionId)?.settings.dailyLossLimit);
  if (!record('shared-risk-policies', limits.length > 0 && limits.every(v => finite(v) && v > 0 && v <= 1), { attachedDeploymentIds: attached.map(d => d.id), dailyLossLimits: limits.map(v => finite(v) ? v : null) })) fail('SHARED_RISK_POLICY_REQUIRED', '연결된 운용 봇의 일일 손실 한도를 확인하세요.');
  const dailyLossLimit = Math.min(...limits), priceReady = finite(dayStartPrice) && dayStartPrice > 0;
  if (fill.side === 'buy' && !record('shared-day-mark', priceReady, { dayStartAt, dayStartPrice: priceReady ? dayStartPrice : null })) fail('SHARED_DAY_MARK_REQUIRED', '해당 UTC 날짜의 시작 가격을 확인한 뒤 매수를 실행하세요.');
  const dayStartEquity = priceReady ? number(openingCash.toString()) + number(openingQuantity.toString()) * dayStartPrice : null;
  const dailyAllowed = fill.side === 'sell' || dayStartEquity > 0 && equity > dayStartEquity * (1 - dailyLossLimit) && nextEquity > dayStartEquity * (1 - dailyLossLimit);
  if (!record('shared-daily-loss', dailyAllowed, { side: fill.side, dailyLossLimit, dayStartAt, dayStartPrice: priceReady ? dayStartPrice : null, openingCashUnits: openingCash.toString(), openingQuantityUnits: openingQuantity.toString(), dayStartEquity, currentEquity: equity, proposedEquity: nextEquity, sellRiskReductionAllowed: fill.side === 'sell' })) fail('SHARED_DAILY_LOSS_LIMIT', '공유 계좌의 일일 손실 한도에 도달해 새 매수를 중지했습니다.');
  return guards;
}

/** Trusted post-execution mirror; callers never supply order/fill amounts through an HTTP action. */
export function mirrorSharedExecution(previous, changed, executionInput, options = {}) {
  const changedResult = changed?.workspace ? changed : { workspace: changed, result: null }, next = clone(changedResult.workspace), { now, ownerId } = inputContext(previous, options);
  check(identifier(executionInput?.deploymentId) && identifier(executionInput?.decisionId) && identifier(executionInput?.idempotencyKey), 'INVALID_SHARED_EXECUTION', '실행 결과의 운용 봇·결정·주문 ID를 확인하세요.');
  const deployment = find(next.deployments, executionInput.deploymentId); if (!deployment.sharedAccountId) return { ...changedResult, mirrored: false };
  const priorDeployment = find(previous.deployments, deployment.id); check(priorDeployment.sharedAccountId === deployment.sharedAccountId, 'SHARED_EXECUTION_SCOPE', '동일 변경에서의 공유 계좌 연결을 확인하세요.');
  const shared = find(previous.sharedAccounts ?? [], deployment.sharedAccountId); check(shared.ownerId === ownerId && !validateSharedAccount(shared).length, 'SHARED_ACCOUNT_OWNER_REQUIRED', '공식 공유 계좌 소유자의 권한을 확인하세요.');
  if (changedResult.idempotent === true && next.revision === previous.revision) {
    const checked = verifyProjection(next, shared, deployment), fill = checked.account.ledger.find(e => e.clientOrderId === executionInput.idempotencyKey && e.decisionId === executionInput.decisionId), official = shared.fills.find(f => f.id === fill?.id);
    check(official?.deploymentId === deployment.id && official.provenanceRefs.decisionId === executionInput.decisionId, 'SHARED_IDEMPOTENT_RESULT_MISSING', '중복 실행 결과와 공식 체결 기록을 대조하세요.');
    return { ...changedResult, mirrored: true };
  }
  check(next.revision === previous.revision + 1, 'SHARED_EXECUTION_SCOPE', '공유 체결을 동일한 저장 변경에 반영하세요.');
  const verified = verifyProjection(previous, shared, priorDeployment), account = find(next.accounts, deployment.accountId), priorAccount = verified.account, record = find(next.decisionRecords, executionInput.decisionId);
  check(record.deploymentId === deployment.id && account.ledger.length === priorAccount.ledger.length + 1 && priorAccount.ledger.every((fill, i) => stableStringify(fill) === stableStringify(account.ledger[i])) && priorAccount.orders.every((order, i) => stableStringify(order) === stableStringify(account.orders[i])) && account.orders.length === priorAccount.orders.length + 1, 'SHARED_EXECUTION_SCOPE', '기존 원장을 보존하고 해당 봇의 새 체결 한 건을 확인하세요.');
  const fill = account.ledger.at(-1); check(fill.decisionId === record.id && fill.deploymentId === deployment.id && fill.clientOrderId === executionInput.idempotencyKey && fill.side === record.decision.action && record.decisionStatus === 'READY', 'SHARED_FILL_ATTRIBUTION', '체결과 승인된 선택 결과의 귀속을 대조하세요.');
  for (const field of ['investmentProfileId', 'investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'memoryVersionId']) check(fill[field] === record[field], 'SHARED_FILL_VERSION_MISMATCH', '체결에 연결된 정책·기억·프로필 버전을 대조하세요.');
  check(fill.feeScheduleSnapshotId === deployment.feeScheduleSnapshot.id && !validatePaperAccount(account).length, 'SHARED_FILL_VERSION_MISMATCH', '체결 요율과 모의 원장을 확인하세요.');
  check(stableStringify(next.sharedAccounts ?? []) === stableStringify(previous.sharedAccounts ?? []), 'SHARED_EXECUTION_SCOPE', '공식 공유 계좌 변경은 체결 반영 단계에서 처리하세요.');
  const guardResults = sharedRisk(previous, shared, fill, options.dayStartPrice);
  const sourceRefs = [...new Set([record.mechanicalModelVersionId, record.decisionContractVersionId, record.fusionPolicyVersionId, record.marketSnapshotId, ...(record.noteRevisionRefs ?? []).map(n => n.id), ...(record.decision.evidenceRefs ?? [])].filter(identifier))].slice(0, 32);
  const provenanceRefs = { decisionId: record.id, inputPackageHash: record.inputPackageHash, investmentProfileId: record.investmentProfileId, investmentProfileVersionId: record.investmentProfileVersionId, strategyVersionId: record.strategyVersionId, riskPresetVersionId: record.riskPresetVersionId, mechanicalModelVersionId: record.mechanicalModelVersionId, decisionContractVersionId: record.decisionContractVersionId, fusionPolicyVersionId: record.fusionPolicyVersionId, feeScheduleSnapshotId: deployment.feeScheduleSnapshot.id, memoryVersionId: record.memoryVersionId, sourceRefs, correlationId: record.correlationId };
  const intentId = `intent-${fill.id}`, reserved = sharedCommand(shared, 'order.reserve', { intentId, deploymentId: deployment.id, symbol: SYMBOL, side: fill.side, quantity: unitString(fill.quantity, 'BTC 수량'), limitPrice: unitString(fill.fillPrice, '체결 가격'), feeBps: deployment.feeScheduleSnapshot.feeBps, asOf: fill.decisionAt, provenanceRefs }, `${executionInput.idempotencyKey}:mirror-reserve`, now, ownerId);
  const filled = sharedCommand(reserved.state, 'order.fill', { intentId, fillId: fill.id, quantity: unitString(fill.quantity), price: unitString(fill.fillPrice), occurredAt: fill.at, reportRef: `runtime-${fill.id}` }, `${executionInput.idempotencyKey}:mirror-fill`, now, ownerId);
  next.sharedAccounts = clone(previous.sharedAccounts); replaceShared(next, filled.state);
  const normalized = normalizedRuntimeAccount(priorAccount, account, filled.state, deployment, fill, filled.result.fill), accountIndex = next.accounts.findIndex(a => a.id === account.id); next.accounts[accountIndex] = normalized.account;
  normalized.account.ledger.at(-1).sharedGuardResults = clone(guardResults);
  for (const receipt of next.commandReceipts) if (receipt.key === executionInput.idempotencyKey && receipt.result?.account?.id === account.id) { receipt.result.account = clone(normalized.account); receipt.result.sharedAccountId = shared.id; receipt.result.officialFillId = fill.id; }
  audit(next, 'SHARED_RISK_CHECKED', shared.id, deployment.id, now, ownerId, { decisionId: record.id, fillId: fill.id, guardResults }, record.correlationId);
  audit(next, 'SHARED_FILL_MIRRORED', shared.id, deployment.id, now, ownerId, { decisionId: record.id, runtimeAccountId: account.id, fillId: fill.id, intentId, officialGrossUnits: filled.result.fill.grossUnits, officialFeeUnits: filled.result.fill.feeUnits, rounding: normalized.rounding }, record.correlationId);
  verifyProjection(next, filled.state, deployment);
  const result = changedResult.result ? { ...clone(changedResult.result), account: clone(normalized.account), sharedAccountId: shared.id, officialFillId: fill.id } : null;
  return { ...changedResult, workspace: next, result, mirrored: true };
}
