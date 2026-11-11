import {observeMindRun} from './mind-observation.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {validateMindSubscription} from '../dist/domain/mind-subscriptions.mjs';
import {acquireClaim,assertClaim,completeClaim,releaseClaim} from './claims.mjs';
import {executeMindRun} from './mind-execution-service.mjs';

const FOUR=14400000,clone=structuredClone,QUOTE_ERRORS=new Set(['EXECUTION_QUOTE_UNAVAILABLE','EXECUTION_QUOTE_PENDING']);
const check=(v,code,message,status=409)=>{if(!v)throw new RepositoryError(code,message,status);};
const financialState=a=>a?{id:a.id,profileId:a.profileId,quoteCurrency:a.quoteCurrency,initialCash:a.initialCash,cash:a.cash,costPolicy:a.costPolicy,ledger:a.ledger,receipts:a.receipts,fundingLedger:a.fundingLedger??[],positions:a.positions.map(p=>({instrumentId:p.instrumentId,quantity:p.quantity,costBasis:p.costBasis}))}:null;
const financialHash=a=>hashInputPackage(financialState(a));

/** Recovery consumes a stored final decision; no selection or provider decision is recalculated. */
export function executionRetryState(workspace,subscription,run,{now}={}){
 const batch=subscription?.runtime?.batch,account=workspace.mindPositions.find(a=>a.id===subscription?.accountId),manifest=workspace.mindManifests.find(m=>m.id===run?.manifestId),completed=account?.receipts?.find(r=>r.runId===run?.id),expiry=Math.min(Date.parse(run?.createdAt)+600000,Date.parse(run?.asOf)+FOUR,...(run?.validUntil?[Date.parse(run.validUntil)]:[]));
 const reject=(code,message)=>({subscriptionId:subscription?.id,runId:run?.id,executionStatus:run?.execution?.status??null,errorCode:run?.execution?.errorCode??null,message,retryable:false,blockedReason:code,expiresAt:Number.isFinite(expiry)?new Date(expiry).toISOString():null});
 if(!subscription||!run||run.profileId!==subscription.profileId||run.automation?.subscriptionId!==subscription.id||run.automation?.portfolioCycle?.phase!=='FINAL')return reject('EXECUTION_RETRY_SCOPE','이 운용의 최종 결정을 선택하세요.');
 if(completed)return {...reject('ALREADY_EXECUTED','저장된 체결 결과를 확인하세요.'),idempotent:true};
 if(subscription.status!=='ENABLED')return reject('SUBSCRIPTION_PAUSED','운용을 시작한 뒤 저장된 체결을 재시도하세요.');
 if(batch?.barCloseAt!==run.asOf||!batch.allocations.some(a=>a.runId===run.id)||!subscription.attempts.some(a=>a.key===run.automation.attemptKey&&a.status==='COMPLETED'&&a.barCloseAt===batch.barCloseAt))return reject('EXECUTION_RETRY_LATEST','가장 최근 운용 주기의 미체결 결정을 선택하세요.');
 if(run.execution?.status!=='AUTO_EXECUTION_DECLINED'||!QUOTE_ERRORS.has(run.execution.errorCode))return reject('EXECUTION_RETRY_REASON','실행 시세를 기다리는 결정만 재시도할 수 있습니다.');
 if(!Number.isFinite(expiry)||Date.parse(now)>=expiry||Date.parse(now)<Date.parse(run.decisionCompletedAt??run.decisionAt)||Math.floor(Date.parse(now)/FOUR)*FOUR!==Date.parse(run.asOf))return reject('DECISION_EXPIRED','결정 유효시간이 지났습니다. 다음 확정 봉에서 새로 평가합니다.');
 if(!manifest||run.manifestId!==subscription.pins.manifestId||run.manifestHash!==subscription.pins.manifestHash||run.manifestHash!==mindDocumentHash(manifest))return reject('MANIFEST_CHANGED','결정에 고정된 원정책을 확인하세요.');
 if(!account||financialHash(account)!==financialHash(run.accountSnapshot))return reject('ACCOUNT_CHANGED','결정 이후 계좌가 바뀌었습니다. 다음 확정 봉에서 최신 잔고로 평가합니다.');
 if(subscription.runtime?.campaign&&!(run.decision.action==='sell'&&run.decision.targetWeight===0&&run.decision.intent?.code==='CAMPAIGN_EXIT'))return reject('CAMPAIGN_EXIT_REQUIRED','운용 종료 요청에 해당하는 청산 결정을 선택하세요.');
 if((run.executionRecoveries??[]).length>=20)return reject('EXECUTION_RECOVERY_LIMIT','이 결정의 복구 기록 한도에 도달했습니다. 다음 확정 봉을 기다립니다.');
 return {...reject(null,run.execution.reason??'새 실행 시세를 받아 저장된 결정을 체결합니다.'),retryable:true};
}

export function executionRetries(workspace,subscription,{now}={}){
 return (subscription.runtime?.batch?.allocations??[]).flatMap(row=>{const run=workspace.mindRuns.find(r=>r.id===row.runId);return run?.execution?.status==='AUTO_EXECUTION_DECLINED'&&QUOTE_ERRORS.has(run.execution.errorCode)?[executionRetryState(workspace,subscription,run,{now})]:[];});
}

export async function retryMindExecution({env,ownerId,repository,body,fingerprint,options={}}={}){
 const clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString(),startedAt=clock();
 let w=await readOperationalWorkspace(repository,ownerId),sub=w?.mindSubscriptions.find(s=>s.id===body.subscriptionId&&s.ownerId===ownerId),run=w?.mindRuns.find(r=>r.id===body.runId);
 check(sub&&run&&run.profileId===sub.profileId,'EXECUTION_RETRY_SCOPE','사용자 소유 운용과 결정을 선택하세요.',404);check(w.revision===body.expectedRevision,'REVISION_CONFLICT','최신 운용 상태를 조회한 뒤 실행하세요.');
 const state=executionRetryState(w,sub,run,{now:startedAt});check(state.retryable||state.idempotent,state.blockedReason,state.message);
 const resourceId='mind-execution:'+sub.profileId,claim=await acquireClaim(repository.db,{ownerId,resourceId,key:'execution-retry:'+body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(startedAt),leaseMs:120000}),fence=()=>({resourceId,token:claim.token,nowMs:Date.parse(clock())});let success=false;
 try{
  const current=await readOperationalWorkspace(repository,ownerId);check(current.revision===w.revision,'REVISION_CONFLICT','다른 작업이 운용 상태를 갱신했습니다. 최신 상태를 조회하세요.');
  const next=clone(w),saved=next.mindRuns.find(r=>r.id===run.id),target=next.mindSubscriptions.find(s=>s.id===sub.id),manifest=w.mindManifests.find(m=>m.id===run.manifestId);let errorCode=null;
  if(!state.idempotent){
   const recovery={id:'execution-recovery-'+crypto.randomUUID(),contractVersion:'mind-execution-recovery-v1',requestedAt:startedAt,requestedBy:ownerId,attemptKey:run.automation.attemptKey,decisionHash:hashInputPackage({decision:run.decision,risk:run.risk,manifestHash:run.manifestHash}),accountBeforeHash:financialHash(w.mindPositions.find(a=>a.id===sub.accountId)),priorExecution:clone(run.execution)};
   try{await executeMindRun({workspace:w,next,run,manifest,fetchImpl:options.fetchImpl??fetch,clock,executionDeadline:state.expiresAt});const scheduled=observeMindRun({run:saved,manifest,now:clock(),horizonHours:8});saved.observationState=scheduled.status;saved.observationDueAt=scheduled.dueAt;}
   catch(error){errorCode=/^[A-Z0-9_]{1,100}$/.test(error.code??'')?error.code:'EXECUTION_RETRY_FAILED';saved.execution={...clone(run.execution),status:'AUTO_EXECUTION_DECLINED',errorCode,reason:error.message,at:clock()};}
   Object.assign(recovery,{completedAt:clock(),status:errorCode?'FAILED':'COMPLETED',executionStatus:saved.execution.status,errorCode,accountAfterHash:financialHash(next.mindPositions.find(a=>a.id===sub.accountId))});saved.executionRecoveries=[...(saved.executionRecoveries??[]),recovery];
   const allocation=target.runtime.batch.allocations.find(a=>a.runId===run.id);allocation.executionStatus=saved.execution.status;if(errorCode)allocation.errorCode=errorCode;else delete allocation.errorCode;
   target.runtime.executionRecovery={runId:run.id,recoveryId:recovery.id,status:recovery.status,requestedAt:startedAt,completedAt:recovery.completedAt,errorCode};target.runtime.stage=errorCode?'EXECUTION_RETRY_REQUIRED':'OBSERVATION_SCHEDULED';
   if(target.runtime.campaign){const campaign=target.runtime.campaign;campaign.remainingInstrumentIds=next.mindPositions.find(a=>a.id===sub.accountId).positions.filter(p=>p.quantity>0).map(p=>p.instrumentId);if(!campaign.remainingInstrumentIds.length){campaign.status='COMPLETED';campaign.completedAt=clock();target.status='PAUSED';target.nextCloseAt=null;target.runtime.stage='CAMPAIGN_COMPLETED';}}
   target.updatedAt=clock();
  }
  const result={subscriptionId:sub.id,runId:run.id,status:saved.execution.status,execution:clone(saved.execution),idempotent:state.idempotent===true};
  next.revision=w.revision+1;next.updatedAt=clock();next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type:'mind.studio',fingerprint,studioFingerprint:fingerprint,revision:next.revision,createdAt:clock(),result:{result}});
  const errors=[...validateWorkspace(next),...validateMindSubscription(target,next,{ownerId})];check(!errors.length,errors[0]?.code,errors[0]?.message,400);await assertClaim(repository.db,{ownerId,...fence()});await repository.commit(ownerId,w,next,body.idempotencyKey,fence());success=true;return {result,workspace:next};
 }finally{await (success?completeClaim(repository.db,{ownerId,...fence()}):releaseClaim(repository.db,{ownerId,...fence(),status:'FAILED'})).catch(()=>{});}
}
