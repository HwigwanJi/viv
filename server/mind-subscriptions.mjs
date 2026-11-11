import {normalizeOperationWindow,operationWindowState} from '../dist/domain/operation-window.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {effectiveSubscriptionPins,applySubscriptionCommand,dueMindSubscriptions,reserveMindSubscriptionAttempt,finishMindSubscriptionAttempt,validateMindSubscription,mindSubscriptionAttemptKey,createMindSubscription,mindSubscriptionBudgetUsage,MAX_ACTIVE_MIND_SUBSCRIPTIONS,activeMindSubscriptionCount,subscriptionInstrumentIds} from '../dist/domain/mind-subscriptions.mjs';
import {paperBudgetSummary} from '../dist/domain/paper-budget.mjs';
import {BTC_4H_AUTO_COHORT_POLICY,AUTOMATIC_COHORT_POLICY_VERSION,automaticCohortPolicyHash} from '../dist/domain/learning-cohort.mjs';
import {acquireClaim,assertClaim,completeClaim,releaseClaim} from './claims.mjs';
import {createOwnerMarketResolver} from './canonical-instrument-market.mjs';
import {prepareMindEvaluation,evaluatePreparedMind,executeMindRun} from './mind-execution-service.mjs';
import {graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {buildMindJevRequest,projectCanonicalVibeRequest} from './mind-engine.mjs';
import {captureMindProviderFailure} from './mind-provider-failure.mjs';
import {createGraphProviderJournal,graphProviderCallUsage,GRAPH_PROVIDER_JOURNAL_VERSION,GRAPH_PROVIDER_LIMITS} from './graph-provider-journal.mjs';
import {executionRetries} from './mind-execution-retry.mjs';
import {runMindPortfolioCycle} from './mind-portfolio-cycle.mjs';

export const MIND_MCP_DELIVERY=Symbol('authenticated-mcp-scheduler-delivery');
export const MIND_LOCAL_DELIVERY=Symbol('local-canonical-paper-delivery');
export const MIND_OBSERVATION_FENCE=Symbol('owner-automatic-observation-fence');
const BTC='crypto:okx:BTC-USDT',FOUR=14400000,clone=structuredClone;
const OFFSET_MIN=BTC_4H_AUTO_COHORT_POLICY.observation.executionOffsetMinMs,OFFSET_MAX=BTC_4H_AUTO_COHORT_POLICY.observation.executionOffsetMaxMs;
const check=(yes,code,message,status=409)=>{if(!yes)throw new RepositoryError(code,message,status);};
const stamp=ms=>new Date(ms).toISOString(),nextBar=now=>stamp((Math.floor(Date.parse(now)/FOUR)+1)*FOUR);
const budgetPolicy={id:'MIND_AUTO_BUDGET_V1',version:1,maxPerCandle:1,maxPerUtcDay:6};
const policyView=m=>m?{id:m.id,manifestId:m.id,manifestHash:mindDocumentHash(m),manifestVersion:m.data.version,versionRefs:clone(m.data.versionRefs),name:m.data.name,availableAt:m.availableAt}:null;
function enableReasons(s,w){
  const errors=validateMindSubscription(s,w,{ownerId:s.ownerId}),account=w.mindPositions.find(a=>a.id===s.accountId),manifest=w.mindManifests.find(m=>m.id===s.pins.manifestId);
  let instruments=[BTC];try{instruments=subscriptionInstrumentIds(manifest);}catch(error){errors.push({code:error.code,message:error.message});}
  if(account?.positions.some(p=>!instruments.includes(p.instrumentId)&&p.quantity>0))errors.push({code:'SUBSCRIPTION_ACCOUNT_SCOPE',message:'정책의 종목 범위에 맞는 USDT 모의계좌를 연결하세요.'});
  if(!manifest||manifest.availableAt>w.updatedAt)errors.push({code:'MANIFEST_NOT_AVAILABLE',message:'사용 가능한 승인 정책을 확인하세요.'});
  if(s.status==='ACTION_REQUIRED'||s.attempts.some(a=>['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(a.status)))errors.push({code:'SUBSCRIPTION_ACTION_REQUIRED',message:'미확정 호출과 실패 기록을 검토한 뒤 다음 운용을 결정하세요.'});
  if(s.runtime?.campaign?.status==='COMPLETED')errors.push({code:'CAMPAIGN_COMPLETED',message:'종료한 운용입니다. 새 마인드를 복제해 새로운 운용을 시작하세요.'});
  if(s.status==='ENABLED')errors.push({code:'SUBSCRIPTION_ALREADY_ENABLED',message:'이미 활성화한 자동운용의 다음 예정 봉을 유지합니다.'});
  if(w.investmentProfiles.find(p=>p.id===s.profileId)?.status==='ARCHIVED')errors.push({code:'MIND_ARCHIVED',message:'보관함에서 마인드를 복원한 뒤 운용을 시작하세요.'});
  if(activeMindSubscriptionCount(w,{ownerId:s.ownerId,excludeId:s.id})>=MAX_ACTIVE_MIND_SUBSCRIPTIONS)errors.push({code:'OWNER_AUTOMATION_CAPACITY',message:`자동운용은 최대 ${MAX_ACTIVE_MIND_SUBSCRIPTIONS}개 마인드까지 가능합니다. 운용 중인 마인드 하나를 일시중지하세요.`});
  return errors;
}
export function mindProfileProviderBudgetUsage(w,subscription,{utcDay}){
  const current=mindSubscriptionBudgetUsage(subscription,{utcDay}),calls=graphProviderCallUsage(w,{profileId:subscription.profileId,utcDay});
  const old=mindSubscriptionBudgetUsage({attempts:(w.mindSubscriptions??[]).filter(s=>s.profileId===subscription.profileId).flatMap(s=>s.attempts??[]).filter(a=>a.providerJournalVersion===undefined)},{utcDay});
  return {...current,jevCallsReserved:calls.reserved+old.jevCallsReserved,jevCallsCompleted:calls.completed+old.jevCallsCompleted,jevCallsUnknown:calls.unknown+old.jevCallsUnknown};
}
export function mindSubscriptionCatalog(w,{ownerId,now,mindId='all',manifests=w.mindManifests??[]}={}){
  check(mindId==='all'||w.investmentProfiles.some(p=>p.id===mindId),'MIND_NOT_FOUND','마인드를 선택하세요.',404);
  const current=manifests.filter(m=>(mindId==='all'||m.scope.profileId===mindId)&&m.availableAt<=now).sort((a,b)=>a.availableAt.localeCompare(b.availableAt)||a.data.version-b.data.version).at(-1);
  const subscriptions=(w.mindSubscriptions??[]).filter(s=>s.ownerId===ownerId&&(mindId==='all'||s.profileId===mindId)).map(s=>{
    const runtime=clone(s.runtime??{}),published=manifests.filter(m=>m.scope.profileId===s.profileId&&m.availableAt<=now).sort((a,b)=>a.data.version-b.data.version).at(-1),pending=published&&mindDocumentHash(published)!==s.pins.manifestHash?policyView(published):null,reasons=enableReasons(s,w),latest=s.attempts.at(-1);
    if(latest&&(latest.status==='ABANDONED'||!runtime.lastAttempt))runtime.lastAttempt={stage:latest.status,completedAt:latest.completedAt,barCloseAt:latest.barCloseAt,decisionId:latest.runId};
    if(s.status==='ENABLED'&&runtime.stage==='ABANDONED')runtime.stage='WAITING_BAR';
    return {hasAttempts:s.attempts.length>0,id:s.id,profileId:s.profileId,name:published?.data.name??s.profileId,instrumentId:s.instrumentId,timeframe:s.timeframe,...normalizeOperationWindow(s),operationWindowState:operationWindowState(s,now),accountId:s.accountId,quoteCurrency:s.quoteCurrency,status:s.status==='ENABLED'?(runtime.stage??'WAITING_BAR'):s.status,enabled:s.status==='ENABLED',manifestId:s.pins.manifestId,manifestHash:s.pins.manifestHash,manifestVersion:s.pins.manifestVersion,versionRefs:clone(s.pins.versionRefs),cohortPolicyId:s.pins.cohortPolicyVersion,cohortPolicyHash:s.pins.cohortPolicyHash,evaluationBudgetId:budgetPolicy.id,evaluationBudgetVersion:1,budget:clone(s.budget),budgetUsage:mindProfileProviderBudgetUsage(w,s,{utcDay:now.slice(0,10)}),instrumentIds:subscriptionInstrumentIds(manifests.find(m=>m.id===s.pins.manifestId)),portfolioCycle:clone(runtime.batch??null),executionRetries:executionRetries(w,s,{now}),executionRecovery:clone(runtime.executionRecovery??null),campaign:clone(runtime.campaign??null),requiresJev:(()=>{const graph=manifests.find(m=>m.id===s.pins.manifestId)?.data.strategyPlan?.graph;return graph?.schemaVersion===2?graphRequiresJev(graph):true;})(),nextBarCloseAt:s.nextCloseAt,nextCloudRunAt:null,triggerConnection:'DELIVERY_VERIFICATION_REQUIRED',nextAttemptAt:runtime.nextAttemptAt??null,nextEligibleAt:runtime.nextAttemptAt??(s.nextCloseAt?stamp(Date.parse(s.nextCloseAt)+300000):null),lastMcpDeliveryAt:runtime.lastMcpDeliveryAt??null,lastDeliveryAt:runtime.lastDeliveryAt??runtime.lastMcpDeliveryAt??null,deliverySource:runtime.deliverySource??(runtime.lastMcpDeliveryAt?'MCP':null),lastCompletedBarCloseAt:s.lastCloseAt,lastAttempt:clone(runtime.lastAttempt??null),lastFailure:clone(runtime.lastFailure??null),pendingVersionChange:pending?{...pending,appliesTo:'NEXT_UNSTARTED_BAR'}:null,pendingPins:clone(s.pendingPins),canEnable:s.status==='PAUSED'&&!reasons.length,enableBlockedReasons:reasons};
  });
  const eligibleAccounts=w.mindPositions.filter(a=>a.kind==='PAPER_ACCOUNT'&&a.quoteCurrency==='USDT'&&(mindId==='all'||a.profileId===mindId)).map(a=>({id:a.id,profileId:a.profileId,quoteCurrency:a.quoteCurrency,initialCash:a.initialCash,asOf:a.asOf}));
  const createBlockedReasons=[];
  if(mindId==='all'||!current)createBlockedReasons.push({code:'MIND_REQUIRED',message:'자동운용할 마인드를 선택하세요.'});
  else if(!eligibleAccounts.length)createBlockedReasons.push({code:'PAPER_ACCOUNT_REQUIRED',message:'USDT 모의계좌를 연결하세요.'});
  else try{createMindSubscription({...w,mindManifests:manifests},{profileId:mindId,accountId:eligibleAccounts[0].id,manifestId:current.id},{ownerId,now});}catch(error){createBlockedReasons.push({code:safeCode(error),message:error.message});}
  return {ok:true,revision:w.revision,asOf:now,capacity:MAX_ACTIVE_MIND_SUBSCRIPTIONS,activeCount:activeMindSubscriptionCount(w,{ownerId}),subscriptions,eligibleAccounts,canCreate:!createBlockedReasons.length,createBlockedReasons,currentPublishedPolicy:policyView(current),currentManifest:policyView(current),cohortPolicies:[{id:AUTOMATIC_COHORT_POLICY_VERSION,hash:automaticCohortPolicyHash(),policy:clone(BTC_4H_AUTO_COHORT_POLICY)}],budgetPolicies:[budgetPolicy],providerCallLimits:GRAPH_PROVIDER_LIMITS};
}
export function dispatchMindSubscription(w,body,operation,{ownerId,now}={}){
  const fields={create:['mindId','accountId','manifestId'],enable:['subscriptionId','optInPaper','autoExecute','cohortPolicyHash','startsAt','endsAt'],pause:['subscriptionId'],'apply-version':['subscriptionId','manifestId']}[operation];
  check(fields&&Object.keys(body).every(k=>[...fields,'expectedRevision','idempotencyKey'].includes(k)),'INVALID_SUBSCRIPTION_COMMAND','자동운용 요청 항목을 확인하세요.',400);
  const payload=operation==='create'?{profileId:body.mindId,accountId:body.accountId,manifestId:body.manifestId}:Object.fromEntries(fields.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]));
  if(operation==='enable'){const s=w.mindSubscriptions.find(s=>s.id===body.subscriptionId&&s.ownerId===ownerId);check(s,'SUBSCRIPTION_NOT_FOUND','자동운용을 선택하세요.',404);const errors=enableReasons(s,w);check(!errors.length,errors[0]?.code,errors[0]?.message);}
  return applySubscriptionCommand(w,{type:'mind.subscription.'+(operation==='apply-version'?'apply-next':operation),payload,idempotencyKey:body.idempotencyKey,expectedRevision:body.expectedRevision},{ownerId,now});
}
async function save(repository,owner,base,next,key,now,fence){
  next.revision=base.revision+1;next.updatedAt=now;const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code,errors[0]?.message,400);
  await repository.commit(owner,base,next,key,fence);return next;
}
function runtime(s,values,now){s.runtime={...s.runtime,...values};s.updatedAt=now;return s;}
function failure(code,message,now,retryAt=null){return {code,message,occurredAt:now,retryAt};}
const safeCode=error=>typeof error?.code==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(error.code)?error.code:'MIND_AUTO_FAILED';
const activeDeliveries=new WeakMap();

/** Trusted server function. Browser commands cannot supply its pinned binding. */
export async function runMindSubscriptions(args={}){
  const {repository,ownerId}=args;let owners=activeDeliveries.get(repository.db);if(!owners){owners=new Set();activeDeliveries.set(repository.db,owners);}
  if(owners.has(ownerId))return {processed:0,completed:0,failed:0,skipped:0,retried:0,results:[],deliveryStatus:'IN_PROGRESS'};
  owners.add(ownerId);try{return await deliverMindSubscriptions(args);}finally{owners.delete(ownerId);}
}
async function deliverMindSubscriptions({request,env,ownerId,repository,options={},maxJobs=1,onlySubscriptionId=null}={}){
  const clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString(),db=repository.db;
  const report={processed:0,completed:0,failed:0,skipped:0,retried:0,results:[]};
  let initial=await readOperationalWorkspace(repository,ownerId);if(!initial)return report;
  for(const s of initial.mindSubscriptions??[])if(s.ownerId===ownerId&&s.status==='ENABLED'&&operationWindowState(s,clock())==='ENDED'){const at=clock(),next=clone(initial),target=next.mindSubscriptions.find(v=>v.id===s.id);target.status='PAUSED';target.updatedAt=at;target.runtime={...target.runtime,stage:'PERIOD_ENDED'};await save(repository,ownerId,initial,next,'period-ended-'+s.id+'-'+s.endsAt,at);initial=next;}
  const due=dueMindSubscriptions(initial,{now:clock(),ownerId}).filter(s=>!onlySubscriptionId||s.id===onlySubscriptionId).slice(0,Math.min(MAX_ACTIVE_MIND_SUBSCRIPTIONS,maxJobs));
  for(const candidate of due){
    const candidateManifest=initial.mindManifests.find(m=>m.id===effectiveSubscriptionPins(candidate,candidate.nextCloseAt,{accountFlat:initial.mindPositions.find(a=>a.id===candidate.accountId)?.positions.length===0}).manifestId);
    if(candidateManifest?.data.strategyPlan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT'&&(Date.parse(clock())<=Date.parse(candidate.nextCloseAt)+OFFSET_MAX||candidate.attempts.some(a=>a.barCloseAt===candidate.nextCloseAt&&['COMPUTING','JEV_STARTED'].includes(a.status)))){
      report.processed++;try{const result=await runMindPortfolioCycle({request,env,ownerId,repository,subscriptionId:candidate.id,options,deliverySource:options[MIND_MCP_DELIVERY]===true?'MCP':options[MIND_LOCAL_DELIVERY]===true?'LOCAL_RUNNER':'MANUAL'});report.completed++;report.results.push(result);}catch(error){const code=safeCode(error);if(code==='IN_PROGRESS'){report.skipped++;report.deliveryStatus='IN_PROGRESS';report.results.push({subscriptionId:candidate.id,status:'SKIPPED',code});}else{report.failed++;report.results.push({subscriptionId:candidate.id,status:'PORTFOLIO_FAILED',code});}}continue;
    }
    report.processed++;let key=null,token=null,resourceId='mind-execution:'+candidate.profileId,paid=false,failed=false;
    try{
      let w=await readOperationalWorkspace(repository,ownerId),s=w.mindSubscriptions.find(s=>s.id===candidate.id);if(!s||s.status!=='ENABLED')continue;
      const deliveredAt=clock(),actualMcpAt=options[MIND_MCP_DELIVERY]===true?deliveredAt:s.runtime?.lastMcpDeliveryAt??null,bar=s.nextCloseAt,boundary=stamp(Math.floor(Date.parse(deliveredAt)/FOUR)*FOUR),barMs=Date.parse(bar);
      const bindingFingerprint=hashInputPackage({subscriptionId:s.id,barCloseAt:bar,contract:s.version});key=mindSubscriptionAttemptKey(s,bar);
      const acquired=await acquireClaim(db,{ownerId,resourceId,key,fingerprint:bindingFingerprint,baseRevision:w.revision,nowMs:Date.parse(deliveredAt),leaseMs:120000});token=acquired.token;
      const fence=()=>({resourceId,token,nowMs:Date.parse(clock())});
      const persist=async(next,command=key)=>{const target=next.mindSubscriptions.find(v=>v.id===candidate.id);if(target?.runtime)Object.assign(target.runtime,{lastDeliveryAt:deliveredAt,deliverySource:options[MIND_LOCAL_DELIVERY]===true?'LOCAL_RUNNER':options[MIND_MCP_DELIVERY]===true?'MCP':'MANUAL'});w=await save(repository,ownerId,w,next,command,clock(),fence());s=w.mindSubscriptions.find(s=>s.id===candidate.id);return w;};
      const finishedRun=s.runtime?.runId&&w.mindRuns.find(r=>r.id===s.runtime.runId&&r.automation?.attemptKey===key);
      const prior=s.attempts.find(a=>a.key===key);
      if(!finishedRun&&prior){const next=clone(w),target=next.mindSubscriptions.find(v=>v.id===s.id),local=prior.requiresJev===false;const stopped=reserveMindSubscriptionAttempt(target,{barCloseAt:bar},{now:clock()});next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=runtime(stopped.subscription,{stage:local?'LOCAL_COMPUTATION_INTERRUPTED':'ACTION_REQUIRED',lastMcpDeliveryAt:actualMcpAt,lastFailure:failure(local?'LOCAL_COMPUTATION_INTERRUPTED':'JEV_OUTCOME_UNKNOWN',local?'중단된 전략 계산의 기록을 확인한 뒤 다음 봉 운용을 재개하세요.':'이전 호출의 실제 응답과 저장 상태를 확인하세요.',clock())},clock());await persist(next,key+':recovery');report.failed++;continue;}
      if(bar<boundary||Date.parse(deliveredAt)>barMs+OFFSET_MAX){
        const catchCurrent=bar<boundary&&Date.parse(deliveredAt)>=Date.parse(boundary)+OFFSET_MIN&&Date.parse(deliveredAt)<=Date.parse(boundary)+OFFSET_MAX;
        const next=clone(w),target=next.mindSubscriptions.find(v=>v.id===s.id);
        if(finishedRun&&prior&&['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(prior.status)){
          Object.assign(target,finishMindSubscriptionAttempt(s,{attemptKey:key,outcome:'FAILED',runId:finishedRun.id,errorCode:'AUTO_EXECUTION_WINDOW_EXPIRED',jevCalled:finishedRun.jevCalled??true},{now:deliveredAt}).subscription);
          const saved=next.mindRuns.find(r=>r.id===finishedRun.id);saved.execution={...saved.execution,status:'DECISION_EXPIRED',errorCode:'AUTO_EXECUTION_WINDOW_EXPIRED',reason:'이 봉의 승인 실행 허용창이 지났습니다.',at:deliveredAt};saved.observationState='DATA_REQUIRED';
        }
        target.nextCloseAt=catchCurrent?boundary:nextBar(deliveredAt);runtime(target,{stage:'SKIPPED',runId:null,nextAttemptAt:null,lastMcpDeliveryAt:actualMcpAt,lastFailure:failure('AUTO_EXECUTION_WINDOW_EXPIRED','이번 봉의 실행 허용창이 지났습니다. 다음 확정 봉을 기다립니다.',deliveredAt),lastAttempt:{stage:'SKIPPED',decisionId:finishedRun?.id??null,completedAt:deliveredAt,barCloseAt:bar}},deliveredAt);await persist(next);report.skipped++;report.results.push({subscriptionId:s.id,status:'SKIPPED',barCloseAt:bar});
        if(catchCurrent){await completeClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock())});token=null;const follow=await deliverMindSubscriptions({request,env,ownerId,repository,options,maxJobs:1,onlySubscriptionId:s.id});report.processed+=follow.processed-1;for(const field of ['completed','failed','skipped','retried'])report[field]+=follow[field];report.results.push(...follow.results);}
        continue;
      }
      const effectivePins=effectiveSubscriptionPins(s,bar,{accountFlat:w.mindPositions.find(a=>a.id===s.accountId)?.positions.length===0}),manifest=w.mindManifests.find(m=>m.id===effectivePins.manifestId);check(manifest&&mindDocumentHash(manifest)===effectivePins.manifestHash,'SUBSCRIPTION_PIN_CHANGED','고정한 마인드 정책 원문을 확인하세요.');
      check(w.investmentProfiles.find(p=>p.id===s.profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','보관한 마인드의 운용을 중지합니다.');
      if(options[MIND_LOCAL_DELIVERY]===true){
        check(manifest.data.strategyPlan?.graph?.schemaVersion===2&&manifest.data.strategyPlan.status==='APPROVED'&&manifest.data.strategyPlan.approval?.enabled===true,'CANONICAL_GRAPH_REQUIRED','노드 편집기에서 발행한 실행 전략을 연결하세요.');
        const pool=paperBudgetSummary(w,'USDT');check(pool.configured&&pool.available>=0,'PAPER_BUDGET_REQUIRED','설정의 공용 USDT 예산과 마인드 배정을 확인하세요.');
      }
      let run=finishedRun;

      if(!run){
        const triggered=clone(w),triggeredSubscription=triggered.mindSubscriptions.find(v=>v.id===s.id);
        triggeredSubscription.runtime={stage:'TRIGGERED',attemptKey:key,barCloseAt:bar,runId:null,nextAttemptAt:null,lastMcpDeliveryAt:actualMcpAt,lastFailure:null,lastAttempt:s.runtime?.lastAttempt??null};triggeredSubscription.updatedAt=clock();await persist(triggered,key+':triggered');
        // The original owner collector owns all HTTP rate/cooldown and immutable
        // capture receipts. Reusing its current capture performs no fetch.
        const {handleWorkspaceAPI}=await import('./workspace-api.mjs');
        const collectKey='auto-collect-'+hashInputPackage({ownerId,barCloseAt:bar,deliveryAt:deliveredAt});
        const collectedResponse=await handleWorkspaceAPI(new Request(new URL('/api/workspace/market-captures/collect',request.url),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify({provider:'okx',instrumentId:BTC,expectedRevision:w.revision,idempotencyKey:collectKey})}),env,{...options,now:clock});
        const collected=await collectedResponse.json();w=await readOperationalWorkspace(repository,ownerId);s=w.mindSubscriptions.find(v=>v.id===s.id);check(s?.status==='ENABLED','SUBSCRIPTION_PAUSED','자동운용이 일시중지되었습니다.');await assertClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock())});
        if(!collectedResponse.ok){const at=clock(),next=clone(w),target=next.mindSubscriptions.find(v=>v.id===s.id),retryAt=collected.collection?.nextAllowedAt??null;runtime(target,{stage:'WAITING_DATA',nextAttemptAt:retryAt,lastMcpDeliveryAt:actualMcpAt,lastFailure:failure(collected.code??'MARKET_CAPTURE_REQUIRED','현재 확정 봉 정본 수집을 기다립니다.',at,retryAt)},at);await persist(next);report.retried++;report.results.push({subscriptionId:s.id,status:'WAITING_DATA',code:collected.code,nextAttemptAt:retryAt});continue;}
        const marketLoader=options.marketLoader??createOwnerMarketResolver({repository,owner:ownerId,workspace:w}),next=clone(w);
        const prepared=await prepareMindEvaluation({workspace:w,next,manifest,instrumentId:BTC,timeframe:'4h',marketLoader,repository,ownerId,env,fetchImpl:options.fetchImpl,clock,createdAt:clock(),executionKey:key,trigger:'mind.subscription.candle.closed'});
        // The request owns its marked input snapshot. Reserving an API budget
        // never adopts that provisional valuation into the financial account.
        next.mindPositions=clone(w.mindPositions);
        check(prepared.account?.id===s.accountId&&prepared.account.positions.every(p=>p.instrumentId===BTC),'SUBSCRIPTION_ACCOUNT_SCOPE','BTC 전용 모의계좌 범위를 확인하세요.');
        check(prepared.market.bars.at(-1).closeTime===bar,'AUTO_BAR_MISMATCH','예약한 확정 봉과 정본 종료 봉을 대조하세요.');check(Date.parse(clock())>=barMs+OFFSET_MIN&&Date.parse(clock())<=barMs+OFFSET_MAX,'AUTO_EXECUTION_WINDOW','승인한 확정 봉 실행 허용창을 확인하세요.');
        const graph=manifest.data.strategyPlan?.graph,staged=graph?.schemaVersion===2&&graph.nodes.some(n=>n.type==='JEV_QUESTION'),requiresJev=graph?.schemaVersion===2?graphRequiresJev(graph,prepared.strategyEvaluation?.graphEvaluation):true;
        const reserved=reserveMindSubscriptionAttempt(s,{barCloseAt:bar,...(graph?.schemaVersion===2?{requiresJev}:{})},{now:clock(),accountFlat:w.mindPositions.find(a=>a.id===s.accountId)?.positions.length===0});next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=reserved.subscription;
        runtime(reserved.subscription,{stage:reserved.authorized?(requiresJev?'JEV_STARTED':'COMPUTING'):'ACTION_REQUIRED',attemptKey:reserved.attempt?.key??null,barCloseAt:bar,runId:null,nextAttemptAt:null,lastMcpDeliveryAt:actualMcpAt,lastFailure:reserved.authorized?null:failure('AUTO_CALL_ALREADY_RESERVED','이미 예약된 결정 실행의 결과를 확인하세요.',clock())},clock());
        // The pure key and runtime key must identify exactly the same contract.
        if(!reserved.authorized){await persist(next,key+':budget');report.failed++;continue;}
        key=reserved.attempt.key;
        if(staged)Object.assign(reserved.subscription.attempts.find(a=>a.key===key),{providerJournalVersion:GRAPH_PROVIDER_JOURNAL_VERSION,providerCallsReserved:0,providerCallsCompleted:0});
        prepared.decisionAt=clock();const preparedRequest=buildMindJevRequest(manifest,prepared.market,{portfolio:prepared.portfolio,contexts:prepared.contexts,memories:prepared.memories,knowledge:w.marketKnowledge,strategyEvaluation:prepared.strategyEvaluation,trigger:prepared.trigger,now:prepared.decisionAt}),rawRequest=requiresJev&&graph?.schemaVersion===2&&!staged?projectCanonicalVibeRequest(preparedRequest,manifest):preparedRequest;
        reserved.subscription.runtime.inputSnapshot={manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),versionRefs:clone(manifest.data.versionRefs),accountId:s.accountId,accountStateHash:hashInputPackage(w.mindPositions.find(a=>a.id===s.accountId)),accountSnapshotHash:hashInputPackage(prepared.account),canonicalSnapshotRef:prepared.market.source.marketDataRef,marketSource:clone(prepared.market.source),requestHash:hashInputPackage(rawRequest),rawRequest,...(graph?.schemaVersion===2?{requestMeaning:staged?'GRAPH_PROVIDER_EXECUTION':requiresJev?'PROVIDER_REQUEST':'INTERNAL_EXECUTION_ONLY',preparedExecutionRequestHash:hashInputPackage(preparedRequest)}:{})};
        await persist(next,key);if(!reserved.authorized){report.failed++;continue;}
        check(operationWindowState(s,clock())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');paid=requiresJev&&!staged;prepared.w=w;prepared.next=clone(w);prepared.key=key;
        const providerHooks=staged?createGraphProviderJournal({repository,ownerId,profileId:s.profileId,manifestHash:mindDocumentHash(manifest),executionKey:key,barCloseAt:bar,resourceId,token,workspace:w,clock,env,
          onPersist(saved){w=saved;s=w.mindSubscriptions.find(v=>v.id===candidate.id);Object.assign(prepared.next,clone(saved));prepared.w=w;},
          assertReady(current){const currentSub=current.mindSubscriptions.find(v=>v.id===candidate.id);check(operationWindowState(currentSub??{},clock())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');check(currentSub?.status==='ENABLED'&&currentSub.pins.manifestHash===mindDocumentHash(manifest),'SUBSCRIPTION_PAUSED','자동운용이 일시중지되었거나 고정 정책이 변경되었습니다.');check(Date.parse(clock())<=barMs+OFFSET_MAX,'AUTO_EXECUTION_WINDOW','승인한 확정 봉 실행 허용창을 확인하세요.');},
          beforeReserve(next,stage){const target=next.mindSubscriptions.find(v=>v.id===candidate.id),attempt=target.attempts.find(a=>a.key===key);attempt.providerCallsReserved++;target.runtime.stage='JEV_STARTED';paid=true;},
          afterResponse(next,stage){const target=next.mindSubscriptions.find(v=>v.id===candidate.id),attempt=target.attempts.find(a=>a.key===key);attempt.providerCallsCompleted++;attempt.jevCalled=true;}
        }):null;
        run=await evaluatePreparedMind(prepared,{autoExecuteHold:false,providerHooks});
        run.automation={ownerId,subscriptionId:s.id,attemptKey:key,barCloseAt:bar,cohortPolicyVersion:s.pins.cohortPolicyVersion,cohortPolicyHash:s.pins.cohortPolicyHash,pins:clone(s.pins)};
        const target=prepared.next.mindSubscriptions.find(v=>v.id===s.id),attempt=target.attempts.find(a=>a.key===key);if(attempt.requiresJev!==undefined)attempt.jevCalled=run.jevCalled===true;runtime(target,{stage:'DECISION_COMPLETED',runId:run.id,lastAttempt:{stage:'DECISION_COMPLETED',decisionId:run.id,action:run.decision.action,completedAt:run.decisionCompletedAt,barCloseAt:bar}},clock());
        await persist(prepared.next,key+':decision');
      }
      let next=clone(w);const at=clock();check(Date.parse(at)<=barMs+OFFSET_MAX,'AUTO_EXECUTION_WINDOW','이번 봉의 실행 허용창이 지났습니다.');
      check(s.status==='ENABLED'&&s.pins.manifestHash===run.manifestHash,'SUBSCRIPTION_BINDING_CHANGED','자동운용의 활성 상태와 고정 정책을 확인하세요.');
      let value;
      try{const executionDraft=clone(w);value=await executeMindRun({workspace:w,next:executionDraft,run,manifest,fetchImpl:options.fetchImpl,clock,executionDeadline:stamp(barMs+OFFSET_MAX)});check(Date.parse(clock())<=barMs+OFFSET_MAX,'AUTO_EXECUTION_WINDOW','이번 봉의 실행 허용창이 지났습니다.');next=executionDraft;}
      catch(error){
        const saved=next.mindRuns.find(r=>r.id===run.id),at=clock();
        if(['EXECUTION_QUOTE_PENDING','EXECUTION_QUOTE_UNAVAILABLE'].includes(error.code)&&Date.parse(at)<barMs+OFFSET_MAX){
          const retryAt=stamp(Math.min(Date.parse(at)+30000,barMs+OFFSET_MAX));saved.execution={...run.execution,status:'WAITING_EXECUTION_DATA',retryable:true,reason:error.message,errorCode:error.code,at};saved.observationState='DATA_REQUIRED';
          runtime(next.mindSubscriptions.find(v=>v.id===s.id),{stage:'RETRY_WAIT',runId:run.id,nextAttemptAt:retryAt,lastFailure:failure(error.code,'저장된 결정으로 새 실행 시세를 기다립니다.',at,retryAt)},at);
          await persist(next,key+':quote-wait');report.retried++;report.results.push({subscriptionId:s.id,status:'RETRY_WAIT',runId:run.id,code:error.code,nextAttemptAt:retryAt});continue;
        }
        saved.execution={...run.execution,status:'AUTO_EXECUTION_DECLINED',reason:'승인한 모의 실행 조건을 충족하지 못했습니다.',errorCode:safeCode(error),at};value={execution:saved.execution};
      }
      const savedRun=next.mindRuns.find(r=>r.id===run.id);savedRun.observationState=value.account?'WAITING_TIME':'DATA_REQUIRED';savedRun.observationDueAt=stamp(barMs+2*FOUR);
      const completed=finishMindSubscriptionAttempt(s,{attemptKey:key,outcome:'COMPLETED',runId:run.id,jevCalled:run.jevCalled??true},{now:clock()});
      const target=completed.subscription;runtime(target,{stage:value.account?'OBSERVATION_SCHEDULED':'PAPER_DECLINED',runId:run.id,nextAttemptAt:null,lastMcpDeliveryAt:actualMcpAt,lastAttempt:{stage:value.account?'OBSERVATION_SCHEDULED':'PAPER_DECLINED',decisionId:run.id,action:run.decision.action,executionStatus:value.execution.status,completedAt:clock(),barCloseAt:bar}},clock());next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===s.id)]=target;
      next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:key+':paper',type:'mind.auto.paper',fingerprint:bindingFingerprint,revision:w.revision+1,createdAt:clock(),result:{runId:run.id,executionStatus:value.execution.status}});
      await persist(next,key+':paper');report.completed++;report.results.push({subscriptionId:s.id,status:target.runtime.stage,runId:run.id,barCloseAt:bar});
    }catch(error){
      failed=true;const code=safeCode(error),at=clock();if(code==='IN_PROGRESS'&&!token){report.skipped++;report.deliveryStatus='IN_PROGRESS';report.results.push({subscriptionId:candidate.id,status:'SKIPPED',code});continue;}report.failed++;report.results.push({subscriptionId:candidate.id,status:'ACTION_REQUIRED',code});
      // Failure metadata alone may use the current owner state. It never
      // reapplies prepared account changes or sends another provider request.
      try{const current=await readOperationalWorkspace(repository,ownerId),next=clone(current),s=next.mindSubscriptions.find(v=>v.id===candidate.id),stored=current.mindRuns.find(r=>r.automation?.subscriptionId===candidate.id&&r.automation?.attemptKey===key),receipt=stored&&current.mindPositions.some(a=>a.receipts?.some(r=>r.runId===stored.id));
        const providerFailure=paid&&s?.attempts.some(a=>a.key===key)?captureMindProviderFailure(error,{attemptKey:key,now:at,env,maxBytes:64000}):null;
        if(providerFailure){const id='event-provider-failure-'+hashInputPackage({ownerId,attemptKey:key,code,at});if(!next.activityEvents.some(e=>e.id===id))next.activityEvents.push({id,eventType:'MIND_AUTO_PROVIDER_FAILED',resourceType:'mind-subscription',resourceId:s.id,occurredAt:at,actorId:ownerId,payload:{attemptKey:key,providerFailure}});if(s.runtime?.attemptKey===key){const remaining=190000-new TextEncoder().encode(JSON.stringify(s.runtime)).length;if(remaining>5000)s.runtime.providerFailure=captureMindProviderFailure(error,{attemptKey:key,now:at,env,maxBytes:Math.min(64000,remaining)});}}
        if(receipt){report.failed--;report.completed++;report.results[report.results.length-1]={subscriptionId:candidate.id,status:'RECOVERED_PAPER_RECEIPT',runId:stored.id};}
        else if(token&&s&&s.status==='ENABLED'&&['CANONICAL_GRAPH_REQUIRED','PAPER_BUDGET_REQUIRED','MIND_ARCHIVED'].includes(code)){
          s.status='PAUSED';runtime(s,{stage:'PAUSED',nextAttemptAt:null,lastFailure:failure(code,code==='CANONICAL_GRAPH_REQUIRED'?'노드 편집기에서 발행한 실행 전략을 적용한 뒤 운용을 시작하세요.':'공용 예산과 마인드 운용 설정을 확인하세요.',at)},at);await save(repository,ownerId,current,next,(key??candidate.id)+':configuration',at);
        }
        else if(token&&s&&s.status==='ENABLED'&&!s.attempts.some(a=>a.key===key&&a.status==='ABANDONED')&&(!s.runtime?.attemptKey||s.runtime.attemptKey===key)){
          const recoverable=stored&&stored.manifestHash===s.pins.manifestHash&&s.runtime?.runId===stored.id;
          const localAttempt=s.attempts.find(a=>a.key===key&&(a.requiresJev===false&&a.status==='COMPUTING'||a.providerJournalVersion&&a.providerCallsReserved===0&&a.status==='JEV_STARTED'));
          if(!recoverable&&localAttempt){const stopped=finishMindSubscriptionAttempt(s,{attemptKey:key,outcome:'FAILED',errorCode:'LOCAL_COMPUTATION_INTERRUPTED',jevCalled:false},{now:at});Object.assign(s,stopped.subscription);s.status='PAUSED';}
          else if(!recoverable&&(paid||s.runtime?.stage==='JEV_STARTED'))s.status='ACTION_REQUIRED';
          runtime(s,{stage:recoverable?'RETRY_WAIT':localAttempt?'LOCAL_COMPUTATION_INTERRUPTED':'ACTION_REQUIRED',nextAttemptAt:recoverable?at:null,lastFailure:failure(localAttempt?'LOCAL_COMPUTATION_INTERRUPTED':code,recoverable?'저장된 실제 결정을 사용해 모의 실행 단계를 재개하세요.':localAttempt?'중단된 전략 계산의 기록을 확인한 뒤 다음 봉 운용을 재개하세요.':'자동운용의 저장 기록과 실행 상태를 확인하세요.',at)},at);
          await save(repository,ownerId,current,next,(key??candidate.id)+':failure',at);
          if(recoverable){report.failed--;report.retried++;report.results[report.results.length-1]={subscriptionId:candidate.id,status:'RETRY_WAIT',runId:stored.id,code};}
        }else if(providerFailure)await save(repository,ownerId,current,next,key+':provider-failure',at);
      }catch{}
    }finally{if(token)await (failed?releaseClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock()),status:'FAILED'}):completeClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock())})).catch(()=>{});}
  }
  return report;
}

/** Existing consent covers fixed-outcome observation after new trades pause. */
export async function runDueMindObservations({request,env,ownerId,repository,options={},maxJobs=1}={}){
 const clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString(),report={processed:0,completed:0,retried:0,failed:0,skipped:0,results:[]};
 if(maxJobs<1||(options[MIND_MCP_DELIVERY]!==true&&options[MIND_LOCAL_DELIVERY]!==true))return report;
 const w=await readOperationalWorkspace(repository,ownerId);if(!w)return report;
 const due=w.mindRuns.filter(run=>{
   const a=run.automation,s=a&&w.mindSubscriptions.find(s=>s.id===a.subscriptionId&&s.ownerId===ownerId);
   return a?.ownerId===ownerId&&a.cohortPolicyHash===automaticCohortPolicyHash()&&s?.approval?.optInPaper===true&&s.approval.autoExecute===true&&!run.observation&&['FILLED','NO_ORDER_REQUIRED'].includes(run.execution?.status)&&run.execution?.accountSnapshotAfter&&run.observationDueAt&&run.observationDueAt<=clock()&&!run.observationAvailability?.sourceFailures?.some(f=>f.nextEligibleAt&&f.nextEligibleAt>clock());
 }).sort((a,b)=>a.observationDueAt.localeCompare(b.observationDueAt)||a.id.localeCompare(b.id)).slice(0,maxJobs);
 for(const candidate of due){let token;const resourceId='mind-observation:'+candidate.id;report.processed++;
   try{
     const current=await readOperationalWorkspace(repository,ownerId),run=current.mindRuns.find(r=>r.id===candidate.id);if(!run||run.observation)continue;
     const key='mind-auto-observe-'+hashInputPackage({ownerId,runId:run.id,cohortPolicyHash:run.automation.cohortPolicyHash,targetEndAt:run.observationDueAt,sources:current.marketSnapshots.map(s=>({id:s.id,sha256:s.sha256}))}),fingerprint=hashInputPackage({runId:run.id,horizonHours:8,key});
     const acquired=await acquireClaim(repository.db,{ownerId,resourceId,key,fingerprint,baseRevision:current.revision,nowMs:Date.parse(clock()),leaseMs:60000});token=acquired.token;
     const {handleMindStudioAPI}=await import('./mind-studio.mjs');
     const response=await handleMindStudioAPI(new Request(new URL('/api/workspace/terminal/observe',request.url),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify({runId:run.id,horizonHours:8,expectedRevision:current.revision,idempotencyKey:key})}),env,{...options,now:clock,[MIND_OBSERVATION_FENCE]:{ownerId,runId:run.id,resourceId,token}});
     const result=await response.json();if(!response.ok)throw new RepositoryError(result.code,result.message,response.status);
     await completeClaim(repository.db,{ownerId,resourceId,token,nowMs:Date.parse(clock())});token=null;
     if(result.status==='OBSERVED')report.completed++;else report.retried++;
     report.results.push({runId:run.id,subscriptionId:run.automation.subscriptionId,status:result.status,dueAt:result.dueAt,sourceFailures:clone(result.sourceFailures??[])});
   }catch(error){report.failed++;report.results.push({runId:candidate.id,status:'OBSERVATION_RETRY_REQUIRED',code:safeCode(error)});}
   finally{if(token)await releaseClaim(repository.db,{ownerId,resourceId,token,nowMs:Date.parse(clock()),status:'FAILED'}).catch(()=>{});}
 }
 return report;
}
