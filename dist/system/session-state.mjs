const clone = value => structuredClone(value);
const json = value => JSON.stringify(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const contextKeys = ['mode', 'cursor', 'asOf', 'strategyVersion', 'configHash', 'sourceHash', 'accountJson', 'portfolio'];
const actions = ['buy', 'hold', 'sell'];
const stances = ['normal', 'clutch', 'defensive'];

export class SessionStateError extends Error {
  constructor(code, message) { super(message); this.name = 'SessionStateError'; this.code = code; }
}
const issue = (code, message) => ({ ok: false, code, message });
const fail = (code, message) => { throw new SessionStateError(code, message); };

// The caller holds the browser's exclusive Web Lock for this read/check/write.
export function persistCandidate(candidate, { storage, key, expectedRevision, maxBytes = 4000000, createId = () => crypto.randomUUID(), now = () => new Date().toISOString(), validateState = () => true } = {}) {
  try {
    const next = { ...clone(candidate), revision: createId(), updatedAt: now() };
    const valid = validateState(next);
    if (valid === false || Array.isArray(valid) && valid.length) fail('INVALID_STATE', '저장할 기록의 형식과 원장을 확인하세요.');
    const raw = JSON.stringify(next, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value) || ['bigint', 'function', 'symbol'].includes(typeof value)) fail('INVALID_STATE', '저장할 기록의 값을 확인하세요.');
      return value;
    });
    if (new TextEncoder().encode(raw).byteLength > maxBytes) fail('STORAGE_SIZE_LIMIT', '저장 공간 한도에 도달했습니다. 기록을 내보내 보관하세요.');
    const currentRaw = storage.getItem(key);
    let currentRevision = null;
    if (currentRaw !== null) {
      let current;
      try { current = JSON.parse(currentRaw); } catch { fail('CORRUPT_STORAGE', '저장된 원본 기록을 확인할 수 없습니다. 원본을 보관한 뒤 다시 여세요.'); }
      if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, 'revision') || current.revision !== null && typeof current.revision !== 'string') fail('CORRUPT_STORAGE', '저장된 원본 기록의 버전을 확인하세요.');
      currentRevision = current.revision;
    }
    if (currentRevision !== expectedRevision) fail('REVISION_CONFLICT', '다른 탭에서 기록이 변경됐습니다. 새로고침 후 계속하세요.');
    storage.setItem(key, raw);
    return { ok: true, state: next, revision: next.revision };
  } catch (error) {
    return issue(error.code || (error.name === 'QuotaExceededError' ? 'STORAGE_QUOTA' : 'STORAGE_FAILED'), error instanceof SessionStateError ? error.message : '브라우저 저장에 실패했습니다. 원본 기록을 보관한 뒤 다시 여세요.');
  }
}

export function createSessionState({ initialState, storage, key = 'keynes-investment-lab-v2', locks = globalThis.navigator?.locks, validateState = () => true, getContext, createId = () => crypto.randomUUID(), now = () => new Date().toISOString(), maxBytes = 4000000, blocked = false, warning = '' } = {}) {
  let state = freeze(clone(initialState)), generation = 0, active = null, latestDecision = null, pending = null;
  let stopped = blocked, message = warning, evaluation = { status: 'idle', generation, requestId: null, message: '' };
  const context = () => clone(getContext(state));
  const sameContext = captured => json(context()) === json(captured);
  const current = token => active?.id === token?.id && generation === token.generation;
  const event = (type, title, detail, extra = {}) => ({ id: createId(), at: now(), type, title, detail, ...clone(extra) });
  const clear = (reason, status = 'invalidated') => {
    generation++;
    active?.controller.abort(); active = null; latestDecision = null; pending = null;
    evaluation = { status, generation, requestId: null, message: reason || '' };
  };
  const stop = result => { stopped = true; message = result.message; clear(message, 'blocked'); return result; };
  const append = (draft, events) => { draft.journal = [...(draft.journal || []), ...events].slice(-3000); };
  async function commit(mutator, { events = [], invalidateReason = null, deferInvalidation = false, guard = null } = {}) {
    if (stopped) return issue('SESSION_BLOCKED', message || '기록을 다시 연 뒤 계속하세요.');
    if (invalidateReason && !deferInvalidation) clear(invalidateReason);
    if (!locks || typeof locks.request !== 'function') return stop(issue('LOCK_UNAVAILABLE', '안전한 브라우저 저장 잠금을 사용할 수 없습니다. 기록을 내보내고 지원되는 브라우저에서 다시 여세요.'));
    try {
      return await locks.request(`keynes-workspace:${key}`, { mode: 'exclusive' }, () => {
        if (stopped) return issue('SESSION_BLOCKED', message);
        if (guard && !guard()) return issue('STALE_RESULT', '입력이 변경되어 이전 실행 결과를 폐기했습니다.');
        const draft = clone(state);
        const changed = mutator?.(draft) || draft;
        if (invalidateReason && deferInvalidation) clear(invalidateReason);
        if (invalidateReason) changed.lastJev = null;
        append(changed, [...events, ...(invalidateReason ? [event('jev.invalidated', '매매 제안 무효화', invalidateReason, { generation })] : [])]);
        const result = persistCandidate(changed, { storage, key, expectedRevision: state.revision ?? null, maxBytes, createId, now, validateState });
        if (!result.ok) return stop(result);
        state = freeze(result.state);
        return { ...result, state };
      });
    } catch (error) {
      if (error instanceof SessionStateError) return issue(error.code, error.message);
      return stop(issue('COMMIT_FAILED', '상태 변경과 저장을 완료하지 못했습니다. 원본 기록을 보관한 뒤 다시 여세요.'));
    }
  }
  async function discard(token, reason) {
    if (current(token)) clear(reason);
    if (!stopped) await commit(null, { events: [event('jev.discarded', '이전 JEV 응답 폐기', reason, { clientRequestId: token?.id || null, generation: token?.generation ?? null })] });
    return { ...issue('STALE_RESULT', reason), ignored: true };
  }
  async function invalidate(reason) {
    return commit(draft => { draft.lastJev = null; }, { invalidateReason: reason });
  }
  function checkDecision(decision, captured) {
    if (!decision || decision.provider !== 'jev' || !actions.includes(decision.action) || !stances.includes(decision.stance) || !['asOf', 'configHash', 'sourceHash'].every(key => decision[key] === captured[key]) || decision.strategyVersion !== captured.strategyVersion) return false;
    return ['cash', 'btcQuantity', 'equity', 'weight'].every(key => Number.isFinite(decision.accountState?.[key]) && decision.accountState[key] === captured.portfolio[key]);
  }
  async function beginEvaluation() {
    if (stopped) return issue('SESSION_BLOCKED', message);
    clear('새 JEV 실행을 시작했습니다.', 'pending');
    const captured = context();
    if (captured.mode !== 'jev' || contextKeys.some(key => !Object.hasOwn(captured, key))) { evaluation = { ...evaluation, status: 'failed', message: 'JEV 실행의 시점과 입력을 확인하세요.' }; return issue('INVALID_CONTEXT', evaluation.message); }
    const token = { id: createId(), generation, context: captured, controller: new AbortController() };
    active = token; evaluation = { status: 'pending', generation, requestId: token.id, message: '' };
    const saved = await commit(draft => { draft.lastJev = null; }, { events: [event('jev.started', 'JEV 실행 시작', `${captured.asOf} · 정책 v${captured.strategyVersion}`, { clientRequestId: token.id, generation })], guard: () => current(token) && sameContext(captured) });
    if (!saved.ok) return saved.code === 'STALE_RESULT' ? discard(token, saved.message) : saved;
    if (!current(token) || !sameContext(captured)) return discard(token, '실행 시작 중 입력이 변경되었습니다.');
    return { ok: true, token, context: clone(captured), signal: token.controller.signal };
  }
  async function failEvaluation(token, failure = {}) {
    if (!current(token)) return discard(token, '이후 실행이 시작되어 이전 실패 응답을 폐기했습니다.');
    latestDecision = null; pending = null;
    const failureMessage = typeof failure.message === 'string' ? failure.message.slice(0, 1000) : 'JEV 실행을 완료하지 못했습니다.';
    evaluation = { status: 'failed', generation, requestId: token.id, message: failureMessage };
    const saved = await commit(draft => { draft.lastJev = null; }, { events: [event('jev.failed', 'JEV 실행 실패', failureMessage, { clientRequestId: token.id, requestId: typeof failure.requestId === 'string' ? failure.requestId : null, status: typeof failure.status === 'string' ? failure.status : 'error', action: 'hold', generation: token.generation })], guard: () => current(token) });
    if (!saved.ok) return saved;
    if (current(token)) { active = null; evaluation = { status: 'failed', generation, requestId: token.id, message: failureMessage }; }
    return issue('EVALUATION_FAILED', failureMessage);
  }
  async function acceptEvaluation(token, result) {
    if (!current(token) || !sameContext(token.context)) return discard(token, '시점·정책·노트·계좌가 변경되어 이전 응답을 폐기했습니다.');
    if (!result || result.ok !== true || result.status !== 'ready' || !checkDecision(result.decision, token.context)) return failEvaluation(token, result || { message: '응답의 시점과 설정을 확인할 수 없습니다.' });
    const decision = clone(result.decision);
    const saved = await commit(draft => { draft.lastJev = decision; }, { events: [event('evaluation', 'JEV 실행 완료', `${decision.action} · ${decision.asOf}`, { decision, clientRequestId: token.id, requestId: result.requestId || null, questionVersion: result.questionVersion || null, usage: result.usage || null, generation: token.generation })], guard: () => current(token) && sameContext(token.context) });
    if (!saved.ok) return saved;
    if (!current(token) || !sameContext(token.context)) return discard(token, '저장 중 이후 실행이 시작되어 이전 응답을 폐기했습니다.');
    active = null; latestDecision = state.lastJev; pending = null;
    evaluation = { status: 'ready', generation, requestId: token.id, message: '' };
    return { ok: true, decision: latestDecision };
  }
  async function runEvaluation(request) {
    const started = await beginEvaluation();
    if (!started.ok) return started;
    try { return await acceptEvaluation(started.token, await request({ context: started.context, token: started.token.id, signal: started.signal })); }
    catch (error) { return failEvaluation(started.token, error?.result || { message: error?.message || 'JEV 응답을 확인할 수 없습니다.' }); }
  }
  function setPendingOrder(proposal, decision) {
    if (stopped || !proposal || !decision || evaluation.status === 'pending') return issue('PROPOSAL_UNAVAILABLE', '현재 실행 결과를 먼저 확인하세요.');
    if (!['jev', 'spec'].includes(decision.provider) || proposal.mode !== 'paper' || proposal.side !== decision.action || typeof proposal.id !== 'string' || !proposal.id || json(proposal.decision) !== json(decision)) return issue('INVALID_PROPOSAL', '현재 신호에서 생성한 모의 주문을 확인하세요.');
    const captured = context();
    if (decision.provider === 'jev' && (evaluation.status !== 'ready' || decision !== latestDecision || !checkDecision(decision, captured)) || decision.provider === 'spec' && captured.mode !== 'spec') return issue('STALE_PROPOSAL', '현재 입력으로 매매 신호를 다시 확인하세요.');
    pending = { proposal, generation, requestId: evaluation.requestId, context: captured, id: proposal.id, fingerprint: json(proposal) };
    return { ok: true, proposal };
  }
  function checkPendingOrder() {
    if (stopped || !pending) return issue('PROPOSAL_UNAVAILABLE', '현재 실행 결과에서 주문을 다시 검토하세요.');
    if (pending.generation !== generation || pending.requestId !== evaluation.requestId || pending.id !== pending.proposal.id || pending.fingerprint !== json(pending.proposal) || !sameContext(pending.context) || pending.proposal.decision?.provider === 'jev' && (evaluation.status !== 'ready' || !checkDecision(pending.proposal.decision, pending.context))) { pending = null; return issue('STALE_PROPOSAL', '입력이 변경되어 주문 후보를 폐기했습니다. 다시 실행하세요.'); }
    return { ok: true, proposal: pending.proposal };
  }
  return {
    get state() { return state; }, get blocked() { return stopped; }, get warning() { return message; },
    get latestDecision() { return evaluation.status === 'ready' && latestDecision && checkDecision(latestDecision, context()) ? latestDecision : null; }, get pendingOrder() { return pending?.proposal || null; }, get evaluation() { return clone(evaluation); },
    commit, invalidate, beginEvaluation, acceptEvaluation, failEvaluation, runEvaluation, setPendingOrder, checkPendingOrder,
    clearPendingOrder() { pending = null; },
    block(reason = '다른 탭에서 기록이 변경됐습니다. 새로고침 후 계속하세요.') { return stop(issue('REVISION_CONFLICT', reason)); },
  };
}
