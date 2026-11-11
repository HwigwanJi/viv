/** Local knowledge workflow. Text is data; no model calls, HTML rendering, or rule execution. */
export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const EXTRACTION_LABEL = '규칙 기반 정리';
export const KNOWLEDGE_KINDS = Object.freeze(['fact', 'observation', 'hypothesis', 'rule']);
export const KNOWLEDGE_STATUSES = Object.freeze(['proposed', 'approved', 'rejected', 'needs-review', 'gap']);
export const KNOWLEDGE_LIMITS = Object.freeze({ items: 200, text: 6000, title: 120, sourceTitle: 240, url: 2048, reason: 1000, tags: 12, references: 30, revisions: 100, proposals: 24, importBytes: 1500000 });

const SOURCE_TYPES = ['conversation', 'wiki', 'user', 'attachment'];
const ITEM_KEYS = ['id', 'title', 'text', 'kind', 'status', 'version', 'sourceTitle', 'sourceUrl', 'sourceType', 'sourceLocator', 'evidenceIds', 'tags', 'createdAt', 'updatedAt', 'review', 'revisions'];
const SNAPSHOT_KEYS = ITEM_KEYS.filter(key => key !== 'revisions');
const INPUT_KEYS = ['title', 'text', 'kind', 'sourceTitle', 'sourceUrl', 'sourceType', 'sourceLocator', 'evidenceIds', 'tags'];
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const validTime = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));
const string = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const uniqueStrings = (value, max, size, pattern) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(entry => string(entry, size) && (!pattern || pattern.test(entry)));
const urlSafe = value => {
  if (value === null) return true;
  if (!string(value, KNOWLEDGE_LIMITS.url)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};

export class KnowledgeError extends Error {
  constructor(code, message) { super(message); this.name = 'KnowledgeError'; this.code = code; }
}
const fail = (code, message) => { throw new KnowledgeError(code, message); };
const nowAt = options => {
  const value = options?.now === undefined ? new Date().toISOString() : options.now;
  if (!validTime(value)) fail('INVALID_TIME', '기록 시각은 ISO UTC 형식이어야 합니다.');
  return new Date(value).toISOString();
};
const makeId = () => `note-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const snapshot = item => Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, copy(item[key])]));

function validateItem(item, path, errors, historical = false) {
  if (!plain(item)) { errors.push({ path, code: 'INVALID_ITEM', message: '지식 항목이 객체가 아닙니다.' }); return; }
  const keys = historical ? SNAPSHOT_KEYS : ITEM_KEYS;
  if (Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(item, key))) errors.push({ path, code: 'UNKNOWN_FIELDS', message: '알 수 없거나 누락된 필드가 있습니다.' });
  if (typeof item.id !== 'string' || !ID.test(item.id)) errors.push({ path, code: 'INVALID_ID', message: '항목 ID가 올바르지 않습니다.' });
  if (!string(item.title, KNOWLEDGE_LIMITS.title) || !string(item.text, KNOWLEDGE_LIMITS.text)) errors.push({ path, code: 'INVALID_TEXT', message: '제목과 본문은 비어 있지 않아야 하며 길이 제한을 지켜야 합니다.' });
  if (!KNOWLEDGE_KINDS.includes(item.kind) || !KNOWLEDGE_STATUSES.includes(item.status)) errors.push({ path, code: 'INVALID_STATE', message: '분류 또는 검토 상태가 올바르지 않습니다.' });
  if (!Number.isInteger(item.version) || item.version < 1 || item.version > 100000) errors.push({ path, code: 'INVALID_VERSION', message: '버전이 올바르지 않습니다.' });
  if (!string(item.sourceTitle, KNOWLEDGE_LIMITS.sourceTitle) || !urlSafe(item.sourceUrl) || !SOURCE_TYPES.includes(item.sourceType) || !string(item.sourceLocator, 240, true)) errors.push({ path, code: 'INVALID_SOURCE', message: '출처 정보가 올바르지 않습니다.' });
  if (!uniqueStrings(item.evidenceIds, KNOWLEDGE_LIMITS.references, 96, ID) || item.evidenceIds?.includes(item.id)) errors.push({ path, code: 'INVALID_EVIDENCE', message: '근거 ID가 중복되거나 올바르지 않습니다.' });
  if (!uniqueStrings(item.tags, KNOWLEDGE_LIMITS.tags, 40)) errors.push({ path, code: 'INVALID_TAGS', message: '태그가 올바르지 않습니다.' });
  if (!validTime(item.createdAt) || !validTime(item.updatedAt) || Date.parse(item.createdAt) > Date.parse(item.updatedAt)) errors.push({ path, code: 'INVALID_TIME', message: '기록 시각이 올바르지 않습니다.' });
  const review = item.review;
  if (review !== null && (!plain(review) || Object.keys(review).some(key => !['decision', 'reason', 'reviewedAt', 'version'].includes(key)) || Object.keys(review).length !== 4 || !['approved', 'rejected'].includes(review.decision) || !string(review.reason, KNOWLEDGE_LIMITS.reason) || !validTime(review.reviewedAt) || review.version !== item.version || Date.parse(review.reviewedAt) < Date.parse(item.updatedAt))) errors.push({ path, code: 'INVALID_REVIEW', message: '검토 기록과 현재 버전이 일치하지 않습니다.' });
  if (['approved', 'rejected'].includes(item.status) && (!review || review.decision !== item.status)) errors.push({ path, code: 'MISSING_REVIEW', message: '승인 또는 반려에는 해당 버전의 검토 기록이 필요합니다.' });
  if (!['approved', 'rejected'].includes(item.status) && review !== null) errors.push({ path, code: 'STALE_REVIEW', message: '검토 대기 항목에 이전 승인을 유지할 수 없습니다.' });
  if (!historical) {
    if (!Array.isArray(item.revisions) || item.revisions.length > KNOWLEDGE_LIMITS.revisions) { errors.push({ path, code: 'INVALID_HISTORY', message: '수정 이력이 올바르지 않습니다.' }); return; }
    let last = 0;
    for (let i = 0; i < item.revisions.length; i++) {
      const revision = item.revisions[i];
      validateItem(revision, `${path}.revisions[${i}]`, errors, true);
      if (revision?.id !== item.id || revision?.version <= last || revision?.version >= item.version) errors.push({ path, code: 'INVALID_HISTORY', message: '수정 이력의 ID 또는 버전 순서가 올바르지 않습니다.' });
      last = revision?.version ?? last;
    }
  }
}

export function validateKnowledge(state) {
  const errors = [];
  if (!plain(state) || Object.keys(state).length !== 2 || Object.keys(state).some(key => !['schemaVersion', 'items'].includes(key)) || state.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION || !Array.isArray(state.items) || state.items.length > KNOWLEDGE_LIMITS.items) return [{ path: 'knowledge', code: 'INVALID_DOCUMENT', message: '지원하는 지식 문서 형식이 아니거나 항목 수 제한을 초과했습니다.' }];
  const ids = new Set();
  const byId = new Map();
  state.items.forEach((item, i) => {
    validateItem(item, `items[${i}]`, errors);
    if (ids.has(item?.id)) errors.push({ path: `items[${i}]`, code: 'DUPLICATE_ID', message: '항목 ID가 중복됩니다.' });
    ids.add(item?.id); byId.set(item?.id, item);
  });
  if (errors.length) return errors;
  for (const item of state.items) {
    if (!Array.isArray(item?.evidenceIds)) continue;
    for (const id of item.evidenceIds) {
      if (!byId.has(id)) errors.push({ path: item.id, code: 'MISSING_EVIDENCE', message: '존재하지 않는 근거를 참조합니다.' });
      else if (item.status === 'approved' && byId.get(id).status !== 'approved') errors.push({ path: item.id, code: 'UNREVIEWED_EVIDENCE', message: '승인된 항목의 근거도 현재 승인 상태여야 합니다.' });
    }
  }
  const visiting = new Set(); const visited = new Set();
  const cycle = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of byId.get(id)?.evidenceIds ?? []) if (byId.has(next) && cycle(next)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if ([...ids].some(id => cycle(id))) errors.push({ path: 'items', code: 'CIRCULAR_EVIDENCE', message: '근거 관계가 순환할 수 없습니다.' });
  if (!errors.length && new TextEncoder().encode(JSON.stringify(state, null, 2)).byteLength > KNOWLEDGE_LIMITS.importBytes) errors.push({ path: 'knowledge', code: 'DOCUMENT_SIZE', message: '수정 이력을 포함한 전체 지식 문서의 크기 제한을 초과했습니다.' });
  return errors;
}

const checked = state => { const errors = validateKnowledge(state); if (errors.length) fail(errors[0].code, errors[0].message); return state; };
const assertInput = input => {
  if (!plain(input) || Object.keys(input).some(key => !INPUT_KEYS.includes(key))) fail('UNKNOWN_FIELDS', '알 수 없는 입력 필드가 있습니다.');
};

function itemFrom(input, { id = makeId(), at, status = 'proposed' }) {
  return {
    id, title: typeof input.title === 'string' ? input.title.trim() : input.title, text: typeof input.text === 'string' ? input.text.trim() : input.text, kind: input.kind ?? 'hypothesis', status, version: 1,
    sourceTitle: input.sourceTitle === undefined ? '사용자 메모' : (typeof input.sourceTitle === 'string' ? input.sourceTitle.trim() : input.sourceTitle), sourceUrl: input.sourceUrl ?? null,
    sourceType: input.sourceType ?? 'user', sourceLocator: input.sourceLocator ?? '',
    evidenceIds: copy(input.evidenceIds ?? []), tags: copy(input.tags ?? []),
    createdAt: at, updatedAt: at, review: null, revisions: [],
  };
}

export function createKnowledge({ seed = true } = {}) {
  if (!seed) return { schemaVersion: KNOWLEDGE_SCHEMA_VERSION, items: [] };
  const at = '2026-10-15T04:11:00.000Z';
  const conversation = (title, text, time, kind = 'hypothesis') => ({ title, text, kind, sourceTitle: '정원과의 투자 아이디어 대화 · 요약', sourceType: 'conversation', sourceLocator: `2026-10-15 ${time} KST`, tags: ['대화 요약', '원문 재검토 필요'] });
  const seeds = [
    ['conversation-reversion', conversation('쏠림과 회귀 가설', '시장 쏠림 이후 회귀를 살펴보는 아이디어가 논의되었다. 측정 지표, 진입 조건, 회귀 실패 기준은 확정되지 않았다.', '09:29')],
    ['conversation-exchange-gap', conversation('거래소 간 갭과 양방향 아이디어', '거래소 간 가격 차이와 양방향 접근 아이디어가 논의되었다. 수수료, 유동성, 이체 지연과 실행 가능성 검증이 필요하다.', '09:29')],
    ['conversation-actions', conversation('판단 결과의 세 가지 상태', '판단 결과를 buy, sell, hold로 구분하는 방향이 논의되었다. 이 구분만으로 매수·매도 조건이 정의되는 것은 아니다.', '09:39', 'observation')],
    ['conversation-safety', conversation('안전 필터를 분리하는 방향', '실행 전 안전 필터를 거치는 방향이 논의되었다. 필터 항목과 임계값은 별도 검토가 필요하다.', '12:59', 'rule')],
    ['conversation-loss', conversation('잃을 때 조금 잃기', '손실을 작게 제한하는 원칙이 논의되었다. 허용 손실과 포지션 규모를 구체적인 수치로 확정해야 한다.', '13:11', 'rule')],
    ['wiki-sp-r141', { title: '사용자 규칙을 명시적으로 통제', text: '출처 요약: 사용자 규칙을 선언에만 맡기지 않고 규칙·훅으로 통제하며, 수집·파싱·위키화와 실제 dry-run을 요구한다. 투자앱 적용 추론: 지식 후보, 검토한 규칙, 모의 실행을 서로 연결하고 단계별 결과를 남긴다.', kind: 'observation', sourceTitle: '케인즈 위키 · SP-R141', sourceType: 'wiki', sourceUrl: 'https://portal.keynsg.com/kg-wiki/source/29ff242d-2e75-4218-85e4-ac0994f10579', tags: ['출처 요약', '적용은 설계 추론'] }],
    ['wiki-sp-r145', { title: '검사 입력과 실제 결과를 함께 보존', text: '출처 요약: 현재 저장본, 검사 당시 입력, 원문, 실제 결과를 함께 확인하고 검사 후 변경과 좋은 점수만 고르는 행위를 막는다. 이는 로컬 확인기이며 서버 전역 훅은 아니다. 투자앱 적용 추론: 수정 후 기존 승인을 해제하고 근거 버전과 모의 실행 결과를 묶어 검토한다.', kind: 'observation', sourceTitle: '케인즈 위키 · SP-R145', sourceType: 'wiki', sourceUrl: 'https://portal.keynsg.com/kg-wiki/source/5bc6f99d-a8fa-49f7-9468-e340f9d96443', tags: ['출처 요약', '적용은 설계 추론'] }],
    ['wiki-esp-r215', { title: '출처의 주장과 적용 추론을 구분', text: '출처 요약: 출처의 사실·주장과 작성자의 해석·추론을 구분하며, 점수는 검토 지표일 뿐 자동 수정의 근거가 아니다. 투자앱 적용 추론: 사실, 관찰, 가설, 규칙 제안을 구분하고 점수만으로 전략이나 지식을 자동 승인하지 않는다.', kind: 'observation', sourceTitle: '케인즈 위키 · ESP-R215', sourceType: 'wiki', sourceUrl: 'https://portal.keynsg.com/kg-wiki/source/2d6b8be4-7941-4f93-80b6-6a0d25a5bce8', tags: ['출처 요약', '적용은 설계 추론'] }],
  ];
  const items = seeds.map(([id, input]) => itemFrom(input, { id, at }));
  items.push(itemFrom({ title: 'BTC 첨부 명세서 미확보', text: '대화에서 언급된 BTC 첨부 명세서를 아직 확보하지 못했다. 원문을 확인하기 전에는 해당 명세서의 매매 조건을 구현하거나 확정된 전략으로 취급할 수 없다.', kind: 'observation', sourceTitle: '대화에 언급된 BTC 첨부 명세서', sourceType: 'attachment', sourceLocator: '미확보', tags: ['자료 공백'] }, { id: 'gap-btc-specification', at, status: 'gap' }));
  return checked({ schemaVersion: KNOWLEDGE_SCHEMA_VERSION, items });
}

export function extractProposals(text) {
  if (typeof text !== 'string' || text.length > KNOWLEDGE_LIMITS.text) fail('INVALID_TEXT', `정리할 메모는 ${KNOWLEDGE_LIMITS.text}자 이내의 문자열이어야 합니다.`);
  if (!text.trim()) return [];
  if (!string(text, KNOWLEDGE_LIMITS.text)) fail('INVALID_TEXT', '정리할 메모에 지원하지 않는 제어 문자가 있습니다.');
  const parts = text.split(/\r?\n|(?<=[.!?。！？])\s+/u).map(part => part.trim()).filter(Boolean);
  if (parts.length > KNOWLEDGE_LIMITS.proposals) fail('TOO_MANY_PROPOSALS', `한 번에 ${KNOWLEDGE_LIMITS.proposals}개 문장까지 정리할 수 있습니다.`);
  return parts.map(part => {
    let kind = 'hypothesis'; let rationale = '명시적인 사실 근거가 없어 검토할 가설로 분류했습니다.';
    if (/^(사실|fact)\s*[:：]/i.test(part)) { kind = 'fact'; rationale = '사용자가 붙인 사실 표시에 따른 분류이며, 내용의 진위를 검증한 것은 아닙니다.'; }
    else if (/^(관찰|observation)\s*[:：]/i.test(part)) { kind = 'observation'; rationale = '사용자가 붙인 관찰 표시에 따라 분류했습니다.'; }
    else if (/^(가설|hypothesis|추론)\s*[:：]/i.test(part)) { kind = 'hypothesis'; rationale = '가설 또는 추론으로 명시된 메모입니다.'; }
    else if (/^(규칙|rule)\s*[:：]/i.test(part) || /(매수|매도|진입|청산|손절|필터|상한|한도|buy|sell|hold|해야|금지|차단)/i.test(part)) { kind = 'rule'; rationale = '행동 조건 또는 제한 표현을 발견해 규칙 제안으로 분류했습니다. 실행 조건의 완전성은 검토가 필요합니다.'; }
    else if (/(관찰|기록|확인했|보였|발생했)/.test(part)) { kind = 'observation'; rationale = '관찰·기록을 나타내는 표현에 따른 분류입니다.'; }
    return { kind, title: part.length > 60 ? `${part.slice(0, 59)}…` : part, text: part, status: 'proposed', rationale, method: EXTRACTION_LABEL };
  });
}

export function addKnowledge(state, input, options) {
  checked(state); assertInput(input);
  if (state.items.length >= KNOWLEDGE_LIMITS.items) fail('ITEM_LIMIT', '지식 항목 수 제한에 도달했습니다.');
  const item = itemFrom(input, { at: nowAt(options) });
  return checked({ schemaVersion: KNOWLEDGE_SCHEMA_VERSION, items: [...copy(state.items), item] });
}

function nextVersion(item, patch, at) {
  if (item.revisions.length >= KNOWLEDGE_LIMITS.revisions) fail('HISTORY_LIMIT', '이 항목의 수정 이력 제한에 도달했습니다. 새 항목으로 검토해 주세요.');
  if (Date.parse(at) < Math.max(Date.parse(item.updatedAt), Date.parse(item.review?.reviewedAt ?? item.updatedAt))) fail('INVALID_TIME', '수정 시각이 이전 기록보다 빠릅니다.');
  return { ...item, ...patch, version: item.version + 1, updatedAt: at, review: null, revisions: [...item.revisions, snapshot(item)] };
}

function invalidateDependents(items, changedId, at) {
  const affected = new Set([changedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) if (!affected.has(item.id) && item.evidenceIds.some(id => affected.has(id))) { affected.add(item.id); changed = true; }
  }
  return items.map(item => item.id !== changedId && affected.has(item.id) && item.status === 'approved' ? nextVersion(item, { status: 'needs-review' }, at) : item);
}

export function updateKnowledge(state, id, patch, options) {
  checked(state); assertInput(patch);
  if (!Object.keys(patch).length) return copy(state);
  const item = state.items.find(entry => entry.id === id);
  if (!item) fail('NOT_FOUND', '수정할 지식 항목이 없습니다.');
  const at = nowAt(options);
  const normalized = { ...copy(patch) };
  for (const key of ['title', 'text', 'sourceTitle']) if (typeof normalized[key] === 'string') normalized[key] = normalized[key].trim();
  const items = copy(state.items).map(entry => entry.id === id ? nextVersion(entry, { ...normalized, status: entry.status === 'gap' ? 'gap' : 'needs-review' }, at) : entry);
  return checked({ schemaVersion: KNOWLEDGE_SCHEMA_VERSION, items: invalidateDependents(items, id, at) });
}

export function reviewKnowledge(state, id, input, options) {
  checked(state);
  if (!plain(input) || Object.keys(input).some(key => !['decision', 'reason'].includes(key)) || !['approved', 'rejected'].includes(input.decision) || !string(input.reason, KNOWLEDGE_LIMITS.reason)) fail('INVALID_REVIEW', '승인·반려 결정과 검토 이유를 입력해야 합니다.');
  const item = state.items.find(entry => entry.id === id);
  if (!item) fail('NOT_FOUND', '검토할 지식 항목이 없습니다.');
  if (item.status === 'gap') fail('UNRESOLVED_GAP', '미확보 자료는 승인할 수 없습니다. 자료를 확보한 새 항목을 만들고 연결해 주세요.');
  const at = nowAt(options);
  if (Date.parse(at) < Math.max(Date.parse(item.updatedAt), Date.parse(item.review?.reviewedAt ?? item.updatedAt))) fail('INVALID_TIME', '검토 시각이 이전 기록보다 빠릅니다.');
  if (input.decision === 'approved' && item.evidenceIds.some(ref => state.items.find(entry => entry.id === ref)?.status !== 'approved')) fail('UNREVIEWED_EVIDENCE', '참조한 근거의 현재 버전을 먼저 승인해야 합니다.');
  let items = copy(state.items).map(entry => {
    if (entry.id !== id) return entry;
    const reviewed = entry.review ? nextVersion(entry, { status: input.decision }, at) : entry;
    return { ...reviewed, status: input.decision, review: { decision: input.decision, reason: input.reason.trim(), reviewedAt: at, version: reviewed.version } };
  });
  if (input.decision === 'rejected') items = invalidateDependents(items, id, at);
  return checked({ schemaVersion: KNOWLEDGE_SCHEMA_VERSION, items });
}

export function buildContext(state) {
  checked(state);
  const compact = item => ({ id: item.id, version: item.version, title: item.title, text: item.text, kind: item.kind, evidenceIds: copy(item.evidenceIds), sourceIds: [`${item.id}:source`], source: { title: item.sourceTitle, url: item.sourceUrl, type: item.sourceType, locator: item.sourceLocator } });
  const approvedKnowledge = state.items.filter(item => item.status === 'approved').map(compact);
  return { schemaVersion: KNOWLEDGE_SCHEMA_VERSION, method: EXTRACTION_LABEL, approvedRules: approvedKnowledge.filter(item => item.kind === 'rule'), approvedKnowledge, unresolvedGaps: state.items.filter(item => item.status === 'gap').map(compact) };
}

export function exportKnowledge(state) { checked(state); return JSON.stringify(state, null, 2); }

export function importKnowledge(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > KNOWLEDGE_LIMITS.importBytes) fail('IMPORT_SIZE', '가져올 JSON의 크기가 제한을 초과했거나 문자열이 아닙니다.');
  let state;
  try { state = JSON.parse(raw); } catch { fail('INVALID_JSON', '올바른 JSON 파일이 아닙니다.'); }
  return copy(checked(state));
}
