import baseDataset from '../dist/data/btc-4h.json' with { type: 'json' };
import baseManifest from '../dist/data/btc-source-manifest.json' with { type: 'json' };
import { precomputeFeatures, decideSnapshot, FOUR_HOURS_MS } from '../dist/trading/model.mjs';
import { accountMetrics, markPaperAccount, preparePaperOrder, executePaperOrder, validatePaperAccount } from '../dist/trading/runtime.mjs';
import { JEV_MODEL, buildJevQuestions, validateJevInput, validateJevResult } from '../dist/trading/jev.mjs';
import { validateWorkspace, buildDeploymentContext, hashInputPackage, stableStringify, resolveDeploymentPolicy, applyDeploymentRun, WorkspaceError } from '../dist/domain/workspace.mjs';
import { approvedResearchRules, researchAt } from '../dist/domain/research.mjs';
import { validateComparisonSourceContext } from '../dist/domain/comparisons.mjs';
import {providerForSnapshot,marketProvider} from './market-providers.mjs';

export const PROFILE_JEV_CONTRACT_VERSION = 'btc-profile-choice-v1';
export const PROFILE_FUSION_POLICY_VERSION = 'btc-semantic-conflict-v1';
export const EXECUTION_SUPPORTED_FUSION_MODES = Object.freeze(['advisory', 'confirmatory']);
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone', EXPIRY_MS = 10 * 60 * 1000;
const preparedCache = new Map();
const clone = value => structuredClone(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const check = (condition, code, message) => { if (!condition) throw new WorkspaceError(code, message); };
const at = options => { const now = options.now ?? new Date().toISOString(); check(iso(now), 'INVALID_TIME', '실행 시각을 확인하세요.'); return now; };
const find = (items, value) => { const result = items.find(item => item.id === value); check(result, 'RESOURCE_NOT_FOUND', '선택한 운용 항목을 찾을 수 없습니다.'); return result; };
function command(input, operation, allowed) {
  check(plain(input) && Object.keys(input).every(k => allowed.includes(k)) && identifier(input.deploymentId) && identifier(input.idempotencyKey) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, 'INVALID_EXECUTION_COMMAND', '운용 봇·요청 ID·저장 버전을 확인하세요.');
  const payload = Object.fromEntries(Object.entries(input).filter(([key]) => !['expectedRevision', 'idempotencyKey'].includes(key)));
  return hashInputPackage({ operation, payload });
}
export function validateExecutionCommand(input,operation){
  check(['evaluate','execute'].includes(operation),'INVALID_EXECUTION_COMMAND','실행 작업을 확인하세요.');
  const fingerprint=command(input,operation,operation==='evaluate'?['deploymentId','cursor','asOf','idempotencyKey','expectedRevision']:['deploymentId','decisionId','idempotencyKey','expectedRevision']);
  check(operation==='execute'?identifier(input.decisionId):(input.cursor===undefined||Number.isSafeInteger(input.cursor)&&input.cursor>=0)&&(input.asOf===undefined||iso(input.asOf)),'INVALID_EXECUTION_COMMAND','실행할 선택 또는 확정 봉 시점을 확인하세요.');
  return fingerprint;
}
function retry(workspace, key, fingerprint) {
  const receipt = workspace.commandReceipts.find(r => r.key === key);
  if (!receipt) return null;
  check(receipt.type === 'internal.deployment.run' && receipt.result.commandFingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '동일 실행 요청의 내용이 변경되었습니다.');
  return viewResult({ workspace, result: clone(receipt.result), idempotent: true });
}
function viewResult(value) {
  const checkResult = value.result.decisionRecord?.ruleResults?.find(r => r.id === 'order.prepare.paper');
  return { ...value, result: { ...value.result, proposal: clone(checkResult?.proposal ?? null), reasons: clone(checkResult?.reasons ?? []), decision: clone(value.result.decisionRecord?.decision ?? null), decisionStatus: value.result.decisionRecord?.decisionStatus ?? null } };
}
function preparedFor(config,dataset=baseDataset) {
  const key = hashInputPackage({config,source:dataset.datasetSha256??[dataset.bars.length,dataset.bars.at(-1)]});
  if (!preparedCache.has(key)) { if (preparedCache.size >= 16) preparedCache.delete(preparedCache.keys().next().value); preparedCache.set(key, precomputeFeatures(dataset, { config })); }
  return preparedCache.get(key);
}
function sourceIndex(input, prepared,dataset=baseDataset,forward=false) {
  const index = input.cursor ?? (input.asOf ? dataset.bars.findIndex(b => b[0] + FOUR_HOURS_MS === Date.parse(input.asOf)) : prepared.features.findLastIndex((f, i) => f.ready && (forward||dataset.bars[i + 1]?.[0] === dataset.bars[i][0] + FOUR_HOURS_MS)));
  check(Number.isSafeInteger(index) && index >= 0 && index < dataset.bars.length && (input.asOf === undefined || iso(input.asOf) && prepared.features[index].asOf === input.asOf), 'INVALID_PLAYBACK_CURSOR', '확정된 4시간봉의 재생 시점을 선택하세요.');
  return index;
}
function markAccount(account, bar,dataset=baseDataset) {
  const asOf = new Date(bar[0] + FOUR_HOURS_MS).toISOString();
  check(Date.parse(asOf) >= Date.parse(account.asOf), 'ACCOUNT_TIME_REWIND', '계좌의 마지막 실행 이후 시점을 선택하세요.');
  const midnight = Date.parse(asOf.slice(0, 10) + 'T00:00:00.000Z'), opening = dataset.bars.find(b => b[0] === midnight)?.[1]??(dataset.dayOpenSnapshot?.day===asOf.slice(0,10)?dataset.dayOpenSnapshot.price:undefined);
  if (account.tradingDay !== asOf.slice(0, 10)) check(Number.isFinite(opening), 'DAY_OPEN_MISSING', 'UTC 날짜 시작 가격이 준비된 구간을 선택하세요.');
  return markPaperAccount(account, { price: bar[4], asOf, dayStartPrice: opening });
}
function evidenceRules(context, memoryVersion) {
  const notes = context.rules.map(r => ({ ...r, evidenceType: 'APPROVED_NOTE' }));
  const memories = context.approvedMemory.map(item => ({ id: `memory_${item.candidateId}`, version: memoryVersion.version, title: item.title, text: item.text, evidenceType: 'APPROVED_PERSONAL_MEMORY' }));
  return [...notes, ...memories].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 16).map(({ id, version, title, text }) => ({ id, version, title, text }));
}
function binding(context, sourceHash) {
  return hashInputPackage({ deploymentId: context.deploymentId, investmentProfileVersionId: context.investmentProfileVersionId, strategyVersionId: context.strategyVersionId, riskPresetVersionId: context.riskPresetVersionId, memoryVersionId: context.memoryVersionId, approvedNotes: context.approvedNotes, approvedMemory: context.approvedMemory, approvedResearchRules:context.approvedResearchRules??[], profilePolicy: context.profilePolicy, strategy: context.strategy, riskLimits: context.riskLimits, feeScheduleSnapshot: context.feeScheduleSnapshot, accountSnapshot: context.accountSnapshot, sourceHash });
}
function contextFor(workspace, deployment, snapshot, account, now, options={}) {
  const copy = clone(workspace), index = copy.accounts.findIndex(a => a.id === account.id); copy.accounts[index] = clone(account);
  const retrospective = ['HISTORICAL_FUNCTIONAL_REPLAY', 'RETROSPECTIVE_POLICY_SIMULATION'].includes(deployment.experimentType);
  const context=buildDeploymentContext(copy, { deploymentId: deployment.id, asOf: snapshot.asOf, notes: workspace.knowledge, marketSnapshot: snapshot, policyMode: retrospective ? 'retrospective' : 'strict', knowledgeAsOf: options.evidenceAsOf??(retrospective ? now : snapshot.asOf), contextBuiltAt: now });
  if(options.comparisonSourceContext?.schemaVersion===2){
    const fixed=options.comparisonSourceContext,member=fixed.members?.find(m=>m.deploymentId===deployment.id);
    check(!validateComparisonSourceContext(fixed).length&&fixed.knowledgeAsOf===context.knowledgeAsOf&&member?.investmentProfileId===deployment.investmentProfileId,'SOURCE_CONTEXT_REVOKED','비교 봉의 승인 근거·대상·사용 시점을 확인하세요.');
    context.approvedResearchRules=clone(member.approvedResearchRules);context.rules=[...context.rules,...context.approvedResearchRules];context.inputPackage.approvedResearchRules=clone(context.approvedResearchRules);
    if(member.researchSnapshot!==null)context.inputPackage.researchSnapshot=clone(member.researchSnapshot);
  }else if(workspace.research){const scopes=['shared','profile:'+deployment.investmentProfileId,'deployment:'+deployment.id];context.approvedResearchRules=approvedResearchRules(workspace.research,context.knowledgeAsOf,{scopes});context.rules=[...context.rules,...context.approvedResearchRules];context.inputPackage.approvedResearchRules=clone(context.approvedResearchRules);context.inputPackage.researchSnapshot=researchAt(workspace.research,context.knowledgeAsOf,{scopes});}
  return context;
}
/** Existing evidence keeps its approval and exact content at order time. Newly
 * approved evidence enters the next comparison bar's input package. */
export function assertComparisonEvidenceCurrent(workspace,inputPackage,now){
  for(const original of inputPackage.approvedNotes??[]){
    const current=workspace.knowledge?.items.find(note=>note.id===original.id);
    const value=current&&Object.fromEntries(Object.entries(current).filter(([key])=>key!=='revisions'));
    check(current?.status==='approved'&&current.review?.decision==='approved'&&current.review.version===current.version&&Date.parse(current.review.reviewedAt)<=Date.parse(now)&&stableStringify(value)===stableStringify(original),'SOURCE_CONTEXT_REVOKED','선택에 사용한 승인 노트가 철회되거나 변경되었습니다.');
  }
  const expected=inputPackage.approvedResearchRules??[];
  if(expected.length){
    const scopes=['shared','profile:'+inputPackage.investmentProfileId,'deployment:'+inputPackage.deploymentId];
    const current=workspace.research?approvedResearchRules(workspace.research,now,{scopes}):[];
    check(expected.every(rule=>current.some(candidate=>candidate.id===rule.id&&stableStringify(candidate)===stableStringify(rule))),'SOURCE_CONTEXT_REVOKED','선택에 사용한 리서치 근거의 승인·버전이 변경되었습니다.');
  }
}
function cleanSecret(value, secret) {
  if (!secret) return value;
  if (typeof value === 'string') return value.includes(secret) ? value.split(secret).join('[redacted]') : value;
  if (Array.isArray(value)) return value.map(v => cleanSecret(v, secret));
  if (plain(value)) return Object.fromEntries(Object.entries(value).filter(([k]) => !['__proto__', 'prototype', 'constructor'].includes(k)).map(([k, v]) => [cleanSecret(k, secret), cleanSecret(v, secret)]));
  return value;
}
async function providerBody(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_PROVIDER_RESPONSE');
  const parts = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 260000) { await reader.cancel(); throw new Error('PROVIDER_RESPONSE_SIZE'); } parts.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function buildProfileJevRequest(context, input) {
  validateJevInput(input); const questions = buildJevQuestions(input);
  questions.action.instructions += ' state.profilePolicy의 투자 성향·기간·증거 선호와 state.approvedPersonalMemory의 승인된 경험을 함께 평가한다. profilePolicy와 기억은 투자 맥락으로 읽고, 매매 수량과 권한은 실행 코드의 계약을 따른다.';
  questions.stance.instructions += ' 투자 프로필의 원칙과 승인된 개인 경험을 참고하고, 같은 데이터·위험 한도 안에서 운용 강도를 선택한다.';
  return { model: JEV_MODEL, state: { ...clone(input), questionVersion: PROFILE_JEV_CONTRACT_VERSION, marketProvider:context.marketProvider??'binance',...(context.marketOrigin?{marketOrigin:context.marketOrigin}:{}),investmentProfileId: context.investmentProfileId, investmentProfileVersionId: context.investmentProfileVersionId, deploymentId: context.deploymentId, strategyVersionId: context.strategyVersionId, riskPresetVersionId: context.riskPresetVersionId, fusionPolicyVersionId: context.fusionPolicyVersionId, memoryVersionId: context.memoryVersionId, experimentId: context.experimentId, experimentType: context.experimentType, profilePolicy: clone(context.profilePolicy), approvedPersonalMemory: clone(context.approvedMemory), evidenceSelectionPolicy: 'approved-notes-and-memory-id-order-first16-v1', knowledgeAsOf: context.knowledgeAsOf, contextBuiltAt: context.contextBuiltAt }, questions };
}

export async function evaluateDeployment(workspace, input, options = {}) {
  const dataset=options.market?.dataset??baseDataset,manifest=options.market?.manifest??baseManifest,wallStart=Date.now();
  if(options.marketDataRef!==undefined)check(identifier(options.marketDataRef)&&options.market?.dataset?.sourceSnapshotId===options.marketDataRef&&options.market?.manifest?.sourceSnapshotId===options.marketDataRef,'MARKET_REFERENCE_MISMATCH','수집한 시세 원본과 결정 입력의 참조를 대조하세요.');
  const errors = validateWorkspace(workspace); check(!errors.length, 'INVALID_WORKSPACE', errors[0]?.message ?? '저장된 운용 구성을 확인하세요.');
  const fingerprint = command(input, 'evaluate', ['deploymentId', 'cursor', 'asOf', 'idempotencyKey', 'expectedRevision']);
  const repeated = retry(workspace, input.idempotencyKey, fingerprint); if (repeated) return repeated;
  check(input.expectedRevision === workspace.revision, 'REVISION_CONFLICT', '최신 운용 구성을 다시 불러오세요.');
  const now = at(options), deployment = find(workspace.deployments, input.deploymentId), strategy = find(workspace.strategyVersions, deployment.strategyVersionId), originalAccount = find(workspace.accounts, deployment.accountId);
  check(deployment.runtimeStatus !== 'stopped', 'DEPLOYMENT_STOPPED', '운용 봇을 재개한 후 실행하세요.');
  check(EXECUTION_SUPPORTED_FUSION_MODES.includes(strategy.settings.fusionMode) && strategy.settings.fusionPolicyVersionId === PROFILE_FUSION_POLICY_VERSION, 'UNSUPPORTED_FUSION_POLICY', '검증된 결합 정책을 선택하세요.');
  if (strategy.settings.provider === 'jev') check(strategy.settings.decisionContractVersionId === PROFILE_JEV_CONTRACT_VERSION, 'UNSUPPORTED_DECISION_CONTRACT', '등록된 프로필 선택 계약을 선택하세요.');
  const previous = workspace.decisionRecords.filter(d => d.deploymentId === deployment.id).at(-1);
  if (strategy.settings.provider === 'jev' && previous) check(Date.parse(now) - Date.parse(previous.createdAt) >= 15000, 'JEV_COOLDOWN', '다음 JEV 실행은 15초 뒤에 가능합니다.');
  const prepared = preparedFor(strategy.settings.modelConfig,dataset), index = sourceIndex(input, prepared,dataset,deployment.experimentType==='FORWARD_PAPER'), bar = dataset.bars[index];
  if(deployment.experimentType==='FORWARD_PAPER'){const close=bar[0]+FOUR_HOURS_MS;check(close>Date.parse(deployment.createdAt),'FORWARD_BAR_BEFORE_DEPLOYMENT','운용 봇 생성 이후 첫 4시간봉 마감부터 실행합니다.');check(close===Math.floor(Date.parse(now)/FOUR_HOURS_MS)*FOUR_HOURS_MS,'FORWARD_BAR_STALE','현재의 가장 최근 확정 봉으로 실행하세요.');}
  const account=markAccount(originalAccount, bar,dataset),metrics=accountMetrics(account,bar[4]),mechanical=decideSnapshot(prepared.features[index],{config:strategy.settings.modelConfig,currentWeight:metrics.weight});
  const context = contextFor(workspace, deployment, mechanical, account, now, options), policy = resolveDeploymentPolicy(workspace, deployment.id), configHash = binding(context, manifest.datasetSha256), configVersion = strategy.version;
  const marketIdentity=options.market?marketProvider(providerForSnapshot(options.market)):marketProvider('binance');
  context.marketProvider=marketIdentity.id;context.marketOrigin=options.market?marketIdentity.origin:'https://data.binance.vision';
  const memoryVersion = find(workspace.memoryVersions, deployment.memoryVersionId), rules = evidenceRules(context, memoryVersion);
  const jevInput = { snapshot: mechanical, recentBars: dataset.bars.slice(Math.max(0, index - 63), index + 1), portfolio: metrics, rules, strategyVersion: configVersion, sourceHash: manifest.datasetSha256, configHash, policy };
  const requestId = crypto.randomUUID(); let decision, rawRequest = null, rawResponse = null, status = 'READY', errorCode = null, providerHTTPStatus = null;
  const ruleResults = [{ id: 'mechanical-baseline', version: strategy.settings.mechanicalModelVersionId, action: mechanical.action, ready: mechanical.ready }, { id: 'semantic-conflict-policy', version: strategy.settings.fusionPolicyVersionId, mode: strategy.settings.fusionMode }];
  if (strategy.settings.provider === 'spec') {
    decision = { asOf: mechanical.asOf, action: mechanical.action, stance: 'normal', provider: 'spec', targetWeight: mechanical.targetWeight, sourceHash: manifest.datasetSha256, configHash, strategyVersion: configVersion, evidenceRefs: [mechanical.modelVersion], reasons: clone(mechanical.evidence) };
  } else {
    const failed = (code, message) => { status = 'FAILED'; errorCode = code; decision = { asOf: mechanical.asOf, action: 'hold', stance: 'defensive', provider: 'jev', evidenceRefs: [], choiceConfidence: null, model: null, sourceHash: manifest.datasetSha256, configHash, strategyVersion: configVersion, accountState: Object.fromEntries(['cash', 'btcQuantity', 'equity', 'weight'].map(k => [k, metrics[k]])), decisionStatus: 'FAILED', reasons: [message] }; };
    if (!mechanical.ready) failed('SOURCE_NOT_READY', '가격 지표가 준비된 시점을 선택하세요.');
    else if (!rules.length) failed('APPROVED_EVIDENCE_REQUIRED', '투자 노트 또는 개인 기억을 검토한 후 실행하세요.');
    else if (!options.env?.TYPESAFE_API_KEY) failed('JEV_CONNECTION_REQUIRED', 'JEV 연결을 설정한 후 다시 실행하세요.');
    else {
      rawRequest = buildProfileJevRequest(context, jevInput);
      check(new TextEncoder().encode(JSON.stringify(rawRequest)).byteLength <= 200000, 'JEV_INPUT_SIZE', '입력 자료의 범위를 줄여 주세요.');
      try {
        const response = await (options.fetchImpl ?? fetch)(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${options.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(rawRequest), signal: AbortSignal.timeout(20000) }); providerHTTPStatus = response.status;
        if (!response.ok) failed('JEV_HTTP_ERROR', `JEV 요청을 완료하지 못했습니다 (${response.status}).`);
        else {
          const rawBody = await providerBody(response); let raw;
          try { raw = JSON.parse(rawBody); rawResponse = cleanSecret(raw, options.env.TYPESAFE_API_KEY); stableStringify(rawResponse); }
          catch { rawResponse = { invalidStructure: true, rawBody: cleanSecret(rawBody, options.env.TYPESAFE_API_KEY) }; throw new Error('JEV_RESPONSE_SCHEMA'); }
          const validated = validateJevResult(raw, jevInput, rawRequest.questions); decision = { ...validated.decision, questionVersion: PROFILE_JEV_CONTRACT_VERSION, fusionPolicyVersionId: strategy.settings.fusionPolicyVersionId, usage: validated.usage };
          if (strategy.settings.fusionMode === 'confirmatory' && decision.action !== 'hold' && decision.action !== mechanical.action) { decision = { ...decision, action: 'hold', evidenceRefs: [], reasons: [...decision.reasons, '계량 신호와 선택 결과의 방향 일치를 기다립니다.'] }; ruleResults.push({ id: 'mechanical-direction-confirmation', result: 'HOLD', mechanicalAction: mechanical.action, version: strategy.settings.fusionPolicyVersionId }); }
        }
      } catch { failed('JEV_RESPONSE_FAILED', 'JEV 응답을 확인할 수 없습니다. 실행 기록을 확인해 주세요.'); }
    }
  }
  let validation = status === 'FAILED' ? { ok: false, proposal: null, reasons: [{ code: errorCode, message: decision.reasons[0] }] } : preparePaperOrder({ account, decision, policy, bar, configVersion, configHash, sourceHash: manifest.datasetSha256 });
  if (validation.proposal && deployment.experimentType!=='FORWARD_PAPER' && dataset.bars[index + 1]?.[0] !== bar[0] + FOUR_HOURS_MS) validation = { ok: false, proposal: null, reasons: [{ code: 'NEXT_OPEN_MISSING', message: '다음 연속 봉의 시가가 준비된 구간을 선택하세요.' }] };
  const proposal = validation.proposal ? clone(validation.proposal) : null;
  let outcomeType = status === 'FAILED' ? 'DECISION_REQUEST_FAILED' : !validation.ok ? 'ORDER_REJECTED' : proposal ? 'TRADE_PROPOSED' : decision.action === 'hold' ? 'HOLD_SELECTED' : 'NO_ORDER_REQUIRED';
  if (status !== 'FAILED' && !validation.ok) status = 'REJECTED';
  ruleResults.push({ id: 'order.prepare.paper', version: 'paper-runtime-v2', ok: validation.ok, reasons: clone(validation.reasons), proposal });
  if (errorCode) ruleResults.push({ id: 'provider-error', code: errorCode, httpStatus: providerHTTPStatus });
  const completedAt=new Date(Date.parse(now)+(Date.now()-wallStart)).toISOString();
  const inputPackage = { ...context.inputPackage,marketProvider:context.marketProvider,marketOrigin:context.marketOrigin,marketLoaderVersion:options.market?manifest.loaderVersion:'archived-dataset-v1', ...(options.comparisonBinding?{comparisonContext:clone(options.comparisonBinding)}:{}),decisionStartedAt:now,decisionCompletedAt:completedAt,executionPolicyVersionId:deployment.experimentType==='FORWARD_PAPER'?'FORWARD_PAPER_FIRST_EXECUTABLE_V1':'DOC9_HISTORICAL_NEXT_OPEN_V1',...(options.market?(options.marketDataRef?{marketDataRef:options.marketDataRef}:{marketData:clone(options.market)}):{}), sourceHash: manifest.datasetSha256, configHash, executionCommandFingerprint: fingerprint, executionCommandKey: input.idempotencyKey, evidenceSelectionPolicy: 'approved-notes-and-memory-id-order-first16-v1' };
  const activityEvents = [];
  if (previous) activityEvents.push({ eventType: 'PROPOSAL_INVALIDATED', occurredAt: now, payload: { previousDecisionId: previous.id, reason: '새 실행 요청', requestId } });
  if (strategy.settings.provider === 'jev') activityEvents.push({ eventType: 'JEV_REQUEST_STARTED', occurredAt: now, payload: { requestId, contractVersion: PROFILE_JEV_CONTRACT_VERSION } }, { eventType: status === 'FAILED' ? 'JEV_REQUEST_FAILED' : 'JEV_REQUEST_COMPLETED', occurredAt: now, status: status === 'FAILED' ? 'failed' : 'completed', payload: { requestId, errorCode, httpStatus: providerHTTPStatus } });
  const experience = { experienceType: status === 'FAILED' ? 'EXECUTION_OPERATION' : 'INVESTMENT_DECISION', summary: decision.reasons.join(' ').slice(0, 6000), ...(status === 'FAILED' ? {} : { referencePrice: bar[4], observationDueAt: new Date(Date.parse(mechanical.asOf) + FOUR_HOURS_MS).toISOString() }) };
  const result = applyDeploymentRun(workspace, { deploymentId: deployment.id, account, decisionPayload: { deploymentId: deployment.id, requestId, inputPackage, inputPackageHash: hashInputPackage(inputPackage), jevRequest: rawRequest, jevResponse: rawResponse, decision, outcomeType, status, expiresAt: new Date(Date.parse(now) + EXPIRY_MS).toISOString(), marketSnapshotId: `${manifest.datasetSha256}:${mechanical.asOf}`, ruleResults }, activityEvents, experience }, { now, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, commandFingerprint: fingerprint });
  return viewResult(result);
}

export async function executeDeployment(workspace, input, options = {}) {
  const savedInput=workspace.decisionRecords.find(r=>r.id===input?.decisionId)?.inputPackage,stored=savedInput?.marketData,wallStart=Date.now();
  const errors = validateWorkspace(workspace); check(!errors.length, 'INVALID_WORKSPACE', errors[0]?.message ?? '저장된 운용 구성을 확인하세요.');
  const fingerprint = command(input, 'execute', ['deploymentId', 'decisionId', 'idempotencyKey', 'expectedRevision']); check(identifier(input.decisionId), 'INVALID_EXECUTION_COMMAND', '실행할 선택 결과를 확인하세요.');
  const repeated = retry(workspace, input.idempotencyKey, fingerprint); if (repeated) return repeated;
  if(savedInput?.marketDataRef)check(identifier(savedInput.marketDataRef)&&options.market?.dataset?.sourceSnapshotId===savedInput.marketDataRef&&options.market?.manifest?.sourceSnapshotId===savedInput.marketDataRef,'MARKET_SNAPSHOT_REQUIRED','결정에 사용한 시세 원본을 복원한 후 실행하세요.');
  const dataset=stored?.dataset??options.market?.dataset??baseDataset,manifest=stored?.manifest??options.market?.manifest??baseManifest;
  check(input.expectedRevision === workspace.revision, 'REVISION_CONFLICT', '최신 운용 구성을 다시 불러오세요.');
  const now = at(options), deployment = find(workspace.deployments, input.deploymentId), record = find(workspace.decisionRecords, input.decisionId), strategy = find(workspace.strategyVersions, deployment.strategyVersionId), account = find(workspace.accounts, deployment.accountId);
  check(record.deploymentId === deployment.id && deployment.runtimeStatus !== 'stopped', 'DECISION_SCOPE', '선택 결과와 운용 봇의 상태를 대조하세요.');
  if(deployment.experimentType==='FORWARD_PAPER')check(stored||savedInput?.marketDataRef,'MARKET_SNAPSHOT_REQUIRED','결정에 사용한 시세 원본을 확인하세요.');
  check(record.decisionStatus === 'READY' && record.outcomeType === 'TRADE_PROPOSED' && record.expiresAt && Date.parse(now) < Date.parse(record.expiresAt), 'DECISION_NOT_EXECUTABLE', '유효한 주문 제안을 다시 생성하세요.');
  check(workspace.decisionRecords.filter(d => d.deploymentId === deployment.id).at(-1)?.id === record.id, 'DECISION_SUPERSEDED', '가장 최근의 선택 결과를 확인하세요.');
  check(!account.ledger.some(entry => entry.decisionId === record.id), 'DECISION_ALREADY_EXECUTED', '이미 체결된 선택 결과입니다.');
  for (const field of ['investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'memoryVersionId']) check(record[field] === deployment[field], 'DECISION_VERSION_MISMATCH', '적용 버전이 변경되었습니다. 새 주문 제안을 생성하세요.');
  check(record.inputPackage.sourceHash === manifest.datasetSha256 && record.inputPackageHash === hashInputPackage(record.inputPackage), 'DECISION_SOURCE_MISMATCH', '선택 결과의 원본 데이터와 입력 사본을 대조하세요.');
  const prepared = preparedFor(strategy.settings.modelConfig,dataset), index = dataset.bars.findIndex(b => b[0] + FOUR_HOURS_MS === Date.parse(record.decision.asOf)), bar = dataset.bars[index], fillBar = dataset.bars[index + 1];
  check(index >= 0 && (deployment.experimentType==='FORWARD_PAPER'||fillBar && fillBar[0] === bar[0] + FOUR_HOURS_MS), 'NEXT_OPEN_MISSING', '다음 연속 봉의 시가가 준비된 구간을 선택하세요.');
  check(account.asOf === record.decision.asOf, 'STALE_ACCOUNT_DECISION', '계좌 평가 시점이 변경되었습니다. 새 주문 제안을 생성하세요.');
  const metrics = accountMetrics(account, bar[4]), mechanical = decideSnapshot(prepared.features[index], { config: strategy.settings.modelConfig, currentWeight: metrics.weight }), context = contextFor(workspace, deployment, mechanical, account, now);
  if(record.inputPackage.comparisonContext){
    check(options.comparisonBinding&&stableStringify(options.comparisonBinding)===stableStringify(record.inputPackage.comparisonContext),'SOURCE_CONTEXT_REVOKED','비교 봉과 주문 근거의 고정 사본을 확인하세요.');
    assertComparisonEvidenceCurrent(workspace,record.inputPackage,now);
    context.approvedNotes=clone(record.inputPackage.approvedNotes);context.approvedResearchRules=clone(record.inputPackage.approvedResearchRules??[]);
  }
  const configHash=binding(context,manifest.datasetSha256),policy=resolveDeploymentPolicy(workspace,deployment.id);
  check(configHash === record.decision.configHash && configHash === record.inputPackage.configHash, 'STALE_DECISION_CONTEXT', '계좌·노트·개인 기억이 변경되었습니다. 새 주문 제안을 생성하세요.');
  const validation = preparePaperOrder({ account, decision: record.decision, policy, bar, configVersion: strategy.version, configHash, sourceHash: manifest.datasetSha256 });
  check(validation.ok && validation.proposal, 'ORDER_REVALIDATION_FAILED', validation.reasons[0]?.message ?? '현재 주문 조건을 다시 확인하세요.');
  const original = record.ruleResults.find(r => r.id === 'order.prepare.paper')?.proposal;
  check(original && stableStringify(original) === stableStringify(validation.proposal), 'PROPOSAL_BINDING_MISMATCH', '승인된 주문 제안의 비중과 버전을 대조하세요.');
  let executionQuote=null;if(deployment.experimentType==='FORWARD_PAPER'){check(typeof options.getQuote==='function','QUOTE_REQUIRED','실행 가능한 호가 연결을 확인하세요.');const orderEligibleAt=new Date(Date.parse(now)+Date.now()-wallStart).toISOString();executionQuote=await options.getQuote({side:record.decision.action,orderEligibleAt,decisionCompletedAt:record.inputPackage.decisionCompletedAt});check(executionQuote?.orderEligibleAt===orderEligibleAt&&executionQuote?.decisionCompletedAt===record.inputPackage.decisionCompletedAt&&Date.parse(executionQuote.filledAt)<=Date.parse(now)+Date.now()-wallStart+1000,'QUOTE_BINDING_MISMATCH','주문 승인 이후의 새 호가를 확인하세요.');const limit=context.riskLimits.maxSlippageBps,spreadBps=(executionQuote.ask-executionQuote.bid)/((executionQuote.ask+executionQuote.bid)/2)*5000;check(Number.isFinite(spreadBps)&&spreadBps>=0&&spreadBps+policy.slippageBps<=limit,'QUOTE_SPREAD_LIMIT','호가 스프레드와 슬리피지 합계가 비용 한도를 초과했습니다.');}
  const execution = executePaperOrder({ account, proposal: validation.proposal, fillBar,executionQuote, policy, configVersion: strategy.version, configHash, sourceHash: manifest.datasetSha256, clientOrderId: input.idempotencyKey });
  check(execution.ok && !validatePaperAccount(execution.account).length, execution.reasons[0]?.code ?? 'PAPER_EXECUTION_FAILED', execution.reasons[0]?.message ?? '모의 주문을 완료할 수 없습니다.');
  return viewResult(applyDeploymentRun(workspace, { deploymentId: deployment.id, account: execution.account, decisionId: record.id, activityEvents: [{ eventType: 'PAPER_ORDER_SUBMITTED', payload: { decisionId: record.id, clientOrderId: input.idempotencyKey, proposalId: validation.proposal.id } }] }, { now, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, commandFingerprint: fingerprint }));
}
