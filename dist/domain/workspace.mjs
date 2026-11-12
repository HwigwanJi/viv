import {validatePaperBudgets} from './paper-budget.mjs';
import { createPaperAccount, validatePaperAccount, validatePaperPolicy, DEFAULT_PAPER_POLICY } from '../trading/runtime.mjs';
import { MODEL_VERSION, DEFAULT_MODEL_CONFIG, resolveModelConfig } from '../trading/model.mjs';
import { validateKnowledge } from '../knowledge.mjs';
import {validateResearch} from './research.mjs';
import {validateJobsState} from './jobs.mjs';
import {validateSharedAccount} from './shared-account.mjs';
import {validateComparisons} from './comparisons.mjs';
import {projectWorkspaceForStorage} from './workspace-storage.mjs';

export const WORKSPACE_SCHEMA_VERSION = 1;
export const MEMORY_KNOWLEDGE_TYPES = Object.freeze(['OBSERVED_FACT','HYPOTHESIS','VALIDATED_HEURISTIC','OPERATING_PROCEDURE']);
export const WORKSPACE_ACTIONS = Object.freeze(['profile.create', 'profile.revise', 'profile.rename', 'profile.clone', 'profile.appearance.set', 'profile.archive', 'profile.restore', 'strategy.create', 'strategy.revise', 'preset.create', 'preset.revise', 'deployment.create', 'deployment.status', 'deployment.configure', 'decision.persist', 'audit.append', 'experience.record', 'experience.observe', 'experience.evaluate', 'memory.propose', 'memory.validate', 'memory.approve', 'memory.reject']);
export const MIND_APPEARANCE_OPTIONS=Object.freeze({bodyVariant:Object.freeze(['blob','pear','heart','frog','cat','rabbit']),colorPalette:Object.freeze(['blue','amber','violet','sage']),eyeVariant:Object.freeze(['natural','focused','sleepy']),accessory:Object.freeze(['none','glasses','sunglasses','bowtie']),motionIntensity:Object.freeze(['subtle','off'])});
export const PROFILE_TEMPLATES = Object.freeze([
  { key: 'trend', name: '추세형', philosophy: '확인된 가격 방향과 추세 지속 근거를 검토한다. 손실 한도 안에서 큰 추세 참여 기회를 평가한다.', evidencePreferences: ['추세 지속', '확정 고저점', '가격 구조'] },
  { key: 'contrarian', name: '역발상형', philosophy: '과도한 가격 이격과 반전 조건을 함께 검토한다. 하락 지속 위험과 반전 실패 조건을 기록한다.', evidencePreferences: ['가격 이격', '반전 확인', '반례'] },
  { key: 'long-term', name: '장기보유형', philosophy: '보유 논제의 지속과 훼손을 검토한다. 매매 비용과 보유 기회비용을 함께 평가한다.', evidencePreferences: ['보유 논제', '논제 훼손', '기회비용'] },
]);
const COLLECTIONS = ['investmentProfiles', 'profileVersions', 'strategies', 'strategyVersions', 'riskPresets', 'riskPresetVersions', 'deployments', 'accounts', 'decisionRecords', 'activityEvents', 'experiences', 'memoryCandidates', 'memoryVersions', 'commandReceipts'];
export const WORKSPACE_COLLECTIONS = Object.freeze([...COLLECTIONS]);
const LIMIT_KEYS = ['normalBuyWeight', 'clutchBuyWeight', 'sellWeight', 'maxExposure', 'maxOrderWeight', 'dailyLossLimit', 'minNotional'];
const OUTCOMES = ['TRADE_PROPOSED', 'HOLD_SELECTED', 'NO_ORDER_REQUIRED', 'ORDER_REJECTED', 'ORDER_ADJUSTED', 'DECISION_REQUEST_FAILED', 'PROPOSAL_INVALIDATED', 'PROPOSAL_EXPIRED'];
const EXPERIMENT_TYPES = ['HISTORICAL_FUNCTIONAL_REPLAY', 'MECHANICAL_BACKTEST', 'POINT_IN_TIME_BACKTEST', 'FORWARD_PAPER', 'CONTROLLED_ABLATION', 'RETROSPECTIVE_POLICY_SIMULATION'];
const clone = value => structuredClone(value);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e15;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value, length = 6000) => typeof value === 'string' && !!value.trim() && value.length <= length && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const strings = (value, limit = 30) => Array.isArray(value) && value.length <= limit && new Set(value).size === value.length && value.every(v => text(v, 240));
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const safe = (value, depth = 0) => depth < 25 && (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 300000 || finite(value) || Array.isArray(value) && value.length <= 20000 && value.every(v => safe(v, depth + 1)) || plain(value) && Object.keys(value).length <= 100 && Object.entries(Object.getOwnPropertyDescriptors(value)).every(([k, d]) => !['__proto__', 'constructor', 'prototype'].includes(k) && Object.hasOwn(d, 'value') && safe(d.value, depth + 1)));
export class WorkspaceError extends Error { constructor(code, message) { super(message); this.name = 'WorkspaceError'; this.code = code; } }
const check = (condition, code, message) => { if (!condition) throw new WorkspaceError(code, message); };
const fields = (input, allowed, required = []) => check(plain(input) && safe(input) && Object.keys(input).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(input, k)), 'INVALID_ACTION_INPUT', '입력 항목과 필수 값을 확인하세요.');
const at = options => { const value = options?.now ?? new Date().toISOString(); check(iso(value), 'INVALID_TIME', '기록 시각을 확인하세요.'); return value; };
const find = (items, target, code = 'RESOURCE_NOT_FOUND') => { const item = items.find(v => v.id === target); check(item, code, '선택한 항목을 찾을 수 없습니다.'); return item; };
const before = (a, b) => Date.parse(a) <= Date.parse(b);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

export function validateMindAppearanceConfig(value){
  return exactKeys(value,Object.keys(MIND_APPEARANCE_OPTIONS))&&Object.entries(MIND_APPEARANCE_OPTIONS).every(([key,choices])=>choices.includes(value[key]))?[]:[{code:'INVALID_MIND_APPEARANCE',message:'캐릭터의 모양·색·눈·장식·움직임을 선택하세요.'}];
}
export function defaultMindAppearanceConfig(profileId){
  let seed=2166136261;for(const point of String(profileId))seed=Math.imul(seed^point.codePointAt(0),16777619)>>>0;const variant=seed%4;
  return {bodyVariant:MIND_APPEARANCE_OPTIONS.bodyVariant[variant],colorPalette:MIND_APPEARANCE_OPTIONS.colorPalette[variant],eyeVariant:'natural',accessory:['none','glasses','sunglasses','bowtie'][variant],motionIntensity:'subtle'};
}
export function readMindAppearance(workspace,profileId){
  const saved=workspace.uiPreferences?.mindCompanions?.[profileId];
  return saved&&!validateMindAppearanceConfig(saved.config).length?{config:clone(saved.config),source:'SAVED',updatedAt:saved.updatedAt,updatedBy:saved.updatedBy}:{config:defaultMindAppearanceConfig(profileId),source:'IDENTITY_DEFAULT',updatedAt:null,updatedBy:null};
}
function validUiPreferences(value,state){
  if(!exactKeys(value,['schemaVersion','mindCompanions'])||value.schemaVersion!==1||!plain(value.mindCompanions)||Object.keys(value.mindCompanions).length>100)return false;
  return Object.entries(value.mindCompanions).every(([profileId,appearance])=>state.investmentProfiles.some(p=>p.id===profileId)&&exactKeys(appearance,['schemaVersion','config','updatedAt','updatedBy'])&&appearance.schemaVersion===1&&!validateMindAppearanceConfig(appearance.config).length&&iso(appearance.updatedAt)&&before(state.createdAt,appearance.updatedAt)&&before(appearance.updatedAt,state.updatedAt)&&identifier(appearance.updatedBy));
}

export function stableStringify(value) {
  check(safe(value), 'UNSAFE_DOCUMENT', '저장할 자료 형식을 확인하세요.');
  const stringify = v => Array.isArray(v) ? `[${v.map(stringify).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stringify(v[k])}`).join(',')}}` : JSON.stringify(v);
  return stringify(value);
}

// SHA-256 uses the same canonical bytes in browsers, workers and tests.
export function hashInputPackage(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const length = Math.ceil((bytes.length + 9) / 64) * 64, data = new Uint8Array(length), view = new DataView(data.buffer);
  data.set(bytes); data[bytes.length] = 0x80; view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const r = (x, n) => x >>> n | x << 32 - n, w = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (r(a, 7) ^ r(a, 18) ^ a >>> 3) + w[i - 16] + (r(b, 17) ^ r(b, 19) ^ b >>> 10) + w[i - 7]; }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) { const t1 = z + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + (e & f ^ ~e & g) + k[i] + w[i], t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + (a & b ^ a & c ^ b & c); z=g; g=f; f=e; e=d+t1|0; d=c; c=b; b=a; a=t1+t2|0; }
    [a,b,c,d,e,f,g,z].forEach((v, i) => { h[i] = h[i] + v >>> 0; });
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('');
}

function profileSettings(input = {}) {
  fields(input, ['philosophy', 'style', 'horizon', 'evidencePreferences', 'discipline', 'learningPolicy']);
  const value = { philosophy: input.philosophy ?? '가격 구조와 승인된 근거를 검토하고 손실 한도를 지킨다.', style: input.style ?? 'custom', horizon: input.horizon ?? '4h', evidencePreferences: input.evidencePreferences ?? [], discipline: input.discipline ?? '보유·손실·비용 한도와 반대 근거를 함께 검토한다.', learningPolicy: input.learningPolicy ?? 'user-approved' };
  check(text(value.philosophy) && text(value.style, 80) && ['1m', '3m', '5m', '1h', '4h', '1d', 'multi-day'].includes(value.horizon) && strings(value.evidencePreferences, 12) && text(value.discipline) && value.learningPolicy === 'user-approved', 'INVALID_PROFILE', '프로필 원칙과 기억 승인 정책을 확인하세요.');
  return clone(value);
}
function strategySettings(input = {}) {
  fields(input, ['provider', 'modelConfig', 'decisionContractVersionId', 'fusionPolicyVersionId', 'fusionMode']);
  const value = { provider: input.provider ?? 'jev', modelConfig: clone(resolveModelConfig(input.modelConfig ?? DEFAULT_MODEL_CONFIG)), mechanicalModelVersionId: MODEL_VERSION, decisionContractVersionId: input.decisionContractVersionId ?? 'btc-profile-choice-v1', fusionPolicyVersionId: input.fusionPolicyVersionId ?? 'btc-semantic-conflict-v1', fusionMode: input.fusionMode ?? 'advisory' };
  check(['jev', 'spec'].includes(value.provider) && ['advisory', 'confirmatory', 'conditional'].includes(value.fusionMode) && identifier(value.decisionContractVersionId) && identifier(value.fusionPolicyVersionId), 'INVALID_STRATEGY', '전략 실행 방식과 버전을 확인하세요.');
  return value;
}
function presetSettings(input = {}) {
  fields(input, [...LIMIT_KEYS, 'maxFeeBps', 'maxSlippageBps']);
  const limits = Object.fromEntries(LIMIT_KEYS.map(k => [k, input[k] ?? DEFAULT_PAPER_POLICY[k]]));
  limits.maxFeeBps = input.maxFeeBps ?? 100; limits.maxSlippageBps = input.maxSlippageBps ?? 100;
  check(validatePaperPolicy({ ...DEFAULT_PAPER_POLICY, ...Object.fromEntries(LIMIT_KEYS.map(k => [k, limits[k]])) }) && ['maxFeeBps', 'maxSlippageBps'].every(k => finite(limits[k]) && limits[k] >= 0 && limits[k] <= 1000), 'INVALID_PRESET', '운용 한도와 비용 상한을 확인하세요.');
  return limits;
}
function feeSnapshot(input, now) {
  const value = input ?? { feeBps: 10, slippageBps: 0, source: '모의투자 기본 비용 가정', kind: 'PAPER_ASSUMPTION' };
  fields(value, ['feeBps', 'slippageBps', 'source', 'kind', 'observedAt'], ['feeBps', 'slippageBps', 'source', 'kind']);
  check(['feeBps', 'slippageBps'].every(k => finite(value[k]) && value[k] >= 0 && value[k] <= 1000) && text(value.source, 1000) && ['PAPER_ASSUMPTION', 'VENUE_OBSERVATION'].includes(value.kind) && (!value.observedAt || iso(value.observedAt) && before(value.observedAt, now)), 'INVALID_FEE_SCHEDULE', '요율의 출처와 관측 시각을 확인하세요.');
  return { id: id('fee'), ...clone(value), observedAt: value.observedAt ?? now };
}
function addVersion(state, collection, entity, settings, now, actorId, extra = {}) {
  const versions = state[collection], previous = versions.filter(v => v.entityId === entity.id).at(-1);
  const version = { id: id('version'), entityId: entity.id, version: (previous?.version ?? 0) + 1, settings, createdAt: now, createdBy: actorId, previousVersionId: previous?.id ?? null, ...extra };
  versions.push(version); entity.currentVersionId = version.id; entity.updatedAt = now;
  return version;
}
function emptyMemory(state, profileId, now, sourceProfileId = null) {
  const version = { id: id('memory'), investmentProfileId: profileId, version: 1, previousVersionId: null, items: [], sourceProfileId, approvedAt: now, availableAt: now, createdAt: now };
  state.memoryVersions.push(version); return version;
}
function addProfile(state, payload, now, actorId, sourceProfileId = null) {
  check(text(payload.name, 120), 'INVALID_PROFILE', '프로필 이름을 입력하세요.');
  const profile = { id: id('profile'), name: payload.name.trim(), currentVersionId: null, currentMemoryVersionId: null, createdAt: now, updatedAt: now, templateKey: payload.templateKey ?? null, sourceProfileId };
  const memory = emptyMemory(state, profile.id, now, sourceProfileId); profile.currentMemoryVersionId = memory.id;
  state.investmentProfiles.push(profile);
  const version = addVersion(state, 'profileVersions', profile, profileSettings(payload.settings), now, actorId, { memoryVersionId: memory.id });
  return { profile: clone(profile), version: clone(version) };
}
function event(state, type, resource, now, actorId, payload = {}, correlationId = null) {
  const value = { id: id('event'), eventType: type, schemaVersion: 1, occurredAt: now, recordedAt: now, actorId, actorType: 'user', producer: 'workspace-domain', resourceType: resource.type, resourceId: resource.id, deploymentId: resource.deploymentId ?? null, aggregateVersion: state.revision + 1, correlationId: correlationId ?? id('correlation'), causationId: null, status: 'recorded', payload: clone(payload) };
  state.activityEvents.push(value); return value;
}

export function createWorkspace(options = {}) {
  const now = at(options), state = { schemaVersion: WORKSPACE_SCHEMA_VERSION, revision: 0, createdAt: now, updatedAt: now, ...Object.fromEntries(COLLECTIONS.map(k => [k, []])) };
  if (options.seed !== false) {
    for (const template of PROFILE_TEMPLATES) addProfile(state, { name: template.name, templateKey: template.key, settings: { style: template.key, philosophy: template.philosophy, evidencePreferences: template.evidencePreferences } }, now, 'initial-template');
    const strategy = { id: id('strategy'), name: 'BTC 현물 4시간봉', currentVersionId: null, createdAt: now, updatedAt: now };
    state.strategies.push(strategy); addVersion(state, 'strategyVersions', strategy, strategySettings(), now, 'initial-template');
    const preset = { id: id('preset'), name: '기본 모의 운용', currentVersionId: null, createdAt: now, updatedAt: now };
    state.riskPresets.push(preset); addVersion(state, 'riskPresetVersions', preset, presetSettings(), now, 'initial-template');
  }
  return state;
}

export function resolveDeploymentPolicy(state, deploymentId) {
  const deployment = find(state.deployments, deploymentId), preset = find(state.riskPresetVersions, deployment.riskPresetVersionId);
  const limits = preset.settings, fee = deployment.feeScheduleSnapshot;
  check(fee.feeBps <= limits.maxFeeBps && fee.slippageBps <= limits.maxSlippageBps, 'COST_LIMIT', '요율이 운용 비용 상한을 초과했습니다.');
  return { ...Object.fromEntries(LIMIT_KEYS.map(k => [k, limits[k]])), feeBps: fee.feeBps, slippageBps: fee.slippageBps };
}

function deploymentRefs(state, deployment) {
  const profile = find(state.investmentProfiles, deployment.investmentProfileId), profileVersion = find(state.profileVersions, deployment.investmentProfileVersionId), strategyVersion = find(state.strategyVersions, deployment.strategyVersionId), riskPresetVersion = find(state.riskPresetVersions, deployment.riskPresetVersionId), account = find(state.accounts, deployment.accountId);
  check(profileVersion.entityId === profile.id, 'PROFILE_VERSION_SCOPE', '프로필과 버전을 대조하세요.');
  return { profile, profileVersion, strategyVersion, riskPresetVersion, account };
}
function approvedNoteSnapshots(notes, asOf) {
  if (!notes) return [];
  const knowledge = Array.isArray(notes) ? { schemaVersion: 1, items: notes } : notes;
  check(validateKnowledge(knowledge).length === 0, 'INVALID_KNOWLEDGE', '노트의 검토 상태와 이력을 확인하세요.');
  const selected = new Map();
  for (const item of knowledge.items) {
    const available = [...item.revisions, item].filter(v => before(v.createdAt, asOf) && before(v.updatedAt, asOf)).sort((a, b) => b.version - a.version)[0];
    if (available?.status === 'approved' && available.review?.decision === 'approved' && available.review.version === available.version && before(available.review.reviewedAt, asOf)) selected.set(item.id, clone(available));
  }
  let changed = true;
  while (changed) { changed = false; for (const [key, note] of selected) if (note.evidenceIds.some(ref => !selected.has(ref))) { selected.delete(key); changed = true; } }
  return [...selected.values()].map(v => ({ ...v, revisions: undefined })).map(v => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)));
}

export function buildDeploymentContext(state, { deploymentId, asOf, notes, marketSnapshot = null, experimentId, experimentType, policyMode = 'strict', knowledgeAsOf = asOf, contextBuiltAt = asOf } = {}) {
  check(validateWorkspace(state).length === 0, 'INVALID_WORKSPACE', '저장된 운용 구성을 확인하세요.');
  check(iso(asOf) && iso(knowledgeAsOf) && iso(contextBuiltAt) && before(knowledgeAsOf, contextBuiltAt) && ['strict', 'retrospective'].includes(policyMode), 'INVALID_TIME', '실행·자료·입력 생성 시각과 정책 사용 기준을 확인하세요.');
  check(safe(marketSnapshot) && (!marketSnapshot?.asOf || marketSnapshot.asOf === asOf), 'MARKET_SNAPSHOT_TIME', '가격 관측과 실행 시점을 대조하세요.');
  const deployment = find(state.deployments, deploymentId), refs = deploymentRefs(state, deployment);
  const useType = experimentType ?? deployment.experimentType, useId = experimentId ?? deployment.experimentId;
  check(EXPERIMENT_TYPES.includes(useType) && (useId === null || identifier(useId)), 'INVALID_EXPERIMENT', '실험 범위를 확인하세요.');
  if (policyMode === 'strict') { check(before(knowledgeAsOf, asOf), 'KNOWLEDGE_TIME_LEAK', '실행 시점까지 사용 가능한 자료를 선택하세요.'); check([refs.profileVersion, refs.strategyVersion, refs.riskPresetVersion].every(v => before(v.createdAt, asOf)), 'POLICY_NOT_AVAILABLE', '실행 시점에 사용 가능한 정책 버전을 선택하세요.'); }
  else check(['HISTORICAL_FUNCTIONAL_REPLAY', 'RETROSPECTIVE_POLICY_SIMULATION'].includes(useType), 'INVALID_RETROSPECTIVE_SCOPE', '사후 정책을 사용하는 실행 유형을 확인하세요.');
  const memory = find(state.memoryVersions, deployment.memoryVersionId);
  check(memory.investmentProfileId === refs.profile.id, 'MEMORY_SCOPE', '프로필과 기억의 소유 관계를 확인하세요.');
  const usableMemory = before(memory.availableAt, asOf) ? memory.items.filter(item => before(item.availableAt, asOf) && (((item.deploymentId === deploymentId || item.approvedDeploymentIds?.includes(deploymentId)) && item.experimentId === useId) || item.authorizations?.some(a=>a.deploymentId===deploymentId&&a.experimentId===useId&&before(a.authorizedAt,asOf)&&item.approvedDeploymentIds?.includes(deploymentId)&&item.approvedExperimentIds?.includes(useId)))).map(clone) : [];
  const noteSnapshots = approvedNoteSnapshots(notes, knowledgeAsOf);
  const inputPackage = { schemaVersion: 1, asOf, knowledgeAsOf, contextBuiltAt, deploymentId, investmentProfileId: refs.profile.id, investmentProfileVersionId: refs.profileVersion.id, strategyVersionId: refs.strategyVersion.id, riskPresetVersionId: refs.riskPresetVersion.id, mechanicalModelVersionId: refs.strategyVersion.settings.mechanicalModelVersionId, decisionContractVersionId: refs.strategyVersion.settings.decisionContractVersionId, fusionPolicyVersionId: refs.strategyVersion.settings.fusionPolicyVersionId, memoryVersionId: memory.id, experimentId: useId, experimentType: useType, policyMode, profilePolicy: clone(refs.profileVersion.settings), strategy: clone(refs.strategyVersion.settings), riskLimits: clone(refs.riskPresetVersion.settings), feeScheduleSnapshot: clone(deployment.feeScheduleSnapshot), accountSnapshot: clone(refs.account), marketSnapshot: clone(marketSnapshot), approvedNotes: noteSnapshots, approvedMemory: usableMemory };
  return { ...inputPackage, inputPackage, inputPackageHash: hashInputPackage(inputPackage), rules: noteSnapshots.filter(n => n.kind === 'rule').map(({ id, version, title, text }) => ({ id, version, title, text })), policy: resolveDeploymentPolicy(state, deploymentId) };
}

function handleAction(state, type, p, now, actorId) {
  if (type === 'profile.create') { fields(p, ['name', 'settings', 'templateKey'], ['name']); check(p.templateKey === undefined || PROFILE_TEMPLATES.some(t => t.key === p.templateKey), 'INVALID_PROFILE', '초기 템플릿을 확인하세요.'); const result = addProfile(state, p, now, actorId); event(state, 'PROFILE_CREATED', { type: 'profile', id: result.profile.id }, now, actorId); return result; }
  if(type==='profile.archive'||type==='profile.restore'){
    fields(p,['profileId'],['profileId']);const profile=find(state.investmentProfiles,p.profileId),archive=type==='profile.archive';
    const subscriptions=(state.mindSubscriptions??[]).filter(s=>s.profileId===profile.id);
    if(archive){
      check(!subscriptions.some(s=>s.attempts.some(a=>['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(a.status))),'PROFILE_EXECUTION_UNRESOLVED','진행 중이거나 응답이 미확정인 운용을 확인한 뒤 보관하세요.');
      for(const s of subscriptions){s.status='PAUSED';s.updatedAt=now;}
      const deployments=state.deployments.filter(d=>d.investmentProfileId===profile.id),ids=new Set(deployments.map(d=>d.id));
      for(const group of state.comparisons??[])if(group.members.some(m=>ids.has(m.deploymentId))){group.status='paused';group.pauseRequestedAt=now;group.updatedAt=now;if(group.round)group.round.lease=null;for(const m of group.members)ids.add(m.deploymentId);}
      for(const d of state.deployments.filter(d=>ids.has(d.id)&&!deployments.includes(d)))deployments.push(d);
      for(const d of deployments){d.runtimeStatus='paused';d.updatedAt=now;}
      const jobs=(state.scheduler?.jobs??[]).filter(j=>ids.has(j.deploymentId));for(const j of jobs){j.status='paused';j.updatedAt=now;}
      if(jobs.length){state.scheduler.updatedAt=now;state.scheduler.revision++;}
      profile.status='ARCHIVED';profile.archivedAt=now;profile.archivedBy=actorId;
    }else{profile.status='ACTIVE';delete profile.archivedAt;delete profile.archivedBy;}
    profile.updatedAt=now;event(state,archive?'PROFILE_ARCHIVED':'PROFILE_RESTORED',{type:'profile',id:profile.id},now,actorId,{pausedSubscriptionIds:archive?subscriptions.map(s=>s.id):[]});
    return {profile:clone(profile),archived:archive};
  }
  if(type==='profile.rename'){
    fields(p,['profileId','name'],['profileId','name']);
    const profile=find(state.investmentProfiles,p.profileId);
    check(text(p.name,120),'INVALID_NAME','마인드 이름을 120자 이내로 입력하세요.');
    profile.displayName=p.name.trim();
    profile.displayNameUpdatedAt=now;
    event(state,'PROFILE_RENAMED',{type:'profile',id:profile.id},now,actorId,{name:profile.displayName});
    return {profile:clone(profile)};
  }
  if(type==='profile.appearance.set'){
    fields(p,['profileId','config'],['profileId','config']);find(state.investmentProfiles,p.profileId);const errors=validateMindAppearanceConfig(p.config);check(!errors.length,'INVALID_MIND_APPEARANCE',errors[0]?.message);
    const appearance={schemaVersion:1,config:clone(p.config),updatedAt:now,updatedBy:actorId};
    state.uiPreferences={schemaVersion:1,mindCompanions:{...state.uiPreferences?.mindCompanions,[p.profileId]:appearance}};
    event(state,'MIND_APPEARANCE_UPDATED',{type:'profile',id:p.profileId},now,actorId,{config:clone(p.config)});
    return {profileId:p.profileId,appearance:clone(appearance)};
  }
  if (type === 'profile.clone') {
    fields(p, ['profileId', 'name'], ['profileId', 'name']); const original = find(state.investmentProfiles, p.profileId), version = find(state.profileVersions, original.currentVersionId);
    const result = addProfile(state, { name: p.name, settings: version.settings }, now, actorId, original.id); event(state, 'PROFILE_CLONED', { type: 'profile', id: result.profile.id }, now, actorId, { sourceProfileId: original.id, sourceMemoryVersionId: original.currentMemoryVersionId }); return result;
  }
  if (['profile.revise', 'strategy.revise', 'preset.revise'].includes(type)) {
    const kind = type.split('.')[0], config = { profile: ['investmentProfiles', 'profileVersions', profileSettings], strategy: ['strategies', 'strategyVersions', strategySettings], preset: ['riskPresets', 'riskPresetVersions', presetSettings] }[kind];
    fields(p, ['id', 'name', 'settings'], ['id']); const entity = find(state[config[0]], p.id), old = find(state[config[1]], entity.currentVersionId);
    if (p.name !== undefined) { check(text(p.name, 120), 'INVALID_NAME', '이름을 입력하세요.'); entity.name = p.name.trim(); }
    const merged = { ...old.settings, ...p.settings }; if (kind === 'strategy') delete merged.mechanicalModelVersionId;
    const settings = p.settings === undefined ? clone(old.settings) : config[2](merged);
    const version = addVersion(state, config[1], entity, settings, now, actorId, kind === 'profile' ? { memoryVersionId: entity.currentMemoryVersionId } : {});
    event(state, `${kind.toUpperCase()}_REVISED`, { type: kind, id: entity.id }, now, actorId, { previousVersionId: old.id, versionId: version.id }); return { entity: clone(entity), version: clone(version) };
  }
  if (['strategy.create', 'preset.create'].includes(type)) {
    fields(p, ['name', 'settings'], ['name']); check(text(p.name, 120), 'INVALID_NAME', '이름을 입력하세요.'); const kind = type.split('.')[0], entity = { id: id(kind), name: p.name.trim(), currentVersionId: null, createdAt: now, updatedAt: now };
    state[kind === 'strategy' ? 'strategies' : 'riskPresets'].push(entity); const version = addVersion(state, kind === 'strategy' ? 'strategyVersions' : 'riskPresetVersions', entity, (kind === 'strategy' ? strategySettings : presetSettings)(p.settings), now, actorId);
    event(state, `${kind.toUpperCase()}_CREATED`, { type: kind, id: entity.id }, now, actorId); return { entity: clone(entity), version: clone(version) };
  }
  if (type === 'deployment.create') {
    fields(p, ['name', 'investmentProfileId', 'investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'initialCash', 'instrumentIds', 'feeScheduleSnapshot', 'experimentId', 'experimentType', 'memoryVersionId', 'accountNow'], ['name', 'investmentProfileId', 'strategyVersionId', 'riskPresetVersionId']);
    check(text(p.name, 120), 'INVALID_NAME', '운용 봇 이름을 입력하세요.'); const profile = find(state.investmentProfiles, p.investmentProfileId), profileVersion = find(state.profileVersions, p.investmentProfileVersionId ?? profile.currentVersionId), strategy = find(state.strategyVersions, p.strategyVersionId); find(state.riskPresetVersions, p.riskPresetVersionId);
    check(profileVersion.entityId === profile.id, 'PROFILE_VERSION_SCOPE', '선택한 프로필 버전을 확인하세요.');
    const instrumentIds = p.instrumentIds ?? ['BTCUSDT']; check(Array.isArray(instrumentIds) && instrumentIds.length === 1 && instrumentIds[0] === 'BTCUSDT', 'UNSUPPORTED_INSTRUMENT', 'BTC 현물 상품을 선택하세요.');
    const experimentId = p.experimentId ?? null, experimentType = p.experimentType ?? 'HISTORICAL_FUNCTIONAL_REPLAY'; check((experimentId === null || identifier(experimentId)) && EXPERIMENT_TYPES.includes(experimentType), 'INVALID_EXPERIMENT', '실험 식별자와 유형을 확인하세요.');
    const accountNow = p.accountNow ?? now; check(iso(accountNow) && before(accountNow, now), 'INVALID_TIME', '모의계좌 시작 시각을 확인하세요.');
    const account = createPaperAccount({ initialCash: p.initialCash ?? 100000, now: accountNow });
    const memory = find(state.memoryVersions, p.memoryVersionId ?? profile.currentMemoryVersionId); check(memory.investmentProfileId === profile.id, 'MEMORY_SCOPE', '선택한 기억의 소유 프로필을 확인하세요.');
    const deployment = { id: id('deployment'), name: p.name.trim(), investmentProfileId: profile.id, investmentProfileVersionId: profileVersion.id, strategyVersionId: strategy.id, riskPresetVersionId: p.riskPresetVersionId, memoryVersionId: memory.id, accountId: account.id, instrumentIds, executionMode: 'paper', runtimeStatus: 'paused', capitalAllocation: account.initialEquity, feeScheduleSnapshot: feeSnapshot(p.feeScheduleSnapshot, now), experimentId, experimentType, createdAt: now, updatedAt: now, activatedAt: null };
    state.accounts.push(account); state.deployments.push(deployment); resolveDeploymentPolicy(state, deployment.id);
    event(state, 'DEPLOYMENT_CREATED', { type: 'deployment', id: deployment.id, deploymentId: deployment.id }, now, actorId, { accountId: account.id }); return { deployment: clone(deployment), account: clone(account) };
  }
  if (type === 'deployment.status') {
    fields(p, ['deploymentId', 'status'], ['deploymentId', 'status']); check(['running', 'paused', 'stopped'].includes(p.status), 'INVALID_DEPLOYMENT_STATUS', '운용 상태를 확인하세요.'); const deployment = find(state.deployments, p.deploymentId);check(p.status!=='running'||find(state.investmentProfiles,deployment.investmentProfileId).status!=='ARCHIVED','MIND_ARCHIVED','마인드를 복원한 뒤 운용을 시작하세요.');deployment.runtimeStatus = p.status; deployment.updatedAt = now; if (p.status === 'running') deployment.activatedAt = now;
    event(state, p.status === 'running' ? 'BOT_STARTED' : p.status === 'paused' ? 'BOT_PAUSED' : 'BOT_STOPPED', { type: 'deployment', id: deployment.id, deploymentId: deployment.id }, now, actorId); return clone(deployment);
  }
  if (type === 'deployment.configure') {
    fields(p, ['deploymentId', 'investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'memoryVersionId'], ['deploymentId']); const deployment = find(state.deployments, p.deploymentId); check(deployment.runtimeStatus !== 'running', 'DEPLOYMENT_RUNNING', '일시중지 후 적용 버전을 변경하세요.'); const previous = clone(deployment);
    for (const key of ['investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'memoryVersionId']) if (p[key] !== undefined) deployment[key] = p[key]; deploymentRefs(state, deployment); const memory = find(state.memoryVersions, deployment.memoryVersionId); check(memory.investmentProfileId === deployment.investmentProfileId, 'MEMORY_SCOPE', '프로필의 기억 버전을 선택하세요.'); resolveDeploymentPolicy(state, deployment.id); deployment.updatedAt = now;
    event(state, 'DEPLOYMENT_CONFIGURED', { type: 'deployment', id: deployment.id, deploymentId: deployment.id }, now, actorId, { previous, applied: clone(deployment) }); return clone(deployment);
  }
  if (type === 'decision.persist') return persistDecision(state, p, now, actorId);
  if (type === 'audit.append') {
    fields(p, ['eventType', 'resourceType', 'resourceId', 'deploymentId', 'payload', 'correlationId', 'status'], ['eventType', 'resourceType', 'resourceId']); check(/^[A-Z][A-Z0-9_]{1,95}$/.test(p.eventType) && identifier(p.resourceType) && identifier(p.resourceId) && (p.deploymentId === undefined || state.deployments.some(d => d.id === p.deploymentId)), 'INVALID_EVENT', '활동 기록의 식별자를 확인하세요.');
    const record = event(state, p.eventType, { type: p.resourceType, id: p.resourceId, deploymentId: p.deploymentId }, now, actorId, p.payload ?? {}, p.correlationId); if (p.status) { check(['recorded', 'failed', 'pending', 'completed'].includes(p.status), 'INVALID_EVENT', '활동 상태를 확인하세요.'); record.status = p.status; } return clone(record);
  }
  if (type.startsWith('experience.') || type.startsWith('memory.')) return handleMemoryAction(state, type, p, now, actorId);
  throw new WorkspaceError('UNKNOWN_ACTION', '지원하는 작업을 선택하세요.');
}

function persistDecision(state, p, now, actorId) {
  fields(p, ['deploymentId', 'requestId', 'inputPackage', 'inputPackageHash', 'jevRequest', 'jevResponse', 'decision', 'outcomeType', 'status', 'expiresAt', 'marketSnapshotId', 'ruleResults', 'correlationId'], ['deploymentId', 'requestId', 'inputPackage', 'decision', 'outcomeType', 'status']);
  const deployment = find(state.deployments, p.deploymentId); check(identifier(p.requestId) && OUTCOMES.includes(p.outcomeType) && ['READY', 'FAILED', 'INVALIDATED', 'EXPIRED', 'REJECTED', 'COMPLETED'].includes(p.status) && plain(p.decision) && ['buy', 'hold', 'sell'].includes(p.decision.action), 'INVALID_DECISION', '선택 결과와 실행 상태를 확인하세요.');
  const input = p.inputPackage, hash = hashInputPackage(input);
  check(p.inputPackageHash === undefined || p.inputPackageHash === hash, 'INPUT_HASH_MISMATCH', '보존할 입력과 해시를 대조하세요.');
  check(input.deploymentId === deployment.id && input.investmentProfileId === deployment.investmentProfileId && iso(input.asOf), 'DECISION_SCOPE', '입력의 운용 봇과 실행 시점을 대조하세요.');
  for (const key of ['investmentProfileVersionId', 'strategyVersionId', 'riskPresetVersionId', 'memoryVersionId']) check(input[key] === deployment[key], 'DECISION_VERSION_MISMATCH', '실행에 적용된 버전을 확인하세요.');
  const refs = deploymentRefs(state, deployment);
  check(stableStringify(input.profilePolicy) === stableStringify(refs.profileVersion.settings) && stableStringify(input.strategy) === stableStringify(refs.strategyVersion.settings) && stableStringify(input.riskLimits) === stableStringify(refs.riskPresetVersion.settings) && stableStringify(input.feeScheduleSnapshot) === stableStringify(deployment.feeScheduleSnapshot), 'DECISION_POLICY_MISMATCH', '입력에 보존한 정책과 불변 버전의 내용을 대조하세요.');
  check(input.accountSnapshot?.id === deployment.accountId && !validatePaperAccount(input.accountSnapshot).length && input.accountSnapshot.initialEquity === refs.account.initialEquity && stableStringify(input.accountSnapshot.ledger) === stableStringify(refs.account.ledger) && stableStringify(input.accountSnapshot.orders) === stableStringify(refs.account.orders), 'DECISION_ACCOUNT_MISMATCH', '선택 당시 계좌 원장과 보유 상태를 대조하세요.');
  check(iso(input.knowledgeAsOf) && iso(input.contextBuiltAt) && before(input.knowledgeAsOf, input.contextBuiltAt) && ['strict', 'retrospective'].includes(input.policyMode) && (input.policyMode === 'strict' ? before(input.knowledgeAsOf, input.asOf) && [refs.profileVersion, refs.strategyVersion, refs.riskPresetVersion].every(v => before(v.createdAt, input.asOf)) : ['HISTORICAL_FUNCTIONAL_REPLAY', 'RETROSPECTIVE_POLICY_SIMULATION'].includes(input.experimentType)), 'DECISION_TIME_CONTRACT', '자료·정책의 사용 가능 시점과 실험 유형을 확인하세요.');
  check(input.decisionContractVersionId === find(state.strategyVersions, deployment.strategyVersionId).settings.decisionContractVersionId && input.fusionPolicyVersionId === find(state.strategyVersions, deployment.strategyVersionId).settings.fusionPolicyVersionId, 'DECISION_VERSION_MISMATCH', '선택·결합 계약의 버전을 확인하세요.');
  check(!state.decisionRecords.some(d => d.requestId === p.requestId), 'DUPLICATE_REQUEST', '이미 기록한 요청입니다.');
  check(p.expiresAt === undefined || iso(p.expiresAt) && before(now, p.expiresAt), 'INVALID_EXPIRY', '제안 유효 시각을 확인하세요.');
  const record = { id: id('decision'), requestId: p.requestId, deploymentId: deployment.id, investmentProfileId: deployment.investmentProfileId, accountId: deployment.accountId, investmentProfileVersionId: input.investmentProfileVersionId, strategyVersionId: input.strategyVersionId, riskPresetVersionId: input.riskPresetVersionId, mechanicalModelVersionId: input.mechanicalModelVersionId, decisionContractVersionId: input.decisionContractVersionId, fusionPolicyVersionId: input.fusionPolicyVersionId, memoryVersionId: input.memoryVersionId, marketSnapshotId: p.marketSnapshotId ?? null, inputPackage: clone(input), inputPackageHash: hash, noteRevisionRefs: (input.approvedNotes ?? []).map(n => ({ id: n.id, version: n.version })), jevRequest: clone(p.jevRequest ?? null), jevResponse: clone(p.jevResponse ?? null), decision: clone(p.decision), outcomeType: p.outcomeType, decisionStatus: p.status, ruleResults: clone(p.ruleResults ?? []), createdAt: now, expiresAt: p.expiresAt ?? null, correlationId: p.correlationId ?? id('correlation') };
  check(new TextEncoder().encode(stableStringify(record)).length <= 600000, 'DECISION_SIZE', '보존할 입력 자료의 범위를 줄여 주세요.');
  state.decisionRecords.push(record); event(state, 'DECISION_SAVED', { type: 'decision', id: record.id, deploymentId: deployment.id }, now, actorId, { decisionId: record.id, requestId: record.requestId, status: record.decisionStatus }, record.correlationId); return clone(record);
}

const PUBLIC_OBSERVATION_PROVIDERS={BINANCE_PUBLIC_REST:{provider:'binance',loaderVersion:'binance-closed-rest-v1'},OKX_PUBLIC_REST:{provider:'okx',loaderVersion:'okx-closed-rest-v1'}};
function publicObservationSource(source){
  const registered=PUBLIC_OBSERVATION_PROVIDERS[source?.kind];
  if(!registered)return false;
  const legacy=source.kind==='BINANCE_PUBLIC_REST'&&source.provider===undefined&&source.loaderVersion===undefined&&source.dataOrigin===undefined&&source.validationMode===undefined;
  return legacy||source.provider===registered.provider&&source.loaderVersion===registered.loaderVersion&&source.dataOrigin==='PUBLIC_API'&&source.validationMode==='PUBLIC';
}
function validateObservationMetadata(state, experience, observation, now, requireCapture=false) {
  if(observation.horizonHours!==undefined)check([4,12,24,48,72,168].includes(observation.horizonHours)&&Date.parse(observation.asOf)-Date.parse(experience.occurredAt)===observation.horizonHours*3600000,'INVALID_OBSERVATION_TIME','관측 기간과 종료 시각을 대조하세요.');
  if(observation.availability!==undefined){const a=observation.availability;check(plain(a)&&a.status==='READY'&&a.missingBars===0&&a.requestedEndAt===observation.asOf&&iso(a.availableAt)&&before(a.availableAt,now),'INVALID_OBSERVATION_SOURCE','확정 자료 확보 시각과 관측 종료를 확인하세요.');}
  if(observation.source!==undefined){
    const s=observation.source;check(plain(s)&&['BINANCE_PUBLIC_REST','OKX_PUBLIC_REST','ARCHIVED_DATASET'].includes(s.kind)&&/^[a-f0-9]{64}$/.test(s.datasetSha256)&&/^[a-f0-9]{64}$/.test(s.barsSha256)&&iso(s.availableAt)&&iso(s.observedAt)&&before(s.availableAt,s.observedAt)&&before(s.observedAt,now)&&s.barRange?.startAt===experience.occurredAt&&s.barRange?.endAt===observation.asOf&&s.barRange?.count===(Date.parse(observation.asOf)-Date.parse(experience.occurredAt))/14400000,'INVALID_OBSERVATION_SOURCE','후속 관측의 원본 해시·범위·확보 시각을 대조하세요.');
    if(s.kind!=='ARCHIVED_DATASET'){
      const registered=PUBLIC_OBSERVATION_PROVIDERS[s.kind],record=find(state.decisionRecords,experience.decisionId);
      check(publicObservationSource(s)&&identifier(s.sourceSnapshotId)&&/^[a-f0-9]{64}$/.test(s.sourceSnapshotSha256)&&(!record.inputPackage.marketProvider||record.inputPackage.marketProvider===registered.provider),'INVALID_OBSERVATION_SOURCE','공개 시세의 등록 공급원·PUBLIC 검증·원본 참조를 확인하세요.');
      const loaded=state.marketSnapshots?.find(c=>c.id===s.sourceSnapshotId);
      check(!requireCapture||loaded,'INVALID_OBSERVATION_SOURCE','관측과 함께 검증한 공개 시세 원본을 저장하세요.');
      if(loaded){const bars=loaded.marketData?.dataset?.bars?.filter(b=>b[0]>=Date.parse(s.barRange.startAt)&&b[0]+14400000<=Date.parse(s.barRange.endAt));check(loaded.provider===registered.provider&&loaded.loaderVersion===registered.loaderVersion&&loaded.dataOrigin==='PUBLIC_API'&&loaded.marketData?.manifest?.dataOrigin==='PUBLIC_API'&&loaded.marketData?.manifest?.loaderVersion===registered.loaderVersion&&loaded.sha256===s.sourceSnapshotSha256&&loaded.marketData?.manifest?.datasetSha256===s.datasetSha256&&Array.isArray(bars)&&bars.length===s.barRange.count&&hashInputPackage(bars)===s.barsSha256,'INVALID_OBSERVATION_SOURCE','확보한 원본과 관측 봉의 공급원·해시·범위를 대조하세요.');}
    }
  }
  if(observation.performance!==undefined){
    const p=observation.performance,record=find(state.decisionRecords,experience.decisionId),start=record.inputPackage.accountSnapshot;
    check(plain(p)&&p.schemaVersion===1&&p.version==='fixed-decision-marked-equity-v1'&&p.fixedDecision===true&&text(p.assumption)&&text(p.excursionBasis)&&p.decisionId===record.id&&p.accountId===start.id&&p.selectedAction===record.decision.action&&['EXECUTED','HOLD','UNFILLED','REJECTED'].includes(p.executionStatus)&&p.fromAt===experience.occurredAt&&p.asOf===observation.asOf&&p.referencePrice===experience.referencePrice&&p.endingPrice===observation.price,'INVALID_OBSERVATION_PERFORMANCE','실행 성과의 선택·계좌·평가 가정을 확인하세요.');
    check(['startingCash','startingQuantity','initialEquity','endingCash','endingQuantity','endingEquity','netReturn','feesPaid','maxFavorableExcursion','maxAdverseExcursion'].every(k=>finite(p[k]))&&p.startingCash===start.cash&&p.startingQuantity===start.btcQuantity&&p.initialEquity>0&&p.endingCash>=0&&p.endingQuantity>=0&&p.endingEquity>=0&&p.feesPaid>=0&&Math.abs(p.initialEquity-(start.cash+start.btcQuantity*experience.referencePrice))<1e-6&&Math.abs(p.endingEquity-(p.endingCash+p.endingQuantity*observation.price))<1e-6&&Math.abs(p.netReturn-(p.endingEquity/p.initialEquity-1))<1e-10&&p.maxFavorableExcursion>=-1e-12&&p.maxAdverseExcursion<=1e-12,'INVALID_OBSERVATION_PERFORMANCE','고정 잔고 평가의 자산·수익률·비용을 대조하세요.');
    check(strings(p.fillIds,100)&&strings(p.excludedLaterFillIds,100)&&plain(p.benchmarks)&&['holdingEquity','holdingReturn','allCashEquity','allCashReturn','buyAndHoldEquity','buyAndHoldReturn','buyAndHoldEntryFee','buyAndHoldEntrySlippage'].every(k=>finite(p.benchmarks[k]))&&plain(p.opportunityCost)&&['holding','allCash','buyAndHold'].every(k=>finite(p.opportunityCost[k]))&&plain(p.costAssumption)&&['feeBps','slippageBps'].every(k=>finite(p.costAssumption[k])&&p.costAssumption[k]>=0),'INVALID_OBSERVATION_PERFORMANCE','체결 참조와 보유·현금·매수 보유 대조값을 확인하세요.');
    const initialIds=new Set(start.ledger.map(f=>f.id)),fills=find(state.accounts,experience.accountId).ledger.filter(f=>!initialIds.has(f.id)&&f.decisionId===record.id&&f.deploymentId===experience.deploymentId&&before(f.at,observation.asOf));
    let cash=start.cash,qty=start.btcQuantity,fees=0;for(const f of fills){cash+=f.side==='buy'?-f.gross-f.fee:f.gross-f.fee;qty+=f.side==='buy'?f.quantity:-f.quantity;fees+=f.fee;}
    check(fills.length===p.fillIds.length&&fills.every(f=>p.fillIds.includes(f.id))&&Math.abs(cash-p.endingCash)<1e-6&&Math.abs(qty-p.endingQuantity)<1e-10&&Math.abs(fees-p.feesPaid)<1e-6,'INVALID_OBSERVATION_PERFORMANCE','해당 결정의 실제 체결만 성과에 귀속하세요.');
  }
}

export function summarizeMemoryEvidence(state, experienceIds) {
  const ids=[...new Set(experienceIds??[])],experiences=ids.map(value=>find(state.experiences,value)),decisions=experiences.map(e=>find(state.decisionRecords,e.decisionId));
  const times=values=>values.length?{startAt:values.reduce((a,b)=>before(a,b)?a:b),endAt:values.reduce((a,b)=>before(a,b)?b:a)}:null;
  const investment=experiences.filter(e=>e.experienceType==='INVESTMENT_DECISION'),forward=investment.filter(e=>e.experimentType==='FORWARD_PAPER'&&e.status==='EVALUATED'&&e.observation&&e.evaluation),priced=investment.filter(e=>e.observation&&e.referencePrice>0),performance=investment.filter(e=>e.observation?.performance?.fixedDecision===true);
  return {experienceCount:experiences.length,experienceIds:ids,decisionIds:[...new Set(decisions.map(d=>d.id))],investmentDecisionCount:investment.length,operatingExperienceCount:experiences.length-investment.length,forwardObservedEvaluatedCount:forward.length,forwardPerformanceCount:forward.filter(e=>e.observation.performance?.fixedDecision===true&&publicObservationSource(e.observation.source)).length,independentSampleCount:null,independenceStatus:'REQUIRES_EXPLICIT_OPPORTUNITY_GROUPING',observationWindow:times(experiences.flatMap(e=>[e.occurredAt,e.observation?.asOf].filter(iso))),evaluationWindow:times(experiences.map(e=>e.evaluationCompletedAt).filter(iso)),experimentIds:[...new Set(experiences.map(e=>e.experimentId))],costScheduleIds:[...new Set(decisions.map(d=>d.inputPackage.feeScheduleSnapshot?.id).filter(identifier))],priceChangeObservations:priced.map(e=>({experienceId:e.id,priceReturn:e.observation.price/e.referencePrice-1,referencePrice:e.referencePrice,endingPrice:e.observation.price,asOf:e.observation.asOf})),decisionPerformanceObservations:performance.map(e=>({experienceId:e.id,fixedDecision:true,netReturn:e.observation.performance.netReturn,feesPaid:e.observation.performance.feesPaid,benchmarks:clone(e.observation.performance.benchmarks),performanceVersion:e.observation.performance.version})),predictionEvaluation:{status:'NOT_MEASURED',description:'실제 연결된 경험·가격 변화·고정 계좌 성과를 기록하며 예측 정확도는 별도 검증한다.'}};
}
function memoryKnowledgeType(value){const type=value??'HYPOTHESIS';check(MEMORY_KNOWLEDGE_TYPES.includes(type),'INVALID_KNOWLEDGE_TYPE','관측 사실·가설·경험칙·운영 절차 중 지식 유형을 선택하세요.');return type;}
function requireHeuristicEvidence(type, evidence, validation){if(type==='VALIDATED_HEURISTIC')check(evidence.forwardObservedEvaluatedCount>0&&evidence.forwardPerformanceCount>0&&text(validation.validationPlan)&&text(validation.counterexamples)&&text(validation.uncertainty),'HEURISTIC_EVIDENCE_REQUIRED','검증된 경험칙에는 실제 실시간 관측·평가·대조 성과와 검증 계획·반례·불확실성이 필요합니다.');}
function validateMemoryMetadata(state,memory){
  if(memory.sourceMemoryVersionId!==undefined){const source=find(state.memoryVersions,memory.sourceMemoryVersionId);check(source.investmentProfileId===memory.investmentProfileId&&source.version<memory.version,'MEMORY_SCOPE','기억 적용 원본 버전의 프로필과 순서를 확인하세요.');}
  for(const item of memory.items){
    if(item.knowledgeType!==undefined)memoryKnowledgeType(item.knowledgeType);
    if(item.experienceCount!==undefined)check(Array.isArray(item.experienceIds)&&item.experienceCount===new Set(item.experienceIds).size&&item.experienceIds.every(id=>state.experiences.some(e=>e.id===id&&e.investmentProfileId===memory.investmentProfileId)),'MEMORY_SCOPE','기억의 실제 원본 경험 수와 프로필을 대조하세요.');
    if(item.authorizations!==undefined){
      check(Array.isArray(item.authorizations)&&item.authorizations.length<=200&&Array.isArray(item.approvedDeploymentIds)&&Array.isArray(item.approvedExperimentIds),'MEMORY_SCOPE','기억 적용 대상과 실험 승인 목록을 확인하세요.');
      for(const a of item.authorizations){check(exactKeys(a,['deploymentId','experimentId','authorizedAt','authorizedBy','reason'])&&identifier(a.deploymentId)&&(a.experimentId===null||identifier(a.experimentId))&&iso(a.authorizedAt)&&before(a.authorizedAt,memory.createdAt)&&identifier(a.authorizedBy)&&text(a.reason,1000),'MEMORY_SCOPE','기억 적용의 명시 승인 기록을 확인하세요.');const d=find(state.deployments,a.deploymentId);check(d.investmentProfileId===memory.investmentProfileId&&d.experimentId===a.experimentId&&item.approvedDeploymentIds.includes(d.id)&&item.approvedExperimentIds.includes(d.experimentId),'MEMORY_SCOPE','기억 적용 대상의 프로필·실험 범위를 확인하세요.');}
      check(new Set(item.approvedDeploymentIds).size===item.approvedDeploymentIds.length&&new Set(item.approvedExperimentIds).size===item.approvedExperimentIds.length&&item.approvedExperimentIds.every(id=>id===item.experimentId||item.authorizations.some(a=>a.experimentId===id))&&item.approvedDeploymentIds.every(id=>{const d=state.deployments.find(d=>d.id===id);return d?.investmentProfileId===memory.investmentProfileId&&(d.experimentId===item.experimentId||item.authorizations.some(a=>a.deploymentId===id&&a.experimentId===d.experimentId));}),'MEMORY_SCOPE','승인된 대상·실험의 범위와 적용 기록을 대조하세요.');
    }
  }
}

function handleMemoryAction(state, type, p, now, actorId) {
  if (type === 'experience.record') {
    fields(p, ['decisionId', 'experienceType', 'summary', 'observationDueAt', 'referencePrice', 'selectedAction', 'outcomeType'], ['decisionId', 'experienceType', 'summary']); const decision = find(state.decisionRecords, p.decisionId), deployment = find(state.deployments, decision.deploymentId);
    const occurredAt = p.experienceType === 'INVESTMENT_DECISION' ? decision.inputPackage.asOf : now;
    check(['INVESTMENT_DECISION', 'EXECUTION_OPERATION'].includes(p.experienceType) && text(p.summary) && (p.observationDueAt === undefined || iso(p.observationDueAt) && before(occurredAt, p.observationDueAt)), 'INVALID_EXPERIENCE', '경험 유형과 후속 관측 시각을 확인하세요.');
    if (p.experienceType === 'INVESTMENT_DECISION') check(decision.decisionStatus !== 'FAILED' && p.referencePrice > 0 && finite(p.referencePrice), 'INVALID_INVESTMENT_EXPERIENCE', '투자 선택과 당시 기준 가격을 확인하세요.');
    check((p.selectedAction === undefined || p.selectedAction === decision.decision.action) && (p.outcomeType === undefined || p.outcomeType === decision.outcomeType), 'EXPERIENCE_DECISION_MISMATCH', '경험에 연결한 선택과 결과 유형을 대조하세요.');
    const experience = { id: id('experience'), investmentProfileId: deployment.investmentProfileId, deploymentId: deployment.id, strategyVersionId: decision.strategyVersionId, riskPresetVersionId: decision.riskPresetVersionId, accountId: deployment.accountId, decisionId: decision.id, sourceMemoryVersionId: decision.memoryVersionId, experienceType: p.experienceType, outcomeType: p.outcomeType ?? decision.outcomeType, selectedAction: p.selectedAction ?? decision.decision.action, referencePrice: p.referencePrice ?? null, summary: p.summary.trim(), experimentId: decision.inputPackage.experimentId, experimentType: decision.inputPackage.experimentType, occurredAt, recordedAt: now, observationDueAt: p.observationDueAt ?? occurredAt, outcomeObservedAt: null, evaluationCompletedAt: null, status: 'AWAITING_OBSERVATION', observation: null, evaluation: null, correlationId: decision.correlationId };
    state.experiences.push(experience); event(state, 'EXPERIENCE_RECORDED', { type: 'experience', id: experience.id, deploymentId: deployment.id }, now, actorId, { experienceType: experience.experienceType }, experience.correlationId); return clone(experience);
  }
  if (type === 'experience.observe') {
    fields(p, ['experienceId', 'observation'], ['experienceId', 'observation']); const experience = find(state.experiences, p.experienceId); check(experience.status === 'AWAITING_OBSERVATION' && before(experience.observationDueAt, now), 'OBSERVATION_NOT_DUE', '후속 관측 기간과 기록 상태를 확인하세요.');
    const observation = p.observation; fields(observation, ['asOf', 'horizonHours', 'price', 'maxPrice', 'minPrice', 'details', 'counterfactual', 'costAssumption','availability','source','performance'], ['asOf']); check(iso(observation.asOf) && before(experience.observationDueAt, observation.asOf) && before(observation.asOf, now), 'INVALID_OBSERVATION_TIME', '후속 자료의 관측 시점을 확인하세요.');
    if (experience.experienceType === 'INVESTMENT_DECISION') check(['price', 'maxPrice', 'minPrice'].every(k => finite(observation[k]) && observation[k] > 0) && observation.maxPrice >= Math.max(observation.price, experience.referencePrice) && observation.minPrice <= Math.min(observation.price, experience.referencePrice), 'INVALID_OBSERVATION', '후속 가격과 고저가를 확인하세요.');
    else check(text(observation.details), 'INVALID_OBSERVATION', '운영 원인과 복구 결과를 입력하세요.');
    validateObservationMetadata(state,experience,observation,now,true);
    experience.observation = clone(observation); experience.outcomeObservedAt = now; experience.status = 'OBSERVED'; return clone(experience);
  }
  if (type === 'experience.evaluate') {
    fields(p, ['experienceId', 'summary', 'evaluationVersion', 'evidenceRefs'], ['experienceId', 'summary', 'evaluationVersion']); const experience = find(state.experiences, p.experienceId); check(experience.status === 'OBSERVED' && text(p.summary) && identifier(p.evaluationVersion) && (p.evidenceRefs === undefined || strings(p.evidenceRefs)), 'INVALID_EVALUATION', '관측을 완료하고 평가 근거를 입력하세요.');
    const ref = experience.referencePrice, observation = experience.observation;
    experience.evaluation = { summary: p.summary.trim(), evaluationVersion: p.evaluationVersion, evidenceRefs: clone(p.evidenceRefs ?? []), return: experience.experienceType === 'INVESTMENT_DECISION' ? observation.price / ref - 1 : null, returnBasis:'REFERENCE_PRICE_CHANGE',...(observation.performance?{performance:clone(observation.performance)}:{}), maxFavorableExcursion: experience.experienceType === 'INVESTMENT_DECISION' ? observation.maxPrice / ref - 1 : null, maxAdverseExcursion: experience.experienceType === 'INVESTMENT_DECISION' ? observation.minPrice / ref - 1 : null, evaluatedBy: actorId };
    experience.evaluationCompletedAt = now; experience.status = 'EVALUATED'; event(state, 'EXPERIENCE_EVALUATED', { type: 'experience', id: experience.id, deploymentId: experience.deploymentId }, now, actorId, { experienceType: experience.experienceType }, experience.correlationId); return clone(experience);
  }
  if (type === 'memory.propose') {
    fields(p, ['investmentProfileId', 'experienceIds', 'title', 'text', 'approvedDeploymentIds', 'investmentRelevance','knowledgeType','validationPlan','uncertainty'], ['investmentProfileId', 'experienceIds', 'title', 'text']); find(state.investmentProfiles, p.investmentProfileId); check(strings(p.experienceIds) && p.experienceIds.length > 0 && text(p.title, 120) && text(p.text), 'INVALID_MEMORY_CANDIDATE', '기억 후보의 원본 경험과 내용을 입력하세요.');
    const experiences = p.experienceIds.map(key => find(state.experiences, key)); check(experiences.every(v => v.investmentProfileId === p.investmentProfileId && v.status === 'EVALUATED'), 'UNREVIEWED_EXPERIENCE', '해당 프로필의 평가된 경험을 선택하세요.');
    check(new Set(experiences.map(v => v.experimentId)).size === 1 && new Set(experiences.map(v => v.deploymentId)).size === 1, 'MEMORY_EXPERIMENT_SCOPE', '동일 배포와 실험 범위의 경험을 선택하세요.');
    if (experiences.some(v => v.experienceType === 'EXECUTION_OPERATION')) check(text(p.investmentRelevance), 'INVESTMENT_RELEVANCE_REQUIRED', '운영 경험이 투자 선택에 기여하는 근거를 입력하세요.');
    const approvedDeploymentIds = p.approvedDeploymentIds ?? []; check(strings(approvedDeploymentIds) && approvedDeploymentIds.every(key => { const d = state.deployments.find(v => v.id === key); return d?.investmentProfileId === p.investmentProfileId && d.experimentId === experiences[0].experimentId; }), 'MEMORY_SCOPE', '기억을 공유할 프로필·실험 범위를 확인하세요.');
    const knowledgeType=memoryKnowledgeType(p.knowledgeType);check((p.validationPlan===undefined||text(p.validationPlan))&&(p.uncertainty===undefined||text(p.uncertainty)),'INVALID_MEMORY_VALIDATION','검증 계획과 불확실성 내용을 확인하세요.');
    const evidenceSummary=summarizeMemoryEvidence(state,p.experienceIds),candidate = { id: id('candidate'), investmentProfileId: p.investmentProfileId, deploymentId: experiences[0].deploymentId, experimentId: experiences[0].experimentId, experienceIds: clone(p.experienceIds), title: p.title.trim(), text: p.text.trim(), approvedDeploymentIds: clone(approvedDeploymentIds), investmentRelevance: p.investmentRelevance ?? null, knowledgeType,experienceCount:evidenceSummary.experienceCount,evidenceSummary,validationPlan:p.validationPlan??null,uncertainty:p.uncertainty??null,createdAt: now, status: 'CANDIDATE', validation: null, review: null, resultMemoryVersionId: null };
    state.memoryCandidates.push(candidate); event(state, 'MEMORY_CANDIDATE_CREATED', { type: 'candidate', id: candidate.id, deploymentId: candidate.deploymentId }, now, actorId); return clone(candidate);
  }
  if (type === 'memory.validate') {
    fields(p, ['candidateId', 'summary', 'counterexamples', 'forwardEvidence', 'methodVersion','knowledgeType','validationPlan','uncertainty'], ['candidateId', 'summary', 'counterexamples', 'forwardEvidence', 'methodVersion']); const candidate = find(state.memoryCandidates, p.candidateId); check(candidate.status === 'CANDIDATE' && text(p.summary) && text(p.counterexamples) && text(p.forwardEvidence) && identifier(p.methodVersion), 'INVALID_MEMORY_VALIDATION', '검증 방법·반례·표본 외 근거를 입력하세요.');
    const knowledgeType=memoryKnowledgeType(p.knowledgeType??candidate.knowledgeType),validationPlan=p.validationPlan??candidate.validationPlan??null,uncertainty=p.uncertainty??candidate.uncertainty??null,evidenceSummary=summarizeMemoryEvidence(state,candidate.experienceIds);check((validationPlan===null||text(validationPlan))&&(uncertainty===null||text(uncertainty)),'INVALID_MEMORY_VALIDATION','검증 계획과 불확실성을 확인하세요.');requireHeuristicEvidence(knowledgeType,evidenceSummary,{validationPlan,uncertainty,counterexamples:p.counterexamples});
    candidate.knowledgeType=knowledgeType;candidate.experienceCount=evidenceSummary.experienceCount;candidate.evidenceSummary=evidenceSummary;candidate.validationPlan=validationPlan;candidate.uncertainty=uncertainty;
    candidate.validation = { summary: p.summary.trim(), counterexamples: p.counterexamples.trim(), forwardEvidence: p.forwardEvidence.trim(), methodVersion: p.methodVersion,validationPlan,uncertainty,evidenceSummary:clone(evidenceSummary), validatedAt: now, validatedBy: actorId }; candidate.status = 'VALIDATED'; return clone(candidate);
  }
  if (['memory.approve', 'memory.reject'].includes(type)) {
    fields(p, ['candidateId', 'reason', 'availableAt'], ['candidateId', 'reason']); const candidate = find(state.memoryCandidates, p.candidateId); check(text(p.reason, 1000) && (type === 'memory.approve' ? candidate.status === 'VALIDATED' : ['CANDIDATE', 'VALIDATED'].includes(candidate.status)), 'INVALID_MEMORY_REVIEW', '후보의 검증 상태와 검토 근거를 확인하세요.');
    candidate.review = { decision: type === 'memory.approve' ? 'approved' : 'rejected', reason: p.reason.trim(), reviewedAt: now, reviewedBy: actorId };
    if (type === 'memory.reject') { candidate.status = 'REJECTED'; return clone(candidate); }
    const availableAt = p.availableAt ?? now; check(iso(availableAt) && before(now, availableAt), 'INVALID_MEMORY_AVAILABLE_AT', '기억 사용 가능 시점은 승인 시점 이후로 지정하세요.');
    const knowledgeType=memoryKnowledgeType(candidate.knowledgeType),evidenceSummary=summarizeMemoryEvidence(state,candidate.experienceIds);requireHeuristicEvidence(knowledgeType,evidenceSummary,candidate.validation??{});
    const profile = find(state.investmentProfiles, candidate.investmentProfileId), previous = find(state.memoryVersions, profile.currentMemoryVersionId), item = { candidateId: candidate.id, title: candidate.title, text: candidate.text, experienceIds: clone(candidate.experienceIds), deploymentId: candidate.deploymentId, experimentId: candidate.experimentId, approvedDeploymentIds: clone(candidate.approvedDeploymentIds), knowledgeType,experienceCount:evidenceSummary.experienceCount,evidenceSummary,validation:clone(candidate.validation), approvedAt: now, availableAt };
    const version = { id: id('memory'), investmentProfileId: profile.id, version: previous.version + 1, previousVersionId: previous.id, items: [...clone(previous.items), item], sourceProfileId: profile.sourceProfileId, approvedAt: now, availableAt, createdAt: now };
    state.memoryVersions.push(version); profile.currentMemoryVersionId = version.id; profile.updatedAt = now; candidate.status = 'APPROVED'; candidate.resultMemoryVersionId = version.id;
    event(state, 'MEMORY_APPROVED', { type: 'candidate', id: candidate.id, deploymentId: candidate.deploymentId }, now, actorId, { memoryVersionId: version.id, availableAt }); return { candidate: clone(candidate), memoryVersion: clone(version) };
  }
  throw new WorkspaceError('UNKNOWN_ACTION', '지원하는 작업을 선택하세요.');
}

export function dispatchWorkspaceAction(workspace, command, options = {}) {
  const errors = validateWorkspace(workspace); check(!errors.length, errors[0]?.code ?? 'INVALID_WORKSPACE', errors[0]?.message ?? '저장된 구성을 확인하세요.');
  fields(command, ['type', 'payload', 'idempotencyKey', 'expectedRevision'], ['type', 'payload', 'idempotencyKey', 'expectedRevision']); check(WORKSPACE_ACTIONS.includes(command.type) && identifier(command.idempotencyKey) && Number.isSafeInteger(command.expectedRevision) && command.expectedRevision >= 0, 'INVALID_COMMAND', '작업 식별자와 저장 버전을 확인하세요.');
  const now = at(options), actorId = options.actorId ?? 'workspace-owner'; check(identifier(actorId), 'INVALID_ACTOR', '작업 주체를 확인하세요.');
  const fingerprint = hashInputPackage({ type: command.type, payload: command.payload, actorId });
  const receipt = workspace.commandReceipts.find(v => v.key === command.idempotencyKey);
  if (receipt) { check(receipt.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 요청 ID의 내용이 변경되었습니다.'); return { workspace, result: clone(receipt.result), idempotent: true }; }
  check(command.expectedRevision === workspace.revision, 'REVISION_CONFLICT', '다른 변경이 저장되었습니다. 최신 상태를 다시 불러오세요.');
  check(before(workspace.updatedAt, now), 'INVALID_TIME', '작업 시각이 이전 저장 시각보다 빠릅니다.');
  const next = clone(workspace), result = handleAction(next, command.type, command.payload, now, actorId);
  next.revision++; next.updatedAt = now; next.commandReceipts.push({ id: id('receipt'), key: command.idempotencyKey, fingerprint, type: command.type, revision: next.revision, createdAt: now, result: clone(result) });
  const changedErrors = validateWorkspace(next); check(!changedErrors.length, changedErrors[0]?.code ?? 'INVALID_WORKSPACE', changedErrors[0]?.message ?? '변경한 구성을 확인하세요.');
  return { workspace: next, result, idempotent: false };
}

export function appendDecisionRecord(workspace, payload, options = {}) {
  return dispatchWorkspaceAction(workspace, { type: 'decision.persist', payload, idempotencyKey: options.idempotencyKey ?? payload.requestId, expectedRevision: options.expectedRevision ?? workspace.revision }, options);
}

/** Trusted execution-service entry point. Public Action dispatch accepts no account replacement. */
export function applyDeploymentRun(workspace, { deploymentId, account, decisionPayload, decisionId, activityEvents = [], experience = null } = {}, options = {}) {
  const errors = validateWorkspace(workspace); check(!errors.length, errors[0]?.code ?? 'INVALID_WORKSPACE', errors[0]?.message ?? '저장된 구성을 확인하세요.');
  const now = at(options), actorId = options.actorId ?? 'paper-execution-service', expectedRevision = options.expectedRevision ?? workspace.revision, idempotencyKey = options.idempotencyKey;
  check(identifier(idempotencyKey) && identifier(actorId), 'INVALID_COMMAND', '실행 요청 식별자를 확인하세요.');
  check(Array.isArray(activityEvents) && activityEvents.length <= 12 && activityEvents.every(e => plain(e) && /^[A-Z][A-Z0-9_]{1,95}$/.test(e.eventType) && (!e.occurredAt || iso(e.occurredAt) && before(e.occurredAt, now)) && safe(e.payload ?? {})) && (options.commandFingerprint === undefined || /^[a-f0-9]{64}$/.test(options.commandFingerprint)), 'INVALID_EXECUTION_EVENT', '실행 사건과 요청 바인딩을 확인하세요.');
  const payload = { deploymentId, account, decisionPayload: decisionPayload ?? null, decisionId: decisionId ?? null, activityEvents, experience, commandFingerprint: options.commandFingerprint ?? null }, fingerprint = hashInputPackage({ type: 'internal.deployment.run', payload, actorId });
  const receipt = workspace.commandReceipts.find(v => v.key === idempotencyKey);
  if (receipt) { check(receipt.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', '동일 실행 요청의 내용이 변경되었습니다.'); return { workspace, result: clone(receipt.result), idempotent: true }; }
  check(expectedRevision === workspace.revision, 'REVISION_CONFLICT', '다른 변경이 저장되었습니다. 최신 상태를 다시 불러오세요.'); check(before(workspace.updatedAt, now), 'INVALID_TIME', '실행 저장 시각을 확인하세요.');
  const next = clone(workspace), deployment = find(next.deployments, deploymentId), index = next.accounts.findIndex(v => v.id === deployment.accountId), oldAccount = next.accounts[index];
  check(safe(account) && account?.id === oldAccount.id && account.initialEquity === oldAccount.initialEquity && !validatePaperAccount(account).length && before(oldAccount.asOf, account.asOf), 'ACCOUNT_INVARIANT', '실행 계좌의 소유·시간·원장을 대조하세요.');
  check(account.ledger.length >= oldAccount.ledger.length && account.orders.length >= oldAccount.orders.length && oldAccount.ledger.every((v, i) => stableStringify(v) === stableStringify(account.ledger[i])) && oldAccount.orders.every((v, i) => stableStringify(v) === stableStringify(account.orders[i])), 'LEDGER_HISTORY_CHANGED', '기존 체결과 주문 기록을 보존하세요.');
  check(!(decisionPayload && decisionId), 'INVALID_DECISION', '결정 사본 또는 기존 결정 식별자를 선택하세요.');
  const record = decisionPayload ? persistDecision(next, { ...decisionPayload, deploymentId }, now, actorId) : decisionId ? find(next.decisionRecords, decisionId) : null;
  check(!record || record.deploymentId === deploymentId, 'DECISION_SCOPE', '결정과 계좌의 운용 봇을 대조하세요.');
  const accountCopy = clone(account), fills = accountCopy.ledger.slice(oldAccount.ledger.length);
  check(fills.length <= 1 && (!fills.length || record && record.decisionStatus === 'READY' && fills[0].side === record.decision.action), 'EXECUTION_DECISION_MISMATCH', '체결과 유효한 선택 결과를 대조하세요.');
  for (const fill of fills) { Object.assign(fill, { decisionId: record.id, deploymentId, investmentProfileId: deployment.investmentProfileId, investmentProfileVersionId: record.investmentProfileVersionId, strategyVersionId: record.strategyVersionId, riskPresetVersionId: record.riskPresetVersionId, memoryVersionId: record.memoryVersionId, feeScheduleSnapshotId: deployment.feeScheduleSnapshot.id }); event(next, 'FILL_RECORDED', { type: 'fill', id: fill.id, deploymentId }, now, actorId, { decisionId: record.id, accountId: account.id, fillId: fill.id }, record.correlationId); }
  next.accounts[index] = accountCopy; deployment.updatedAt = now;
  for (const item of activityEvents) { const value = event(next, item.eventType, { type: 'deployment', id: deploymentId, deploymentId }, item.occurredAt ?? now, actorId, item.payload ?? {}, record?.correlationId); if (item.status) { check(['recorded', 'failed', 'pending', 'completed'].includes(item.status), 'INVALID_EXECUTION_EVENT', '실행 사건 상태를 확인하세요.'); value.status = item.status; } }
  const experienceRecord = experience ? handleMemoryAction(next, 'experience.record', { ...experience, decisionId: record?.id }, now, actorId) : null;
  const result = { deployment: clone(deployment), account: clone(accountCopy), decisionRecord: clone(record), executionIds: fills.map(v => v.id), commandFingerprint: options.commandFingerprint ?? null, experience: experienceRecord };
  event(next, 'BOT_RUN_COMPLETED', { type: 'deployment', id: deploymentId, deploymentId }, now, actorId, { decisionId: record?.id ?? null, executionIds: result.executionIds }, record?.correlationId);
  next.revision++; next.updatedAt = now; next.commandReceipts.push({ id: id('receipt'), key: idempotencyKey, fingerprint, type: 'internal.deployment.run', revision: next.revision, createdAt: now, result: clone(result) });
  const changedErrors = validateWorkspace(next); check(!changedErrors.length, changedErrors[0]?.code ?? 'INVALID_WORKSPACE', changedErrors[0]?.message ?? '운용 결과를 확인하세요.');
  return { workspace: next, result, idempotent: false };
}

export function validateWorkspace(state) {
  const errors = [], bad = (code, message, path = 'workspace') => errors.push({ code, message, path });
  const requiredKeys = ['schemaVersion', 'revision', 'createdAt', 'updatedAt', ...COLLECTIONS];
  if (!plain(state) || !safe(state) || Object.keys(state).some(k => ![...requiredKeys, 'research', 'knowledge','scheduler','sharedAccounts','marketSnapshots','comparisons','mindDocuments','mindManifests','mindRuns','mindPositions','mindSubscriptions','mindSelections','marketKnowledge','universeSourceSnapshots','newsComparisons','newsComparisonResults','quantStrategies','strategyModels','mindPresets','regimePrograms','homeMarketRecords','learningSessions','simulationDrafts','uiPreferences'].includes(k)) || requiredKeys.some(k => !Object.hasOwn(state, k)) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !iso(state.createdAt) || !iso(state.updatedAt) || !before(state.createdAt, state.updatedAt) || COLLECTIONS.some(k => !Array.isArray(state[k]))) return [{ code: 'INVALID_WORKSPACE', message: '지원하는 운용 구성 문서를 확인하세요.', path: 'workspace' }];
  if(state.uiPreferences!==undefined&&!validUiPreferences(state.uiPreferences,state))return [{code:'INVALID_UI_PREFERENCES',message:'저장된 캐릭터 설정과 마인드의 연결을 확인하세요.',path:'uiPreferences'}];
  for(const key of ['mindDocuments','mindManifests','mindRuns','mindPositions','mindSubscriptions','mindSelections','marketKnowledge','universeSourceSnapshots','newsComparisons','newsComparisonResults','quantStrategies','strategyModels','mindPresets','regimePrograms','homeMarketRecords','learningSessions','simulationDrafts'])if(state[key]!==undefined&&(!Array.isArray(state[key])||state[key].some(v=>!plain(v)||!identifier(v.id))||new Set(state[key].map(v=>v.id)).size!==state[key].length))return [{code:'INVALID_MIND_COLLECTION',message:'마인드 문서와 실행 기록의 식별자를 확인하세요.',path:key}];
  if(state.comparisons!==undefined&&validateComparisons(state.comparisons,state).length)return [{code:'INVALID_COMPARISONS',message:'비교 운용의 공통 조건과 실행 기록을 확인하세요.',path:'comparisons'}];
  if (state.knowledge !== undefined && validateKnowledge(state.knowledge).length) return [{ code: 'INVALID_KNOWLEDGE', message: '저장된 노트의 이력과 승인 상태를 확인하세요.', path: 'knowledge' }];
  if(state.research!==undefined&&validateResearch(state.research).length)return [{code:'INVALID_RESEARCH',message:'리서치 원본과 승인 계보를 확인하세요.',path:'research'}];
  if(state.scheduler!==undefined&&validateJobsState(state.scheduler).length)return [{code:'INVALID_JOB_STATE',message:'예약 작업의 실행 기록을 확인하세요.',path:'scheduler'}];
  const budgetErrors=validatePaperBudgets(state);if(budgetErrors.length)return budgetErrors;
  if(state.sharedAccounts!==undefined&&(!Array.isArray(state.sharedAccounts)||new Set(state.sharedAccounts.map(a=>a?.id)).size!==state.sharedAccounts.length||state.sharedAccounts.some(a=>validateSharedAccount(a).length)))return [{code:'INVALID_SHARED_ACCOUNT',message:'공유 계좌의 공식 원장과 배분을 확인하세요.',path:'sharedAccounts'}];
  if(state.marketSnapshots!==undefined&&(!Array.isArray(state.marketSnapshots)||new Set(state.marketSnapshots.map(a=>a?.id)).size!==state.marketSnapshots.length||state.marketSnapshots.some(s=>!identifier(s?.id)||!/^\w{64}$/.test(s.sha256)||!Array.isArray(s.records)||s.records.some(r=>typeof r.rawBody!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)))))return [{code:'INVALID_MARKET_SNAPSHOT',message:'시세 원본의 식별자와 해시를 확인하세요.',path:'marketSnapshots'}];
  if (state.research !== undefined && !plain(state.research)) return [{ code: 'INVALID_RESEARCH', message: '리서치 저장 구조를 확인하세요.', path: 'research' }];
  for (const collection of COLLECTIONS) { const ids = state[collection].map(v => v?.id); if (ids.some(v => !identifier(v)) || new Set(ids).size !== ids.length) bad('INVALID_ID', '항목 식별자가 중복되거나 형식이 잘못되었습니다.', collection); }
  if (errors.length) return errors;
  try {
    for (const [entities, versions, validator] of [['investmentProfiles', 'profileVersions', profileSettings], ['strategies', 'strategyVersions', strategySettings], ['riskPresets', 'riskPresetVersions', presetSettings]]) {
      for (const entity of state[entities]) { check(text(entity.name, 120) && iso(entity.createdAt) && iso(entity.updatedAt) && before(entity.createdAt, entity.updatedAt), 'INVALID_ENTITY', '이름과 생성 시각을 확인하세요.'); check(find(state[versions], entity.currentVersionId).entityId === entity.id, 'VERSION_SCOPE', '현재 버전의 소유 관계를 확인하세요.'); }
      for (const version of state[versions]) { find(state[entities], version.entityId); check(Number.isSafeInteger(version.version) && version.version > 0 && iso(version.createdAt), 'INVALID_VERSION', '정책 버전을 확인하세요.'); const input = clone(version.settings); if (versions === 'strategyVersions') { check(input.mechanicalModelVersionId === MODEL_VERSION, 'INVALID_MODEL_VERSION', '계량 모델 버전을 확인하세요.'); delete input.mechanicalModelVersionId; } validator(input); if (version.previousVersionId) { const previous = find(state[versions], version.previousVersionId); check(previous.entityId === version.entityId && previous.version === version.version - 1 && before(previous.createdAt, version.createdAt), 'VERSION_CHAIN', '버전 순서와 소유 관계를 확인하세요.'); } else check(version.version === 1, 'VERSION_CHAIN', '최초 버전을 확인하세요.'); }
    }
    for (const profile of state.investmentProfiles) {
      if(profile.displayName!==undefined)check(text(profile.displayName,120)&&iso(profile.displayNameUpdatedAt)&&before(profile.createdAt,profile.displayNameUpdatedAt),'INVALID_NAME','마인드 표시 이름과 변경 시각을 확인하세요.');
      check(find(state.memoryVersions, profile.currentMemoryVersionId).investmentProfileId === profile.id, 'MEMORY_SCOPE', '프로필 기억의 소유 관계를 확인하세요.');
      check(profile.status===undefined||['ACTIVE','ARCHIVED'].includes(profile.status),'INVALID_PROFILE_STATUS','마인드의 운용·보관 상태를 확인하세요.');
      if(profile.status==='ARCHIVED')check(iso(profile.archivedAt)&&before(profile.createdAt,profile.archivedAt)&&before(profile.archivedAt,profile.updatedAt)&&identifier(profile.archivedBy)&&!(state.mindSubscriptions??[]).some(s=>s.profileId===profile.id&&s.status==='ENABLED'),'INVALID_PROFILE_ARCHIVE','보관 시각·사용자와 자동운용 중지 상태를 확인하세요.');
    }
    for (const account of state.accounts) check(!validatePaperAccount(account).length, 'ACCOUNT_INVARIANT', '모의계좌 잔고와 원장을 대조하세요.');
    const accountIds = state.deployments.map(d => d.accountId); check(new Set(accountIds).size === accountIds.length && state.accounts.every(a => accountIds.includes(a.id)), 'ACCOUNT_ISOLATION', '운용 봇별 독립 모의계좌를 확인하세요.');
    for (const deployment of state.deployments) { deploymentRefs(state, deployment); check(deployment.executionMode === 'paper' && ['running', 'paused', 'stopped'].includes(deployment.runtimeStatus) && EXPERIMENT_TYPES.includes(deployment.experimentType) && (deployment.experimentId === null || identifier(deployment.experimentId)) && Array.isArray(deployment.instrumentIds) && deployment.instrumentIds.length === 1 && deployment.instrumentIds[0] === 'BTCUSDT', 'INVALID_DEPLOYMENT', '운용 봇의 상품·상태·실험 범위를 확인하세요.'); check(find(state.memoryVersions, deployment.memoryVersionId).investmentProfileId === deployment.investmentProfileId, 'MEMORY_SCOPE', '운용 봇의 기억 소유 관계를 확인하세요.'); resolveDeploymentPolicy(state, deployment.id); }
    for (const memory of state.memoryVersions) { find(state.investmentProfiles, memory.investmentProfileId); check(Number.isSafeInteger(memory.version) && memory.version > 0 && iso(memory.approvedAt) && iso(memory.availableAt) && before(memory.approvedAt, memory.availableAt) && Array.isArray(memory.items), 'INVALID_MEMORY_VERSION', '기억의 승인·사용 가능 시점을 확인하세요.'); if (memory.previousVersionId) { const previous = find(state.memoryVersions, memory.previousVersionId); check(previous.investmentProfileId === memory.investmentProfileId && previous.version === memory.version - 1, 'MEMORY_VERSION_CHAIN', '기억 버전의 소유와 순서를 확인하세요.'); } else check(memory.version === 1 && memory.items.length === 0, 'MEMORY_VERSION_CHAIN', '최초 기억 버전을 확인하세요.'); validateMemoryMetadata(state,memory); }
    const requests = new Set();
    for (const decision of state.decisionRecords) { find(state.deployments, decision.deploymentId); check(!requests.has(decision.requestId) && OUTCOMES.includes(decision.outcomeType) && decision.inputPackageHash === hashInputPackage(decision.inputPackage), 'INVALID_DECISION_RECORD', '결정 입력 사본과 요청 식별자를 대조하세요.'); requests.add(decision.requestId); }
    for (const experience of state.experiences) { const decision = find(state.decisionRecords, experience.decisionId); check(decision.deploymentId === experience.deploymentId && decision.investmentProfileId === experience.investmentProfileId && ['INVESTMENT_DECISION', 'EXECUTION_OPERATION'].includes(experience.experienceType), 'EXPERIENCE_SCOPE', '경험의 원본 선택과 소유 범위를 확인하세요.'); if(experience.observation)validateObservationMetadata(state,experience,experience.observation,state.updatedAt); }
    for (const candidate of state.memoryCandidates) { find(state.investmentProfiles, candidate.investmentProfileId); check(Array.isArray(candidate.experienceIds) && candidate.experienceIds.length > 0 && candidate.experienceIds.every(key => find(state.experiences, key).investmentProfileId === candidate.investmentProfileId), 'MEMORY_CANDIDATE_SCOPE', '기억 후보의 원본 경험을 확인하세요.'); if(candidate.knowledgeType!==undefined)memoryKnowledgeType(candidate.knowledgeType);if(candidate.experienceCount!==undefined)check(candidate.experienceCount===new Set(candidate.experienceIds).size,'MEMORY_CANDIDATE_SCOPE','실제 연결된 원본 경험 수를 확인하세요.'); }
    check(new Set(state.commandReceipts.map(r => r.key)).size === state.commandReceipts.length && state.commandReceipts.every(r => identifier(r.key) && /^[a-f0-9]{64}$/.test(r.fingerprint) && r.revision <= state.revision), 'INVALID_RECEIPT', '요청 멱등 기록을 확인하세요.');
    check(new TextEncoder().encode(stableStringify(projectWorkspaceForStorage(state))).length <= 15000000, 'WORKSPACE_SIZE', '저장 자료의 검증 한도에 도달했습니다. 기존 정책과 운용 기록은 보존됩니다. 저장 구조를 확인한 뒤 다시 시도하세요.');
  } catch (error) { bad(error.code ?? 'INVALID_WORKSPACE', error.message); }
  return errors;
}
