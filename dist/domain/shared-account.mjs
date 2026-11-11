import { hashInputPackage, stableStringify } from './workspace.mjs';

export const SHARED_ACCOUNT_SCHEMA_VERSION = 1;
export const SHARED_ACCOUNT_ACTIONS = Object.freeze(['sleeve.allocate', 'sleeve.release', 'order.reserve', 'order.fill', 'order.cancel.request', 'order.cancel.confirm', 'account.reconcile']);
export const SHARED_ACCOUNT_ASSUMPTIONS = Object.freeze([
  'BTC 현물·USDT 기준의 paper 계좌를 처리한다. 수량과 USDT는 소수 8자리 정수 문자열로 보존한다.',
  'price는 이미 슬리피지를 반영한 체결 가격이다. 이 모듈은 추가 슬리피지를 적용하지 않는다.',
  '부분 체결의 거래대금과 수수료는 주문 누적 금액에서 반올림 차이를 계산한다. 매수 대금은 올림, 매도 대금은 내림, 수수료는 올림한다.',
  '취소 요청은 예약을 유지한다. 취소 확인 후 남은 예약을 해제한다. 확인 뒤 새 체결 보고는 대조와 별도 검토가 필요하다.',
  '외부 잔고 차이는 관측 보고서로 보존하고 신규 자금 배분과 주문 예약을 중지한다. 소유가 확인된 기존 주문의 체결·취소 보고는 처리한다.',
]);
const SCALE = 100000000n, ZERO = '0', SYMBOL = 'BTCUSDT';
const feeFor = (gross, rate) => ceil(gross * units(rate, '수수료율'), 10000n * SCALE);
const ROOT_KEYS = ['schemaVersion', 'id', 'ownerId', 'mode', 'currency', 'revision', 'createdAt', 'updatedAt', 'status', 'initialBalances', 'official', 'unallocated', 'sleeves', 'orderIntents', 'reservations', 'fills', 'ledger', 'events', 'receipts', 'reconciliationReports'];
const clone = value => structuredClone(value);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const unit = value => typeof value === 'string' && /^(0|[1-9]\d{0,24})$/.test(value);
const I = value => BigInt(value);
const ceil = (n, d) => (n + d - 1n) / d;
const freshId = prefix => `${prefix}-${crypto.randomUUID()}`;
export class SharedAccountError extends Error { constructor(code, message) { super(message); this.name = 'SharedAccountError'; this.code = code; } }
const check = (condition, code, message) => { if (!condition) throw new SharedAccountError(code, message); };
const fields = (input, allowed, required = []) => check(plain(input) && Object.keys(input).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(input, key)), 'INVALID_INPUT', '공유 계좌 입력 항목을 확인하세요.');
function units(value, label = '금액', positive = false) {
  let decimal = value;
  if (typeof value === 'number') {
    check(Number.isFinite(value) && value >= 0 && value < 1e15, 'INVALID_AMOUNT', `${label}의 범위를 확인하세요.`);
    decimal = value.toFixed(8);
    check(Math.abs(Number(decimal) - value) <= Number.EPSILON * Math.max(1, value) * 2, 'AMOUNT_PRECISION', `${label}은 소수 8자리까지 입력하세요.`);
  }
  check(typeof decimal === 'string' && /^(0|[1-9]\d{0,14})(\.\d{1,8})?$/.test(decimal), 'INVALID_AMOUNT', `${label}의 단위를 확인하세요.`);
  const [whole, fraction = ''] = decimal.split('.'), result = I(whole) * SCALE + I(fraction.padEnd(8, '0'));
  check(!positive || result > 0n, 'INVALID_AMOUNT', `${label}은 0보다 커야 합니다.`);
  return result;
}
const number = value => Number(value) / Number(SCALE);
function positions(value = {}) {
  fields(value, [SYMBOL]);
  return { [SYMBOL]: units(value[SYMBOL] ?? 0, 'BTC 수량').toString() };
}
function balance(cashUnits = ZERO, quantityUnits = ZERO) { return { cashUnits, positions: { [SYMBOL]: quantityUnits } }; }
function provenance(input) {
  const allowed = ['decisionId', 'inputPackageHash', 'investmentProfileId', 'investmentProfileVersionId', 'strategyVersionId', 'mechanicalModelVersionId','decisionContractVersionId','fusionPolicyVersionId','riskPresetVersionId', 'feeScheduleSnapshotId', 'memoryVersionId', 'sourceRefs', 'correlationId'];
  fields(input, allowed, ['decisionId', 'inputPackageHash', 'strategyVersionId', 'riskPresetVersionId', 'feeScheduleSnapshotId']);
  check(/^[a-f0-9]{64}$/i.test(input.inputPackageHash) && allowed.filter(key => key !== 'inputPackageHash' && key !== 'sourceRefs').every(key => input[key] === undefined || identifier(input[key])), 'INVALID_PROVENANCE', '결정·정책·비용 버전의 참조를 확인하세요.');
  const refs = input.sourceRefs ?? [];
  check(Array.isArray(refs) && refs.length <= 32 && new Set(refs).size === refs.length && refs.every(identifier), 'INVALID_PROVENANCE', '가격과 근거 출처 참조를 확인하세요.');
  return { ...clone(input), sourceRefs: [...refs] };
}
function find(items, id, code) { const found = items.find(item => item.id === id); check(found, code, '선택한 공유 계좌 항목을 찾을 수 없습니다.'); return found; }
const sleeveFor = (state, deploymentId) => { const found = state.sleeves.find(item => item.deploymentId === deploymentId); check(found, 'SLEEVE_NOT_FOUND', '운용 봇의 자금 배분을 먼저 확인하세요.'); return found; };
const activeReservation = (state, intent) => find(state.reservations, intent.reservationId, 'RESERVATION_NOT_FOUND');
function reserved(state, deploymentId) {
  return state.reservations.filter(item => item.deploymentId === deploymentId && item.status === 'ACTIVE').reduce((sum, item) => ({ cash: sum.cash + I(item.cashUnits), quantity: sum.quantity + I(item.quantityUnits) }), { cash: 0n, quantity: 0n });
}
function move(target, cash, quantity) {
  const nextCash = I(target.cashUnits) + cash, nextQuantity = I(target.positions[SYMBOL]) + quantity;
  check(nextCash >= 0n && nextQuantity >= 0n, 'INSUFFICIENT_BALANCE', '소유한 현금과 BTC 수량을 확인하세요.');
  target.cashUnits = nextCash.toString(); target.positions[SYMBOL] = nextQuantity.toString();
}
function log(state, type, now, actorId, command, payload, refs = null) {
  const record = { id: `shared-event-${hashInputPackage({ accountId: state.id, revision: state.revision + 1, type, commandKey: command.idempotencyKey, index: state.events.length })}`, eventType: type, occurredAt: now, actorId, sharedAccountId: state.id, aggregateVersion: state.revision + 1, commandKey: command.idempotencyKey, deploymentId: payload.deploymentId ?? null, payload: clone(payload), provenanceRefs: clone(refs) };
  state.events.push(record); return record;
}
function entry(state, type, payload, command, now) { state.ledger.push({ id: `shared-entry-${hashInputPackage({ accountId: state.id, revision: state.revision + 1, type, commandKey: command.idempotencyKey, index: state.ledger.length })}`, type, ...clone(payload), commandKey: command.idempotencyKey, recordedAt: now }); }
function releaseReservation(reservation) { reservation.status = 'RELEASED'; reservation.cashUnits = ZERO; reservation.quantityUnits = ZERO; }

export function createSharedAccount({ id = freshId('shared'), ownerId, initialCash = 100000, initialPositions = {}, now = new Date().toISOString() } = {}) {
  check(identifier(id) && identifier(ownerId) && iso(now), 'INVALID_ACCOUNT', '공유 계좌 소유자·식별자·시각을 확인하세요.');
  const initialBalances = { cashUnits: units(initialCash, '초기 자금').toString(), positions: positions(initialPositions) };
  return { schemaVersion: 1, id, ownerId, mode: 'paper', currency: 'USDT', revision: 0, createdAt: now, updatedAt: now, status: 'READY', initialBalances, official: { ...clone(initialBalances), feesPaidUnits: ZERO }, unallocated: clone(initialBalances), sleeves: [], orderIntents: [], reservations: [], fills: [], ledger: [], events: [], receipts: [], reconciliationReports: [] };
}

function allocate(state, payload, command, now, actorId, release) {
  fields(payload, ['deploymentId', 'cash', 'positions', 'allocationRef'], ['deploymentId', 'allocationRef']);
  check(identifier(payload.deploymentId) && identifier(payload.allocationRef), 'INVALID_ALLOCATION', '자금 배분의 운용 봇과 승인 참조를 확인하세요.');
  if (!release) check(state.status === 'READY', 'RECONCILIATION_REQUIRED', '공유 계좌 대조를 완료한 뒤 자금을 배분하세요.');
  const cash = units(payload.cash ?? 0), quantity = I(positions(payload.positions)[SYMBOL]);
  check(cash + quantity > 0n, 'EMPTY_ALLOCATION', '배분할 자금을 입력하세요.');
  let sleeve = state.sleeves.find(item => item.deploymentId === payload.deploymentId);
  if (!sleeve) {
    check(!release, 'SLEEVE_NOT_FOUND', '운용 봇의 자금 배분을 확인하세요.');
    sleeve = { id: `sleeve:${payload.deploymentId}`, deploymentId: payload.deploymentId, ...balance(), feesPaidUnits: ZERO, createdAt: now };
    state.sleeves.push(sleeve);
  }
  if (release) { const hold = reserved(state, sleeve.deploymentId); check(I(sleeve.cashUnits) - hold.cash >= cash && I(sleeve.positions[SYMBOL]) - hold.quantity >= quantity, 'FUNDS_RESERVED', '대기 주문에 예약한 자금을 해제할 수 없습니다.'); }
  move(release ? sleeve : state.unallocated, -cash, -quantity); move(release ? state.unallocated : sleeve, cash, quantity);
  const value = { deploymentId: sleeve.deploymentId, cashUnits: cash.toString(), quantityUnits: quantity.toString(), allocationRef: payload.allocationRef };
  entry(state, release ? 'RELEASE' : 'ALLOCATE', value, command, now); log(state, release ? 'SLEEVE_RELEASED' : 'SLEEVE_ALLOCATED', now, actorId, command, value);
  return clone(sleeve);
}

function reserveOrder(state, p, command, now, actorId) {
  fields(p, ['intentId', 'deploymentId', 'symbol', 'side', 'quantity', 'limitPrice', 'feeBps', 'asOf', 'provenanceRefs'], ['intentId', 'deploymentId', 'symbol', 'side', 'quantity', 'limitPrice', 'feeBps', 'asOf', 'provenanceRefs']);
  check(state.status === 'READY', 'RECONCILIATION_REQUIRED', '공유 계좌 대조를 완료한 뒤 주문을 예약하세요.');
  check(identifier(p.intentId) && identifier(p.deploymentId) && p.symbol === SYMBOL && ['buy', 'sell'].includes(p.side) && typeof p.feeBps === 'number' && Number.isFinite(p.feeBps) && p.feeBps >= 0 && p.feeBps <= 1000 && iso(p.asOf) && Date.parse(p.asOf) <= Date.parse(now), 'INVALID_INTENT', '현물 주문의 소유·수량·가격·요율·시각을 확인하세요.');
  check(!state.orderIntents.some(item => item.id === p.intentId), 'INTENT_ID_CONFLICT', '주문 의도 식별자를 다시 사용할 수 없습니다.');
  const sleeve = sleeveFor(state, p.deploymentId), quantity = units(p.quantity, '주문 수량', true), price = units(p.limitPrice, '주문 경계 가격', true), refs = provenance(p.provenanceRefs), hold = reserved(state, p.deploymentId);
  const gross = ceil(quantity * price, SCALE), cash = p.side === 'buy' ? gross + feeFor(gross, p.feeBps) : 0n, lockedQuantity = p.side === 'sell' ? quantity : 0n;
  check(I(sleeve.cashUnits) - hold.cash >= cash && I(sleeve.positions[SYMBOL]) - hold.quantity >= lockedQuantity, 'INSUFFICIENT_AVAILABLE_BALANCE', '해당 운용 봇의 사용 가능한 현금과 BTC 수량을 확인하세요.');
  const reservation = { id: `reservation:${p.intentId}`, intentId: p.intentId, deploymentId: p.deploymentId, cashUnits: cash.toString(), quantityUnits: lockedQuantity.toString(), status: 'ACTIVE' };
  const intent = { id: p.intentId, deploymentId: p.deploymentId, symbol: SYMBOL, side: p.side, quantityUnits: quantity.toString(), limitPriceUnits: price.toString(), feeBps: p.feeBps, asOf: p.asOf, createdAt: now, status: 'OPEN', reservationId: reservation.id, filledQuantityUnits: ZERO, grossUnits: ZERO, feeUnits: ZERO, notionalNumerator: ZERO, provenanceRefs: refs, reserveFingerprint: hashInputPackage(p) };
  state.orderIntents.push(intent); state.reservations.push(reservation); log(state, 'ORDER_INTENT_RESERVED', now, actorId, command, { intentId: intent.id, deploymentId: intent.deploymentId, reservationId: reservation.id }, refs);
  return { orderIntent: clone(intent), reservation: clone(reservation) };
}

function fillOrder(state, p, command, now, actorId) {
  fields(p, ['intentId', 'fillId', 'quantity', 'price', 'feeQuote', 'feeCurrency', 'occurredAt', 'reportRef'], ['intentId', 'fillId', 'quantity', 'price', 'occurredAt', 'reportRef']);
  check(identifier(p.intentId) && identifier(p.fillId) && identifier(p.reportRef) && (p.feeCurrency === undefined || p.feeCurrency === 'USDT') && iso(p.occurredAt) && Date.parse(p.occurredAt) <= Date.parse(now), 'INVALID_FILL', '체결 보고의 식별자·비용 통화·시각을 확인하세요.');
  const intent = find(state.orderIntents, p.intentId, 'INTENT_NOT_FOUND');
  check(['OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'].includes(intent.status), 'ORDER_CLOSED', '종료된 주문의 새 체결 보고는 계좌 대조와 별도 확인이 필요합니다.');
  check(Date.parse(p.occurredAt) >= Date.parse(intent.asOf), 'FILL_TIME_MISMATCH', '주문 의도의 기준 시점 이후 체결을 확인하세요.');
  const quantity = units(p.quantity, '체결 수량', true), price = units(p.price, '체결 가격', true), remaining = I(intent.quantityUnits) - I(intent.filledQuantityUnits);
  check(quantity <= remaining, 'OVERFILL', '체결 수량이 주문 잔량을 넘었습니다.');
  check(intent.side === 'buy' ? price <= I(intent.limitPriceUnits) : price >= I(intent.limitPriceUnits), 'FILL_PRICE_LIMIT', '체결 가격이 예약한 주문 가격 범위를 벗어났습니다.');
  const numerator = I(intent.notionalNumerator) + quantity * price, cumulativeGross = intent.side === 'buy' ? ceil(numerator, SCALE) : numerator / SCALE;
  const cumulativeFee = feeFor(cumulativeGross, intent.feeBps), gross = cumulativeGross - I(intent.grossUnits), fee = cumulativeFee - I(intent.feeUnits);
  if (p.feeQuote !== undefined) check(units(p.feeQuote, '보고 수수료') === fee, 'FEE_MISMATCH', '체결 보고 수수료와 고정된 모의 비용 산식을 대조하세요.');
  const reservation = activeReservation(state, intent), sleeve = sleeveFor(state, intent.deploymentId), cashChange = intent.side === 'buy' ? -gross - fee : gross - fee, quantityChange = intent.side === 'buy' ? quantity : -quantity;
  check(reservation.status === 'ACTIVE' && (intent.side === 'buy' ? I(reservation.cashUnits) >= gross + fee : I(reservation.quantityUnits) >= quantity), 'RESERVATION_EXHAUSTED', '체결에 필요한 예약 잔액을 확인하세요.');
  move(state.official, cashChange, quantityChange); move(sleeve, cashChange, quantityChange);
  state.official.feesPaidUnits = (I(state.official.feesPaidUnits) + fee).toString(); sleeve.feesPaidUnits = (I(sleeve.feesPaidUnits) + fee).toString();
  if (intent.side === 'buy') reservation.cashUnits = (I(reservation.cashUnits) - gross - fee).toString(); else reservation.quantityUnits = (I(reservation.quantityUnits) - quantity).toString();
  intent.filledQuantityUnits = (I(intent.filledQuantityUnits) + quantity).toString(); intent.notionalNumerator = numerator.toString(); intent.grossUnits = cumulativeGross.toString(); intent.feeUnits = cumulativeFee.toString();
  if (intent.filledQuantityUnits === intent.quantityUnits) { intent.status = 'FILLED'; releaseReservation(reservation); }
  else if (intent.status !== 'CANCEL_REQUESTED') intent.status = 'PARTIALLY_FILLED';
  const fill = { id: p.fillId, intentId: intent.id, deploymentId: intent.deploymentId, symbol: SYMBOL, side: intent.side, quantityUnits: quantity.toString(), priceUnits: price.toString(), grossUnits: gross.toString(), feeUnits: fee.toString(), occurredAt: p.occurredAt, recordedAt: now, reportRef: p.reportRef, fingerprint: hashInputPackage(p), provenanceRefs: clone(intent.provenanceRefs) };
  state.fills.push(fill); entry(state, 'FILL', { fillId: fill.id }, command, now); log(state, 'FILL_RECORDED', now, actorId, command, { fillId: fill.id, intentId: intent.id, deploymentId: intent.deploymentId }, intent.provenanceRefs);
  return { fill: clone(fill), orderIntent: clone(intent), reservation: clone(reservation) };
}

function cancelOrder(state, p, command, now, actorId, confirm) {
  fields(p, ['intentId', 'reportRef'], ['intentId', 'reportRef']); check(identifier(p.reportRef), 'INVALID_CANCEL', '취소의 요청·확인 보고 참조를 입력하세요.');
  const intent = find(state.orderIntents, p.intentId, 'INTENT_NOT_FOUND');
  if (intent.status === 'FILLED' || intent.status === 'CANCELED') { log(state, 'ORDER_CANCEL_ALREADY_TERMINAL', now, actorId, command, { intentId: intent.id, deploymentId: intent.deploymentId, reportRef: p.reportRef, terminalStatus: intent.status }, intent.provenanceRefs); return clone(intent); }
  if (confirm) { check(intent.status === 'CANCEL_REQUESTED', 'CANCEL_NOT_REQUESTED', '취소 요청 이후의 확인 보고를 처리하세요.'); intent.status = 'CANCELED'; releaseReservation(activeReservation(state, intent)); }
  else intent.status = 'CANCEL_REQUESTED';
  log(state, confirm ? 'ORDER_CANCEL_CONFIRMED' : 'ORDER_CANCEL_REQUESTED', now, actorId, command, { intentId: intent.id, deploymentId: intent.deploymentId, reportRef: p.reportRef }, intent.provenanceRefs);
  return clone(intent);
}

function reconcile(state, p, command, now, actorId) {
  fields(p, ['reportId', 'asOf', 'cash', 'positions', 'sourceRef'], ['reportId', 'asOf', 'cash', 'positions', 'sourceRef']);
  check(identifier(p.reportId) && identifier(p.sourceRef) && iso(p.asOf) && Date.parse(p.asOf) <= Date.parse(now), 'INVALID_RECONCILIATION', '잔고 대조 보고의 출처와 시각을 확인하세요.');
  const latestFill = state.fills.reduce((latest, fill) => Math.max(latest, Date.parse(fill.occurredAt)), Date.parse(state.createdAt));
  const latestReport = state.reconciliationReports.at(-1);
  check(Date.parse(p.asOf) >= latestFill && (!latestReport || Date.parse(p.asOf) >= Date.parse(latestReport.asOf)), 'STALE_RECONCILIATION', '최근 체결과 대조 보고 이후의 잔고를 확인하세요.');
  const observed = { cashUnits: units(p.cash, '공식 현금').toString(), positions: positions(p.positions) }, expected = { cashUnits: state.official.cashUnits, positions: clone(state.official.positions) };
  const matched = stableStringify(observed) === stableStringify(expected);
  const record = { ledgerLength: state.ledger.length, id: p.reportId, asOf: p.asOf, sourceRef: p.sourceRef, observed, expected, matched, cashDeltaUnits: (I(observed.cashUnits) - I(expected.cashUnits)).toString(), quantityDeltaUnits: (I(observed.positions[SYMBOL]) - I(expected.positions[SYMBOL])).toString(), fingerprint: hashInputPackage(p), recordedAt: now };
  state.reconciliationReports.push(record); state.status = matched ? 'READY' : 'RECONCILIATION_REQUIRED';
  log(state, matched ? 'ACCOUNT_RECONCILED' : 'ACCOUNT_RECONCILIATION_REQUIRED', now, actorId, command, { reportId: p.reportId, matched, sourceRef: p.sourceRef });
  return clone(record);
}

export function dispatchSharedAccount(state, command, { actorId, now = new Date().toISOString() } = {}) {
  check(validateSharedAccount(state).length === 0, 'INVALID_SHARED_ACCOUNT', '공유 계좌의 원장과 예약을 대조하세요.');
  fields(command, ['type', 'payload', 'idempotencyKey', 'expectedRevision'], ['type', 'payload', 'idempotencyKey', 'expectedRevision']);
  check(actorId === state.ownerId && identifier(actorId), 'ACCOUNT_OWNER_REQUIRED', '공유 계좌 소유자의 실행 권한을 확인하세요.');
  check(SHARED_ACCOUNT_ACTIONS.includes(command.type) && identifier(command.idempotencyKey) && Number.isSafeInteger(command.expectedRevision) && command.expectedRevision >= 0 && iso(now), 'INVALID_COMMAND', '명령·중복 키·계좌 버전·시각을 확인하세요.');
  const fingerprint = hashInputPackage({ type: command.type, payload: command.payload, actorId }), receipt = state.receipts.find(item => item.key === command.idempotencyKey);
  if (receipt) { check(receipt.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 명령 키의 내용이 변경됐습니다.'); return { state, result: clone(receipt.result), idempotent: true }; }
  const repeated = command.type === 'order.fill' ? state.fills.find(item => item.id === command.payload?.fillId) : command.type === 'account.reconcile' ? state.reconciliationReports.find(item => item.id === command.payload?.reportId) : command.type === 'order.reserve' ? state.orderIntents.find(item => item.id === command.payload?.intentId) : null;
  if (repeated) { check((repeated.reserveFingerprint || repeated.fingerprint) === hashInputPackage(command.payload), command.type === 'order.fill' ? 'FILL_ID_CONFLICT' : command.type === 'order.reserve' ? 'INTENT_ID_CONFLICT' : 'REPORT_ID_CONFLICT', '같은 보고 식별자의 내용이 변경됐습니다.'); const intent = command.type === 'order.fill' ? find(state.orderIntents, repeated.intentId, 'INTENT_NOT_FOUND') : command.type === 'order.reserve' ? repeated : null; return { state, result: intent ? { ...(command.type === 'order.fill' ? { fill: clone(repeated) } : {}), orderIntent: clone(intent), reservation: clone(activeReservation(state, intent)) } : clone(repeated), idempotent: true }; }
  check(command.expectedRevision === state.revision, 'REVISION_CONFLICT', '공유 계좌가 변경됐습니다. 최신 상태로 다시 계산하세요.');
  check(Date.parse(now) >= Date.parse(state.updatedAt), 'INVALID_TIME', '마지막 공유 계좌 변경 이후의 기록 시각을 확인하세요.');
  const next = clone(state), p = command.payload; let result;
  if (command.type === 'sleeve.allocate' || command.type === 'sleeve.release') result = allocate(next, p, command, now, actorId, command.type === 'sleeve.release');
  else if (command.type === 'order.reserve') result = reserveOrder(next, p, command, now, actorId);
  else if (command.type === 'order.fill') result = fillOrder(next, p, command, now, actorId);
  else if (command.type === 'order.cancel.request' || command.type === 'order.cancel.confirm') result = cancelOrder(next, p, command, now, actorId, command.type === 'order.cancel.confirm');
  else result = reconcile(next, p, command, now, actorId);
  next.revision++; next.updatedAt = now;
  next.receipts.push({ key: command.idempotencyKey, fingerprint, revision: next.revision, type: command.type, result: clone(result), createdAt: now });
  check(validateSharedAccount(next).length === 0, 'SHARED_ACCOUNT_INVARIANT', '명령 이후 현금·수량·예약·수수료 원장을 대조하세요.');
  return { state: next, result, idempotent: false };
}

export function validateSharedAccount(state) {
  try {
    fields(state, ROOT_KEYS, ROOT_KEYS);
    stableStringify(state);
    check(state.schemaVersion === 1 && identifier(state.id) && identifier(state.ownerId) && state.mode === 'paper' && state.currency === 'USDT' && Number.isSafeInteger(state.revision) && state.revision >= 0 && iso(state.createdAt) && iso(state.updatedAt) && Date.parse(state.updatedAt) >= Date.parse(state.createdAt) && ['READY', 'RECONCILIATION_REQUIRED'].includes(state.status), 'INVALID_SHARED_ACCOUNT', '공유 계좌의 범위와 버전을 확인하세요.');
    for (const key of ['sleeves', 'orderIntents', 'reservations', 'fills', 'ledger', 'events', 'receipts', 'reconciliationReports']) check(Array.isArray(state[key]) && state[key].length <= 20000, 'INVALID_COLLECTION', '공유 계좌 기록의 범위를 확인하세요.');
    const validBalance = value => plain(value) && unit(value.cashUnits) && plain(value.positions) && Object.keys(value.positions).length === 1 && unit(value.positions[SYMBOL]);
    check(validBalance(state.initialBalances) && validBalance(state.official) && unit(state.official.feesPaidUnits) && validBalance(state.unallocated), 'INVALID_BALANCE', '현금과 BTC의 정수 단위를 확인하세요.');
    const unique = (items, field) => new Set(items.map(item => item[field])).size === items.length;
    check(unique(state.sleeves, 'deploymentId') && unique(state.orderIntents, 'id') && unique(state.reservations, 'id') && unique(state.fills, 'id') && unique(state.receipts, 'key') && unique(state.reconciliationReports, 'id') && unique(state.ledger, 'id') && unique(state.events, 'id'), 'DUPLICATE_RECORD', '소유·주문·보고의 고유 식별자를 확인하세요.');
    let cash = I(state.unallocated.cashUnits), quantity = I(state.unallocated.positions[SYMBOL]), fees = 0n;
    for (const sleeve of state.sleeves) { check(identifier(sleeve.deploymentId) && sleeve.id === `sleeve:${sleeve.deploymentId}` && validBalance(sleeve) && unit(sleeve.feesPaidUnits), 'INVALID_SLEEVE', '운용 봇의 가상 원장을 확인하세요.'); const hold = reserved(state, sleeve.deploymentId); check(hold.cash <= I(sleeve.cashUnits) && hold.quantity <= I(sleeve.positions[SYMBOL]), 'RESERVATION_OVERSPEND', '예약이 해당 운용 봇의 자산을 초과했습니다.'); cash += I(sleeve.cashUnits); quantity += I(sleeve.positions[SYMBOL]); fees += I(sleeve.feesPaidUnits); }
    check(cash === I(state.official.cashUnits) && quantity === I(state.official.positions[SYMBOL]) && fees === I(state.official.feesPaidUnits), 'ALLOCATION_TOTAL_MISMATCH', '가상 원장 합계와 공유 계좌 총계를 대조하세요.');
    const replay = { official: clone(state.initialBalances), unallocated: clone(state.initialBalances), sleeves: new Map(), fees: 0n, sleeveFees: new Map() }, filled = new Set();
    const requestedSnapshots = new Set(state.reconciliationReports.map(report => report.ledgerLength)), balancesAt = new Map([[0, clone(replay.official)]]);
    for (const [ledgerIndex, e] of state.ledger.entries()) {
      check(identifier(e.id) && identifier(e.commandKey) && iso(e.recordedAt), 'INVALID_LEDGER', '원장 항목의 참조와 시각을 확인하세요.');
      if (e.type === 'ALLOCATE' || e.type === 'RELEASE') {
        check(unit(e.cashUnits) && unit(e.quantityUnits) && identifier(e.deploymentId) && identifier(e.allocationRef), 'INVALID_ALLOCATION', '배분 원장 단위를 확인하세요.');
        if (!replay.sleeves.has(e.deploymentId)) replay.sleeves.set(e.deploymentId, balance());
        const target = replay.sleeves.get(e.deploymentId), c = I(e.cashUnits), q = I(e.quantityUnits);
        move(e.type === 'ALLOCATE' ? replay.unallocated : target, -c, -q); move(e.type === 'ALLOCATE' ? target : replay.unallocated, c, q);
      } else {
        check(e.type === 'FILL' && !filled.has(e.fillId), 'INVALID_FILL_LEDGER', '체결을 원장에 한 번만 반영하세요.');
        const fill = find(state.fills, e.fillId, 'FILL_NOT_FOUND'), target = replay.sleeves.get(fill.deploymentId);
        check(target && ['buy', 'sell'].includes(fill.side) && [fill.quantityUnits, fill.priceUnits, fill.grossUnits, fill.feeUnits].every(unit), 'INVALID_FILL', '체결의 소유와 금액 단위를 확인하세요.');
        const c = fill.side === 'buy' ? -I(fill.grossUnits) - I(fill.feeUnits) : I(fill.grossUnits) - I(fill.feeUnits), q = I(fill.quantityUnits) * (fill.side === 'buy' ? 1n : -1n);
        move(replay.official, c, q); move(target, c, q); replay.fees += I(fill.feeUnits); replay.sleeveFees.set(fill.deploymentId, (replay.sleeveFees.get(fill.deploymentId) || 0n) + I(fill.feeUnits)); filled.add(fill.id);
      }
      if (requestedSnapshots.has(ledgerIndex + 1)) balancesAt.set(ledgerIndex + 1, clone(replay.official));
    }
    check(filled.size === state.fills.length && stableStringify(replay.official) === stableStringify({ cashUnits: state.official.cashUnits, positions: state.official.positions }) && stableStringify(replay.unallocated) === stableStringify(state.unallocated) && replay.fees === I(state.official.feesPaidUnits), 'LEDGER_TOTAL_MISMATCH', '배분과 체결로 공유 계좌 잔액을 재계산하세요.');
    for (const sleeve of state.sleeves) check(stableStringify(replay.sleeves.get(sleeve.deploymentId)) === stableStringify({ cashUnits: sleeve.cashUnits, positions: sleeve.positions }) && (replay.sleeveFees.get(sleeve.deploymentId) || 0n) === I(sleeve.feesPaidUnits), 'SLEEVE_LEDGER_MISMATCH', '배포별 현금·수량·비용을 원장과 대조하세요.');
    check(replay.sleeves.size === state.sleeves.length && state.reservations.length === state.orderIntents.length, 'INTENT_RESERVATION_MISMATCH', '주문 의도별 예약을 확인하세요.');
    for (const intent of state.orderIntents) {
      const r = activeReservation(state, intent), ownFills = state.fills.filter(fill => fill.intentId === intent.id);
      check(identifier(intent.id) && iso(intent.asOf) && iso(intent.createdAt) && Date.parse(intent.asOf) <= Date.parse(intent.createdAt) && Date.parse(intent.createdAt) <= Date.parse(state.updatedAt) && state.sleeves.some(s => s.deploymentId === intent.deploymentId) && intent.symbol === SYMBOL && ['buy', 'sell'].includes(intent.side) && ['OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'FILLED'].includes(intent.status) && [intent.quantityUnits, intent.limitPriceUnits, intent.filledQuantityUnits, intent.grossUnits, intent.feeUnits].every(unit) && typeof intent.notionalNumerator === 'string' && /^(0|[1-9]\d{0,50})$/.test(intent.notionalNumerator) && I(intent.quantityUnits) > 0n && I(intent.limitPriceUnits) > 0n && typeof intent.feeBps === 'number' && Number.isFinite(intent.feeBps) && intent.feeBps >= 0 && intent.feeBps <= 1000, 'INVALID_INTENT', '주문 의도의 수량·비용·상태를 확인하세요.');
      provenance(intent.provenanceRefs);
      const qty = ownFills.reduce((n, f) => n + I(f.quantityUnits), 0n), numerator = ownFills.reduce((n, f) => n + I(f.quantityUnits) * I(f.priceUnits), 0n), gross = intent.side === 'buy' ? ceil(numerator, SCALE) : numerator / SCALE, fee = feeFor(gross, intent.feeBps);
      check(qty <= I(intent.quantityUnits) && qty === I(intent.filledQuantityUnits) && numerator === I(intent.notionalNumerator) && gross === I(intent.grossUnits) && fee === I(intent.feeUnits) && ownFills.reduce((n, f) => n + I(f.grossUnits), 0n) === gross && ownFills.reduce((n, f) => n + I(f.feeUnits), 0n) === fee && ownFills.every(f => identifier(f.id) && identifier(f.reportRef) && /^[a-f0-9]{64}$/.test(f.fingerprint) && iso(f.recordedAt) && Date.parse(f.occurredAt) <= Date.parse(f.recordedAt) && Date.parse(f.recordedAt) <= Date.parse(state.updatedAt) && f.deploymentId === intent.deploymentId && f.side === intent.side && f.symbol === SYMBOL && I(f.quantityUnits) > 0n && I(f.priceUnits) > 0n && (intent.side === 'buy' ? I(f.priceUnits) <= I(intent.limitPriceUnits) : I(f.priceUnits) >= I(intent.limitPriceUnits)) && iso(f.occurredAt) && Date.parse(f.occurredAt) >= Date.parse(intent.asOf) && Date.parse(f.occurredAt) <= Date.parse(state.updatedAt) && stableStringify(f.provenanceRefs) === stableStringify(intent.provenanceRefs)), 'FILL_ATTRIBUTION_MISMATCH', '부분 체결·수수료·결정 출처의 귀속을 확인하세요.');
      const closed = ['FILLED', 'CANCELED'].includes(intent.status), maximumGross = ceil(I(intent.quantityUnits) * I(intent.limitPriceUnits), SCALE), maximumCash = maximumGross + feeFor(maximumGross, intent.feeBps);
      check(r.intentId === intent.id && r.deploymentId === intent.deploymentId && [r.cashUnits, r.quantityUnits].every(unit) && r.status === (closed ? 'RELEASED' : 'ACTIVE') && I(r.cashUnits) === (closed || intent.side === 'sell' ? 0n : maximumCash - gross - fee) && I(r.quantityUnits) === (closed || intent.side === 'buy' ? 0n : I(intent.quantityUnits) - qty) && (intent.status !== 'FILLED' || qty === I(intent.quantityUnits)) && (intent.status !== 'OPEN' || qty === 0n) && (intent.status !== 'PARTIALLY_FILLED' || qty > 0n && qty < I(intent.quantityUnits)), 'RESERVATION_MISMATCH', '잔량·상태와 예약 잔액을 대조하세요.');
    }
    check(state.fills.every(fill => state.orderIntents.some(intent => intent.id === fill.intentId)) && state.receipts.length === state.revision && state.receipts.every((r, i) => r.revision === i + 1) && state.events.every(e => e.sharedAccountId === state.id && e.aggregateVersion >= 1 && e.aggregateVersion <= state.revision && e.actorId === state.ownerId && identifier(e.commandKey) && iso(e.occurredAt) && Date.parse(e.occurredAt) <= Date.parse(state.updatedAt) && state.receipts.some(r => r.key === e.commandKey)), 'INVALID_AUDIT', '명령 영수증과 감사 사건을 확인하세요.');
    for (const report of state.reconciliationReports) {
      check(identifier(report.id) && /^[a-f0-9]{64}$/.test(report.fingerprint) && identifier(report.sourceRef) && iso(report.asOf) && iso(report.recordedAt) && Date.parse(report.asOf) <= Date.parse(report.recordedAt) && Date.parse(report.recordedAt) <= Date.parse(state.updatedAt) && Number.isInteger(report.ledgerLength) && report.ledgerLength >= 0 && report.ledgerLength <= state.ledger.length && validBalance(report.observed) && validBalance(report.expected) && stableStringify(report.expected) === stableStringify(balancesAt.get(report.ledgerLength)) && report.matched === (stableStringify(report.observed) === stableStringify(report.expected)) && report.cashDeltaUnits === (I(report.observed.cashUnits) - I(report.expected.cashUnits)).toString() && report.quantityDeltaUnits === (I(report.observed.positions[SYMBOL]) - I(report.expected.positions[SYMBOL])).toString(), 'INVALID_RECONCILIATION', '대조 보고의 원장 시점과 관측 차이를 확인하세요.');
    }
    const lastReport = state.reconciliationReports.at(-1); check(!lastReport || state.status === (lastReport.matched ? 'READY' : 'RECONCILIATION_REQUIRED'), 'RECONCILIATION_STATUS', '마지막 대조 보고와 실행 상태를 확인하세요.');
    return [];
  } catch (error) { return [{ code: error.code || 'INVALID_SHARED_ACCOUNT', message: error.message }]; }
}

export function sharedAccountView(state) {
  check(validateSharedAccount(state).length === 0, 'INVALID_SHARED_ACCOUNT', '공유 계좌를 확인하세요.');
  const viewBalance = value => ({ cash: number(value.cashUnits), positions: { [SYMBOL]: number(value.positions[SYMBOL]) } });
  return { id: state.id, ownerId: state.ownerId, mode: state.mode, revision: state.revision, status: state.status, official: { ...viewBalance(state.official), feesPaid: number(state.official.feesPaidUnits) }, unallocated: viewBalance(state.unallocated), sleeves: state.sleeves.map(sleeve => { const hold = reserved(state, sleeve.deploymentId); return { deploymentId: sleeve.deploymentId, ...viewBalance(sleeve), feesPaid: number(sleeve.feesPaidUnits), reservedCash: number(hold.cash), reservedQuantity: number(hold.quantity), availableCash: number(I(sleeve.cashUnits) - hold.cash), availableQuantity: number(I(sleeve.positions[SYMBOL]) - hold.quantity) }; }) };
}
