import {normalizeOperationWindow,operationWindowState} from './operation-window.mjs';
import {checkpointMindAttempts,MIND_SUBSCRIPTION_HISTORY_VERSION} from './mind-subscription-history.mjs';
import {hashInputPackage} from './workspace.mjs';
import {assertMindDocument,mindDocumentHash} from './mind-manifest.mjs';
import {validateMindPaperAccount} from './mind-paper.mjs';
import {validatePaperAdaptation} from './paper-adaptation.mjs';
import {AUTOMATIC_COHORT_POLICY_VERSION,automaticCohortPolicyHash,automaticObservationWindow} from './learning-cohort.mjs';

export const MIND_SUBSCRIPTION_VERSION='mind-btc-4h-subscription-v1';
export const MAX_SUBSCRIPTION_ATTEMPTS=128;
export const MAX_ACTIVE_MIND_SUBSCRIPTIONS=4;
export const MIND_SUBSCRIPTION_ACTIONS=Object.freeze(['mind.subscription.create','mind.subscription.enable','mind.subscription.pause','mind.subscription.apply-next']);
const FOUR=14400000,BTC='crypto:okx:BTC-USDT',HASH=/^[a-f0-9]{64}$/,clone=structuredClone;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const closed=value=>stamp(value)&&Date.parse(value)%FOUR===0;
const iso=value=>new Date(value).toISOString();
const future=now=>iso((Math.floor(Date.parse(now)/FOUR)+1)*FOUR);
const safe=(value,depth=0)=>depth<20&&(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=65536&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||Array.isArray(value)&&value.length<=1000&&value.every(v=>safe(v,depth+1))||plain(value)&&Object.keys(value).length<=60&&Object.entries(Object.getOwnPropertyDescriptors(value)).every(([k,d])=>!['__proto__','constructor','prototype'].includes(k)&&Object.hasOwn(d,'value')&&safe(d.value,depth+1)));
const fields=(value,allowed,required=allowed)=>plain(value)&&safe(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k));
export class MindSubscriptionError extends Error{constructor(code,message,status=409){super(message);this.name='MindSubscriptionError';this.code=code;this.status=status;}}
const check=(value,code,message,status)=>{if(!value)throw new MindSubscriptionError(code,message,status);};
function at(now){const value=now??new Date().toISOString();check(stamp(value),'SUBSCRIPTION_TIME','자동 운용의 실제 서버 시각을 확인하세요.',400);return value;}
const pinKeys=['manifestId','manifestHash','manifestVersion','versionRefs','cohortPolicyVersion','cohortPolicyHash'];
function validPins(p,pending=false){return fields(p,pending?[...pinKeys,'applyAtCloseAt']:pinKeys)&&id(p.manifestId)&&HASH.test(p.manifestHash)&&Number.isSafeInteger(p.manifestVersion)&&p.manifestVersion>0&&fields(p.versionRefs,['profileVersionId','strategyVersionId','riskPresetVersionId','memoryVersionId'])&&Object.values(p.versionRefs).every(id)&&p.cohortPolicyVersion===AUTOMATIC_COHORT_POLICY_VERSION&&p.cohortPolicyHash===automaticCohortPolicyHash()&&(!pending||closed(p.applyAtCloseAt));}
function pinsFrom(workspace,manifestId,profileId,now){
  const manifest=workspace.mindManifests?.find(m=>m.id===manifestId);check(manifest,'SUBSCRIPTION_MANIFEST_REQUIRED','발행해 저장한 마인드 정책을 선택하세요.',400);assertMindDocument(manifest);
  check(manifest.kind==='mind-policy'&&manifest.scope.profileId===profileId&&manifest.availableAt<=now&&manifest.asOf<=now&&manifest.data.universe.instrumentIds.includes(BTC),'SUBSCRIPTION_MANIFEST_SCOPE','현재 사용 가능한 BTC 마인드 정책 버전을 확인하세요.',400);
  check(manifest.data.trigger.interval==='4h','SUBSCRIPTION_TIMEFRAME','BTC 4시간봉 정책을 선택하세요.',400);
  const plan=manifest.data.strategyPlan;
  check(plan?.scope?.universe!=='MIND_UNIVERSE','SUBSCRIPTION_PORTFOLIO_SCOPE','BTC 다종목 노드 전략은 실험실에서 비교하세요.',400);
  if(plan?.graph?.schemaVersion===2)check(plan.status==='APPROVED'&&plan.approval?.enabled===true&&plan.approval.approvedAt<=now&&plan.graph.triggers.includes('closed_bar'),'SUBSCRIPTION_GRAPH_TRIGGER','확정 봉 실행을 지원하는 승인 전략을 선택하세요.',400);
  return {manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),manifestVersion:manifest.data.version,versionRefs:clone(manifest.data.versionRefs),cohortPolicyVersion:AUTOMATIC_COHORT_POLICY_VERSION,cohortPolicyHash:automaticCohortPolicyHash()};
}
function accountFor(workspace,profileId,accountId){
  const all=(workspace.mindPositions??[]).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===profileId&&a.quoteCurrency==='USDT');
  check(all.length===1&&all[0].id===accountId&&!validateMindPaperAccount(all[0]).length,'SUBSCRIPTION_ACCOUNT_REQUIRED','이 마인드의 유일한 USDT 모의계좌를 확인하세요.',400);return all[0];
}
export function subscriptionInstrumentIds(manifest){
  if(manifest?.data?.strategyPlan?.scope?.instrumentPolicy!=='UNIVERSE_CURRENT')return [BTC];
  const ids=manifest.data.universe.instrumentIds;
  check(Array.isArray(ids)&&ids.length>0&&ids.length<=4&&ids.every(value=>['crypto:okx:BTC-USDT','crypto:okx:ETH-USDT','crypto:okx:SOL-USDT','crypto:okx:XRP-USDT'].includes(value)),'SUBSCRIPTION_INSTRUMENT_SCOPE','자동 운용 범위를 BTC·ETH·SOL·XRP의 USDT 현물 종목으로 설정하세요.',400);
  return [...ids];
}
function validBatch(value){
  if(value===undefined)return true;
  const keys=['contractVersion','trigger','status','barCloseAt','candidateIds','selected','runIds','allocations','ranking','selectionId','completedAt','rebalanceDue','previousSelectionBar'];
  return fields(value,keys,['contractVersion','trigger','status','barCloseAt','candidateIds','selected','runIds','allocations','ranking'])&&value.contractVersion==='MIND_PORTFOLIO_CYCLE_V1'&&['CLOSED_BAR','MANUAL_START'].includes(value.trigger)&&id(value.status)&&closed(value.barCloseAt)&&['candidateIds','selected','runIds'].every(k=>Array.isArray(value[k])&&value[k].length<=36&&value[k].every(id)&&new Set(value[k]).size===value[k].length)&&Array.isArray(value.allocations)&&value.allocations.length<=36&&value.allocations.every(row=>fields(row,['instrumentId','runId','action','targetWeight','executionStatus','errorCode'],['instrumentId','runId','action','targetWeight','executionStatus'])&&id(row.instrumentId)&&id(row.runId)&&['buy','sell','hold'].includes(row.action)&&Number.isFinite(row.targetWeight)&&row.targetWeight>=0&&row.targetWeight<=1&&id(row.executionStatus)&&(row.errorCode===undefined||id(row.errorCode)))&&Array.isArray(value.ranking)&&value.ranking.length<=12&&value.ranking.every(row=>fields(row,['instrumentId','runId','score','targetWeight','action','policyIndex'])&&id(row.instrumentId)&&id(row.runId)&&Number.isFinite(row.score)&&Number.isFinite(row.targetWeight)&&row.targetWeight>=0&&row.targetWeight<=1&&['buy','sell','hold'].includes(row.action)&&Number.isSafeInteger(row.policyIndex)&&row.policyIndex>=0)&&(value.selectionId===undefined||id(value.selectionId))&&(value.completedAt===undefined||stamp(value.completedAt))&&(value.rebalanceDue===undefined||typeof value.rebalanceDue==='boolean')&&(value.previousSelectionBar===undefined||value.previousSelectionBar===null||closed(value.previousSelectionBar));
}
function validCampaign(value){
  if(value===undefined)return true;
  return fields(value,['contractVersion','status','manifestId','manifestHash','triggerRunId','triggerBarCloseAt','requestedAt','remainingInstrumentIds','completedAt'])&&value.contractVersion==='mind-paper-campaign-v1'&&['EXITING','COMPLETED'].includes(value.status)&&[value.manifestId,value.triggerRunId].every(id)&&HASH.test(value.manifestHash)&&closed(value.triggerBarCloseAt)&&stamp(value.requestedAt)&&Array.isArray(value.remainingInstrumentIds)&&value.remainingInstrumentIds.length<=4&&value.remainingInstrumentIds.every(id)&&new Set(value.remainingInstrumentIds).size===value.remainingInstrumentIds.length&&(value.status==='EXITING'?value.completedAt===null:stamp(value.completedAt)&&value.completedAt>=value.requestedAt&&value.remainingInstrumentIds.length===0);
}
export function activeMindSubscriptionCount(workspace,{ownerId,excludeId}={}){
  return (workspace.mindSubscriptions??[]).filter(s=>s.id!==excludeId&&(!ownerId||s.ownerId===ownerId)&&['ENABLED','ACTION_REQUIRED'].includes(s.status)).length;
}
function validRuntime(runtime){
  if(runtime===undefined)return true;
  const allowed=['stage','attemptKey','barCloseAt','runId','nextAttemptAt','lastMcpDeliveryAt','lastDeliveryAt','deliverySource','lastFailure','lastAttempt','canonicalSnapshotRef','skippedThrough','inputSnapshot','reconciliation','providerFailure','batch','campaign','executionRecovery'];
  return fields(runtime,allowed,['stage'])&&id(runtime.stage)&&validBatch(runtime.batch)&&validCampaign(runtime.campaign)&&(runtime.executionRecovery===undefined||fields(runtime.executionRecovery,['runId','recoveryId','status','requestedAt','completedAt','errorCode'])&&[runtime.executionRecovery.runId,runtime.executionRecovery.recoveryId].every(id)&&['COMPLETED','FAILED'].includes(runtime.executionRecovery.status)&&[runtime.executionRecovery.requestedAt,runtime.executionRecovery.completedAt].every(stamp)&&runtime.executionRecovery.completedAt>=runtime.executionRecovery.requestedAt&&(runtime.executionRecovery.errorCode===null||id(runtime.executionRecovery.errorCode)))&&['attemptKey','runId','canonicalSnapshotRef'].every(k=>runtime[k]===undefined||runtime[k]===null||id(runtime[k]))&&['barCloseAt','skippedThrough'].every(k=>runtime[k]===undefined||runtime[k]===null||closed(runtime[k]))&&['nextAttemptAt','lastMcpDeliveryAt','lastDeliveryAt'].every(k=>runtime[k]===undefined||runtime[k]===null||stamp(runtime[k]))&&(runtime.deliverySource===undefined||['LOCAL_RUNNER','MCP','MANUAL'].includes(runtime.deliverySource))&&(runtime.reconciliation===undefined||plain(runtime.reconciliation))&&new TextEncoder().encode(JSON.stringify(runtime)).length<=200000;
}

export function validateMindSubscription(subscription,workspace,{ownerId}={}){
  try{
    const s=subscription,keys=['schemaVersion','version','id','ownerId','profileId','accountId','instrumentId','timeframe','quoteCurrency','executionMode','status','pins','pendingPins','nextCloseAt','lastCloseAt','budget','attempts','createdAt','updatedAt'];
    check(fields(s,[...keys,'runtime','approval','adaptation','attemptCheckpoint','startsAt','endsAt'],keys)&&validatePaperAdaptation(s.adaptation)&&s.schemaVersion===1&&s.version===MIND_SUBSCRIPTION_VERSION&&[s.id,s.ownerId,s.profileId,s.accountId].every(id)&&(!ownerId||s.ownerId===ownerId)&&s.instrumentId===BTC&&s.timeframe==='4h'&&s.quoteCurrency==='USDT'&&s.executionMode==='paper'&&['PAUSED','ENABLED','ACTION_REQUIRED'].includes(s.status)&&validPins(s.pins)&&(s.pendingPins===null||validPins(s.pendingPins,true))&&[s.createdAt,s.updatedAt].every(stamp)&&s.createdAt<=s.updatedAt&&(s.nextCloseAt===null||closed(s.nextCloseAt))&&(s.lastCloseAt===null||closed(s.lastCloseAt))&&fields(s.budget,['maxPerCandle','maxPerUtcDay'])&&s.budget.maxPerCandle===1&&s.budget.maxPerUtcDay===6&&Array.isArray(s.attempts)&&s.attempts.length<=MAX_SUBSCRIPTION_ATTEMPTS&&validRuntime(s.runtime),'INVALID_MIND_SUBSCRIPTION','마인드 자동 운용의 범위·고정 버전·예산·시각을 확인하세요.',400);
    normalizeOperationWindow(s);if(s.attemptCheckpoint!==undefined){const c=s.attemptCheckpoint;check(fields(c,['contractVersion','count','throughBarCloseAt','tailHash'])&&c.contractVersion===MIND_SUBSCRIPTION_HISTORY_VERSION&&Number.isSafeInteger(c.count)&&c.count>0&&closed(c.throughBarCloseAt)&&HASH.test(c.tailHash)&&s.attempts.every(a=>a.barCloseAt>c.throughBarCloseAt),'INVALID_ATTEMPT_CHECKPOINT','이전 실행 원본의 건수·마지막 봉·해시 연결을 확인하세요.',400);}
    const campaign=s.runtime?.campaign;
    if(campaign){
      check(campaign.manifestId===s.pins.manifestId&&campaign.manifestHash===s.pins.manifestHash&&!(campaign.status==='COMPLETED'&&(s.status!=='PAUSED'||s.nextCloseAt!==null)),'CAMPAIGN_STATE','운용 종료 원정책과 청산 상태를 확인하세요.',400);
      if(workspace){const trigger=workspace.mindRuns?.find(r=>r.id===campaign.triggerRunId),account=workspace.mindPositions?.find(a=>a.id===s.accountId),remaining=account?.positions.filter(p=>p.quantity>0).map(p=>p.instrumentId).sort();check(trigger?.manifestHash===campaign.manifestHash&&trigger.profileId===s.profileId&&trigger.automation?.subscriptionId===s.id&&trigger.automation?.portfolioCycle?.phase==='FINAL'&&trigger.decision?.action==='sell'&&trigger.decision.targetWeight===0&&trigger.decision.intent?.code==='CAMPAIGN_EXIT'&&trigger.automation.barCloseAt===campaign.triggerBarCloseAt&&hashInputPackage(remaining)===hashInputPackage([...campaign.remainingInstrumentIds].sort()),'CAMPAIGN_EVIDENCE','운용 종료 결정과 보유 원장의 잔량을 대조하세요.',400);}
    }
    if(s.approval!==undefined)check(fields(s.approval,['optInPaper','autoExecute','cohortPolicyHash','approvedAt','approvedBy'])&&s.approval.optInPaper===true&&s.approval.autoExecute===true&&s.approval.cohortPolicyHash===automaticCohortPolicyHash()&&stamp(s.approval.approvedAt)&&id(s.approval.approvedBy),'SUBSCRIPTION_APPROVAL','자동 모의 운용의 명시 동의 기록을 확인하세요.',400);
    if(s.status==='ENABLED')check(s.nextCloseAt&&s.approval,'SUBSCRIPTION_APPROVAL','다음 미래 봉과 자동 모의 운용 동의를 확인하세요.',400);
    const seen=new Set();for(const a of s.attempts){
      const keys=['key','barCloseAt','utcDay','status','reservedAt','completedAt','runId','errorCode','pins'];
      check(fields(a,[...keys,'abandonment','requiresJev','jevCalled','providerJournalVersion','providerCallsReserved','providerCallsCompleted'],keys)&&id(a.key)&&!seen.has(a.key)&&closed(a.barCloseAt)&&a.key===mindSubscriptionAttemptKey(s,a.barCloseAt)&&/^\d{4}-\d{2}-\d{2}$/.test(a.utcDay)&&stamp(a.reservedAt)&&a.utcDay===a.reservedAt.slice(0,10)&&['COMPUTING','JEV_STARTED','COMPLETED','FAILED','ACTION_REQUIRED','ABANDONED'].includes(a.status)&&(a.completedAt===null||stamp(a.completedAt)&&a.completedAt>=a.reservedAt)&&(a.runId===null||id(a.runId))&&(a.errorCode===null||id(a.errorCode))&&validPins(a.pins),'INVALID_SUBSCRIPTION_ATTEMPT','봉별 한 번 예약한 호출과 단계·고정 버전을 확인하세요.',400);
      check((a.requiresJev===undefined&&a.jevCalled===undefined&&a.status!=='COMPUTING')||(typeof a.requiresJev==='boolean'&&[true,false,null].includes(a.jevCalled)&&!(a.requiresJev===false&&(a.jevCalled!==false||['JEV_STARTED','ACTION_REQUIRED','ABANDONED'].includes(a.status)))&&!(a.requiresJev===true&&a.status==='COMPUTING')),'INVALID_SUBSCRIPTION_ATTEMPT','로컬 계산과 외부 호출의 단계·실제 호출 여부를 확인하세요.',400);
      if(a.providerJournalVersion!==undefined)check(a.providerJournalVersion==='graph-provider-journal-v1'&&Number.isSafeInteger(a.providerCallsReserved)&&a.providerCallsReserved>=0&&a.providerCallsReserved<=9&&Number.isSafeInteger(a.providerCallsCompleted)&&a.providerCallsCompleted>=0&&a.providerCallsCompleted<=a.providerCallsReserved,'INVALID_PROVIDER_STAGE_BUDGET','질문별 예약·응답 횟수를 확인하세요.',400);
      if(a.status==='ABANDONED')check(fields(a.abandonment,['abandonedAt','abandonedBy','reason','reference','externalOutcome','budgetConsumed'])&&stamp(a.abandonment.abandonedAt)&&a.abandonment.abandonedAt===a.completedAt&&a.abandonment.abandonedBy===s.ownerId&&id(a.abandonment.reference)&&typeof a.abandonment.reason==='string'&&a.abandonment.reason.trim().length>=10&&a.abandonment.reason.length<=2000&&a.abandonment.externalOutcome==='UNKNOWN'&&a.abandonment.budgetConsumed===true&&a.runId===null,'INVALID_ATTEMPT_ABANDONMENT','이번 봉 종결의 소유자·실제 시각·사유·결과 미확정·예산 소모를 확인하세요.',400);
      else check(a.abandonment===undefined,'INVALID_ATTEMPT_ABANDONMENT','종결한 호출의 검토 기록을 해당 상태와 함께 보존하세요.',400);seen.add(a.key);
    }
    check([...new Set(s.attempts.map(a=>a.utcDay))].every(day=>s.attempts.filter(a=>a.utcDay===day).length<=6),'DAILY_JEV_BUDGET','UTC 하루 여섯 번의 결정 실행 상한을 확인하세요.',400);
    if(workspace){accountFor(workspace,s.profileId,s.accountId);check((workspace.mindSubscriptions??[]).filter(v=>v.id!==s.id&&(v.profileId===s.profileId||v.accountId===s.accountId)).length===0,'DUPLICATE_MIND_SUBSCRIPTION','마인드와 계좌에 연결된 자동 운용을 하나로 유지하세요.');for(const p of [s.pins,s.pendingPins,...s.attempts.map(a=>a.pins)].filter(Boolean)){const m=workspace.mindManifests?.find(m=>m.id===p.manifestId);check(m&&mindDocumentHash(m)===p.manifestHash&&m.data.version===p.manifestVersion&&hashInputPackage(m.data.versionRefs)===hashInputPackage(p.versionRefs),'SUBSCRIPTION_PINS_CHANGED','고정한 정책·원칙·위험·기억 버전의 불변 원본을 확인하세요.');}}
    return [];
  }catch(error){return [{code:error.code??'INVALID_MIND_SUBSCRIPTION',message:error.message}];}
}
function assertSubscription(s){const errors=validateMindSubscription(s);check(!errors.length,errors[0]?.code,errors[0]?.message);}
export function createMindSubscription(workspace,input,{ownerId,now}={}){
  now=at(now);check(fields(input,['id','profileId','accountId','manifestId'],['profileId','accountId','manifestId'])&&[input.profileId,input.accountId,input.manifestId,ownerId].every(id)&&(input.id===undefined||id(input.id)),'INVALID_SUBSCRIPTION_INPUT','마인드·모의계좌·발행 정책과 소유자를 확인하세요.',400);
  check(workspace.investmentProfiles?.find(p=>p.id===input.profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','보관함에서 마인드를 복원한 뒤 운용을 설정하세요.',400);
  const instruments=subscriptionInstrumentIds(workspace.mindManifests?.find(m=>m.id===input.manifestId));
  check(accountFor(workspace,input.profileId,input.accountId).positions.every(p=>instruments.includes(p.instrumentId)),'SUBSCRIPTION_ACCOUNT_SCOPE','정책의 투자 범위와 모의계좌의 보유 종목을 확인하세요.',400);check(!(workspace.mindSubscriptions??[]).some(s=>s.profileId===input.profileId||s.accountId===input.accountId||s.id===input.id),'DUPLICATE_MIND_SUBSCRIPTION','이 마인드 또는 계좌에 연결한 자동 운용을 사용하세요.');
  const s={schemaVersion:1,version:MIND_SUBSCRIPTION_VERSION,id:input.id??'mind-subscription-'+crypto.randomUUID(),ownerId,profileId:input.profileId,accountId:input.accountId,instrumentId:BTC,timeframe:'4h',quoteCurrency:'USDT',executionMode:'paper',status:'PAUSED',pins:pinsFrom(workspace,input.manifestId,input.profileId,now),pendingPins:null,nextCloseAt:null,lastCloseAt:null,budget:{maxPerCandle:1,maxPerUtcDay:6},attempts:[],createdAt:now,updatedAt:now};assertSubscription(s);return s;
}
export function mindSubscriptionAttemptKey(subscription,barCloseAt){check([subscription?.id,subscription?.ownerId,subscription?.profileId].every(id)&&closed(barCloseAt),'SUBSCRIPTION_CANDLE_KEY','소유자·논리 운용·확정 봉의 호출 식별자를 확인하세요.',400);return 'mind-auto-'+hashInputPackage({ownerId:subscription.ownerId,subscriptionId:subscription.id,contractVersion:MIND_SUBSCRIPTION_VERSION,instrumentId:BTC,timeframe:'4h',barCloseAt});}
export const subscriptionAttemptKey=mindSubscriptionAttemptKey;
export function dueMindSubscriptions(workspace,{now,ownerId}={}){
  now=at(now);return (workspace.mindSubscriptions??[]).filter(s=>!validateMindSubscription(s,workspace,{ownerId}).length&&s.status==='ENABLED'&&operationWindowState(s,now)==='ACTIVE'&&Date.parse(s.nextCloseAt)+300000<=Date.parse(now)&&(!s.runtime?.nextAttemptAt||s.runtime.nextAttemptAt<=now)).sort((a,b)=>a.nextCloseAt.localeCompare(b.nextCloseAt)||a.id.localeCompare(b.id)).map(s=>clone(s));
}
/** Learned candidates begin with a flat original account; user-authored policy changes keep their existing contract. */
export function effectiveSubscriptionPins(subscription,barCloseAt,{accountFlat=false}={}){
 const pending=subscription.pendingPins,learned=pending&&subscription.adaptation?.forwardTrialRef&&pending.manifestId===subscription.adaptation.pendingManifestId;
 return pending&&barCloseAt>=pending.applyAtCloseAt&&(!learned||accountFlat===true)?pending:subscription.pins;
}
export function reserveMindSubscriptionAttempt(subscription,{barCloseAt,requiresJev}={},{now,manualStart=false,accountFlat=false}={}){
  assertSubscription(subscription);now=at(now);check(now>=subscription.updatedAt,'SUBSCRIPTION_CLOCK_REWIND','최근 자동 운용 상태 이후에 예약하세요.');
  check(requiresJev===undefined||typeof requiresJev==='boolean','INVALID_SUBSCRIPTION_OUTCOME','실행에 필요한 외부 호출 여부를 확인하세요.',400);
  const next=clone(subscription),key=mindSubscriptionAttemptKey(next,barCloseAt),prior=next.attempts.find(a=>a.key===key);
  if(prior){if(prior.status==='JEV_STARTED'){next.status='ACTION_REQUIRED';prior.status='ACTION_REQUIRED';prior.errorCode='JEV_OUTCOME_UNKNOWN';next.updatedAt=now;}else if(prior.status==='COMPUTING'){const stopped=finishMindSubscriptionAttempt(next,{attemptKey:key,outcome:'FAILED',errorCode:'LOCAL_COMPUTATION_INTERRUPTED',jevCalled:false},{now});stopped.subscription.status='PAUSED';return {...stopped,authorized:false,idempotent:true};}return {subscription:next,attempt:clone(prior),authorized:false,idempotent:true};}
  if(next.attemptCheckpoint&&barCloseAt<=next.attemptCheckpoint.throughBarCloseAt)return {subscription:next,attempt:null,authorized:false,idempotent:true,reason:'ATTEMPT_CHECKPOINTED'};
  check(next.status==='ENABLED'&&barCloseAt===next.nextCloseAt,'SUBSCRIPTION_NOT_DUE','활성 자동 운용의 예정 봉을 확인하세요.');
  check(operationWindowState(next,now)==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');const window=automaticObservationWindow({barCloseAt,executionAt:now}),currentClosed=iso(Math.floor(Date.parse(now)/FOUR)*FOUR);check(manualStart===true?barCloseAt===currentClosed:window.withinExecutionWindow,'SUBSCRIPTION_EXECUTION_WINDOW',manualStart?'현재 확정 봉으로 첫 운용을 실행하세요.':'기준 봉 마감+5~+10분에 한 번 호출하세요.');
  if(next.attempts.filter(a=>a.utcDay===now.slice(0,10)).length>=next.budget.maxPerUtcDay){next.status='ACTION_REQUIRED';next.updatedAt=now;return {subscription:next,attempt:null,authorized:false,idempotent:false,reason:'DAILY_JEV_BUDGET'};}
  if(next.attempts.length>=MAX_SUBSCRIPTION_ATTEMPTS){
    const removable=[];for(const a of next.attempts.slice(0,MAX_SUBSCRIPTION_ATTEMPTS/2)){if(!['COMPLETED','FAILED','ABANDONED'].includes(a.status)||a.utcDay>=now.slice(0,10))break;removable.push(a);}
    check(removable.length>0,'ATTEMPT_HISTORY_PENDING','미확정 실행을 검토한 뒤 운용을 재개하세요.');next.attemptCheckpoint=checkpointMindAttempts(next,removable).checkpoint;next.attempts=next.attempts.slice(removable.length);
  }
  if(next.pendingPins&&effectiveSubscriptionPins(next,barCloseAt,{accountFlat})===next.pendingPins){const {applyAtCloseAt,...pins}=next.pendingPins;next.pins=pins;next.pendingPins=null;}
  const attempt={key,barCloseAt,utcDay:now.slice(0,10),status:requiresJev===false?'COMPUTING':'JEV_STARTED',reservedAt:now,completedAt:null,runId:null,errorCode:null,pins:clone(next.pins),...(requiresJev===undefined?{}:{requiresJev,jevCalled:requiresJev?null:false})};
  next.attempts.push(attempt);next.updatedAt=now;assertSubscription(next);return {subscription:next,attempt:clone(attempt),authorized:true,idempotent:false};
}
export function finishMindSubscriptionAttempt(subscription,{attemptKey,outcome,runId=null,errorCode=null,jevCalled}={},{now}={}){
  assertSubscription(subscription);now=at(now);check(id(attemptKey)&&['COMPLETED','FAILED','UNKNOWN'].includes(outcome)&&(runId===null||id(runId))&&(errorCode===null||id(errorCode))&&now>=subscription.updatedAt,'INVALID_SUBSCRIPTION_OUTCOME','호출 결과·실제 결정 참조와 완료 시각을 확인하세요.',400);
  const next=clone(subscription),attempt=next.attempts.find(a=>a.key===attemptKey);check(attempt,'SUBSCRIPTION_ATTEMPT_REQUIRED','미리 저장한 JEV 호출 예약을 확인하세요.');
  if(['COMPLETED','FAILED','ABANDONED'].includes(attempt.status))return {subscription:next,attempt:clone(attempt),idempotent:true};
  check((jevCalled===undefined||typeof jevCalled==='boolean')&&!(attempt.requiresJev===false&&(jevCalled===true||outcome==='UNKNOWN')),'INVALID_SUBSCRIPTION_OUTCOME','로컬 계산과 외부 호출의 실제 결과를 구분하세요.',400);
  if(attempt.requiresJev!==undefined&&jevCalled!==undefined)attempt.jevCalled=jevCalled;
  check(now>=attempt.reservedAt,'SUBSCRIPTION_CLOCK_REWIND','호출 예약 이후의 실제 완료 시각을 확인하세요.');attempt.status=outcome==='UNKNOWN'?'ACTION_REQUIRED':outcome;attempt.completedAt=now;attempt.runId=runId;attempt.errorCode=outcome==='UNKNOWN'?'JEV_OUTCOME_UNKNOWN':errorCode;
  if(outcome==='UNKNOWN')next.status='ACTION_REQUIRED';else{next.lastCloseAt=attempt.barCloseAt;next.nextCloseAt=iso(Math.max(Date.parse(attempt.barCloseAt)+FOUR,Date.parse(future(now))));}
  next.updatedAt=now;assertSubscription(next);return {subscription:next,attempt:clone(attempt),idempotent:false};
}

/** Server reconciliation supplies the lease/fence and immutable-account checks. */
export function abandonMindSubscriptionAttempt(subscription,input,{now,ownerId}={}){
  assertSubscription(subscription);now=at(now);
  check(fields(input,['attemptKey','reasonCode','reason','ackUnknown','ackBudget'])&&id(input.attemptKey)&&id(input.reasonCode)&&typeof input.reason==='string'&&input.reason.trim().length>=10&&input.reason.length<=2000&&input.ackUnknown===true&&input.ackBudget===true&&ownerId===subscription.ownerId,'SUBSCRIPTION_ABANDONMENT_REVIEW','소유자·종결 사유와 결과 미확정·예산 소모 확인을 입력하세요.',400);
  check(now>=subscription.updatedAt,'SUBSCRIPTION_CLOCK_REWIND','최근 실행 기록 이후에 이번 봉 종결을 검토하세요.');
  const next=clone(subscription),attempt=next.attempts.find(a=>a.key===input.attemptKey);check(attempt,'SUBSCRIPTION_ATTEMPT_REQUIRED','종결할 저장 호출을 선택하세요.');
  if(attempt.status==='ABANDONED')return {subscription:next,attempt:clone(attempt),idempotent:true};
  check(attempt.requiresJev!==false&&['JEV_STARTED','ACTION_REQUIRED'].includes(attempt.status)&&attempt.runId===null,'SUBSCRIPTION_RECOVERY_REQUIRED','저장된 결정과 영수증을 복구하거나 미확정 호출을 검토하세요.');
  attempt.status='ABANDONED';attempt.completedAt=now;attempt.abandonment={abandonedAt:now,abandonedBy:ownerId,reason:input.reason.trim(),reference:input.reasonCode,externalOutcome:'UNKNOWN',budgetConsumed:true};
  next.status='PAUSED';next.nextCloseAt=future(now);next.updatedAt=now;assertSubscription(next);return {subscription:next,attempt:clone(attempt),idempotent:false};
}
export function applySubscriptionCommand(workspace,command,{ownerId,now}={}){
  now=at(now);check(fields(command,['type','payload','idempotencyKey','expectedRevision'])&&MIND_SUBSCRIPTION_ACTIONS.includes(command.type)&&id(command.idempotencyKey)&&Number.isSafeInteger(command.expectedRevision)&&id(ownerId),'INVALID_SUBSCRIPTION_COMMAND','자동 운용 작업·요청 키·저장 버전을 확인하세요.',400);
  const fingerprint=hashInputPackage({type:command.type,payload:command.payload,ownerId}),saved=workspace.commandReceipts?.find(r=>r.key===command.idempotencyKey);
  if(saved){check(saved.type==='mind.subscription.command'&&saved.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 자동 운용 요청 키의 조건이 변경되었습니다.');return {workspace,result:clone(saved.result),idempotent:true};}
  check(workspace.revision===command.expectedRevision&&now>=workspace.updatedAt,'REVISION_CONFLICT','최신 자동 운용 상태를 다시 조회하세요.');const next=clone(workspace);next.mindSubscriptions??=[];let result;const p=command.payload;
  if(command.type==='mind.subscription.create'){result=createMindSubscription(workspace,p,{ownerId,now});next.mindSubscriptions.push(result);}
  else{
    const allowed=command.type==='mind.subscription.enable'?['subscriptionId','optInPaper','autoExecute','cohortPolicyHash','startsAt','endsAt']:command.type==='mind.subscription.apply-next'?['subscriptionId','manifestId']:['subscriptionId'];check(fields(p,allowed,allowed.filter(k=>!['startsAt','endsAt'].includes(k)))&&id(p.subscriptionId),'INVALID_SUBSCRIPTION_INPUT','자동 운용과 해당 작업의 입력을 확인하세요.',400);
    result=next.mindSubscriptions.find(s=>s.id===p.subscriptionId&&s.ownerId===ownerId);check(result,'SUBSCRIPTION_NOT_FOUND','사용자 소유 자동 운용을 선택하세요.',404);assertSubscription(result);
    if(command.type==='mind.subscription.pause'){result.status='PAUSED';}
    else if(command.type==='mind.subscription.enable'){
      check(p.optInPaper===true&&p.autoExecute===true&&p.cohortPolicyHash===automaticCohortPolicyHash(),'PAPER_AUTOMATION_OPT_IN','고정 코호트와 자동 모의 실행에 명시 동의하세요.',400);
      check(result.runtime?.campaign?.status!=='COMPLETED','CAMPAIGN_COMPLETED','종료한 운용입니다. 새 마인드를 복제해 새로운 운용을 시작하세요.');
      const instruments=subscriptionInstrumentIds(workspace.mindManifests.find(m=>m.id===result.pins.manifestId));check(accountFor(workspace,result.profileId,result.accountId).positions.every(p=>instruments.includes(p.instrumentId)),'SUBSCRIPTION_ACCOUNT_SCOPE','정책의 투자 범위와 모의계좌의 보유 종목을 확인하세요.',400);
      check(!result.attempts.some(a=>['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(a.status))&&result.status!=='ACTION_REQUIRED','SUBSCRIPTION_ACTION_REQUIRED','응답이 불명확한 이전 호출을 대조한 뒤 재개하세요.');
      check(result.status==='PAUSED','SUBSCRIPTION_ALREADY_ENABLED','이미 시작한 자동 운용의 현재 예정 봉을 유지하세요.');
      check(next.investmentProfiles.find(p=>p.id===result.profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','보관함에서 마인드를 복원한 뒤 운용을 시작하세요.');
      check(activeMindSubscriptionCount(next,{ownerId,excludeId:result.id})<MAX_ACTIVE_MIND_SUBSCRIPTIONS,'OWNER_AUTOMATION_CAPACITY',`자동운용은 최대 ${MAX_ACTIVE_MIND_SUBSCRIPTIONS}개 마인드까지 가능합니다. 운용 중인 마인드 하나를 일시중지하세요.`);
      const window=normalizeOperationWindow(p,{now});delete result.startsAt;delete result.endsAt;Object.assign(result,window);result.status='ENABLED';result.nextCloseAt=future(window.startsAt&&window.startsAt>now?window.startsAt:now);result.approval={optInPaper:true,autoExecute:true,cohortPolicyHash:p.cohortPolicyHash,approvedAt:now,approvedBy:ownerId};
    }else{check(!result.runtime?.campaign,'CAMPAIGN_POLICY_LOCKED','종료 중이거나 완료한 운용의 정책을 보존하세요. 새 정책은 복제한 마인드에서 시작하세요.');const pins=pinsFrom(workspace,p.manifestId,result.profileId,now);result.pendingPins={...pins,applyAtCloseAt:future(now)};}
    result.updatedAt=now;const errors=validateMindSubscription(result,next,{ownerId});check(!errors.length,errors[0]?.code,errors[0]?.message);
  }
  next.revision++;next.updatedAt=now;next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:command.idempotencyKey,type:'mind.subscription.command',fingerprint,revision:next.revision,createdAt:now,result:clone(result)});next.activityEvents.push({id:'event-'+crypto.randomUUID(),eventType:'MIND_SUBSCRIPTION_CHANGED',resourceType:'mind-subscription',resourceId:result.id,occurredAt:now,actorId:ownerId,payload:{action:command.type}});return {workspace:next,result:clone(result),idempotent:false};
}

/** Evaluation reservations and provider outcomes have separate counters. Legacy pending calls remain unknown. */
export function mindSubscriptionBudgetUsage(subscription,{utcDay}={}){
  const rows=subscription.attempts.filter(a=>a.utcDay===utcDay),paid=rows.filter(a=>a.requiresJev!==false);
  return {utcDay,evaluationsStarted:rows.length,quantComputationsStarted:rows.filter(a=>a.requiresJev===false).length,jevCallsReserved:paid.reduce((n,a)=>n+(a.providerCallsReserved??1),0),jevCallsCompleted:paid.reduce((n,a)=>n+(a.providerCallsCompleted??(a.jevCalled===true||(a.requiresJev===undefined&&a.runId!==null)?1:0)),0),jevCallsUnknown:paid.reduce((n,a)=>n+(a.providerCallsReserved!==undefined?a.providerCallsReserved-a.providerCallsCompleted:a.jevCalled!==true&&a.runId===null?1:0),0)};
}
