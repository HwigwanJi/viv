import { hashInputPackage } from '../dist/domain/workspace.mjs';
import {paperDecisionFillCount} from '../dist/domain/paper-mind-presets.mjs';
import {resolveInvestmentProfileIdentity} from './profile-read-model.mjs';

export class TradingRecordsError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'TradingRecordsError'; this.code = code; this.status = status; this.resetCursor = code === 'TRADING_CURSOR_STALE'; }
}
const check = (condition, code, message, status) => { if (!condition) throw new TradingRecordsError(code, message, status); };
const list = v => Array.isArray(v) ? v : [], finite = v => typeof v === 'number' && Number.isFinite(v), number = v => finite(v) ? v : null;
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(v), iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const FIELDS = ['profileId', 'instrumentId', 'kind', 'search', 'status', 'pageSize', 'cursor'];
function normalizeQuery(input) {
  if (input instanceof URLSearchParams) { check([...input.keys()].every(k => input.getAll(k).length === 1), 'INVALID_TRADING_QUERY', '조회 조건은 항목마다 한 번만 전달하세요.'); input = Object.fromEntries(input); }
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => FIELDS.includes(k)), 'INVALID_TRADING_QUERY', '조회 범위와 필터를 확인하세요.');
  const profileId = input.profileId ?? 'all', instrumentId = input.instrumentId ?? null, kind = input.kind ?? 'all', pageSize = input.pageSize === undefined ? 20 : typeof input.pageSize === 'string' && /^\d{1,2}$/.test(input.pageSize) ? Number(input.pageSize) : input.pageSize;
  check((profileId === 'all' || id(profileId)) && (instrumentId === null || id(instrumentId)) && ['all', 'decisions', 'fills'].includes(kind) && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50, 'INVALID_TRADING_QUERY', '마인드·종목·기록 유형과 페이지 크기를 확인하세요.');
  check(input.search === undefined || typeof input.search === 'string' && input.search.length <= 200 && !/[\u0000-\u001f]/.test(input.search), 'INVALID_TRADING_QUERY', '검색어는 200자 이내로 입력하세요.');
  check(input.status === undefined || typeof input.status === 'string' && input.status.length <= 80 && !/[\u0000-\u001f]/.test(input.status), 'INVALID_TRADING_QUERY', '상태 필터를 확인하세요.');
  check(input.cursor === undefined || typeof input.cursor === 'string' && input.cursor.length >= 1 && input.cursor.length <= 2048, 'TRADING_CURSOR_INVALID', '다음 페이지 위치를 확인하세요.');
  return { profileId, instrumentId, kind, pageSize, search: input.search?.trim().toLocaleLowerCase() || null, status: input.status?.trim().toUpperCase() || null, cursor: input.cursor };
}
function legacyInstrument(record, fill = null) {
  const p = record?.inputPackage ?? {}, explicit = fill?.quote?.provider ?? p.marketProvider ?? p.marketData?.manifest?.provider;
  if (explicit === 'okx') return 'crypto:okx:BTC-USDT';
  if (explicit === 'binance') return 'crypto:binance:BTCUSDT';
  if (explicit !== undefined && explicit !== null) return null;
  const loader = p.marketData?.manifest?.loaderVersion ?? p.marketLoaderVersion;
  if (loader?.startsWith('okx-')) return 'crypto:okx:BTC-USDT';
  if (loader?.startsWith('binance-') || ['HISTORICAL_FUNCTIONAL_REPLAY', 'MECHANICAL_BACKTEST', 'POINT_IN_TIME_BACKTEST', 'RETROSPECTIVE_POLICY_SIMULATION'].includes(p.experimentType)) return 'crypto:binance:BTCUSDT';
  return null;
}
const mode = r => r?.mode === 'replay' || r?.inputPackage?.experimentType && r.inputPackage.experimentType !== 'FORWARD_PAPER' ? 'replay' : 'live';
const decisionTimes = record => ({requestAt:iso(record.provider?.startedAt)?record.provider.startedAt:iso(record.decisionAt)?record.decisionAt:null,completedAt:iso(record.decisionCompletedAt)?record.decisionCompletedAt:iso(record.provider?.answeredAt)?record.provider.answeredAt:null});
const decisionOrigin = record => ({authority:record.decision?.authority??null,strength:number(record.decision?.strength),jevCalled:typeof record.jevCalled==='boolean'?record.jevCalled:null,decisionProvider:record.decision?.provider??null});
const displayedStatus = row => row.executionStatus ?? row.status;
const recordDay = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
function recordDateQuery(search) {
  const match=search?.match(/^(?:(\d{4})[-.]\s*)?(\d{1,2})[-.]\s*(\d{1,2})\.?$/);
  if(!match)return null;
  const [,year,month,day]=match;
  return [year,month.padStart(2,'0'),day.padStart(2,'0')].filter(Boolean).join('-');
}
function matchesRecordDate(row, date) {
  const matches=at=>at&&recordDay.format(new Date(at)).endsWith(date);
  return matches(row.asOf)||(row.kind==='decision'&&matches(row.completedAt??row.requestAt));
}
const sortRows = (a, b) => b.asOf.localeCompare(a.asOf) || b.id.localeCompare(a.id) || b.kind.localeCompare(a.kind);
function cursorEncode(body) { return btoa(JSON.stringify({ ...body, checksum: hashInputPackage(body) })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function cursorDecode(value) {
  try {
    check(/^[A-Za-z0-9_-]+$/.test(value), 'TRADING_CURSOR_INVALID', '조회 위치의 형식을 확인하세요.');
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))); check(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'TRADING_CURSOR_INVALID', '조회 위치를 확인하세요.');
    const { checksum, ...body } = parsed;
    check(Object.keys(body).length === 4 && body.v === 1 && /^[a-f0-9]{64}$/.test(body.scopeHash) && Number.isSafeInteger(body.revision) && body.revision >= 0 && body.last && Object.keys(body.last).length === 2 && typeof body.last.id === 'string' && body.last.id.length <= 230 && iso(body.last.asOf) && hashInputPackage(body) === checksum, 'TRADING_CURSOR_INVALID', '조회 위치의 범위·시점·검증값을 확인하세요.'); return body;
  } catch (error) { if (error instanceof TradingRecordsError) throw error; throw new TradingRecordsError('TRADING_CURSOR_INVALID', '첫 페이지부터 다시 조회하세요.'); }
}

export function savedMindRunFills(workspace,run){
  return list(workspace.mindPositions).flatMap(account=>account.profileId===run.profileId?list(account.ledger).filter(fill=>fill.runId===run.id):[]);
}

/** Thin owner-scoped projection. The authenticated workspace is supplied by the
 * caller; all filters precede stable revision-bound cursor pagination. */
export function buildTradingRecords(workspace, query = {}, {now=workspace?.updatedAt??new Date().toISOString()} = {}) {
  const q = normalizeQuery(query); check(Number.isSafeInteger(workspace?.revision) && workspace.revision >= 0, 'INVALID_TRADING_CONTEXT', '저장 버전을 확인하세요.');
  const profiles = new Map(list(workspace.investmentProfiles).map(p => [p.id, p]));
  check(q.profileId === 'all' || profiles.has(q.profileId), 'TRADING_PROFILE_NOT_FOUND', '이 계정의 마인드를 선택하세요.', 404);
  const decisions = new Map(list(workspace.decisionRecords).map(r => [r.id, r])), runs = new Map(list(workspace.mindRuns).map(r => [r.id, r])), rows = [], unique = new Map();
  const add = row => {
    if (!id(row.id) || !iso(row.asOf) || !profiles.has(row.profileId)) return;
    const key = `${row.kind}:${row.id}`, previous = unique.get(key);
    if (previous) { check(hashInputPackage(previous) === hashInputPackage(row), 'TRADING_RECORD_COLLISION', '중복 기록 ID의 프로필·종목·내용을 대조하세요.', 409); return; }
    unique.set(key, row); rows.push(row);
  };
  const profileName = value => resolveInvestmentProfileIdentity(workspace,value,{asOf:now}).name;
  for (const r of decisions.values()) {
    const p = r.inputPackage ?? {}, confidence = r.decision?.choiceConfidence ?? r.decision?.confidence ?? r.jevResponse?.answers?.action?.confidence;
    add({ kind: 'decision', id: r.id, ...decisionTimes(r), ...decisionOrigin(r), asOf: p.asOf ?? r.createdAt, instrumentId: legacyInstrument(r), profileId: r.investmentProfileId, profileName: profileName(r.investmentProfileId,r), action: r.decision?.action ?? null, confidence: number(confidence), price: number(p.marketSnapshot?.features?.close ?? p.marketSnapshot?.price), quantity: null, fee: null, status: r.decisionStatus ?? r.outcomeType ?? 'RECORDED', decisionId: r.id, quoteCurrency: 'USDT', mode: mode(r), model: r.decision?.model ?? r.jevResponse?.model ?? null });
  }
  const fillsByRun = new Map();
  for (const account of list(workspace.mindPositions)) for (const fill of list(account.ledger)) {
    const run = runs.get(fill.runId);
    if (!run || run.profileId !== account.profileId) continue;
    if (!fillsByRun.has(run.id)) fillsByRun.set(run.id, []);
    fillsByRun.get(run.id).push(fill);
  }
  for (const r of runs.values()) {
    const paper = r.experimentType === 'FORWARD_PAPER' && r.executionMode !== 'live' && mode(r) !== 'replay' && r.status !== 'FAILED';
    const execution = r.execution?.status;
    const fillCount = paper ? paperDecisionFillCount(r, fillsByRun.get(r.id) ?? []) : null;
    const executionStatus = paper && execution
      ? fillCount === null ? 'PAPER_FILL_UNCONFIRMED'
        : execution === 'NO_ORDER_REQUIRED' && r.decision?.action === 'hold' ? 'HOLD_SELECTED' : execution
      : undefined;
    add({ kind: 'decision', id: r.id, ...decisionTimes(r), ...decisionOrigin(r), asOf: r.asOf ?? r.decisionAt ?? r.createdAt, instrumentId: r.instrumentId ?? null, profileId: r.profileId, profileName: profileName(r.profileId,r), action: r.decision?.action ?? null, confidence: number(r.decision?.confidence), price: number(r.rawRequest?.state?.market?.features?.lastClose ?? r.rawRequest?.state?.market?.closedBars?.at(-1)?.close), quantity: null, fee: null, status: r.status ?? execution ?? 'RECORDED', ...(executionStatus ? {executionStatus} : {}), decisionId: r.id, quoteCurrency: r.rawRequest?.state?.market?.instrument?.quoteCurrency ?? r.accountSnapshot?.quoteCurrency ?? null, mode: mode(r), model: r.provider?.model ?? r.decision?.model ?? null });
  }
  for (const account of list(workspace.accounts)) for (const fill of list(account.ledger)) {
    const record = decisions.get(fill.decisionId); if (!record) continue;
    const profileId = fill.investmentProfileId ?? record.investmentProfileId;
    add({ kind: 'fill', id: fill.id, ...decisionTimes(record), ...decisionOrigin(record), asOf: fill.at, instrumentId: legacyInstrument(record, fill), profileId, profileName: profileName(profileId,record), action: fill.side ?? null, confidence: number(record.decision?.choiceConfidence ?? record.decision?.confidence), price: number(fill.fillPrice), quantity: number(fill.quantity), fee: number(fill.fee), status: 'FILLED', decisionId: record.id, quoteCurrency: account.baseCurrency ?? 'USDT', mode: mode(record), model: record.decision?.model ?? record.jevResponse?.model ?? null });
  }
  for (const account of list(workspace.mindPositions).filter(a => a.kind === 'PAPER_ACCOUNT')) for (const fill of list(account.ledger)) {
    const run = runs.get(fill.runId); if (!run || run.profileId !== account.profileId || fill.profileId && fill.profileId !== account.profileId) continue;
    add({ kind: 'fill', id: fill.id, ...decisionTimes(run), ...decisionOrigin(run), asOf: fill.at, instrumentId: fill.instrumentId ?? run.instrumentId ?? null, profileId: account.profileId, profileName: profileName(account.profileId,run), action: fill.side ?? null, confidence: number(run.decision?.confidence), price: number(fill.fillPrice), quantity: number(fill.quantity), fee: number(fill.fee), status: 'FILLED', decisionId: run.id, quoteCurrency: fill.currency ?? account.quoteCurrency, mode: mode(run), model: run.provider?.model ?? run.decision?.model ?? null });
  }
  const dateToken=q.search?.match(/(?:^|\s)(\d{4}-\d{1,2}-\d{1,2})(?=\s|$)/);
  const date=recordDateQuery(dateToken?.[1]??q.search);
  const search=dateToken?q.search.replace(dateToken[0],' ').trim():date?null:q.search;
  const filtered = rows.filter(r => (q.profileId === 'all' || r.profileId === q.profileId) && (!q.instrumentId || r.instrumentId === q.instrumentId) && (q.kind === 'all' || r.kind === (q.kind === 'fills' ? 'fill' : 'decision')) && (!q.status || q.status === 'ALL' || String(displayedStatus(r)).toUpperCase() === q.status || String(r.action).toUpperCase() === q.status) && (!search || [r.id, r.profileName, r.instrumentId, r.action, r.status, displayedStatus(r), r.decisionId, r.quoteCurrency, r.model].join(' ').toLocaleLowerCase().includes(search)) && (!date || matchesRecordDate(r,date))).sort(sortRows);
  const scope = { profileId: q.profileId, instrumentId: q.instrumentId, kind: q.kind, status: q.status, search: q.search }, scopeHash = hashInputPackage({ scope, pageSize: q.pageSize }); let remaining = filtered;
  if (q.cursor) { const c = cursorDecode(q.cursor); check(c.scopeHash === scopeHash, 'TRADING_CURSOR_SCOPE', '조회 범위가 변경되었습니다. 첫 페이지를 조회하세요.'); check(c.revision === workspace.revision, 'TRADING_CURSOR_STALE', '거래 기록이 갱신되었습니다. 첫 페이지를 조회하세요.', 409); const index = filtered.findIndex(r => `${r.kind}:${r.id}` === c.last.id && r.asOf === c.last.asOf); check(index >= 0, 'TRADING_CURSOR_INVALID', '조회 위치의 기록을 찾을 수 없습니다.'); remaining = filtered.slice(index + 1); }
  const items = remaining.slice(0, q.pageSize), hasMore = remaining.length > items.length, last = items.at(-1);
  return { revision: workspace.revision, scope, page: { items, total: filtered.length, pageSize: q.pageSize, nextCursor: hasMore ? cursorEncode({ v: 1, scopeHash, revision: workspace.revision, last: { id: `${last.kind}:${last.id}`, asOf: last.asOf } }) : null, hasMore } };
}
