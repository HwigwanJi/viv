import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {abandonMindSubscriptionAttempt,finishMindSubscriptionAttempt,mindSubscriptionBudgetUsage} from '../dist/domain/mind-subscriptions.mjs';
import {automaticObservationWindow} from '../dist/domain/learning-cohort.mjs';
import {acquireClaim,releaseClaim,completeClaim} from './claims.mjs';
import {executeMindRun} from './mind-execution-service.mjs';

const clone=structuredClone;
const check=(value,code,message,status=409)=>{if(!value)throw new RepositoryError(code,message,status);};
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(v);
const reasonCodes=[{value:'PROVIDER_OUTCOME_UNKNOWN',label:'응답 결과 확인 불가'},{value:'WORKER_INTERRUPTED',label:'실행 중단'},{value:'OTHER',label:'기타'}];
const resourceFor=s=>'mind-execution:'+s.profileId;
async function readLease(db,ownerId,resourceId){return db.prepare('SELECT command_key,fingerprint,claim_token,status,lease_until,started_at,finished_at FROM operation_claims WHERE owner_id=? AND resource_id=?').bind(ownerId,resourceId).first();}
const autoLeaseMatches=(lease,s,attempt)=>Boolean(attempt&&lease.command_key===attempt.key&&lease.fingerprint===hashInputPackage({subscriptionId:s.id,barCloseAt:attempt.barCloseAt,contract:s.version}));

function providerStages(w,ownerId,s,attempt){
 if(!attempt)return [];
 const events=(w.activityEvents??[]).filter(e=>e.actorId===ownerId&&e.resourceId===s.profileId&&e.payload?.profileId===s.profileId&&e.payload.executionKey===attempt.key&&e.payload.manifestHash===attempt.pins.manifestHash);
 return events.filter(e=>e.eventType==='MIND_PROVIDER_STAGE_RESERVED').sort((a,b)=>a.payload.stage.index-b.payload.stage.index).map(reservation=>{
  const related=events.filter(e=>e.payload?.reservationId===reservation.id&&e.payload.stage.index===reservation.payload.stage.index&&e.payload.stage.rawRequestHash===reservation.payload.stage.rawRequestHash);
  const response=related.find(e=>e.eventType==='MIND_PROVIDER_STAGE_ANSWERED'),failed=related.find(e=>e.eventType==='MIND_PROVIDER_STAGE_FAILED'),result=response??failed;
  return {index:reservation.payload.stage.index,status:response?'ANSWERED':failed?'FAILED':'RESPONSE_NOT_RECORDED',reservationId:reservation.id,reservedAt:reservation.occurredAt,resultEventId:result?.id??null,resultAt:result?.occurredAt??null,stage:clone(result?.payload.stage??reservation.payload.stage)};
 });
}

function inspect(w,ownerId,subscriptionId,attemptKey=null){
 const s=w.mindSubscriptions.find(s=>s.id===subscriptionId&&s.ownerId===ownerId);check(s,'SUBSCRIPTION_NOT_FOUND','사용자 소유 자동운용을 선택하세요.',404);
 const attempt=attemptKey?s.attempts.find(a=>a.key===attemptKey):s.attempts.at(-1),account=w.mindPositions.find(a=>a.id===s.accountId&&a.profileId===s.profileId);
 check(!attemptKey||attempt,'SUBSCRIPTION_ATTEMPT_REQUIRED','저장한 호출 시도를 선택하세요.',404);
 const snapshot=attempt&&s.runtime?.attemptKey===attempt.key?s.runtime?.inputSnapshot:null;
 const runs=attempt?w.mindRuns.filter(r=>r.executionKey===attempt.key||r.automation?.attemptKey===attempt.key):[];
 check(runs.length<=1&&runs.every(r=>r.automation?.ownerId===ownerId&&r.automation.subscriptionId===s.id&&r.profileId===s.profileId&&r.instrumentId===s.instrumentId&&r.manifestHash===attempt.pins.manifestHash),'RECOVERY_RECORD_CONFLICT','호출과 저장 결정의 소유자·고정 정책을 대조하세요.');
 const run=runs[0]??null,receipts=run?w.mindPositions.filter(a=>a.kind==='PAPER_ACCOUNT').flatMap(a=>a.receipts.filter(r=>r.runId===run.id).map(r=>({accountId:a.id,...r}))):[];
 check(receipts.length<=1&&receipts.every(r=>r.accountId===s.accountId),'RECOVERY_RECORD_CONFLICT','저장 영수증과 고정 계좌를 대조하세요.');
 const receipt=receipts[0]??null,commandReceipt=attempt?w.commandReceipts.find(r=>r.key===attempt.key+':paper'):null;
 const orphan=Boolean(commandReceipt&&!run||attempt?.runId&&run?.id!==attempt.runId);
 const currentFingerprint=account?hashInputPackage(account):null,reservedFingerprint=snapshot?.accountStateHash??null;
 const snapshotValid=Boolean(snapshot&&snapshot.accountId===s.accountId&&snapshot.manifestHash===attempt.pins.manifestHash&&snapshot.requestHash===hashInputPackage(snapshot.rawRequest)&&/^[a-f0-9]{64}$/.test(reservedFingerprint??''));
 return {s,attempt,account,snapshot,snapshotValid,currentFingerprint,reservedFingerprint,unchanged:snapshotValid&&currentFingerprint===reservedFingerprint,run,receipt,orphan};
}

export async function mindSubscriptionRecovery(w,{repository,ownerId,subscriptionId,attemptKey=null,now}={}){
 const state=inspect(w,ownerId,subscriptionId,attemptKey),{s,attempt,run,receipt}=state,lease=await readLease(repository.db,ownerId,resourceFor(s));
 const unresolved=attempt&&['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(attempt.status),reconciliation=s.runtime?.reconciliation?.attemptKey===attempt?.key?s.runtime.reconciliation:null;
 const allowedActions=[],blockedReasons=[],busy=lease?.status==='PENDING'&&lease.lease_until>=Date.parse(now)&&!autoLeaseMatches(lease,s,attempt);
 if(attempt&&attempt.status!=='ABANDONED')allowedActions.push('reconcile');
 if(unresolved&&(run||receipt)&&!state.orphan)allowedActions.push('recover');
 if(unresolved&&attempt.requiresJev!==false&&!run&&!receipt&&!state.orphan&&state.unchanged&&reconciliation?.result==='NO_RECORDS'&&reconciliation.accountStateHash===state.currentFingerprint)allowedActions.push('abandon');
 if(s.status==='PAUSED'&&!s.attempts.some(a=>['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(a.status)))allowedActions.push('resume');
 if(unresolved&&!run&&!state.snapshotValid)blockedReasons.push({code:'RECOVERY_BASELINE_REQUIRED',message:'예약 당시 원본 계좌 지문과 입력 원문을 확인하세요.'});
 else if(unresolved&&!run&&!state.unchanged)blockedReasons.push({code:'ACCOUNT_CHANGED',message:'예약 이후 계좌 변경을 대조한 뒤 처리하세요.'});
 if(state.orphan)blockedReasons.push({code:'RECOVERY_RECORD_CONFLICT',message:'결정·계좌 영수증 참조를 확인하세요.'});
 if(busy){allowedActions.length=0;blockedReasons.push({code:'RECOVERY_RESOURCE_BUSY',message:'이 계좌의 다른 실행이 진행 중입니다. 완료 후 다시 조회하세요.'});}
 return {ok:true,revision:w.revision,asOf:now,recovery:{subscriptionId:s.id,profileId:s.profileId,attemptKey:attempt?.key??null,subscriptionStatus:s.status,attempt:clone(attempt??null),pins:clone(attempt?.pins??s.pins),budget:{...clone(s.budget),consumedPerCandle:attempt?1:0,consumedUtcDay:attempt?s.attempts.filter(a=>a.utcDay===attempt.utcDay).length:0},budgetUsage:mindSubscriptionBudgetUsage(s,{utcDay:attempt?.utcDay??now.slice(0,10)}),lease:lease?{status:lease.status,leaseUntil:new Date(lease.lease_until).toISOString(),expired:lease.lease_until<Date.parse(now),startedAt:lease.started_at,finishedAt:lease.finished_at}:null,inputSnapshot:state.snapshot?{accountId:state.snapshot.accountId,accountStateHash:state.snapshot.accountStateHash??null,accountSnapshotHash:state.snapshot.accountSnapshotHash,requestHash:state.snapshot.requestHash,canonicalSnapshotRef:state.snapshot.canonicalSnapshotRef}:null,account:{id:s.accountId,reservedFingerprint:state.reservedFingerprint,currentFingerprint:state.currentFingerprint,unchanged:state.unchanged},decision:run?{id:run.id,action:run.decision.action,decisionAt:run.decisionAt??null,decisionCompletedAt:run.decisionCompletedAt??null,executionStatus:run.execution?.status??null}:null,receipt:receipt?{decisionId:receipt.runId,status:receipt.outcome,at:receipt.at}:null,reconciliation:clone(reconciliation),providerStages:providerStages(w,ownerId,s,attempt),providerFailure:s.runtime?.providerFailure?.attemptKey===attempt?.key?clone(s.runtime.providerFailure):clone(w.activityEvents.filter(e=>e.eventType==='MIND_AUTO_PROVIDER_FAILED'&&e.resourceId===s.id&&e.payload?.attemptKey===attempt?.key).at(-1)?.payload?.providerFailure??null),allowedActions,blockedReasons,reasonCodes}};
}

/** Owner review revokes the previous writer before inspecting immutable records. */
export async function recoverMindSubscription({repository,ownerId,body,operation,options={}}={}){
 const clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();
 const allowed=['subscriptionId','attemptKey','expectedRevision','idempotencyKey',...(operation==='abandon'?['reasonCode','reasonText','ackUnknown','ackBudget']:[])];
 check(['reconcile','recover','abandon'].includes(operation)&&Object.keys(body).every(k=>allowed.includes(k))&&[body.subscriptionId,body.attemptKey,body.idempotencyKey].every(validId)&&Number.isSafeInteger(body.expectedRevision),'INVALID_RECOVERY_COMMAND','자동운용·호출 시도·저장 버전을 확인하세요.',400);
 if(operation==='abandon')check(reasonCodes.some(r=>r.value===body.reasonCode)&&typeof body.reasonText==='string'&&body.reasonText.trim().length>=10&&body.reasonText.length<=2000&&body.ackUnknown===true&&body.ackBudget===true,'SUBSCRIPTION_ABANDONMENT_REVIEW','종결 사유와 결과 미확정·예산 소모 확인을 입력하세요.',400);
 const input=Object.fromEntries(Object.entries(body).filter(([k])=>!['expectedRevision','idempotencyKey'].includes(k))),fingerprint=hashInputPackage({ownerId,operation,input});
 let w=await readOperationalWorkspace(repository,ownerId,undefined,[body.idempotencyKey]);check(w,'SUBSCRIPTION_NOT_FOUND','사용자 소유 자동운용을 선택하세요.',404);
 const prior=w.commandReceipts.find(r=>r.key===body.idempotencyKey);
 if(prior){check(prior.type==='mind.subscription.recovery'&&prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 검토 요청의 입력이 변경되었습니다.');return {...await mindSubscriptionRecovery(w,{repository,ownerId,subscriptionId:body.subscriptionId,attemptKey:body.attemptKey,now:clock()}),result:clone(prior.result),idempotent:true};}
 check(w.revision===body.expectedRevision,'REVISION_CONFLICT','최신 자동운용 기록을 다시 조회하세요.');
 let state=inspect(w,ownerId,body.subscriptionId,body.attemptKey);check(state.attempt,'SUBSCRIPTION_ATTEMPT_REQUIRED','저장 호출을 선택하세요.',404);
 const resourceId=resourceFor(state.s),old=await readLease(repository.db,ownerId,resourceId),nowMs=Date.parse(clock());
 if(old?.status==='PENDING'&&old.lease_until>=nowMs){
   check(autoLeaseMatches(old,state.s,state.attempt),'RECOVERY_RESOURCE_BUSY','다른 계좌 실행이 진행 중입니다. 완료 후 다시 조회하세요.');
   await releaseClaim(repository.db,{ownerId,resourceId,token:old.claim_token,nowMs,status:'CANCELLED'});
 }
 const claim=await acquireClaim(repository.db,{ownerId,resourceId,key:'mind-recovery-'+body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(clock()),leaseMs:120000});let finalized=false;
 try{
   w=await readOperationalWorkspace(repository,ownerId,undefined,[body.idempotencyKey]);check(w.revision===body.expectedRevision,'REVISION_CONFLICT','대조 중 기록이 갱신되었습니다. 다시 조회하세요.');
   state=inspect(w,ownerId,body.subscriptionId,body.attemptKey);const {s,attempt,run,receipt}=state,next=clone(w);let target=next.mindSubscriptions.find(v=>v.id===s.id),result;
   check(!state.orphan,'RECOVERY_RECORD_CONFLICT','결정·계좌 영수증 참조를 먼저 확인하세요.');
   if(operation==='reconcile'){
     const localInterrupted=attempt.status==='COMPUTING'&&attempt.requiresJev===false&&!run&&!receipt&&state.unchanged;
     const outcome=run||receipt?'RECOVERY_AVAILABLE':localInterrupted?'LOCAL_COMPUTATION_INTERRUPTED':state.unchanged?'NO_RECORDS':'ACCOUNT_CHANGED';
     if(localInterrupted){target=finishMindSubscriptionAttempt(s,{attemptKey:attempt.key,outcome:'FAILED',errorCode:outcome,jevCalled:false},{now:clock()}).subscription;target.status='PAUSED';next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=target;}
     target.runtime={...target.runtime,stage:outcome,...(localInterrupted?{nextAttemptAt:null,lastFailure:{code:outcome,message:'전략 계산이 중단되었습니다. 다음 확정 봉부터 운용을 재개할 수 있습니다.',occurredAt:clock(),retryAt:null}}:{}),reconciliation:{attemptKey:attempt.key,checkedAt:clock(),result:outcome,accountStateHash:state.currentFingerprint}};
     if(!localInterrupted&&['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(attempt.status)&&target.status==='ENABLED')target.status='ACTION_REQUIRED';
     result={subscriptionId:s.id,attemptKey:attempt.key,outcome,decisionId:run?.id??null};
   }else if(operation==='abandon'){
     check(!run&&!receipt,'SUBSCRIPTION_RECOVERY_REQUIRED','실제로 저장한 결정과 영수증을 먼저 복구하세요.');
     check(state.unchanged,'ACCOUNT_CHANGED','예약 당시 원본 지문과 현재 계좌를 대조하세요.');
     check(s.runtime?.reconciliation?.attemptKey===attempt.key&&s.runtime.reconciliation.result==='NO_RECORDS'&&s.runtime.reconciliation.accountStateHash===state.currentFingerprint,'RECONCILIATION_REQUIRED','이번 호출의 저장 기록을 먼저 다시 확인하세요.');
     const value=abandonMindSubscriptionAttempt(s,{attemptKey:attempt.key,reasonCode:body.reasonCode,reason:body.reasonText,ackUnknown:body.ackUnknown,ackBudget:body.ackBudget},{ownerId,now:clock()});target=value.subscription;
     target.runtime={...target.runtime,stage:'ABANDONED',nextAttemptAt:null,reconciliation:{attemptKey:attempt.key,checkedAt:clock(),result:'ABANDONED',accountStateHash:state.currentFingerprint}};
     next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=target;
     result={subscriptionId:s.id,attemptKey:attempt.key,outcome:'ABANDONED',externalOutcome:'UNKNOWN',budgetConsumed:true};
   }else{
     check(run,'RECOVERY_DECISION_REQUIRED','실제로 저장한 결정을 확인하세요.');
     check(['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(attempt.status),'RECOVERY_ALREADY_FINALIZED','이미 종결한 호출의 원본 기록을 확인하세요.');
     const manifest=w.mindManifests.find(m=>m.id===attempt.pins.manifestId);check(manifest&&mindDocumentHash(manifest)===run.manifestHash,'SUBSCRIPTION_PIN_CHANGED','해당 호출에 고정한 원본 정책을 확인하세요.');
     let executionStatus=run.execution?.status,outcome='RECOVERED';
     if(!receipt){
       const window=automaticObservationWindow({barCloseAt:attempt.barCloseAt,executionAt:clock()});
       if(!window.withinExecutionWindow){const saved=next.mindRuns.find(r=>r.id===run.id);saved.execution={...saved.execution,status:'DECISION_EXPIRED',errorCode:'DECISION_EXPIRED',reason:'이 봉의 승인 실행 허용창이 지났습니다.',at:clock()};executionStatus='DECISION_EXPIRED';outcome='DECISION_EXPIRED';}
       else{check(state.unchanged,'ACCOUNT_CHANGED','저장 결정 이후 계좌 변경을 대조하세요.');const draft=clone(w);const value=await executeMindRun({workspace:w,next:draft,run,manifest,fetchImpl:options.fetchImpl,clock,executionDeadline:window.executionWindowEndAt});check(clock()<=window.executionWindowEndAt,'AUTO_EXECUTION_WINDOW','이 봉의 실행 허용창이 지났습니다.');next.mindPositions=draft.mindPositions;next.mindRuns=draft.mindRuns;executionStatus=value.execution.status;}
     }
     const completed=finishMindSubscriptionAttempt(s,{attemptKey:attempt.key,outcome:outcome==='DECISION_EXPIRED'?'FAILED':'COMPLETED',runId:run.id,errorCode:outcome==='DECISION_EXPIRED'?'DECISION_EXPIRED':null,jevCalled:run.jevCalled??true},{now:clock()});target=completed.subscription;target.status='PAUSED';
     target.runtime={...target.runtime,stage:outcome==='DECISION_EXPIRED'?'DECISION_EXPIRED':'OBSERVATION_SCHEDULED',runId:run.id,nextAttemptAt:null,reconciliation:{attemptKey:attempt.key,checkedAt:clock(),result:'RECOVERY_AVAILABLE',accountStateHash:state.currentFingerprint},lastAttempt:{stage:outcome,decisionId:run.id,action:run.decision.action,executionStatus,completedAt:clock(),barCloseAt:attempt.barCloseAt}};
     const saved=next.mindRuns.find(r=>r.id===run.id);saved.observationState=outcome==='DECISION_EXPIRED'?'DATA_REQUIRED':'WAITING_TIME';saved.observationDueAt=new Date(Date.parse(attempt.barCloseAt)+28800000).toISOString();
     next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=target;result={subscriptionId:s.id,attemptKey:attempt.key,outcome,decisionId:run.id,executionStatus};
   }
   const at=clock();target.updatedAt=at;next.revision=w.revision+1;next.updatedAt=at;
   next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type:'mind.subscription.recovery',fingerprint,revision:next.revision,createdAt:at,result:clone(result)});
   next.activityEvents.push({id:'event-'+crypto.randomUUID(),eventType:'MIND_SUBSCRIPTION_RECOVERY',resourceType:'mind-subscription',resourceId:s.id,occurredAt:at,actorId:ownerId,payload:{operation,attemptKey:attempt.key,outcome:result.outcome}});
   const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code,errors[0]?.message,400);
   await repository.commit(ownerId,w,next,body.idempotencyKey,{resourceId,token:claim.token,nowMs:Date.parse(clock())});
   await completeClaim(repository.db,{ownerId,resourceId,token:claim.token,nowMs:Date.parse(clock())});finalized=true;
   return {...await mindSubscriptionRecovery(next,{repository,ownerId,subscriptionId:s.id,attemptKey:attempt.key,now:clock()}),result,idempotent:false};
 }finally{if(!finalized)await releaseClaim(repository.db,{ownerId,resourceId,token:claim.token,nowMs:Date.parse(clock()),status:'FAILED'}).catch(()=>{});}
}
