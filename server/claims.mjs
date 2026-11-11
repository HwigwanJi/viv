export class ClaimError extends Error {
  constructor(code, message, status = 409, claim = null) { super(message); this.name = 'ClaimError'; this.code = code; this.status = status; this.claim = claim; }
}
const check = (value, code, message, status = 409, claim = null) => { if (!value) throw new ClaimError(code, message, status, claim); };
const string = (value, limit = 200) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f]/.test(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value < 8640000000000000;
const iso = milliseconds => new Date(milliseconds).toISOString();
const dto = row => row ? { ownerId: row.owner_id, resourceId: row.resource_id, key: row.command_key, fingerprint: row.fingerprint, token: row.claim_token, status: row.status, baseRevision: row.base_revision, leaseUntil: row.lease_until, startedAt: row.started_at, finishedAt: row.finished_at } : null;
const selectSQL = 'SELECT owner_id,resource_id,command_key,fingerprint,claim_token,status,base_revision,lease_until,started_at,finished_at FROM operation_claims WHERE owner_id=? AND resource_id=?';
function validate(db, input, { acquire = false } = {}) {
  check(db?.prepare, 'STORAGE_REQUIRED', '서버 실행 저장소를 확인하세요.', 503);
  check(input && string(input.ownerId, 240) && string(input.resourceId) && validTime(input.nowMs), 'INVALID_CLAIM_INPUT', '실행 주체·운용 봇·시각을 확인하세요.', 400);
  if (acquire) check(string(input.key) && /^[a-f0-9]{64}$/.test(input.fingerprint) && Number.isSafeInteger(input.baseRevision) && input.baseRevision >= 0 && Number.isSafeInteger(input.leaseMs ?? 45000) && (input.leaseMs ?? 45000) >= 1000 && (input.leaseMs ?? 45000) <= 120000 && validTime(input.nowMs + (input.leaseMs ?? 45000)), 'INVALID_CLAIM_INPUT', '요청 식별자·저장 버전·실행 유효 시간을 확인하세요.', 400);
  else check(string(input.token), 'INVALID_CLAIM_INPUT', '실행 소유 토큰을 확인하세요.', 400);
}
async function read(db, ownerId, resourceId) { return dto(await db.prepare(selectSQL).bind(ownerId, resourceId).first()); }
function chronological(claim, nowMs) { return !claim || Date.parse(claim.startedAt) <= nowMs && (!claim.finishedAt || Date.parse(claim.finishedAt) <= nowMs); }
function checkTime(claim, nowMs) { check(chronological(claim, nowMs), 'CLOCK_REWIND', '서버 시각이 이전 실행 기록보다 빠릅니다. 시각을 확인한 후 다시 실행하세요.', 409, claim); }

/** Acquire one deployment lease using a single conditional SQL mutation. */
export async function acquireClaim(db, input) {
  validate(db, input, { acquire: true });
  const token = crypto.randomUUID(), leaseUntil = input.nowMs + (input.leaseMs ?? 45000), startedAt = iso(input.nowMs);
  const prior = await read(db, input.ownerId, input.resourceId);
  if (prior?.key === input.key) check(prior.fingerprint === input.fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 실행 요청 ID의 내용이 변경되었습니다.', 409, prior);
  checkTime(prior, input.nowMs);
  const result = await db.prepare(`INSERT INTO operation_claims(owner_id,resource_id,command_key,fingerprint,claim_token,status,base_revision,lease_until,started_at,finished_at)
    VALUES(?,?,?,?,?,'PENDING',?,?,?,NULL)
    ON CONFLICT(owner_id,resource_id) DO UPDATE SET command_key=excluded.command_key,fingerprint=excluded.fingerprint,claim_token=excluded.claim_token,status='PENDING',base_revision=excluded.base_revision,lease_until=excluded.lease_until,started_at=excluded.started_at,finished_at=NULL
    WHERE (operation_claims.status<>'PENDING' OR operation_claims.lease_until<?)
      AND operation_claims.started_at<=excluded.started_at AND (operation_claims.finished_at IS NULL OR operation_claims.finished_at<=excluded.started_at)
      AND (operation_claims.command_key<>excluded.command_key OR operation_claims.fingerprint=excluded.fingerprint)
      AND operation_claims.claim_token=?`).bind(input.ownerId, input.resourceId, input.key, input.fingerprint, token, input.baseRevision, leaseUntil, startedAt, input.nowMs, prior?.token ?? 'unobserved-claim').run();
  const current = await read(db, input.ownerId, input.resourceId);
  if (result?.meta?.changes !== 1 || current?.token !== token) {
    if (current?.key === input.key) check(current.fingerprint === input.fingerprint, 'IDEMPOTENCY_CONFLICT', '같은 실행 요청 ID의 내용이 변경되었습니다.', 409, current);
    checkTime(current, input.nowMs);
    if (current?.status === 'PENDING' && current.leaseUntil >= input.nowMs) throw new ClaimError('IN_PROGRESS', '이 운용 봇의 실행이 진행 중입니다. 완료 후 다시 실행하세요.', 409, current);
    throw new ClaimError('CLAIM_CONFLICT', '다른 실행이 처리 상태를 갱신했습니다. 최신 상태를 확인하세요.', 409, current);
  }
  return { ...current, replacedClaim: prior, recoveredExpired: !!prior && prior.status === 'PENDING' && prior.leaseUntil < input.nowMs };
}

/** Assert immediately before a fenced state commit. The repository repeats this check in SQL. */
export async function assertClaim(db, input) {
  validate(db, input); const current = await read(db, input.ownerId, input.resourceId);
  check(current && current.token === input.token, 'CLAIM_LOST', '실행 소유권이 변경되었습니다. 최신 상태를 확인하세요.', 409, current);
  checkTime(current, input.nowMs);
  check(current.status === 'PENDING', 'CLAIM_FINALIZED', '이 실행의 처리 상태가 이미 확정되었습니다.', 409, current);
  check(current.leaseUntil >= input.nowMs, 'CLAIM_EXPIRED', '실행 유효 시간이 지났습니다. 결과를 다시 확인하고 재실행하세요.', 409, current);
  if (input.baseRevision !== undefined) check(current.baseRevision === input.baseRevision, 'CLAIM_REVISION_MISMATCH', '실행을 시작한 저장 버전을 확인하세요.', 409, current);
  return current;
}

async function finalize(db, input, status, requireLease) {
  validate(db, input); const current = await read(db, input.ownerId, input.resourceId);
  check(current && current.token === input.token, 'CLAIM_LOST', '실행 소유권이 변경되어 처리 상태를 갱신할 수 없습니다.', 409, current); checkTime(current, input.nowMs);
  if (current.status === status) return { ...current, idempotent: true };
  check(current.status === 'PENDING', 'CLAIM_FINALIZED', '이 실행의 처리 상태가 이미 확정되었습니다.', 409, current);
  if (requireLease) check(current.leaseUntil >= input.nowMs, 'CLAIM_EXPIRED', '실행 유효 시간이 지났습니다. 최신 결과를 확인하세요.', 409, current);
  const result = await db.prepare(`UPDATE operation_claims SET status=?,finished_at=? WHERE owner_id=? AND resource_id=? AND claim_token=? AND status='PENDING' AND started_at<=? ${requireLease ? 'AND lease_until>=?' : ''}`).bind(status, iso(input.nowMs), input.ownerId, input.resourceId, input.token, iso(input.nowMs), ...(requireLease ? [input.nowMs] : [])).run();
  const saved = await read(db, input.ownerId, input.resourceId);
  check(result?.meta?.changes === 1 && saved?.token === input.token && saved.status === status, 'CLAIM_LOST', '다른 실행이 처리 상태를 갱신했습니다.', 409, saved);
  return { ...saved, idempotent: false };
}

export async function completeClaim(db, input) { return finalize(db, input, 'COMPLETED', true); }
export async function renewClaim(db,input){
  const current=await assertClaim(db,input),leaseMs=input.leaseMs??120000;
  check(Number.isSafeInteger(leaseMs)&&leaseMs>=1000&&leaseMs<=120000,'INVALID_CLAIM_INPUT','실행 유효 시간을 확인하세요.',400);
  const leaseUntil=input.nowMs+leaseMs;
  const result=await db.prepare("UPDATE operation_claims SET lease_until=? WHERE owner_id=? AND resource_id=? AND claim_token=? AND status='PENDING' AND lease_until>=?").bind(leaseUntil,input.ownerId,input.resourceId,input.token,input.nowMs).run();
  check(result?.meta?.changes===1,'CLAIM_LOST','실행 소유권이 변경되었습니다. 최신 상태를 확인하세요.');return {...current,leaseUntil};
}
export async function releaseClaim(db, input) {
  const status = input?.status ?? 'FAILED'; check(['FAILED', 'CANCELLED'].includes(status), 'INVALID_CLAIM_STATUS', '실행 종료 상태를 확인하세요.', 400);
  return finalize(db, input, status, false);
}

export async function listInFlightClaims(db, { ownerId, nowMs } = {}) {
  check(db?.prepare, 'STORAGE_REQUIRED', '서버 실행 저장소를 확인하세요.', 503); check(string(ownerId, 240) && validTime(nowMs), 'INVALID_CLAIM_INPUT', '실행 주체와 조회 시각을 확인하세요.', 400);
  const rows = await db.prepare(`SELECT owner_id,resource_id,command_key,fingerprint,claim_token,status,base_revision,lease_until,started_at,finished_at FROM operation_claims WHERE owner_id=? AND status='PENDING' ORDER BY started_at,resource_id`).bind(ownerId).all();
  return rows.results.map(row => { const claim = dto(row); return { ...claim, expired: claim.leaseUntil < nowMs }; });
}
