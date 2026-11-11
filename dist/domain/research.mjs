/** Research ingestion and promotion. No network, key access, model calls or rule execution. */
export const RESEARCH_SCHEMA_VERSION = 1;
export const RESEARCH_LIMITS = Object.freeze({ sourceBytes: 80000, rawBytes: 2000000, sources: 100, records: 10000, blocks: 3000, blockChars: 4000, ruleChars: 6000, references: 32 });
export const CONTEXT_TYPES = Object.freeze(['REQUIREMENT', 'INVESTMENT_INTENT', 'DECISION', 'TASK', 'CONSTRAINT', 'RATIONALE', 'HEURISTIC', 'RISK']);
export const RESEARCH_ACTIONS = Object.freeze(['capture.ingest', 'capture.parse', 'knowledge.source.review', 'knowledge.context.promote', 'knowledge.context.review', 'knowledge.context.approve', 'knowledge.rule.propose', 'knowledge.rule.review', 'knowledge.rule.approve', 'connection.create', 'connection.status', 'connection.job.record']);
export const PARSER_REGISTRY = Object.freeze([
  Object.freeze({ id: 'plain-text', version: '1', mimeTypes: Object.freeze(['text/plain']), runtime: 'pure-js', fallback: null }),
  Object.freeze({ id: 'markdown', version: '1', mimeTypes: Object.freeze(['text/markdown', 'text/x-markdown']), runtime: 'pure-js', fallback: 'plain-text' }),
  Object.freeze({ id: 'json', version: '1', mimeTypes: Object.freeze(['application/json', 'text/json']), runtime: 'pure-js', fallback: 'plain-text' }),
  Object.freeze({ id: 'csv', version: '1', mimeTypes: Object.freeze(['text/csv', 'application/csv']), runtime: 'pure-js', fallback: 'plain-text' }),
]);
const COLLECTIONS = ['sources', 'representations', 'documents', 'sections', 'blocks', 'parseJobs', 'reviews', 'promotions', 'contexts', 'ruleCandidates', 'rules', 'events', 'connections', 'jobs'];
export const RESEARCH_COLLECTIONS = Object.freeze([...COLLECTIONS]);
const clone = v => structuredClone(v);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const identifier = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v);
const text = (v, max = 6000) => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const safe = (v, depth = 0) => depth < 30 && (v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 200000 || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.length <= RESEARCH_LIMITS.records && v.every(x => safe(x, depth + 1)) || plain(v) && Object.keys(v).length <= 100 && Object.entries(Object.getOwnPropertyDescriptors(v)).every(([k, d]) => !['__proto__', 'constructor', 'prototype'].includes(k) && Object.hasOwn(d, 'value') && safe(d.value, depth + 1)));
export class ResearchError extends TypeError { constructor(code, message) { super(message); this.name = 'ResearchError'; this.code = code; } }
const check = (ok, code, message) => { if (!ok) throw new ResearchError(code, message); };
const fields = (v, allowed, required = []) => check(plain(v) && safe(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k)), 'INVALID_ACTION_INPUT', '입력 항목과 필수 값을 확인하세요.');
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const bytes = value => new TextEncoder().encode(value);
const before = (a, b) => Date.parse(a) <= Date.parse(b);
function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'INVALID_TIME', 'ISO UTC 시각을 확인하세요.');
  return new Date(value).toISOString();
}
const latestAt = values => values.reduce((a, b) => Date.parse(a) >= Date.parse(b) ? a : b);
const scope = value => { const v = value ?? 'shared'; check(typeof v === 'string' && (v === 'shared' || /^(profile|deployment):[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v)), 'INVALID_SCOPE', '자료의 적용 범위를 확인하세요.'); return v; };
const find = (list, target, version) => { const v = list.find(x => x.id === target && (version === undefined || x.version === version)); check(v, 'RESOURCE_NOT_FOUND', '선택한 자료와 버전을 찾을 수 없습니다.'); return v; };
const seal = value => ({ ...value, recordHash: researchSha256(canonical(value)) });
const unsealed = value => Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'recordHash'));

/** Exact UTF-8 SHA-256. Storage hashes detect changes; authentication belongs to the caller. */
export function researchSha256(value) {
  check(typeof value === 'string', 'INVALID_TEXT', '해시할 원문을 확인하세요.');
  const input = bytes(value), length = Math.ceil((input.length + 9) / 64) * 64, data = new Uint8Array(length), view = new DataView(data.buffer);
  data.set(input); data[input.length] = 128; view.setUint32(length - 8, Math.floor(input.length / 0x20000000)); view.setUint32(length - 4, input.length * 8 >>> 0);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const r = (x, n) => x >>> n | x << 32 - n, w = new Uint32Array(64);
  for (let off = 0; off < length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (r(a,7)^r(a,18)^a>>>3)+w[i-16]+(r(b,17)^r(b,19)^b>>>10)+w[i-7]; }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) { const t = z+(r(e,6)^r(e,11)^r(e,25))+(e&f^~e&g)+k[i]+w[i], u = (r(a,2)^r(a,13)^r(a,22))+(a&b^a&c^b&c); z=g;g=f;f=e;e=d+t|0;d=c;c=b;b=a;a=t+u|0; }
    [a,b,c,d,e,f,g,z].forEach((v,i) => { h[i] = h[i]+v>>>0; });
  }
  return h.map(v => v.toString(16).padStart(8,'0')).join('');
}

function normalized(raw) { return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
function addUnit(units, value, section, locator, kind = 'paragraph') {
  for (let from = 0; from < value.length;) {
    let end = Math.min(from + RESEARCH_LIMITS.blockChars, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    const part = value.slice(from, end);
    units.push({ text: part, section, kind, locator: { ...locator, charStart: from, charEnd: from + part.length } });
    check(units.length <= RESEARCH_LIMITS.blocks, 'PARSER_LIMIT', '원문 블록 수가 처리 한도를 넘었습니다.');
    from = end;
  }
}
function parseText(raw, markdown) {
  const body = normalized(raw), lines = body.split('\n'), units = [], sections = [{ title: '', level: 0, locator: { kind: 'line', startLine: 1, endLine: lines.length } }];
  let section = 0, paragraph = [], start = 1, fenced = null;
  const flush = () => { if (paragraph.length) { addUnit(units, paragraph.join('\n'), section, { kind: 'line', startLine: start, endLine: start + paragraph.length - 1 }); paragraph = []; } };
  lines.forEach((line, i) => {
    const fence = markdown ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) : null;
    if (fence) {
      if (fenced && fence[1][0] === fenced.character && fence[1].length >= fenced.length && !fence[2].trim()) fenced = null;
      else if (!fenced && (fence[1][0] === '~' || !fence[2].includes('`'))) fenced = { character: fence[1][0], length: fence[1].length };
    }
    const heading = markdown && !fenced ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) { flush(); sections.push({ title: heading[2], level: heading[1].length, locator: { kind: 'line', startLine: i + 1, endLine: i + 1 } }); section = sections.length - 1; addUnit(units, line, section, { kind: 'line', startLine: i + 1, endLine: i + 1 }, 'heading'); }
    else if (!line.trim() && !fenced) flush();
    else { if (!paragraph.length) start = i + 1; paragraph.push(line); }
  }); flush();
  return { body, units, sections, warnings: fenced ? ['UNCLOSED_MARKDOWN_FENCE'] : [] };
}
const pointerEscape = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
function parseJson(raw) {
  let value; try { value = JSON.parse(normalized(raw)); } catch { throw new ResearchError('INVALID_JSON', 'JSON 문법을 확인하세요.'); }
  const units = [], walk = (v, pointer, depth) => {
    check(depth <= 30, 'PARSER_LIMIT', 'JSON 중첩 깊이가 처리 한도를 넘었습니다.');
    if (typeof v === 'number') check(Number.isFinite(v), 'JSON_NUMBER_RANGE', 'JSON 숫자의 표현 범위를 확인하세요.');
    if (v && typeof v === 'object' && Object.keys(v).length) for (const [key, entry] of Object.entries(v)) walk(entry, `${pointer}/${pointerEscape(key)}`, depth + 1);
    else addUnit(units, `${pointer || '/'}: ${JSON.stringify(v)}`, 0, { kind: 'json-pointer', pointer }, 'record');
  }; walk(value, '', 0);
  return { body: units.map(u => u.text).join('\n'), units, sections: [{ title: '', level: 0, locator: { kind: 'json-pointer', pointer: '' } }], warnings: [] };
}
function parseCsv(raw) {
  const input = normalized(raw), rows = [], units = [], warnings = []; let row = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  const finish = () => { row.push(cell); if (row.some(v => v.length)) rows.push({ cells: row, startLine: start, endLine: line }); row = []; cell = ''; closed = false; start = line + 1; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"' && input[i+1] === '"') { cell += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else { cell += c; if (c === '\n') line++; } }
    else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\n') { finish(); line++; }
    else if (c === '"' && !cell && !closed) quoted = true;
    else { check(!closed && c !== '"', 'INVALID_CSV', 'CSV 따옴표와 구분자를 확인하세요.'); cell += c; }
  }
  check(!quoted, 'INVALID_CSV', 'CSV 따옴표를 닫아 주세요.');
  if (cell.length || row.length || closed) finish();
  const headers = rows[0]?.cells ?? [];
  if (new Set(headers).size !== headers.length) warnings.push('DUPLICATE_CSV_HEADERS');
  rows.forEach((record, index) => {
    if (record.cells.length !== headers.length) warnings.push(`CSV_COLUMN_COUNT_ROW_${index + 1}`);
    const output = index === 0 ? record.cells.join(' | ') : record.cells.map((v, n) => `${headers[n] || `column_${n+1}`}${headers.indexOf(headers[n]) !== n ? ` [${n+1}]` : ''}: ${v}`).join(' · ');
    addUnit(units, output, 0, { kind: 'csv-row', row: index + 1, startLine: record.startLine, endLine: record.endLine }, index === 0 ? 'header' : 'record');
  });
  return { body: units.map(u => u.text).join('\n'), units, sections: [{ title: '', level: 0, locator: { kind: 'csv-row', row: 1 } }], warnings };
}
function parseSource(source) {
  const requested = PARSER_REGISTRY.find(p => p.mimeTypes.includes(source.mimeType));
  check(requested, 'UNSUPPORTED_MIME', '지원하는 원문 형식을 확인하세요.');
  let parser = requested, parsed, fallbackFrom = null, warning = [];
  try { parsed = requested.id === 'json' ? parseJson(source.text) : requested.id === 'csv' ? parseCsv(source.text) : parseText(source.text, requested.id === 'markdown'); }
  catch (error) { if (!requested.fallback) throw error; parser = PARSER_REGISTRY.find(p => p.id === requested.fallback); fallbackFrom = requested.id; warning = [`${error.code || 'PARSE_ERROR'}:FALLBACK_TO_${parser.id}`]; parsed = parseText(source.text, false); }
  check(parsed.units.length > 0, 'EMPTY_PARSED_RESULT', '읽을 수 있는 본문이 없습니다. 원본은 보존합니다.');
  parsed.warnings = [...warning, ...(source.text.charCodeAt(0) === 0xFEFF ? ['UTF8_BOM_REMOVED_IN_PARSED'] : []), ...parsed.warnings];
  return { ...parsed, parserId: parser.id, parserVersion: parser.version, runtime: parser.runtime, requestedParserId: requested.id, fallbackFrom, outputHash: researchSha256(canonical(parsed)) };
}

export function createResearch(options = {}) {
  const now = timestamp(options.now ?? new Date().toISOString());
  return { schemaVersion: RESEARCH_SCHEMA_VERSION, revision: 0, createdAt: now, updatedAt: now, ...Object.fromEntries(COLLECTIONS.map(k => [k, []])) };
}
const sourceKey = source => `${source.id}@${source.version}`;
const currentSource = (state, sourceId, asOf) => state.sources.filter(s => s.id === sourceId && before(s.ingestedAt, asOf) && before(s.availableAt, asOf)).sort((a,b) => b.version - a.version)[0];
const sourceReview = (state, sourceId, sourceVersion, asOf) => state.reviews.filter(r => r.sourceId === sourceId && r.sourceVersion === sourceVersion && before(r.reviewedAt, asOf)).at(-1);
function evidence(state, refs) {
  check(Array.isArray(refs) && refs.length > 0 && refs.length <= RESEARCH_LIMITS.references && new Set(refs.map(r => `${r?.id}@${r?.version}`)).size === refs.length, 'INVALID_EVIDENCE', '근거 블록과 버전을 확인하세요.');
  return refs.map(ref => {
    fields(ref, ['id', 'version'], ['id', 'version']); const block = find(state.blocks, ref.id, ref.version);
    return { id: block.id, version: block.version, blockHash: block.recordHash, sourceId: block.sourceId, sourceVersion: block.sourceVersion, sourceHash: block.sourceHash, representationId: block.representationId, outputHash: block.outputHash, locator: clone(block.locator) };
  });
}
function evidenceReviews(state, refs, asOf) {
  return refs.map(ref => {
    const block = find(state.blocks, ref.id, ref.version), source = currentSource(state, ref.sourceId, asOf), review = sourceReview(state, ref.sourceId, ref.sourceVersion, asOf);
    check(block.recordHash === ref.blockHash && before(block.availableAt, asOf) && source?.version === ref.sourceVersion && source.sha256 === ref.sourceHash, 'STALE_EVIDENCE', '원본이나 근거 버전이 변경되었습니다.');
    check(review?.decision === 'approved', 'UNAPPROVED_SOURCE', '근거 원본을 검토·승인해 주세요.');
    return review.id;
  });
}
function contextUsable(state, context, asOf) {
  if (!before(context.availableAt, asOf)) return false;
  const newest = state.contexts.filter(c => c.id === context.id && before(c.availableAt, asOf)).sort((a,b) => b.version - a.version)[0];
  if (newest?.version !== context.version) return false;
  try { return canonical(evidenceReviews(state, context.blockRefs, asOf)) === canonical(context.sourceReviewIds); } catch { return false; }
}

/** Verify stored lineage and change hashes before pure commands or queries. */
export function validateResearch(state) {
  try {
    check(plain(state) && safe(state) && Object.keys(state).length === COLLECTIONS.length + 4 && state.schemaVersion === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0 && COLLECTIONS.every(k => Array.isArray(state[k]) && state[k].length <= RESEARCH_LIMITS.records), 'INVALID_RESEARCH', '리서치 저장 형식을 확인하세요.');
    timestamp(state.createdAt); timestamp(state.updatedAt); check(before(state.createdAt, state.updatedAt), 'INVALID_TIME', '저장 시각의 순서를 확인하세요.');
    for (const collection of COLLECTIONS) {
      const keys = new Set();
      for (const record of state[collection]) {
        check(plain(record) && identifier(record.id) && record.recordHash === researchSha256(canonical(unsealed(record))), 'RESEARCH_INTEGRITY', '보존한 자료와 검증값을 대조하세요.');
        const key = collection === 'sources' || collection === 'contexts' || collection === 'rules' ? `${record.id}@${record.version}` : record.id;
        check(!keys.has(key), 'DUPLICATE_RECORD', '동일한 기록과 버전이 중복됐습니다.'); keys.add(key);
      }
    }
    check(state.sources.length <= RESEARCH_LIMITS.sources && state.sources.reduce((n,s) => n + s.byteLength,0) <= RESEARCH_LIMITS.rawBytes, 'RESEARCH_LIMIT', '원본 보관 한도를 확인하세요.');
    for (const s of state.sources) {
      check(Number.isInteger(s.version) && s.version > 0 && typeof s.text === 'string' && bytes(s.text).length === s.byteLength && s.byteLength <= RESEARCH_LIMITS.sourceBytes && s.sha256 === researchSha256(s.text), 'SOURCE_INTEGRITY', '원문과 SHA-256을 대조하세요.');
      timestamp(s.ingestedAt); timestamp(s.availableAt); if (s.publishedAt) timestamp(s.publishedAt); if (s.eventAt) timestamp(s.eventAt);
      const previous = s.version === 1 ? null : find(state.sources,s.id,s.version - 1);
      check(s.previousHash === (previous?.sha256 ?? null) && (!previous || previous.scope === s.scope && before(previous.ingestedAt,s.ingestedAt)), 'SOURCE_INTEGRITY', '원본 버전의 계보를 확인하세요.');
      check(before(s.ingestedAt, s.availableAt) && (!s.publishedAt || before(s.publishedAt, s.availableAt)), 'INVALID_AVAILABILITY', '자료의 사용 가능 시각을 확인하세요.');
    }
    for (const rep of state.representations) {
      const source = find(state.sources, rep.sourceId, rep.sourceVersion), expected = parseSource(source);
      check(rep.sourceHash === source.sha256 && rep.outputHash === expected.outputHash && canonical(rep.units) === canonical(expected.units) && canonical(rep.warnings) === canonical(expected.warnings) && rep.body === expected.body && rep.parserId === expected.parserId && rep.parserVersion === expected.parserVersion && rep.runtime === expected.runtime, 'REPRESENTATION_INTEGRITY', '파서 결과와 원본 계보를 대조하세요.');
    }
    for (const block of state.blocks) {
      const rep = find(state.representations, block.representationId), unit = rep.units[block.unitIndex];
      check(block.version === 1 && unit && block.text === unit.text && canonical(block.locator) === canonical(unit.locator) && block.sourceId === rep.sourceId && block.sourceVersion === rep.sourceVersion && block.sourceHash === rep.sourceHash && block.outputHash === rep.outputHash, 'BLOCK_INTEGRITY', '근거 블록과 파싱 위치를 대조하세요.');
      const section = find(state.sections, block.sectionId), doc = find(state.documents, block.documentId);
      check(section.documentId === doc.id && section.blockIds.includes(block.id) && doc.blockIds.includes(block.id) && doc.representationId === rep.id, 'DOCUMENT_INTEGRITY', '문서·절·블록의 연결을 확인하세요.');
    }
    for (const review of state.reviews) check(find(state.sources,review.sourceId,review.sourceVersion).sha256 === review.sourceHash && ['approved','rejected'].includes(review.decision), 'REVIEW_INTEGRITY', '원본 검토의 대상과 버전을 확인하세요.');
    for (const p of [...state.promotions, ...state.contexts]) for (const ref of p.blockRefs) { const block = find(state.blocks, ref.id, ref.version); check(canonical(ref) === canonical({id:block.id,version:block.version,blockHash:block.recordHash,sourceId:block.sourceId,sourceVersion:block.sourceVersion,sourceHash:block.sourceHash,representationId:block.representationId,outputHash:block.outputHash,locator:block.locator}), 'STALE_EVIDENCE', '승격 근거의 고정 버전을 확인하세요.'); }
    for (const c of state.contexts) {
      const p = find(state.promotions, c.promotionId);
      check(p.status === 'approved' && c.id === p.contextId && c.version === p.expectedVersion + 1 && ['contextType','title','text','scope','blockRefs'].every(k => canonical(c[k]) === canonical(p[k])) && c.sourceReviewIds.length === c.blockRefs.length && c.sourceReviewIds.every((x,i) => { const r = find(state.reviews,x), b = c.blockRefs[i]; return r.decision === 'approved' && r.sourceId === b.sourceId && r.sourceVersion === b.sourceVersion && r.sourceHash === b.sourceHash; }), 'INVALID_PROMOTION', '맥락의 승격·승인 계보를 확인하세요.');
    }
    for (const rule of state.rules) {
      const candidate = find(state.ruleCandidates, rule.candidateId), context = find(state.contexts, rule.contextId, rule.contextVersion);
      check(candidate.status === 'approved' && rule.id === candidate.ruleId && rule.version === candidate.expectedVersion + 1 && ['contextId','contextVersion','contextHash','title','text','scope'].every(k => rule[k] === candidate[k]) && context.recordHash === rule.contextHash && context.scope === rule.scope, 'INVALID_RULE', '실행 규칙의 별도 승인 계보를 확인하세요.');
    }
    return [];
  } catch (error) { return [{ code: error.code || 'INVALID_RESEARCH', message: error.message }]; }
}
const checked = state => { const errors = validateResearch(state); check(!errors.length, errors[0]?.code, errors[0]?.message); return state; };
function event(state, eventType, resourceId, now, actorId) { state.events.push(seal({ id: id('research-event'), eventType, resourceId, occurredAt: now, recordedAt: now, actorId, revision: state.revision + 1 })); }
function sourceOrigin(payload) {
  if (payload.sourceUri === undefined || payload.sourceUri === null || payload.sourceUri === 'manual') { check(text(payload.sourceLocator, 2048), 'INVALID_SOURCE', '수동 원문의 위치를 기록하세요.'); return { sourceUri: null, sourceLocator: payload.sourceLocator }; }
  check(text(payload.sourceUri, 2048), 'INVALID_SOURCE', '출처 주소를 확인하세요.');
  let url; try { url = new URL(payload.sourceUri); } catch { throw new ResearchError('INVALID_SOURCE', '출처 주소를 확인하세요.'); }
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && (payload.sourceLocator === undefined || text(payload.sourceLocator,2048)), 'INVALID_SOURCE', 'HTTP(S) 출처와 위치를 확인하세요.');
  return { sourceUri: url.href, sourceLocator: payload.sourceLocator ?? url.href };
}
function parseInto(state, source, now, actorId) {
  let parsed;
  try { parsed = parseSource(source); }
  catch (error) { const job = seal({ id: id('parse-job'), sourceId: source.id, sourceVersion: source.version, status: 'parse_failed', errorCode: error.code || 'PARSE_FAILED', message: error.message, createdAt: now }); state.parseJobs.push(job); event(state,'SOURCE_PARSE_FAILED',source.id,now,actorId); return { source: clone(source), representation: null, document: null, sections: [], blocks: [], parseJob: clone(job) }; }
  const representation = seal({ id: id('parsed'), sourceId: source.id, sourceVersion: source.version, sourceHash: source.sha256, ...parsed, createdAt: now, availableAt: latestAt([source.availableAt, now]) });
  const docId = id('document'), sectionIds = parsed.sections.map(() => id('section'));
  const blocks = parsed.units.map((u, index) => seal({ id: id('block'), version: 1, documentId: docId, sectionId: sectionIds[u.section], representationId: representation.id, unitIndex: index, kind: u.kind, text: u.text, locator: u.locator, sourceId: source.id, sourceVersion: source.version, sourceHash: source.sha256, parserId: parsed.parserId, parserVersion: parsed.parserVersion, outputHash: parsed.outputHash, availableAt: representation.availableAt, createdAt: now }));
  const sections = parsed.sections.map((s, index) => seal({ id: sectionIds[index], version: 1, documentId: docId, title: s.title || source.title, level: s.level, locator: s.locator, blockIds: blocks.filter(b => b.sectionId === sectionIds[index]).map(b => b.id), createdAt: now }));
  const document = seal({ id: docId, version: 1, title: source.title, sourceId: source.id, sourceVersion: source.version, sourceHash: source.sha256, representationId: representation.id, sectionIds, blockIds: blocks.map(b => b.id), availableAt: representation.availableAt, createdAt: now });
  const job = seal({ id: id('parse-job'), sourceId: source.id, sourceVersion: source.version, parserId: parsed.parserId, parserVersion: parsed.parserVersion, runtime: parsed.runtime, status: parsed.warnings.length ? 'parsed_with_warning' : 'parsed', representationId: representation.id, createdAt: now });
  state.representations.push(representation); state.documents.push(document); state.sections.push(...sections); state.blocks.push(...blocks); state.parseJobs.push(job); event(state,'SOURCE_PARSED',source.id,now,actorId);
  return clone({ source, representation, document, sections, blocks, parseJob: job });
}
const update = (list, record, patch) => { const value = seal({ ...unsealed(record), ...patch }); list[list.indexOf(record)] = value; return value; };

export async function dispatchResearchAction(research, command, options = {}) {
  checked(research); fields(command, ['type','payload','expectedRevision'], ['type','payload']);
  check(RESEARCH_ACTIONS.includes(command.type), 'UNKNOWN_ACTION', '등록된 리서치 작업을 선택하세요.');
  check(command.expectedRevision === undefined || command.expectedRevision === research.revision, 'STALE_RESEARCH', '리서치 상태를 새로 확인하세요.');
  const now = timestamp(options.now ?? new Date().toISOString()), actorId = options.actorId ?? 'local-user';
  check(before(research.updatedAt, now) && identifier(actorId), 'INVALID_ACTION_CONTEXT', '실행 주체와 기록 시각을 확인하세요.');
  const state = clone(research), p = command.payload; let result;
  if (command.type === 'capture.ingest') {
    fields(p,['title','text','mimeType','sourceUri','sourceLocator','eventAt','publishedAt','availableAt','sourceId','scope'],['title','text','mimeType']);
    check(text(p.title,240) && typeof p.text === 'string' && bytes(p.text).length <= RESEARCH_LIMITS.sourceBytes && !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p.text), 'INVALID_SOURCE_TEXT', '원문은 올바른 UTF-8 텍스트로 80,000바이트 이내여야 합니다.');
    check(typeof p.mimeType === 'string', 'UNSUPPORTED_MIME', '원문 형식을 선택하세요.'); const mimeType = p.mimeType.split(';')[0].trim().toLowerCase();
    check(PARSER_REGISTRY.some(x => x.mimeTypes.includes(mimeType)), 'UNSUPPORTED_MIME', '텍스트·Markdown·JSON·CSV 형식을 선택하세요.');
    const previous = p.sourceId === undefined ? null : state.sources.filter(x => x.id === p.sourceId).sort((a,b) => b.version - a.version)[0];
    check(p.sourceId === undefined || previous, 'RESOURCE_NOT_FOUND', '이전 원본 ID를 확인하세요.');
    const publishedAt = p.publishedAt == null ? null : timestamp(p.publishedAt), availableAt = timestamp(p.availableAt ?? now);
    check((!publishedAt || before(publishedAt, now)) && before(now, availableAt) && (!publishedAt || before(publishedAt, availableAt)), 'INVALID_AVAILABILITY', '공개·수집·사용 가능 시각을 확인하세요.');
    const source = seal({ id: previous?.id ?? id('source'), version: (previous?.version ?? 0) + 1, title: p.title, text: p.text, mimeType, ...sourceOrigin(p), scope: scope(p.scope ?? previous?.scope), eventAt: p.eventAt == null ? null : timestamp(p.eventAt), publishedAt, ingestedAt: now, availableAt, sha256: researchSha256(p.text), byteLength: bytes(p.text).length, previousHash: previous?.sha256 ?? null, capturedBy: actorId });
    check(!previous || source.scope === previous.scope, 'SOURCE_SCOPE_CHANGE', '기존 원본의 적용 범위를 유지하세요.');
    state.sources.push(source); event(state,'SOURCE_INGESTED',source.id,now,actorId); result = parseInto(state,source,now,actorId);
  } else if (command.type === 'capture.parse') {
    fields(p,['sourceId','sourceVersion'],['sourceId','sourceVersion']); result = parseInto(state,find(state.sources,p.sourceId,p.sourceVersion),now,actorId);
  } else if (command.type === 'knowledge.source.review') {
    fields(p,['sourceId','sourceVersion','decision','reason'],['sourceId','sourceVersion','decision','reason']);
    const source = find(state.sources,p.sourceId,p.sourceVersion); check(['approved','rejected'].includes(p.decision) && text(p.reason,1000), 'INVALID_REVIEW', '검토 결과와 이유를 입력하세요.');
    check(p.decision === 'rejected' || currentSource(state,source.id,now)?.version === source.version && state.blocks.some(b => b.sourceId === source.id && b.sourceVersion === source.version && before(b.availableAt,now)), 'UNREADABLE_SOURCE', '현재 사용 가능한 원본과 본문을 검토하세요.');
    result = seal({ id: id('source-review'), sourceId: source.id, sourceVersion: source.version, sourceHash: source.sha256, decision: p.decision, reason: p.reason, reviewedAt: now, reviewerId: actorId }); state.reviews.push(result); event(state, p.decision === 'approved' ? 'SOURCE_APPROVED' : 'SOURCE_REJECTED',source.id,now,actorId);
  } else if (command.type === 'knowledge.context.promote') {
    fields(p,['sourceId','sourceVersion','blockRefs','contextType','title','text','scope','availableAt','contextId','expectedVersion'],['blockRefs','contextType','title','text']);
    check(CONTEXT_TYPES.includes(p.contextType) && text(p.title,120) && text(p.text), 'INVALID_CONTEXT', '맥락 유형·제목·내용을 확인하세요.');
    const refs = evidence(state,p.blockRefs), targetScope = scope(p.scope ?? find(state.sources,refs[0].sourceId,refs[0].sourceVersion).scope);
    if (p.sourceId !== undefined) check(refs.every(r => r.sourceId === p.sourceId && r.sourceVersion === p.sourceVersion), 'EVIDENCE_SCOPE', '선택한 원본과 근거 버전을 대조하세요.');
    for (const ref of refs) { const s = find(state.sources,ref.sourceId,ref.sourceVersion); check(s.scope === 'shared' || s.scope === targetScope, 'EVIDENCE_SCOPE', '개인 자료의 승격 범위를 확인하세요.'); }
    const previous = p.contextId === undefined ? null : state.contexts.filter(c => c.id === p.contextId).sort((a,b) => b.version - a.version)[0];
    check(p.contextId === undefined || previous && p.expectedVersion === previous.version && previous.scope === targetScope, 'STALE_CONTEXT_VERSION', '맥락의 현재 버전과 범위를 확인하세요.');
    result = seal({ id: id('promotion'), contextId: previous?.id ?? id('context'), expectedVersion: previous?.version ?? 0, contextType: p.contextType, title: p.title, text: p.text, scope: targetScope, blockRefs: refs, availableAt: timestamp(p.availableAt ?? now), status: 'draft', createdAt: now, createdBy: actorId, reviewedAt: null, approvedAt: null, reason: null });
    check(before(now,result.availableAt), 'INVALID_AVAILABILITY', '승격 시점 이전으로 소급할 수 없습니다.'); state.promotions.push(result); event(state,'CONTEXT_DRAFTED',result.id,now,actorId);
  } else if (command.type === 'knowledge.context.review' || command.type === 'knowledge.context.approve') {
    fields(p,['promotionId','decision','reason'],['promotionId','reason']); let draft = find(state.promotions,p.promotionId);
    check(['draft','in-review'].includes(draft.status) && text(p.reason,1000), 'INVALID_PROMOTION_STATE', '검토 가능한 승격 초안과 이유를 확인하세요.');
    const isReview = command.type.endsWith('.review'), decision = isReview ? 'in-review' : p.decision ?? 'approved';
    check(isReview ? p.decision === undefined || p.decision === 'in-review' : ['approved','rejected'].includes(decision), 'INVALID_REVIEW', '승격 검토 결과를 확인하세요.');
    const reviewIds = decision === 'rejected' ? [] : evidenceReviews(state,draft.blockRefs,now), current = state.contexts.filter(c => c.id === draft.contextId).sort((a,b) => b.version - a.version)[0];
    check(decision === 'rejected' || (current?.version ?? 0) === draft.expectedVersion, 'STALE_CONTEXT_VERSION', '맥락 버전이 변경되어 새 승격 검토가 필요합니다.');
    draft = update(state.promotions,draft,{status:decision,reviewedAt:now,approvedAt:decision === 'approved' ? now : null,reason:p.reason,reviewerId:actorId}); result = { promotion: clone(draft), context: null };
    if (decision === 'approved') { const context = seal({ id: draft.contextId, version: draft.expectedVersion + 1, promotionId: draft.id, contextType: draft.contextType, title: draft.title, text: draft.text, scope: draft.scope, blockRefs: draft.blockRefs, sourceReviewIds: reviewIds, createdAt: now, approvedAt: now, availableAt: latestAt([now,draft.availableAt,...draft.blockRefs.map(r => find(state.blocks,r.id,r.version).availableAt)]), approvedBy: actorId }); state.contexts.push(context); result.context = clone(context); }
    event(state,decision === 'approved' ? 'CONTEXT_APPROVED' : decision === 'rejected' ? 'CONTEXT_REJECTED' : 'CONTEXT_REVIEWED',draft.id,now,actorId);
  } else if (command.type === 'knowledge.rule.propose') {
    fields(p,['contextId','contextVersion','title','text','availableAt','ruleId','expectedVersion'],['contextId','contextVersion','title','text']); const context = find(state.contexts,p.contextId,p.contextVersion);
    check(contextUsable(state,context,now) && text(p.title,120) && text(p.text,RESEARCH_LIMITS.ruleChars), 'INVALID_RULE_CONTEXT', '승인된 현재 맥락과 실행 규칙 내용을 확인하세요.');
    const previous = p.ruleId === undefined ? null : state.rules.filter(r => r.id === p.ruleId).sort((a,b) => b.version - a.version)[0];
    check(p.ruleId === undefined || previous && previous.version === p.expectedVersion && previous.scope === context.scope, 'STALE_RULE_VERSION', '규칙의 현재 버전과 적용 범위를 확인하세요.');
    result = seal({ id: id('rule-candidate'), ruleId: previous?.id ?? id('research-rule'), expectedVersion: previous?.version ?? 0, contextId: context.id, contextVersion: context.version, contextHash: context.recordHash, scope: context.scope, title: p.title, text: p.text, availableAt: timestamp(p.availableAt ?? now), status: 'draft', createdAt: now, createdBy: actorId, reviewedAt: null, approvedAt: null, reason: null });
    check(before(now,result.availableAt), 'INVALID_AVAILABILITY', '규칙 사용 시점을 소급할 수 없습니다.'); state.ruleCandidates.push(result); event(state,'RULE_CANDIDATE_CREATED',result.id,now,actorId);
  } else if (command.type === 'knowledge.rule.review' || command.type === 'knowledge.rule.approve') {
    fields(p,['candidateId','decision','reason'],['candidateId','reason']); let candidate = find(state.ruleCandidates,p.candidateId); const context = find(state.contexts,candidate.contextId,candidate.contextVersion);
    check(['draft','in-review'].includes(candidate.status) && text(p.reason,1000), 'INVALID_RULE_STATE', '규칙 후보의 검토 상태와 이유를 확인하세요.');
    const isReview = command.type.endsWith('.review'), decision = isReview ? 'in-review' : p.decision ?? 'approved';
    check(isReview ? p.decision === undefined || p.decision === 'in-review' : ['approved','rejected'].includes(decision), 'INVALID_REVIEW', '실행 규칙 승인 결과를 확인하세요.');
    check(decision === 'rejected' || context.recordHash === candidate.contextHash && contextUsable(state,context,now), 'INVALID_RULE_STATE', '현재 맥락과 근거 승인을 확인하세요.');
    const current = state.rules.filter(r => r.id === candidate.ruleId).sort((a,b) => b.version - a.version)[0]; check(decision === 'rejected' || (current?.version ?? 0) === candidate.expectedVersion, 'STALE_RULE_VERSION', '다른 규칙 버전이 발행되었습니다.');
    candidate = update(state.ruleCandidates,candidate,{status:decision,reviewedAt:now,approvedAt:decision === 'approved' ? now : null,reviewerId:actorId,reason:p.reason}); result = { candidate: clone(candidate), rule: null };
    if (decision === 'approved') { const rule = seal({ id: candidate.ruleId, version: candidate.expectedVersion + 1, candidateId: candidate.id, contextId: context.id, contextVersion: context.version, contextHash: context.recordHash, title: candidate.title, text: candidate.text, scope: candidate.scope, approvedAt: now, availableAt: latestAt([now,candidate.availableAt,context.availableAt]), approvedBy: actorId }); state.rules.push(rule); result.rule = clone(rule); }
    event(state,decision === 'approved' ? 'EXECUTABLE_RULE_APPROVED' : decision === 'rejected' ? 'RULE_CANDIDATE_REJECTED' : 'RULE_CANDIDATE_REVIEWED',candidate.id,now,actorId);
  } else if (command.type === 'connection.create') {
    fields(p,['name','sourceUri'],['name','sourceUri']); check(text(p.name,120), 'INVALID_CONNECTION', '자료 연결 이름을 확인하세요.'); const origin = sourceOrigin({sourceUri:p.sourceUri}); check(origin.sourceUri, 'INVALID_CONNECTION', 'HTTP(S) 자료 주소를 확인하세요.');
    result = seal({id:id('connection'),name:p.name,sourceUri:origin.sourceUri,status:'configured',message:null,createdAt:now,updatedAt:now}); state.connections.push(result); event(state,'CONNECTION_CONFIGURED',result.id,now,actorId);
  } else if (command.type === 'connection.status') {
    fields(p,['connectionId','status','message'],['connectionId','status']); const connection = find(state.connections,p.connectionId); check(['configured','active','paused','error'].includes(p.status) && (p.message === undefined || text(p.message,1000)), 'INVALID_CONNECTION', '연결 상태를 확인하세요.');
    result = update(state.connections,connection,{status:p.status,message:p.message ?? null,updatedAt:now}); event(state,'CONNECTION_STATUS_RECORDED',result.id,now,actorId);
  } else {
    fields(p,['connectionId','status','sourceId','sourceVersion','message'],['connectionId','status']); find(state.connections,p.connectionId); check(['queued','running','succeeded','failed'].includes(p.status) && (p.message === undefined || text(p.message,1000)) && (p.sourceId === undefined) === (p.sourceVersion === undefined), 'INVALID_JOB', '수집 작업 상태와 원본 버전을 확인하세요.'); if (p.sourceId !== undefined) find(state.sources,p.sourceId,p.sourceVersion);
    result = seal({id:id('collection-job'),connectionId:p.connectionId,status:p.status,sourceId:p.sourceId ?? null,sourceVersion:p.sourceVersion ?? null,message:p.message ?? null,createdAt:now}); state.jobs.push(result); event(state,'COLLECTION_JOB_RECORDED',result.id,now,actorId);
  }
  state.revision++; state.updatedAt = now; checked(state); return {research:state,result:clone(result)};
}

function queryOptions(asOf, options) { const at = timestamp(asOf), scopes = options?.scopes ?? ['shared']; check(Array.isArray(scopes) && scopes.length > 0 && scopes.every(s => scope(s) === s), 'INVALID_SCOPE', '조회할 자료 범위를 확인하세요.'); return {at,scopes}; }
export function approvedResearchRules(research, asOf, options = {}) {
  checked(research); const {at,scopes} = queryOptions(asOf,options), newest = new Map();
  for (const rule of research.rules) if (before(rule.approvedAt,at) && before(rule.availableAt,at) && (!newest.has(rule.id) || newest.get(rule.id).version < rule.version)) newest.set(rule.id,rule);
  return [...newest.values()].filter(r => scopes.includes(r.scope) && contextUsable(research,find(research.contexts,r.contextId,r.contextVersion),at)).map(({id,version,title,text}) => ({id,version,title,text}));
}
export function researchAt(research, asOf, options = {}) {
  checked(research); const {at,scopes} = queryOptions(asOf,options), sources = [...new Set(research.sources.map(s => s.id))].map(x => currentSource(research,x,at)).filter(s => s && scopes.includes(s.scope));
  const sourceKeys = new Set(sources.map(sourceKey)), representations = research.representations.filter(r => sourceKeys.has(`${r.sourceId}@${r.sourceVersion}`) && before(r.availableAt,at)), repIds = new Set(representations.map(r => r.id)), documents = research.documents.filter(d => repIds.has(d.representationId)), docIds = new Set(documents.map(d => d.id));
  return clone({asOf:at,sources,representations,documents,sections:research.sections.filter(s => docIds.has(s.documentId)),blocks:research.blocks.filter(b => repIds.has(b.representationId)),contexts:research.contexts.filter(c => scopes.includes(c.scope) && contextUsable(research,c,at)),rules:approvedResearchRules(research,at,{scopes})});
}
