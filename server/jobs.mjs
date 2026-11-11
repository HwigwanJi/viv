import { validateJobsState, dueJobs, dispatchJobAction, JobError, JOB_INTERVAL_MS,MAX_JOB_RETRY_DELAY_MS } from '../dist/domain/jobs.mjs';

const clone = value => structuredClone(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value);
const check = (condition, code, message) => { if (!condition) throw new JobError(code, message); };
const nonRetryable = new Set(['UNSUPPORTED_FUSION_POLICY', 'UNSUPPORTED_DECISION_CONTRACT', 'ACCOUNT_TIME_REWIND', 'DECISION_SCOPE', 'PAPER_OPT_IN_REQUIRED', 'INVALID_EXECUTION_COMMAND', 'INVALID_JOB_EFFECT_SCOPE']);
const reevaluateErrors = new Set(['DECISION_REQUEST_FAILED', 'DECISION_NOT_EXECUTABLE', 'DECISION_SUPERSEDED', 'DECISION_VERSION_MISMATCH', 'STALE_ACCOUNT_DECISION', 'STALE_DECISION_CONTEXT', 'DECISION_SOURCE_MISMATCH', 'ORDER_REVALIDATION_FAILED']);
const publicHosts={okx:'openapi.okx.com',binance:'data-api.binance.vision'};
/** Only public HTTP metadata from the server API crosses into scheduler policy. */
export function safePublicHttpDiagnostic(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(publicHosts,value.provider)||value.host!==publicHosts[value.provider]||typeof value.path!=='string'||!/^\/api\/v[35]\/[a-zA-Z0-9/-]{1,160}$/.test(value.path)||!Number.isInteger(value.httpStatus)||value.httpStatus<100||value.httpStatus>599||!iso(value.requestedAt)||!iso(value.receivedAt)||Date.parse(value.receivedAt)<Date.parse(value.requestedAt))return null;
  const header=value.retryAfter,retryAfter=typeof header==='string'&&(/^\d{1,10}$/.test(header)||/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)&&Number.isFinite(Date.parse(header)))?header:null;
  return {provider:value.provider,host:value.host,path:value.path,httpStatus:value.httpStatus,retryAfter,requestedAt:value.requestedAt,receivedAt:value.receivedAt};
}
function retryPolicy(error,now){
  const diagnostic=safePublicHttpDiagnostic(error.diagnostic),result={retryable:!nonRetryable.has(error.code),message:'예약 실행을 완료하지 못했습니다. 실행 기록을 확인해 주세요.'};
  if(diagnostic?.httpStatus===403)return {retryable:false,message:'공개 시세 접근이 거절되어 예약을 일시중지했습니다. 연결 상태를 확인한 뒤 재개하세요.'};
  if(diagnostic?.httpStatus!==429||diagnostic.retryAfter===null)return result;
  const current=Date.parse(now),target=/^\d+$/.test(diagnostic.retryAfter)?Math.max(current,Date.parse(diagnostic.receivedAt))+Number(diagnostic.retryAfter)*1000:Date.parse(diagnostic.retryAfter);
  if(!Number.isSafeInteger(target)||target-current>MAX_JOB_RETRY_DELAY_MS)return {retryable:false,message:'서버가 24시간을 넘는 재시도 대기를 안내하여 예약을 일시중지했습니다. 연결 상태와 안내 시각을 확인하세요.'};
  if(target>current)result.retryNotBefore=new Date(target).toISOString();return result;
}
function checkedEnvelope(envelope, ownerId) {
  check(envelope?.workspace && Array.isArray(envelope.workspace.deployments) && Number.isSafeInteger(envelope.workspace.revision) && validateJobsState(envelope.jobs).length === 0, 'INVALID_SCHEDULER_STATE', '영속 작업과 운용 구성을 확인하세요.');
  check(!ownerId || envelope.jobs.ownerId === ownerId, 'JOB_OWNER_SCOPE', '예약 작업의 사용자 범위를 확인하세요.'); return envelope;
}
function currentAttempt(envelope, attemptId, token, now) {
  const attempt = envelope.jobs.attempts.find(a => a.id === attemptId), job = envelope.jobs.jobs.find(j => j.id === attempt?.jobId);
  check(attempt && job && attempt.status === 'PENDING' && attempt.leaseToken === token, 'JOB_LEASE_LOST', '예약 작업의 실행 소유권이 변경되었습니다.'); check(job.status === 'active', 'JOB_DISABLED', '예약 작업이 일시중지되었습니다.');
  if (now) check(attempt.leaseUntil >= Date.parse(now), 'JOB_LEASE_EXPIRED', '예약 작업 실행 유효 시간이 지났습니다.');
  return { job, attempt };
}
function decisionRecord(effect, deploymentId, closeAt) {
  const record = effect?.result?.decisionRecord;
  check(record?.id && record.deploymentId === deploymentId && record.inputPackage?.asOf === closeAt, 'INVALID_JOB_EFFECT_SCOPE', '예약 봉과 보존한 선택 결과의 범위를 대조하세요.'); return record;
}

/**
 * read() -> {workspace,jobs}; compareAndSwap({expectedWorkspaceRevision,
 * expectedJobsRevision,workspace:null|newWorkspace,jobs,reason}) -> saved envelope.
 * A null workspace is a job-only commit; the host increments its workspace head.
 * Effects may return {persisted:true}; then checkpointing rereads the authoritative
 * workspace. Stable effect keys recover a crash before that checkpoint.
 */
export async function runScheduledJobs(adapters, options = {}) {
  check(['read', 'compareAndSwap', 'evaluate', 'execute'].every(k => typeof adapters?.[k] === 'function'), 'SCHEDULER_ADAPTER_REQUIRED', '예약 실행의 저장·선택·주문 연결을 확인하세요.');
  const clock = options.clock ?? (options.now ? () => options.now : () => new Date().toISOString());
  const now = () => { const value = clock(); check(iso(value), 'INVALID_TIME', '예약 실행 시각을 확인하세요.'); return value; };
  const workerId = options.workerId ?? `worker-${crypto.randomUUID()}`, maxJobs = options.maxJobs ?? 5;
  check(identifier(workerId) && Number.isSafeInteger(maxJobs) && maxJobs >= 1 && maxJobs <= 30, 'INVALID_WORKER_POLICY', '작업 주체와 실행 개수 한도를 확인하세요.');
  const report = { processed: 0, completed: 0, retried: 0, failed: 0, skipped: 0, results: [] }, excluded = new Set();
  const read = async () => checkedEnvelope(await adapters.read(), options.ownerId);
  const commit = async (base, mutation, workspace, reason) => checkedEnvelope(await adapters.compareAndSwap({ expectedWorkspaceRevision: base.workspace.revision, expectedJobsRevision: base.jobs.revision, workspace: workspace ?? null, jobs: mutation.jobs, reason }), options.ownerId);
  const mutate = (base, type, payload, time) => dispatchJobAction(base.jobs, { type, payload, idempotencyKey: crypto.randomUUID(), expectedRevision: base.jobs.revision }, { now: time });
  const latestClose = () => Math.floor(Date.parse(now()) / JOB_INTERVAL_MS) * JOB_INTERVAL_MS;
  const skip = async (base, job, through, code, attempt = null, token = null) => {
    const throughCloseAt = new Date(through).toISOString(), skippedBars = (through - Date.parse(job.nextCloseAt)) / JOB_INTERVAL_MS + 1;
    const skipped = mutate(base, 'job.skip', { jobId: job.id, throughCloseAt, reason: code, ...(attempt ? { attemptId: attempt.id, token } : {}) }, now());
    const saved = await commit(base, skipped, null, 'job.skipped'); report.skipped += skippedBars; report.results.push({ jobId: job.id, attemptId: attempt?.id ?? null, status: 'skipped', code, fromCloseAt: job.nextCloseAt, throughCloseAt, skippedBars }); return saved;
  };
  const skipThrough = (base, job, deployment) => {
    const latest = latestClose(), account = base.workspace.accounts?.find(a => a.id === deployment.accountId);
    return latest <= Date.parse(deployment.createdAt) || account && latest <= Date.parse(account.asOf) ? latest : latest - JOB_INTERVAL_MS;
  };
  let envelope = await read();
  for (let iteration = 0; iteration < maxJobs * 4 + 8; iteration++) {
    envelope = await read(); const job = dueJobs(envelope.jobs, { now: now() }).find(j => !excluded.has(j.id)); if (!job) break;
    const deployment = envelope.workspace.deployments.find(d => d.id === job.deploymentId);
    if (!deployment || deployment.executionMode !== 'paper' || deployment.runtimeStatus !== 'running') { report.skipped++; report.results.push({ jobId: job.id, status: 'skipped', code: !deployment ? 'DEPLOYMENT_NOT_FOUND' : deployment.executionMode !== 'paper' ? 'PAPER_OPT_IN_REQUIRED' : 'DEPLOYMENT_PAUSED' }); excluded.add(job.id); continue; }
    const forward = deployment.experimentType === 'FORWARD_PAPER';
    if (forward) {
      const unfinished = envelope.jobs.attempts.find(a => a.jobId === job.id && a.closeAt === job.nextCloseAt && !['COMPLETED', 'SKIPPED'].includes(a.status));
      if (!unfinished) { const through = skipThrough(envelope, job, deployment); if (Date.parse(job.nextCloseAt) <= through) { const code = latestClose() <= Date.parse(deployment.createdAt) ? 'FORWARD_BAR_BEFORE_DEPLOYMENT' : through === latestClose() ? 'FORWARD_BAR_ALREADY_PROCESSED' : 'MISSED_FORWARD_BARS'; try { envelope = await skip(envelope, job, through, code); } catch (error) { if (!['REVISION_CONFLICT', 'JOBS_REVISION_CONFLICT'].includes(error.code)) throw error; } continue; } }
    }
    if (report.processed >= maxJobs) break;
    let attemptId = null, token = null;
    try {
      const claimed = mutate(envelope, 'job.claim', { jobId: job.id, closeAt: job.nextCloseAt, workerId }, now());
      envelope = await commit(envelope, claimed, null, 'job.claim'); attemptId = claimed.result.id; token = claimed.result.leaseToken; report.processed++;
      let state = currentAttempt(envelope, attemptId, token, now());
      if (forward && state.attempt.stage === 'EVALUATING' && (Date.parse(state.attempt.closeAt) < latestClose() || Date.parse(state.attempt.closeAt) <= Date.parse(deployment.createdAt)) && !envelope.workspace.commandReceipts?.some(r => r.key === state.attempt.evaluateKey)) { envelope = await skip(envelope, state.job, Math.max(Date.parse(state.attempt.closeAt), skipThrough(envelope, state.job, deployment)), 'STALE_UNFINISHED_FORWARD_BAR', state.attempt, token); continue; }
      if (state.attempt.stage === 'EVALUATING') {
        const effect = await adapters.evaluate(envelope.workspace, { deploymentId: job.deploymentId, asOf: state.attempt.closeAt, idempotencyKey: state.attempt.evaluateKey, expectedRevision: envelope.workspace.revision }, { now: now(), ownerId: envelope.jobs.ownerId, jobId: job.id, attemptId, workerId });
        const record = decisionRecord(effect, job.deploymentId, state.attempt.closeAt);
        const persisted = effect.persisted === true || adapters.effectsPersisted === true || options.effectsPersisted === true;
        if (persisted) { envelope = await read(); state = currentAttempt(envelope, attemptId, token, now()); }
        const evaluated = mutate(envelope, 'job.checkpoint', { attemptId, token, stage: 'EVALUATED', decisionId: record.id, outcome: record.outcomeType }, now());
        envelope = await commit(envelope, evaluated, persisted ? null : effect.workspace, 'job.evaluated'); state = currentAttempt(envelope, attemptId, token, now());
      }
      if (state.attempt.stage === 'EVALUATED') {
        const record = envelope.workspace.decisionRecords?.find(d => d.id === state.attempt.decisionId); check(record?.deploymentId === job.deploymentId && record.inputPackage?.asOf === state.attempt.closeAt, 'INVALID_JOB_EFFECT_SCOPE', '작업의 보존된 선택 결과를 확인하세요.');
        const existing = envelope.workspace.accounts?.flatMap(a => a.ledger ?? []).filter(entry => entry.decisionId === record.id && entry.deploymentId === job.deploymentId) ?? [];
        if (!existing.length && forward && (Date.parse(state.attempt.closeAt) < latestClose() || Date.parse(state.attempt.closeAt) <= Date.parse(deployment.createdAt))) { envelope = await skip(envelope, state.job, Math.max(Date.parse(state.attempt.closeAt), skipThrough(envelope, state.job, deployment)), 'STALE_EVALUATED_FORWARD_BAR', state.attempt, token); continue; }
        if (record.decisionStatus === 'FAILED') throw new JobError('DECISION_REQUEST_FAILED', '선택 요청에 실패하여 재시도를 예약합니다.');
        if (existing.length || record.outcomeType !== 'TRADE_PROPOSED' || record.decisionStatus !== 'READY' || !state.job.autoExecute) {
          const outcome = existing.length ? 'TRADE_FILLED' : record.outcomeType === 'TRADE_PROPOSED' && !state.job.autoExecute ? 'PROPOSAL_REVIEW_REQUIRED' : record.outcomeType;
          const completed = mutate(envelope, 'job.checkpoint', { attemptId, token, stage: 'COMPLETED', outcome, executionIds: existing.map(e => e.id) }, now());
          envelope = await commit(envelope, completed, null, 'job.completed'); report.completed++; report.results.push({ jobId: job.id, attemptId, status: 'completed', outcome, decisionId: record.id, executionIds: existing.map(e => e.id) }); continue;
        }
        const executing = mutate(envelope, 'job.checkpoint', { attemptId, token, stage: 'EXECUTING' }, now()); envelope = await commit(envelope, executing, null, 'job.executing'); state = currentAttempt(envelope, attemptId, token, now());
      }
      if (state.attempt.stage === 'EXECUTING') {
        const currentDeployment = envelope.workspace.deployments.find(d => d.id === state.job.deploymentId); check(currentDeployment?.runtimeStatus === 'running' && currentDeployment.executionMode === 'paper', 'JOB_DISABLED', '운용 봇의 모의 실행이 일시중지되었습니다.');
        const existing = envelope.workspace.accounts?.flatMap(a => a.ledger ?? []).filter(entry => entry.decisionId === state.attempt.decisionId && entry.deploymentId === job.deploymentId) ?? [];
        if (existing.length) { const completed = mutate(envelope, 'job.checkpoint', { attemptId, token, stage: 'COMPLETED', outcome: 'TRADE_FILLED', executionIds: existing.map(e => e.id) }, now()); envelope = await commit(envelope, completed, null, 'job.completed'); report.completed++; report.results.push({ jobId: job.id, attemptId, status: 'completed', outcome: 'TRADE_FILLED', decisionId: state.attempt.decisionId, executionIds: existing.map(e => e.id), recoveredPersistedFill: true }); continue; }
        if (forward && (Date.parse(state.attempt.closeAt) < latestClose() || Date.parse(state.attempt.closeAt) <= Date.parse(deployment.createdAt))) { envelope = await skip(envelope, state.job, Math.max(Date.parse(state.attempt.closeAt), skipThrough(envelope, state.job, deployment)), 'STALE_UNFILLED_FORWARD_ORDER', state.attempt, token); continue; }
        const effect = await adapters.execute(envelope.workspace, { deploymentId: job.deploymentId, decisionId: state.attempt.decisionId, idempotencyKey: state.attempt.executeKey, expectedRevision: envelope.workspace.revision }, { now: now(), ownerId: envelope.jobs.ownerId, jobId: job.id, attemptId, workerId });
        const record = decisionRecord(effect, job.deploymentId, state.attempt.closeAt); check(record.id === state.attempt.decisionId && Array.isArray(effect.result.executionIds) && effect.result.executionIds.length > 0, 'INVALID_JOB_EFFECT_SCOPE', '체결과 선택 결과의 연결을 확인하세요.');
        const persisted = effect.persisted === true || adapters.effectsPersisted === true || options.effectsPersisted === true;
        if (persisted) { envelope = await read(); state = currentAttempt(envelope, attemptId, token, now()); }
        const completed = mutate(envelope, 'job.checkpoint', { attemptId, token, stage: 'COMPLETED', outcome: 'TRADE_FILLED', executionIds: effect.result.executionIds }, now());
        envelope = await commit(envelope, completed, persisted ? null : effect.workspace, 'job.completed'); report.completed++; report.results.push({ jobId: job.id, attemptId, status: 'completed', outcome: 'TRADE_FILLED', decisionId: record.id, executionIds: clone(effect.result.executionIds) });
      }
    } catch (error) {
      let failureSaved = false;
      if (attemptId && token) try {
        const latest = await read(), attempt = latest.jobs.attempts.find(a => a.id === attemptId);
        if (attempt?.status === 'PENDING' && attempt.leaseToken === token && attempt.leaseUntil >= Date.parse(now())) {
          const code = identifier(error.code) ? error.code : 'JOB_RUN_FAILED',failedAt=now(),policy=retryPolicy(error,failedAt),failure = mutate(latest, 'job.fail', { attemptId, token, code,...policy,resetEvaluation: reevaluateErrors.has(code) }, failedAt);
          envelope = await commit(latest, failure, null, 'job.failed'); failureSaved = true;
          if (failure.result.status === 'RETRY_WAIT') report.retried++; else report.failed++;
        }
      } catch { /* The persisted lease and stable effect keys recover a storage interruption. */ }
      if (!failureSaved) report.failed++;
      report.results.push({ jobId: job.id, attemptId, status: failureSaved ? 'retry-or-failure-recorded' : 'recovery-required', code: identifier(error.code) ? error.code : 'JOB_RUN_FAILED' }); excluded.add(job.id);
    }
  }
  envelope = await read(); return { ...envelope, report };
}
