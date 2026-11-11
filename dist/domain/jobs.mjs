export const JOBS_SCHEMA_VERSION = 1;
export const JOB_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const MAX_JOB_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
export const JOB_ACTIONS = Object.freeze(['job.create', 'job.pause', 'job.stop', 'job.resume', 'job.claim', 'job.checkpoint', 'job.fail', 'job.skip']);
export const JOB_STAGES = Object.freeze(['EVALUATING', 'EVALUATED', 'EXECUTING', 'COMPLETED']);
const COLLECTIONS = ['jobs', 'attempts', 'events', 'receipts'];
const clone = value => structuredClone(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const safe = (v, depth = 0) => depth < 20 && (v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 6000 || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.length <= 20000 && v.every(x => safe(x, depth + 1)) || plain(v) && Object.keys(v).length <= 60 && Object.entries(Object.getOwnPropertyDescriptors(v)).every(([k, d]) => !['__proto__', 'constructor', 'prototype'].includes(k) && Object.hasOwn(d, 'value') && safe(d.value, depth + 1)));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
export class JobError extends Error { constructor(code, message, status = 409) { super(message); this.name = 'JobError'; this.code = code; this.status = status; } }
const check = (condition, code, message, status) => { if (!condition) throw new JobError(code, message, status); };
const fields = (value, allowed, required = []) => check(plain(value) && safe(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value, k)), 'INVALID_JOB_INPUT', '작업 입력 항목과 필수 값을 확인하세요.', 400);
const nowAt = options => { const now = options?.now ?? new Date().toISOString(); check(iso(now), 'INVALID_TIME', '작업 시각을 확인하세요.', 400); return now; };
const find = (items, target) => { const item = items.find(v => v.id === target); check(item, 'JOB_RESOURCE_NOT_FOUND', '예약 작업과 실행 기록을 확인하세요.', 404); return item; };
const closed = value => iso(value) && Date.parse(value) >= JOB_INTERVAL_MS && Date.parse(value) % JOB_INTERVAL_MS === 0;
const boundedInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const asIso = value => new Date(value).toISOString();
function event(state, type, jobId, attemptId, now, payload = {}) { state.events.push({ id: id('job-event'), eventType: type, jobId, attemptId: attemptId ?? null, occurredAt: now, payload: clone(payload), revision: state.revision + 1 }); }
function keys(job, closeAt, generation) { const base = `scheduled:${job.deploymentId}:${closeAt}:g${generation}`; return { evaluateKey: `${base}:evaluate`, executeKey: `${base}:execute` }; }
function verifyToken(attempt, token, now) { check(attempt.status === 'PENDING' && attempt.leaseToken === token, 'JOB_LEASE_LOST', '작업의 실행 소유권이 변경되었습니다.'); check(attempt.leaseUntil >= Date.parse(now), 'JOB_LEASE_EXPIRED', '작업 실행 유효 시간이 지났습니다.'); }

export function createJobsState({ ownerId = 'workspace-owner', now = new Date().toISOString() } = {}) {
  check(text(ownerId, 240) && iso(now), 'INVALID_JOB_STATE', '작업 소유자와 생성 시각을 확인하세요.', 400);
  return { schemaVersion: JOBS_SCHEMA_VERSION, ownerId, revision: 0, createdAt: now, updatedAt: now, jobs: [], attempts: [], events: [], receipts: [] };
}

export function dueJobs(state, options = {}) {
  const errors = validateJobsState(state); check(!errors.length, errors[0]?.code ?? 'INVALID_JOB_STATE', errors[0]?.message ?? '예약 작업을 확인하세요.'); const now = nowAt(options), time = Date.parse(now);
  return state.jobs.filter(job => job.status === 'active' && job.optInPaper && job.executionMode === 'paper' && Date.parse(job.nextCloseAt) + job.settleDelayMs <= time).filter(job => {
    const attempt = state.attempts.find(a => a.jobId === job.id && a.closeAt === job.nextCloseAt);
    return !attempt || attempt.status === 'RETRY_WAIT' && Date.parse(attempt.retryAt) <= time || attempt.status === 'PENDING' && attempt.leaseUntil < time;
  }).sort((a, b) => Date.parse(a.nextCloseAt) - Date.parse(b.nextCloseAt) || a.id.localeCompare(b.id)).map(clone);
}

export function dispatchJobAction(jobs, command, options = {}) {
  const errors = validateJobsState(jobs); check(!errors.length, errors[0]?.code ?? 'INVALID_JOB_STATE', errors[0]?.message ?? '예약 작업을 확인하세요.');
  fields(command, ['type', 'payload', 'idempotencyKey', 'expectedRevision'], ['type', 'payload', 'idempotencyKey', 'expectedRevision']); check(JOB_ACTIONS.includes(command.type) && identifier(command.idempotencyKey) && Number.isSafeInteger(command.expectedRevision), 'INVALID_JOB_COMMAND', '작업 종류와 저장 버전을 확인하세요.', 400);
  const fingerprint = canonical({ type: command.type, payload: command.payload }), receipt = jobs.receipts.find(r => r.key === command.idempotencyKey);
  if (receipt) { check(receipt.fingerprint === fingerprint, 'JOB_IDEMPOTENCY_CONFLICT', '같은 작업 요청 ID의 내용이 변경되었습니다.'); return { jobs, result: clone(receipt.result), idempotent: true }; }
  check(command.expectedRevision === jobs.revision, 'JOBS_REVISION_CONFLICT', '다른 실행이 예약 작업을 갱신했습니다. 최신 상태를 다시 조회하세요.');
  const now = nowAt(options); check(Date.parse(now) >= Date.parse(jobs.updatedAt), 'JOB_CLOCK_REWIND', '작업 시각이 이전 저장 기록보다 빠릅니다.');
  const state = clone(jobs), p = command.payload; let result;
  if (command.type === 'job.create') {
    fields(p, ['name', 'deploymentId', 'optInPaper', 'executionMode', 'autoExecute', 'startCloseAt', 'settleDelayMs', 'leaseMs', 'maxRetries', 'retryBaseMs'], ['name', 'deploymentId', 'optInPaper', 'executionMode', 'autoExecute']);
    check(text(p.name, 120) && identifier(p.deploymentId) && p.deploymentId.length <= 96 && p.optInPaper === true && p.executionMode === 'paper' && typeof p.autoExecute === 'boolean', 'PAPER_OPT_IN_REQUIRED', '모의 운용 동의와 자동 주문 설정을 확인하세요.', 400);
    check(!state.jobs.some(j => j.deploymentId === p.deploymentId && j.status !== 'stopped'), 'DUPLICATE_DEPLOYMENT_JOB', '이 운용 봇의 예약 작업이 이미 있습니다.');
    const settleDelayMs = p.settleDelayMs ?? 15000, leaseMs = p.leaseMs ?? 45000, maxRetries = p.maxRetries ?? 3, retryBaseMs = p.retryBaseMs ?? 30000;
    check(boundedInteger(settleDelayMs, 0, 300000) && boundedInteger(leaseMs, 30000, 120000) && boundedInteger(maxRetries, 0, 10) && boundedInteger(retryBaseMs, 15000, 3600000), 'INVALID_JOB_POLICY', '확정 대기·작업 유효 시간·재시도 정책을 확인하세요.', 400);
    const first = (Math.floor(Date.parse(now) / JOB_INTERVAL_MS) + 1) * JOB_INTERVAL_MS, startCloseAt = p.startCloseAt ?? asIso(first);
    check(closed(startCloseAt), 'INVALID_CLOSE_TIME', 'UTC 4시간봉 마감 시각을 선택하세요.', 400);
    result = { id: id('job'), ownerId: state.ownerId, name: p.name.trim(), deploymentId: p.deploymentId, optInPaper: true, executionMode: 'paper', autoExecute: p.autoExecute, intervalMs: JOB_INTERVAL_MS, settleDelayMs, leaseMs, maxRetries, retryBaseMs, status: 'active', nextCloseAt: startCloseAt, lastCompletedCloseAt: null, lastSkippedCloseAt: null, createdAt: now, updatedAt: now };
    state.jobs.push(result); event(state, 'SCHEDULED_JOB_CREATED', result.id, null, now, { autoExecute: result.autoExecute, firstCloseAt: startCloseAt });
  } else if (['job.pause', 'job.stop', 'job.resume'].includes(command.type)) {
    fields(p, ['jobId'], ['jobId']); const job = find(state.jobs, p.jobId), status = command.type === 'job.pause' ? 'paused' : command.type === 'job.stop' ? 'stopped' : 'active';
    if (status === 'active') check(!state.jobs.some(j => j.id !== job.id && j.deploymentId === job.deploymentId && j.status !== 'stopped'), 'DUPLICATE_DEPLOYMENT_JOB', '이 운용 봇의 다른 예약 작업을 중지하세요.');
    job.status = status; job.updatedAt = now;
    if (status === 'active') for (const attempt of state.attempts.filter(a => a.jobId === job.id && a.status === 'FAILED')) { attempt.status = 'RETRY_WAIT'; attempt.failures = 0; attempt.retryAt = asIso(Math.max(Date.parse(now),Date.parse(attempt.retryNotBefore??now))); attempt.updatedAt = now; event(state, 'JOB_RETRY_REQUESTED', job.id, attempt.id, now); }
    if (status !== 'active') for (const attempt of state.attempts.filter(a => a.jobId === job.id && a.status === 'PENDING')) { attempt.status = 'RETRY_WAIT'; attempt.retryAt = now; attempt.leaseToken = null; attempt.leaseUntil = null; attempt.updatedAt = now; event(state, 'JOB_ATTEMPT_RELEASED', job.id, attempt.id, now, { reason: status }); }
    event(state, status === 'active' ? 'SCHEDULED_JOB_RESUMED' : status === 'paused' ? 'SCHEDULED_JOB_PAUSED' : 'SCHEDULED_JOB_STOPPED', job.id, null, now); result = job;
  } else if (command.type === 'job.skip') {
    fields(p, ['jobId', 'throughCloseAt', 'reason', 'attemptId', 'token'], ['jobId', 'throughCloseAt', 'reason']); const job = find(state.jobs, p.jobId), time = Date.parse(now);
    check(job.status === 'active' && closed(p.throughCloseAt) && Date.parse(p.throughCloseAt) >= Date.parse(job.nextCloseAt) && Date.parse(p.throughCloseAt) <= Math.floor(time / JOB_INTERVAL_MS) * JOB_INTERVAL_MS && text(p.reason, 120), 'INVALID_SKIP_RANGE', '사용 가능한 과거 마감 봉의 건너뛰기 범위를 확인하세요.');
    const unfinished = state.attempts.filter(a => a.jobId === job.id && Date.parse(a.closeAt) >= Date.parse(job.nextCloseAt) && Date.parse(a.closeAt) <= Date.parse(p.throughCloseAt) && !['COMPLETED', 'SKIPPED'].includes(a.status));
    check(unfinished.length === 0 || unfinished.length === 1 && unfinished[0].id === p.attemptId, 'UNFINISHED_JOB_ATTEMPT', '완료되지 않은 작업의 영속 결과를 먼저 복구하세요.');
    for (const attempt of unfinished) { verifyToken(attempt, p.token, now); attempt.status = 'SKIPPED'; attempt.stage = 'COMPLETED'; attempt.outcome = 'SKIPPED_STALE_FORWARD_BAR'; attempt.completedAt = now; attempt.updatedAt = now; attempt.leaseToken = null; attempt.leaseUntil = null; attempt.retryAt = null; event(state, 'JOB_ATTEMPT_SKIPPED', job.id, attempt.id, now, { reason: p.reason, decisionId: attempt.decisionId, generation: attempt.generation }); }
    const fromCloseAt = job.nextCloseAt; job.lastSkippedCloseAt = p.throughCloseAt; job.nextCloseAt = asIso(Date.parse(p.throughCloseAt) + JOB_INTERVAL_MS); job.updatedAt = now;
    event(state, 'JOB_BARS_SKIPPED', job.id, p.attemptId, now, { fromCloseAt, throughCloseAt: p.throughCloseAt, skippedBars: (Date.parse(p.throughCloseAt) - Date.parse(fromCloseAt)) / JOB_INTERVAL_MS + 1, reason: p.reason }); result = job;
  } else if (command.type === 'job.claim') {
    fields(p, ['jobId', 'closeAt', 'workerId'], ['jobId', 'closeAt', 'workerId']); const job = find(state.jobs, p.jobId), time = Date.parse(now);
    check(job.status === 'active' && job.optInPaper && job.executionMode === 'paper', 'JOB_DISABLED', '활성 모의투자 예약 작업을 선택하세요.'); check(identifier(p.workerId) && closed(p.closeAt), 'INVALID_JOB_INPUT', '작업 주체와 확정 봉 시각을 확인하세요.', 400);
    let attempt = state.attempts.find(a => a.jobId === job.id && a.closeAt === p.closeAt);
    if (attempt && ['COMPLETED', 'SKIPPED'].includes(attempt.status)) result = attempt;
    else {
      check(p.closeAt === job.nextCloseAt && Date.parse(p.closeAt) + job.settleDelayMs <= time, 'CANDLE_NOT_READY', '예약된 4시간봉이 확정된 후 실행하세요.');
      if (attempt) {
        check(attempt.status !== 'FAILED' && (attempt.status === 'RETRY_WAIT' ? Date.parse(attempt.retryAt) <= time : attempt.status === 'PENDING' && attempt.leaseUntil < time), 'JOB_IN_PROGRESS', '작업의 완료 또는 재시도 시각을 기다려 주세요.');
        const priorToken = attempt.leaseToken, priorStage = attempt.stage;
        if (attempt.resetEvaluation) { attempt.generation++; attempt.stage = 'EVALUATING'; attempt.decisionId = null; attempt.outcome = null; attempt.executionIds = []; Object.assign(attempt, keys(job, p.closeAt, attempt.generation)); attempt.resetEvaluation = false; }
        attempt.attemptNumber++; attempt.status = 'PENDING'; attempt.workerId = p.workerId; attempt.leaseToken = crypto.randomUUID(); attempt.leaseUntil = time + job.leaseMs; attempt.retryAt = null; attempt.retryNotBefore = null; attempt.updatedAt = now;
        event(state, priorToken ? 'JOB_LEASE_RECOVERED' : 'JOB_RETRY_STARTED', job.id, attempt.id, now, { previousToken: priorToken, previousStage: priorStage, attemptNumber: attempt.attemptNumber });
      } else {
        attempt = { id: id('attempt'), jobId: job.id, ownerId: state.ownerId, deploymentId: job.deploymentId, closeAt: p.closeAt, generation: 1, attemptNumber: 1, failures: 0, status: 'PENDING', stage: 'EVALUATING', workerId: p.workerId, leaseToken: crypto.randomUUID(), leaseUntil: time + job.leaseMs, retryAt: null, retryNotBefore:null, resetEvaluation: false, decisionId: null, outcome: null, executionIds: [], lastError: null, ...keys(job, p.closeAt, 1), createdAt: now, updatedAt: now, completedAt: null };
        state.attempts.push(attempt); event(state, 'JOB_ATTEMPT_STARTED', job.id, attempt.id, now, { closeAt: p.closeAt });
      }
      result = attempt;
    }
  } else if (command.type === 'job.checkpoint') {
    fields(p, ['attemptId', 'token', 'stage', 'decisionId', 'outcome', 'executionIds'], ['attemptId', 'token', 'stage']); const attempt = find(state.attempts, p.attemptId), job = find(state.jobs, attempt.jobId); verifyToken(attempt, p.token, now);
    check(job.status === 'active', 'JOB_DISABLED', '예약 작업이 일시중지되었습니다.');
    const allowed = { EVALUATING: ['EVALUATED'], EVALUATED: ['EXECUTING', 'COMPLETED'], EXECUTING: ['COMPLETED'], COMPLETED: [] };
    check(allowed[attempt.stage].includes(p.stage), 'INVALID_JOB_TRANSITION', '작업 단계의 순서를 확인하세요.');
    if (p.stage === 'EVALUATED') check(identifier(p.decisionId), 'JOB_DECISION_REQUIRED', '보존한 선택 결과의 식별자를 확인하세요.', 400);
    if (p.stage === 'EXECUTING') check(job.autoExecute && identifier(attempt.decisionId), 'AUTOMATIC_EXECUTION_DISABLED', '모의 주문 자동 실행 동의를 확인하세요.');
    if (p.executionIds !== undefined) check(Array.isArray(p.executionIds) && p.executionIds.length <= 10 && p.executionIds.every(identifier), 'INVALID_EXECUTION_REFS', '체결 식별자를 확인하세요.', 400);
    attempt.stage = p.stage; if (p.decisionId !== undefined) attempt.decisionId = p.decisionId; if (p.outcome !== undefined) { check(text(p.outcome, 120), 'INVALID_JOB_INPUT', '작업 결과를 확인하세요.', 400); attempt.outcome = p.outcome; } if (p.executionIds) attempt.executionIds = clone(p.executionIds); attempt.updatedAt = now;
    if (p.stage === 'COMPLETED') { attempt.status = 'COMPLETED'; attempt.completedAt = now; attempt.leaseToken = null; attempt.leaseUntil = null; job.lastCompletedCloseAt = attempt.closeAt; job.nextCloseAt = asIso(Date.parse(attempt.closeAt) + JOB_INTERVAL_MS); job.updatedAt = now; }
    else attempt.leaseUntil = Date.parse(now) + job.leaseMs;
    event(state, p.stage === 'COMPLETED' ? 'JOB_ATTEMPT_COMPLETED' : 'JOB_CHECKPOINT_SAVED', job.id, attempt.id, now, { stage: p.stage, decisionId: attempt.decisionId, outcome: attempt.outcome }); result = attempt;
  } else {
    fields(p, ['attemptId', 'token', 'code', 'message', 'retryable', 'resetEvaluation','retryNotBefore'], ['attemptId', 'token', 'code', 'message', 'retryable']); const attempt = find(state.attempts, p.attemptId), job = find(state.jobs, attempt.jobId); verifyToken(attempt, p.token, now);
    check(identifier(p.code) && text(p.message, 1000) && typeof p.retryable === 'boolean' && (p.resetEvaluation === undefined || typeof p.resetEvaluation === 'boolean') && (p.retryNotBefore===undefined || p.retryable&&iso(p.retryNotBefore)&&Date.parse(p.retryNotBefore)>=Date.parse(now)&&Date.parse(p.retryNotBefore)-Date.parse(now)<=MAX_JOB_RETRY_DELAY_MS), 'INVALID_JOB_FAILURE', '실패 사유와 재시도 정책·24시간 이내의 UTC 재시도 시각을 확인하세요.', 400);
    attempt.failures++; attempt.lastError = { code: p.code, message: p.message, occurredAt: now,...(p.retryNotBefore===undefined?{}:{retryNotBefore:p.retryNotBefore}) }; attempt.retryNotBefore=p.retryNotBefore??null;attempt.leaseToken = null; attempt.leaseUntil = null; attempt.updatedAt = now; attempt.resetEvaluation = p.resetEvaluation ?? false;
    if (p.retryable && attempt.failures <= job.maxRetries) { attempt.status = 'RETRY_WAIT'; attempt.retryAt = asIso(Math.max(Date.parse(now) + Math.min(job.retryBaseMs * 2 ** (attempt.failures - 1), 3600000),Date.parse(p.retryNotBefore??now))); }
    else { attempt.status = 'FAILED'; attempt.retryAt = null; job.status = 'paused'; job.updatedAt = now; }
    event(state, attempt.status === 'FAILED' ? 'JOB_ATTEMPT_FAILED' : 'JOB_RETRY_SCHEDULED', job.id, attempt.id, now, { code: p.code, retryAt: attempt.retryAt,...(p.retryNotBefore===undefined?{}:{retryNotBefore:p.retryNotBefore}), stage: attempt.stage, resetEvaluation: attempt.resetEvaluation }); result = attempt;
  }
  state.revision++; state.updatedAt = now; state.receipts.push({ id: id('job-receipt'), key: command.idempotencyKey, fingerprint, revision: state.revision, result: clone(result), createdAt: now });
  const changed = validateJobsState(state); check(!changed.length, changed[0]?.code ?? 'INVALID_JOB_STATE', changed[0]?.message ?? '작업 상태를 확인하세요.'); return { jobs: state, result: clone(result), idempotent: false };
}

export function claimJobAttempt(state, payload, options = {}) { return dispatchJobAction(state, { type: 'job.claim', payload, idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(), expectedRevision: options.expectedRevision ?? state.revision }, options); }
export function advanceJobAttempt(state, payload, options = {}) { return dispatchJobAction(state, { type: 'job.checkpoint', payload, idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(), expectedRevision: options.expectedRevision ?? state.revision }, options); }

export function validateJobsState(state) {
  try {
    check(plain(state) && safe(state) && Object.keys(state).length === COLLECTIONS.length + 5 && state.schemaVersion === JOBS_SCHEMA_VERSION && text(state.ownerId, 240) && Number.isSafeInteger(state.revision) && state.revision >= 0 && iso(state.createdAt) && iso(state.updatedAt) && Date.parse(state.createdAt) <= Date.parse(state.updatedAt) && COLLECTIONS.every(k => Array.isArray(state[k])), 'INVALID_JOB_STATE', '지원하는 예약 작업 문서를 확인하세요.');
    for (const collection of COLLECTIONS) check(state[collection].length <= 10000 && state[collection].every(r => plain(r) && identifier(r.id)) && new Set(state[collection].map(r => r.id)).size === state[collection].length, 'INVALID_JOB_RECORD', '작업 기록의 식별자와 보관 한도를 확인하세요.');
    for (const job of state.jobs) {
      const lastSkipped = job.lastSkippedCloseAt ?? null, marks = [job.lastCompletedCloseAt, lastSkipped].filter(Boolean);
      check(job.ownerId === state.ownerId && identifier(job.deploymentId) && text(job.name, 120) && job.optInPaper === true && job.executionMode === 'paper' && typeof job.autoExecute === 'boolean' && job.intervalMs === JOB_INTERVAL_MS && ['active', 'paused', 'stopped'].includes(job.status) && closed(job.nextCloseAt) && (job.lastCompletedCloseAt === null || closed(job.lastCompletedCloseAt)) && (lastSkipped === null || closed(lastSkipped)) && (!marks.length || Date.parse(job.nextCloseAt) === Math.max(...marks.map(Date.parse)) + JOB_INTERVAL_MS) && boundedInteger(job.settleDelayMs, 0, 300000) && boundedInteger(job.leaseMs, 30000, 120000) && boundedInteger(job.maxRetries, 0, 10) && boundedInteger(job.retryBaseMs, 15000, 3600000), 'INVALID_JOB_POLICY', '작업 소유·모의 실행·일정·재시도 정책을 확인하세요.');
    }
    const activeDeployments = state.jobs.filter(j => j.status !== 'stopped').map(j => j.deploymentId); check(new Set(activeDeployments).size === activeDeployments.length, 'DUPLICATE_DEPLOYMENT_JOB', '동일 운용 봇의 예약 작업이 중복됐습니다.');
    const runs = new Set();
    for (const attempt of state.attempts) {
      const job = find(state.jobs, attempt.jobId), run = `${attempt.jobId}:${attempt.closeAt}`;
      check(!runs.has(run) && closed(attempt.closeAt) && attempt.ownerId === state.ownerId && attempt.deploymentId === job.deploymentId && boundedInteger(attempt.generation, 1, 100000) && boundedInteger(attempt.attemptNumber, 1, 100000) && boundedInteger(attempt.failures, 0, 100000) && ['PENDING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'SKIPPED'].includes(attempt.status) && JOB_STAGES.includes(attempt.stage), 'INVALID_JOB_ATTEMPT', '실행 기록의 소유·봉·단계를 확인하세요.'); runs.add(run);
      check(canonical(keys(job, attempt.closeAt, attempt.generation)) === canonical({ evaluateKey: attempt.evaluateKey, executeKey: attempt.executeKey }), 'JOB_EFFECT_KEY_MISMATCH', '봉 실행의 중복 방지 키를 대조하세요.');
      check(attempt.status !== 'PENDING' || identifier(attempt.leaseToken) && Number.isSafeInteger(attempt.leaseUntil) && attempt.leaseUntil >= Date.parse(attempt.updatedAt), 'INVALID_JOB_LEASE', '작업 잠금과 유효 시각을 확인하세요.');
      check(attempt.status !== 'RETRY_WAIT' || iso(attempt.retryAt), 'INVALID_JOB_RETRY', '재시도 시각을 확인하세요.'); check(attempt.status === 'SKIPPED' || attempt.stage === 'EVALUATING' || identifier(attempt.decisionId), 'JOB_DECISION_REQUIRED', '실행 단계에 연결된 선택 결과를 확인하세요.');
      const boundary=attempt.retryNotBefore,recorded=attempt.lastError?.retryNotBefore,occurred=attempt.lastError?.occurredAt;
      check(recorded===undefined||iso(recorded)&&iso(occurred)&&Date.parse(recorded)>=Date.parse(occurred)&&Date.parse(recorded)-Date.parse(occurred)<=MAX_JOB_RETRY_DELAY_MS,'INVALID_JOB_RETRY','저장된 서버 재시도 안내의 UTC 시각과 상한을 확인하세요.');
      check(boundary===undefined||boundary===null||iso(boundary)&&boundary===recorded&&(attempt.status!=='RETRY_WAIT'||Date.parse(attempt.retryAt)>=Date.parse(boundary)),'INVALID_JOB_RETRY','서버 안내 시각보다 이른 예약 재시도를 중단하세요.');
      check(!['COMPLETED', 'SKIPPED'].includes(attempt.status) || attempt.stage === 'COMPLETED' && iso(attempt.completedAt), 'INVALID_JOB_COMPLETION', '완료 단계와 시각을 확인하세요.');
    }
    check(new Set(state.receipts.map(r => r.key)).size === state.receipts.length && state.receipts.every(r => identifier(r.key) && typeof r.fingerprint === 'string' && r.revision <= state.revision), 'INVALID_JOB_RECEIPT', '예약 작업의 중복 방지 기록을 확인하세요.');
    return [];
  } catch (error) { return [{ code: error.code ?? 'INVALID_JOB_STATE', message: error.message }]; }
}
