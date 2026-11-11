import {operationWindowState} from '../dist/domain/operation-window.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {effectiveSubscriptionPins,subscriptionInstrumentIds,validateMindSubscription,mindSubscriptionAttemptKey,reserveMindSubscriptionAttempt,finishMindSubscriptionAttempt} from '../dist/domain/mind-subscriptions.mjs';
import {graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {paperBudgetSummary} from '../dist/domain/paper-budget.mjs';
import {acquireClaim,assertClaim,renewClaim,completeClaim,releaseClaim} from './claims.mjs';
import {prepareMindEvaluation,evaluatePreparedMind,executeMindRun} from './mind-execution-service.mjs';
import {createOwnerMarketResolver} from './canonical-instrument-market.mjs';
import {createGraphProviderJournal,GRAPH_PROVIDER_JOURNAL_VERSION} from './graph-provider-journal.mjs';
import {pickMindInstrument} from './mind-engine.mjs';
import {observeMindRun} from './mind-observation.mjs';
import {captureMindProviderFailure} from './mind-provider-failure.mjs';

export const MIND_PORTFOLIO_CYCLE_VERSION='MIND_PORTFOLIO_CYCLE_V1';
const BTC='crypto:okx:BTC-USDT',FOUR=14400000,clone=structuredClone;
const check=(v,c,m,status=409)=>{if(!v)throw new RepositoryError(c,m,status);};
const iso=n=>new Date(n).toISOString(),safeCode=e=>typeof e?.code==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(e.code)?e.code:'PORTFOLIO_CYCLE_FAILED';
export function portfolioSelectionContext(manifest,barCloseAt,selected,phase){
 const context={contractVersion:'mind-selection-context-v1',profileId:manifest.scope.profileId,asOf:barCloseAt,phase,selectedInstrumentIds:[...selected]};
 return {...context,sourceHash:hashInputPackage(context)};
}
/** Deterministic ties retain the user's policy order. A score never fabricates an order. */
export function rankPortfolioCandidates(runs,instrumentIds){
 return runs.map(run=>{
  const evaluation=run.strategyEvaluation,momentum=evaluation?.modules?.find(m=>m.moduleId==='MOMENTUM'&&m.ready!==false&&Number.isFinite(m.mechanicalScore)),signals=evaluation?.graphEvaluation?.trace??[],signal=signals.find(row=>Number.isFinite(row.output?.score));
  const score=momentum?.indicators?.totalReturn??momentum?.mechanicalScore??signal?.output?.score??evaluation?.modules?.find(m=>m.ready!==false&&Number.isFinite(m.mechanicalScore))?.mechanicalScore??0;
  return {instrumentId:run.instrumentId,runId:run.id,score,targetWeight:run.decision.targetWeight,action:run.decision.action,policyIndex:instrumentIds.indexOf(run.instrumentId)};
 }).sort((a,b)=>b.score-a.score||a.policyIndex-b.policyIndex);
}

/** One owner lease, one candle reservation and one financial ledger span the entire portfolio cycle. */
export async function runMindPortfolioCycle({request,env,ownerId,repository,subscriptionId,options={},manualStart=false,manualCommand=null,deliverySource='LOCAL_RUNNER'}={}){
 const clock=()=>iso(typeof options.now==='function'?options.now():options.now??Date.now()),db=repository.db,fetchImpl=options.fetchImpl??fetch;
 let w=await readOperationalWorkspace(repository,ownerId),s=w?.mindSubscriptions.find(v=>v.id===subscriptionId&&v.ownerId===ownerId);
 check(s,'SUBSCRIPTION_NOT_FOUND','운용할 마인드를 선택하세요.',404);
 check(s.runtime?.campaign?.status!=='COMPLETED','CAMPAIGN_COMPLETED','종료한 운용입니다. 새 마인드를 복제해 새로운 운용을 시작하세요.');
 check(s.status==='ENABLED','SUBSCRIPTION_PAUSED','자동 운용을 시작한 뒤 현재 봉을 실행하세요.');
 const startedAt=clock(),bar=manualStart?iso(Math.floor(Date.parse(startedAt)/FOUR)*FOUR):s.nextCloseAt,key=mindSubscriptionAttemptKey(s,bar),prior=s.attempts.find(a=>a.key===key);
 if(prior?.status==='COMPLETED')return {subscriptionId:s.id,status:'COMPLETED',barCloseAt:bar,runId:prior.runId,batch:s.runtime?.batch?.barCloseAt===bar?clone(s.runtime.batch):null,idempotent:true};
 const pins=effectiveSubscriptionPins(s,bar,{accountFlat:w.mindPositions.find(a=>a.id===s.accountId)?.positions.length===0}),manifest=w.mindManifests.find(m=>m.id===pins.manifestId),resourceId='mind-execution:'+s.profileId;
 check(manifest&&mindDocumentHash(manifest)===pins.manifestHash,'SUBSCRIPTION_PIN_CHANGED','고정한 전략 버전을 확인하세요.');
 const graph=manifest.data.strategyPlan?.graph,instruments=subscriptionInstrumentIds(manifest),selectionPolicy=manifest.data.universe.selection;
 check(graph?.schemaVersion===2&&manifest.data.strategyPlan.status==='APPROVED'&&manifest.data.strategyPlan.approval?.enabled===true,'CANONICAL_GRAPH_REQUIRED','노드 편집기에서 발행한 실행 전략을 연결하세요.');
 const budget=paperBudgetSummary(w,'USDT');check(budget.configured&&budget.available>=0,'PAPER_BUDGET_REQUIRED','공용 USDT 예산과 마인드 배정을 확인하세요.');
 const account=w.mindPositions.find(a=>a.id===s.accountId);check(account?.kind==='PAPER_ACCOUNT'&&account.positions.every(p=>instruments.includes(p.instrumentId)),'SUBSCRIPTION_ACCOUNT_SCOPE','고정한 종목 범위와 모의계좌를 확인하세요.');
 const deadline=manualStart?iso(Date.parse(startedAt)+600000):iso(Date.parse(bar)+600000),fingerprint=hashInputPackage({subscriptionId:s.id,barCloseAt:bar,contract:s.version});
 const lease=await acquireClaim(db,{ownerId,resourceId,key,fingerprint,baseRevision:w.revision,nowMs:Date.parse(startedAt),leaseMs:120000}),token=lease.token;
 let failed=false,preparedActive=null,journal=null,callIndex=0;
 const fence=()=>({resourceId,token,nowMs:Date.parse(clock())});
 const adopt=state=>{w=state;s=w.mindSubscriptions.find(v=>v.id===subscriptionId);if(preparedActive){preparedActive.w=w;Object.assign(preparedActive.next,clone(w));}};
 const assertReady=async(current=w)=>{
  const sub=current.mindSubscriptions.find(v=>v.id===subscriptionId);check(sub?.status==='ENABLED'&&(sub.attempts.some(a=>a.key===key)?sub.pins:effectiveSubscriptionPins(sub,bar,{accountFlat:current.mindPositions.find(a=>a.id===sub.accountId)?.positions.length===0})).manifestHash===mindDocumentHash(manifest),'SUBSCRIPTION_BINDING_CHANGED','현재 운용 상태와 고정 전략을 확인하세요.');
  check(clock()<=deadline,'AUTO_EXECUTION_WINDOW','이번 운용의 실행 시간이 지났습니다.');await assertClaim(db,{ownerId,...fence()});
 };
 const persist=async(next,suffix)=>{await assertReady();next.revision=w.revision+1;next.updatedAt=clock();const errors=[...validateWorkspace(next),...validateMindSubscription(next.mindSubscriptions.find(v=>v.id===subscriptionId),next,{ownerId})];check(!errors.length,errors[0]?.code,errors[0]?.message,400);await renewClaim(db,{ownerId,...fence(),leaseMs:120000});await repository.commit(ownerId,w,next,key+':'+suffix,fence());adopt(next);};
 try{
  check(!prior,'PORTFOLIO_CYCLE_INTERRUPTED','중단된 실행의 저장 결과를 확인한 뒤 다음 봉 운용을 재개하세요.');
  // The collector reuses its immutable current capture and owns provider throttling.
  const {handleWorkspaceAPI}=await import('./workspace-api.mjs');
  const response=await handleWorkspaceAPI(new Request(new URL('/api/workspace/market-captures/collect',request.url),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify({provider:'okx',instrumentId:BTC,expectedRevision:w.revision,idempotencyKey:'cycle-capture-'+hashInputPackage({ownerId,bar,at:startedAt})})}),env,{...options,now:clock});
  const collected=await response.json();adopt(await readOperationalWorkspace(repository,ownerId));await assertReady();check(response.ok,collected.code??'MARKET_CAPTURE_REQUIRED','현재 확정 봉 자료를 가져온 뒤 다시 실행하세요.',503);
  const needsJev=selectionPolicy.method==='jev'||graphRequiresJev(graph),next=clone(w),target=next.mindSubscriptions.find(v=>v.id===subscriptionId);
  if(manualStart)target.nextCloseAt=bar;
  const reserved=reserveMindSubscriptionAttempt(target,{barCloseAt:bar,requiresJev:needsJev},{now:clock(),manualStart,accountFlat:w.mindPositions.find(a=>a.id===target.accountId)?.positions.length===0});check(reserved.authorized,reserved.reason??'PORTFOLIO_CYCLE_RESERVED','이번 봉의 실행 예약과 호출 한도를 확인하세요.');
  const previous=target.runtime?.batch,rebalanceEvery=selectionPolicy.rebalanceEveryBars??1,lastSelection=previous?.rebalanceDue===false?previous.previousSelectionBar:previous?.barCloseAt??null,rebalanceDue=!lastSelection||Date.parse(bar)-Date.parse(lastSelection)>=rebalanceEvery*FOUR;
  const batch={contractVersion:MIND_PORTFOLIO_CYCLE_VERSION,trigger:manualStart?'MANUAL_START':'CLOSED_BAR',status:'SCREENING',barCloseAt:bar,candidateIds:instruments,selected:[],runIds:[],allocations:[],ranking:[],rebalanceDue,previousSelectionBar:lastSelection};
  const active=reserved.subscription;active.runtime={stage:'PORTFOLIO_SCREENING',attemptKey:key,barCloseAt:bar,runId:null,nextAttemptAt:null,lastDeliveryAt:startedAt,deliverySource,lastMcpDeliveryAt:deliverySource==='MCP'?startedAt:s.runtime?.lastMcpDeliveryAt??null,lastFailure:null,batch,...(s.runtime?.campaign?{campaign:clone(s.runtime.campaign)}:{})};
  Object.assign(active.attempts.at(-1),{providerJournalVersion:GRAPH_PROVIDER_JOURNAL_VERSION,providerCallsReserved:0,providerCallsCompleted:0});next.mindSubscriptions[next.mindSubscriptions.findIndex(v=>v.id===subscriptionId)]=active;
  // Pending pins become effective only in the reservation committed here.
  next.revision=w.revision+1;next.updatedAt=clock();const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code,errors[0]?.message,400);await repository.commit(ownerId,w,next,key+':reserve',fence());adopt(next);
  const newJournal=()=>createGraphProviderJournal({repository,ownerId,profileId:s.profileId,manifestHash:mindDocumentHash(manifest),executionKey:key+':provider:'+callIndex,barCloseAt:bar,resourceId,token,workspace:w,clock,env,onPersist:adopt,assertReady,
   beforeReserve(state){const sub=state.mindSubscriptions.find(v=>v.id===subscriptionId);check(operationWindowState(sub,clock())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');const attempt=sub.attempts.find(a=>a.key===key);check(attempt.providerCallsReserved<9,'PORTFOLIO_PROVIDER_BUDGET','이번 봉의 질문 호출 한도에 도달했습니다.');attempt.providerCallsReserved++;sub.runtime.stage='JEV_STARTED';},
   afterResponse(state){const attempt=state.mindSubscriptions.find(v=>v.id===subscriptionId).attempts.find(a=>a.key===key);attempt.providerCallsCompleted++;attempt.jevCalled=true;}
  });
  const journalFetch=async(url,init)=>{
   if(new URL(url).href!=='https://api.typesafe.ai/v1/systemone')return fetchImpl(url,init);
   journal=newJournal();const rawRequest=JSON.parse(init.body),stage={index:0,nodeId:'portfolio-question-'+callIndex,rawRequest,rawRequestHash:hashInputPackage(rawRequest),startedAt:clock()};await journal.beforeCall(stage);
   let response;try{response=await fetchImpl(url,init);}catch(error){error.graphStage={...stage,callStarted:true};await journal.onFailure(error);throw error;}
   const text=await response.clone().text();check(text.length<=260000,'PROVIDER_JOURNAL_SIZE','질문 응답의 저장 한도를 확인하세요.');let rawResponse;try{rawResponse=JSON.parse(text);}catch{rawResponse={httpStatus:response.status,rawText:text};}
   await journal.afterCall({...stage,answeredAt:clock(),rawResponse,rawResponseHash:hashInputPackage(rawResponse),httpStatus:response.status});callIndex++;return response;
  };
  const graphProviderHooks=()=>{
   let currentJournal=null;
   return {
    async beforeCall(stage){currentJournal=newJournal();await currentJournal.beforeCall({...stage,graphStageIndex:stage.index,index:0});},
    async afterCall(stage){check(currentJournal,'GRAPH_PROVIDER_RESERVATION','질문의 전송 예약을 확인하세요.');await currentJournal.afterCall({...stage,graphStageIndex:stage.index,index:0});callIndex++;currentJournal=null;},
    async onFailure(error){if(currentJournal)await currentJournal.onFailure(Object.assign(new Error(error.message),error,{graphStage:{...error.graphStage,index:0}}));}
   };
  };
  const marketLoader=options.marketLoader??createOwnerMarketResolver({repository,owner:ownerId,workspace:w});
  const marketCache=new Map(),cachedLoader=async(args)=>{const cacheKey=hashInputPackage({instrumentId:args.instrumentId,timeframe:args.timeframe,limit:args.limit,strategyHistory:args.strategyHistory??false});if(!marketCache.has(cacheKey))marketCache.set(cacheKey,await marketLoader(args));return clone(marketCache.get(cacheKey));};
  let evaluationIndex=0;
  const evaluate=async(instrumentId,phase,selected)=>{
   await assertReady();check(operationWindowState(s,clock())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');const draft=clone(w),selection=portfolioSelectionContext(manifest,bar,selected,phase);
   const staged=graph.nodes.some(node=>node.type==='JEV_QUESTION');
   preparedActive=await prepareMindEvaluation({workspace:w,next:draft,manifest,instrumentId,timeframe:'4h',marketLoader:cachedLoader,repository,ownerId,env,fetchImpl:staged?fetchImpl:journalFetch,clock,createdAt:clock(),executionKey:key+':'+phase.toLowerCase()+':'+evaluationIndex++,trigger:'mind.subscription.candle.closed',selection});
   check(preparedActive.market.bars.at(-1).closeTime===bar,'AUTO_BAR_MISMATCH','같은 확정 봉에서 후보 종목을 비교하세요.');
   preparedActive.next.mindPositions=clone(w.mindPositions);const current=preparedActive,run=await evaluatePreparedMind(current,{autoExecuteHold:false,providerHooks:staged?graphProviderHooks():null});preparedActive=null;
   run.automation={ownerId,subscriptionId:s.id,attemptKey:key,barCloseAt:bar,cohortPolicyVersion:s.pins.cohortPolicyVersion,cohortPolicyHash:s.pins.cohortPolicyHash,pins:clone(s.pins),portfolioCycle:{contractVersion:MIND_PORTFOLIO_CYCLE_VERSION,trigger:manualStart?'MANUAL_START':'CLOSED_BAR',phase,selectionContext:selection}};
   if(phase==='SCREENING'){run.execution={status:'SCREENING_ONLY',reason:'종목 선정용 전략 평가'};run.observationState='SCREENING_ONLY';}
   const sub=current.next.mindSubscriptions.find(v=>v.id===subscriptionId);sub.runtime.batch.runIds.push(run.id);sub.runtime.runId=run.id;sub.runtime.stage=phase==='SCREENING'?'PORTFOLIO_SCREENING':'PORTFOLIO_EXECUTING';
   await persist(current.next,'decision-'+run.id);return clone(w.mindRuns.find(r=>r.id===run.id));
  };
  const screening=[];for(const id of instruments)screening.push(await evaluate(id,'SCREENING',instruments));
  const ranked=rankPortfolioCandidates(screening,instruments),held=w.mindPositions.find(a=>a.id===s.accountId).positions.filter(p=>p.quantity>0).map(p=>p.instrumentId),max=selectionPolicy.maxPositions;
  let selected;
  if(!rebalanceDue)selected=previous?.selected?.filter(id=>instruments.includes(id))??held;
  else if(selectionPolicy.method==='jev'){
   const states=screening.map(run=>run.rawRequest?.state),byInstrument=Object.fromEntries(screening.map(run=>[run.instrumentId,run.strategyEvaluation]));
   const selection=await pickMindInstrument({manifest,markets:instruments.map(id=>[...marketCache.values()].find(m=>m.instrument.id===id)),contexts:states[0]?.contexts??[],portfolios:[w.mindPositions.find(a=>a.id===s.accountId)],memories:manifest.data.approvedMemory,knowledge:w.marketKnowledge,strategyEvaluations:byInstrument,now:clock(),env,fetchImpl:journalFetch,clock});
   selection.id='mind-selection-'+crypto.randomUUID();selection.profileId=s.profileId;selection.createdAt=clock();selection.automation={subscriptionId:s.id,attemptKey:key,barCloseAt:bar};const saved=clone(w);saved.mindSelections.push(selection);saved.mindSubscriptions.find(v=>v.id===subscriptionId).runtime.batch.selectionId=selection.id;await persist(saved,'selection');
   selected=selection.selectedInstrumentId?[selection.selectedInstrumentId]:[];
  }else if(selectionPolicy.method==='strategy')selected=ranked.filter(row=>['buy','hold'].includes(row.action)&&row.targetWeight>0&&row.score>0).slice(0,max).map(row=>row.instrumentId);
  else {
   const buy=screening.filter(run=>run.decision.action==='buy'&&run.decision.targetWeight>0);
   if(selectionPolicy.method==='liquidity')buy.sort((a,b)=>{const volume=run=>run.marketBars.slice(-6).reduce((sum,row)=>sum+(row.volume??0)*row.close,0);return volume(b)-volume(a)||instruments.indexOf(a.instrumentId)-instruments.indexOf(b.instrumentId);});
   selected=buy.slice(0,max).map(run=>run.instrumentId);
  }
  // Existing holdings keep consuming slots until their graph actually releases them.
  if(!selectionPolicy.exitUnselected)selected=[...new Set([...held,...selected])].slice(0,max);
  const selectedState=clone(w),selectedSub=selectedState.mindSubscriptions.find(v=>v.id===subscriptionId);Object.assign(selectedSub.runtime.batch,{selected,ranking:ranked,status:'EXECUTING'});selectedSub.runtime.stage='PORTFOLIO_EXECUTING';await persist(selectedState,'ranked');
  const finals=[];for(const id of instruments)finals.push(await evaluate(id,'FINAL',selected));
  const campaignExit=finals.find(run=>run.decision.action==='sell'&&run.decision.targetWeight===0&&run.decision.intent?.code==='CAMPAIGN_EXIT');
  if(campaignExit&&!s.runtime.campaign){
   const closing=clone(w),sub=closing.mindSubscriptions.find(v=>v.id===subscriptionId);sub.pendingPins=null;sub.runtime.campaign={contractVersion:'mind-paper-campaign-v1',status:'EXITING',manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),triggerRunId:campaignExit.id,triggerBarCloseAt:bar,requestedAt:clock(),remainingInstrumentIds:closing.mindPositions.find(a=>a.id===s.accountId).positions.filter(p=>p.quantity>0).map(p=>p.instrumentId),completedAt:null};await persist(closing,'campaign-exit-requested');
  }
  if(finals.some(run=>run.decision.action==='buy'&&!selected.includes(run.instrumentId))){const deferred=clone(w);for(const run of finals.filter(run=>run.decision.action==='buy'&&!selected.includes(run.instrumentId))){const stored=deferred.mindRuns.find(r=>r.id===run.id);stored.execution={status:'NOT_SELECTED',reason:'이번 주기의 종목 선정 결과'};stored.observationState='SCREENING_ONLY';}await persist(deferred,'not-selected');}
  const ordered=s.runtime.campaign?finals:[...finals.filter(run=>run.decision.action==='sell'),...finals.filter(run=>run.decision.action==='hold'),...finals.filter(run=>run.decision.action==='buy'&&selected.includes(run.instrumentId))];
  for(let run of ordered){
   await assertReady();let currentAccount=w.mindPositions.find(a=>a.id===s.accountId);
   if(s.runtime.campaign||currentAccount.cash!==run.accountSnapshot?.cash||hashInputPackage(currentAccount.ledger)!==hashInputPackage(run.accountSnapshot?.ledger))run=await evaluate(run.instrumentId,'FINAL',selected);
   if(run.decision.action==='buy'&&!selected.includes(run.instrumentId))continue;
   const draft=clone(w),saved=draft.mindRuns.find(r=>r.id===run.id);let errorCode;
   try{check(!s.runtime.campaign||run.decision.action==='sell'&&run.decision.targetWeight===0&&run.decision.intent?.code==='CAMPAIGN_EXIT'||run.decision.action==='hold'&&!currentAccount.positions.some(p=>p.instrumentId===run.instrumentId&&p.quantity>0),'CAMPAIGN_EXIT_REQUIRED','청산 중인 운용의 종료 요청을 전략 입력에 연결하세요.');await executeMindRun({workspace:w,next:draft,run,manifest,fetchImpl:journalFetch,clock,executionDeadline:deadline});const scheduled=observeMindRun({run:saved,manifest,now:clock(),horizonHours:8});saved.observationState=scheduled.status;saved.observationDueAt=scheduled.dueAt;}
   catch(error){errorCode=safeCode(error);saved.execution={...saved.execution,status:'AUTO_EXECUTION_DECLINED',errorCode,reason:error.message,at:clock()};saved.observationState='DATA_REQUIRED';}
   draft.mindSubscriptions.find(v=>v.id===subscriptionId).runtime.batch.allocations.push({instrumentId:run.instrumentId,runId:run.id,action:run.decision.action,targetWeight:run.decision.targetWeight,executionStatus:saved.execution.status,...(errorCode?{errorCode}:{})});const campaign=draft.mindSubscriptions.find(v=>v.id===subscriptionId).runtime.campaign;if(campaign)campaign.remainingInstrumentIds=draft.mindPositions.find(a=>a.id===s.accountId).positions.filter(p=>p.quantity>0).map(p=>p.instrumentId);await persist(draft,'execution-'+run.id);
  }
  const done=clone(w),sub=done.mindSubscriptions.find(v=>v.id===subscriptionId),representative=sub.runtime.batch.allocations.at(-1)?.runId??sub.runtime.batch.runIds.at(-1),attempt=sub.attempts.find(a=>a.key===key),finished=finishMindSubscriptionAttempt(sub,{attemptKey:key,outcome:'COMPLETED',runId:representative,jevCalled:attempt.providerCallsReserved>0},{now:clock()}).subscription;
  finished.runtime.batch.status='COMPLETED';finished.runtime.batch.completedAt=clock();finished.runtime.stage='OBSERVATION_SCHEDULED';finished.runtime.runId=representative;finished.runtime.lastAttempt={stage:'COMPLETED',decisionId:representative,completedAt:clock(),barCloseAt:bar};done.mindSubscriptions[done.mindSubscriptions.findIndex(v=>v.id===subscriptionId)]=finished;
  if(finished.runtime.campaign){const campaign=finished.runtime.campaign;campaign.remainingInstrumentIds=done.mindPositions.find(a=>a.id===s.accountId).positions.filter(p=>p.quantity>0).map(p=>p.instrumentId);if(!campaign.remainingInstrumentIds.length){campaign.status='COMPLETED';campaign.completedAt=clock();finished.status='PAUSED';finished.nextCloseAt=null;finished.runtime.stage='CAMPAIGN_COMPLETED';}else finished.runtime.stage='CAMPAIGN_EXITING';}
  const representativeRun=done.mindRuns.find(r=>r.id===representative);Object.assign(representativeRun.automation.portfolioCycle,{completedBatch:clone(finished.runtime.batch),completedBatchHash:hashInputPackage(finished.runtime.batch)});
  const result={subscriptionId:s.id,status:'COMPLETED',barCloseAt:bar,runId:representative,batch:clone(finished.runtime.batch),campaign:clone(finished.runtime.campaign??null),idempotent:false};
  if(manualCommand)done.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:manualCommand.idempotencyKey,type:'mind.studio',fingerprint:manualCommand.fingerprint,studioFingerprint:manualCommand.fingerprint,revision:w.revision+1,createdAt:clock(),result:{result}});
  await persist(done,'complete');return result;
 }catch(error){
  failed=true;try{
   const current=await readOperationalWorkspace(repository,ownerId),draft=clone(current),sub=draft.mindSubscriptions.find(v=>v.id===subscriptionId),attempt=sub?.attempts.find(a=>a.key===key);
   if(attempt&&['COMPUTING','JEV_STARTED'].includes(attempt.status)){
    const unknown=attempt.providerCallsReserved>attempt.providerCallsCompleted,outcome=unknown?'UNKNOWN':'FAILED',finished=finishMindSubscriptionAttempt(sub,{attemptKey:key,outcome,errorCode:safeCode(error),runId:sub.runtime?.runId??null,jevCalled:attempt.providerCallsReserved>0},{now:clock()}).subscription;
    if(!unknown)finished.status='PAUSED';finished.runtime.stage=unknown?'ACTION_REQUIRED':'PORTFOLIO_FAILED';finished.runtime.batch.status='FAILED';finished.runtime.batch.completedAt=clock();const terminalRun=draft.mindRuns.find(r=>r.id===finished.runtime.runId&&r.automation?.attemptKey===key);if(terminalRun)Object.assign(terminalRun.automation.portfolioCycle,{completedBatch:clone(finished.runtime.batch),completedBatchHash:hashInputPackage(finished.runtime.batch)});finished.runtime.lastFailure={code:safeCode(error),message:'저장된 포트폴리오 실행 결과와 운용 설정을 확인하세요.',occurredAt:clock(),retryAt:null};
    if(attempt.providerCallsReserved>0)finished.runtime.providerFailure=captureMindProviderFailure(error,{attemptKey:key,now:clock(),env,maxBytes:64000});draft.mindSubscriptions[draft.mindSubscriptions.findIndex(v=>v.id===subscriptionId)]=finished;draft.revision=current.revision+1;draft.updatedAt=clock();const errors=validateWorkspace(draft);if(!errors.length)await repository.commit(ownerId,current,draft,key+':failed',fence());
   }
  }catch{}
  throw error;
 }finally{await (failed?releaseClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock()),status:'FAILED'}):completeClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock())})).catch(()=>{});}
}
