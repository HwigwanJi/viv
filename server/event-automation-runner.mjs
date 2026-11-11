import {reviewHourlyValueExecution} from '../dist/domain/hourly-value-policy.mjs';
import {placeRestingTakeProfit,isRestingTakeProfit,isWorkingTakeProfit} from './resting-take-profit.mjs';
import {encodeLiveEventBody} from './live-event-body.mjs';
import {readMinuteSurgeMarket} from './minute-surge-source.mjs';
import {programBinding,resolveProgramDeployment} from './strategy-program-deployment.mjs';
import {runRegimeProgram} from './regime-program-runtime.mjs';
import {createRegimeRuntimeStore} from './regime-runtime-store.mjs';
import {programFillRows,programMemberTag,programMemberLedger,programPositionAccount,programAggregateLedger,allocateProgramCash,assertProgramOrder} from './strategy-program-ledger.mjs';
import {callRegimeJevClassifier} from './regime-jev-classifier.mjs';
import {isHourlyScreenGraph} from '../dist/domain/hourly-pullback.mjs';
import {processHourlyScreenAccount} from './hourly-screen-runtime.mjs';
import {hourlyScreenSource} from './hourly-screen-source.mjs';
import {readHourlyRegimeMarket} from './hourly-regime-input.mjs';
import {isHourlyRegimeGraph,hourlyRegimeDecision} from '../dist/domain/hourly-regime.mjs';
import {isHourlyValueGraph} from '../dist/domain/hourly-value-graph.mjs';
import {readDailyPortfolioMarket} from './daily-portfolio-source.mjs';
import {isAdaptivePortfolioGraph,portfolioSourceSpec} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {processAdaptivePortfolio,capturePortfolioSources,portfolioSourceMarkets} from './adaptive-portfolio-runtime.mjs';
import {processMonthlyPortfolioPromotion} from './monthly-portfolio-promotion.mjs';
import {resolvePortfolioQuestions} from './portfolio-question-runtime.mjs';
import {readPortfolioNews} from './portfolio-news-source.mjs';
import {processHourlyValueLive,liveHourlyValueAccount} from './hourly-value-live.mjs';
import {captureHourlyValueMarket,readHourlyValueReview} from './hourly-value-capture.mjs';
import {EVENT_AUTOMATION_RUNNER_VERSION} from '../dist/system/automation-contracts.mjs';
import {operationWindowState} from '../dist/domain/operation-window.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash,graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {assertEventStrategyGraph,prepareEventStrategyInputs} from '../dist/domain/event-strategy-runtime.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {listLiveAutomations,getLiveAutomation,listLiveAutomationOrders,readLiveAutomationPositionAccount,readLiveAutomationEntryCapacity,createLiveAutomationBindings,applyLiveStrategyUpdate,stopLiveAutomation} from './live-automation-store.mjs';
import {readAutomationBook,readAutomationPermission,eventAutomationScope} from './automated-trading.mjs';
import {buildEventCandidateInput} from '../dist/domain/multi-asset-event-runtime.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';
import {withUpbitReadConnection} from './broker-accounts.mjs';
import {createUpbitOrderAdapter,previewUpbitOrder} from './upbit-order-adapter.mjs';
import {readUpbitScalpingCandles,captureUpbitPublic,normalizeUpbitScalpingEvent,parseScalpFinancialJson,scalpDecimal} from './upbit-scalping-market.mjs';
import {evaluateGraphQuestions} from './graph-question-runtime.mjs';
import {acquireClaim,assertClaim,renewClaim,releaseClaim} from './claims.mjs';

export {EVENT_AUTOMATION_RUNNER_VERSION};
const Q=10n**18n,LOT=10n**10n,clone=structuredClone,openStates=new Set(['RESERVED','UNKNOWN','PENDING','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED']);
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});},iso=v=>new Date(v).toISOString();
const n=v=>{const s=scalpDecimal(v);check(/^\d+(?:\.\d{1,18})?$/.test(s),'LIVE_RUNNER_DECIMAL','소수 18자리 이내의 수량과 금액을 확인하세요.');const [a,b='']=s.split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));};
const signed=v=>{const s=scalpDecimal(v);return s.startsWith('-')?-n(s.slice(1)):n(s);};
const out=v=>{check(v>=0n,'LIVE_RUNNER_DECIMAL','음수 주문 금액은 사용할 수 없습니다.');const b=(v%Q).toString().padStart(18,'0').replace(/0+$/,'');return String(v/Q)+(b?'.'+b:'');},min=(...v)=>v.reduce((a,b)=>a<b?a:b),ceil=(a,b)=>(a+b-1n)/b,floor=(a,b)=>a/b*b;
const hash=hashInputPackage;
function isRejectedProviderResponse(failure,pending){
 if(!(failure?.responseAvailability==='RETAINED'&&failure.callId===pending.callId&&failure.snapshotAsOf===pending.snapshotAsOf&&Number.isFinite(Date.parse(pending.snapshotAsOf))&&hash(failure.rawRequest)===pending.requestHash&&Number.isFinite(Date.parse(failure.provider?.responseReceivedAt))&&typeof failure.rawResponseText==='string'&&researchSha256(failure.rawResponseText)===failure.rawResponseHash))return false;
 if(failure.code==='JEV_QUESTION_HTTP'){
  if(failure.rawResponse?.httpStatus!==failure.provider.httpStatus||failure.rawResponse.body!==failure.rawResponseText)return false;
  if([429,500,502,503,504,529].includes(failure.provider.httpStatus))return true;
  try{return failure.provider.httpStatus===400&&JSON.parse(failure.rawResponseText)?.detail?.error_type==='max_tokens_exceeded';}catch{return false;}
 }
 if(failure.provider.httpStatus!==200)return false;
 if(failure.code==='JEV_QUESTION_RESPONSE_JSON'){try{JSON.parse(failure.rawResponseText);return false;}catch{return failure.rawResponse===null;}}
 if(!['JEV_QUESTION_CHOICE','JEV_QUESTION_RESPONSE','JEV_QUESTION_ANSWER','JEV_QUESTION_DISTRIBUTION','JEV_QUESTION_SCORE','JEV_QUESTION_NOUL'].includes(failure.code))return false;
 try{return hash(JSON.parse(failure.rawResponseText))===hash(failure.rawResponse);}catch{return false;}
}
function freshBook(book,market,now,readyAt=null,maxAgeMs=3000){
 check(book?.kind==='ORDER_BOOK'&&book.market===market&&book.levels?.length&&/^[a-f0-9]{64}$/.test(book.sourceHash??''),'LIVE_RUNNER_BOOK','원문에 연결된 실제 호가를 확인하세요.');
 try{for(const t of [book.eventTime,book.receivedAt])check(Number.isFinite(Date.parse(t))&&t<=now&&Date.parse(now)-Date.parse(t)<=maxAgeMs&&(!readyAt||t>=readyAt),'LIVE_RUNNER_BOOK_TIME','판단과 공급자 응답 뒤에 수신한 호가를 설정된 유효시간으로 확인합니다.');}
 catch(error){error.bookTime={market,eventTime:book.eventTime,receivedAt:book.receivedAt,checkedAt:now,readyAt,eventAgeMs:Date.parse(now)-Date.parse(book.eventTime),receiptAgeMs:Date.parse(now)-Date.parse(book.receivedAt),maxAgeMs};throw error;}
 return book;
}
export function exactPlan({activation,account,evaluation,book,readiness,now,signalEvidence,participationRate=.1,entryCapacity=null}){
 const d=evaluation.output.decision,asset=book.market.split('-')[1],quantity=n(activation.positions?.[asset]?.quantity??'0'),cash=n(account.exact.cash),equity=n(account.exact.equity),bid=n(book.levels[0].bidPrice),current=quantity*bid/Q,target=equity*n(d.targetWeight)/Q,buy=d.action==='buy';
 check(evaluation.output.ready===true&&evaluation.output.orderAllowed===true&&evaluation.output.riskAllowed===true&&evaluation.output.execution==='LIVE'&&['buy','sell'].includes(d.action),'LIVE_RUNNER_ORDER_GATE','canonical 위험·주문 부품이 허용한 결정만 주문합니다.');
 const policy=evaluation.output.orderPolicy??{orderType:'LIMIT_FOK',maxSlippageBps:20},slip=n(policy.maxSlippageBps??20),tick=n(readiness.rules.tickSize),best=n(book.levels[0][buy?'askPrice':'bidPrice']),scale=10000n*Q,raw=buy?best*(scale+slip)/scale:ceil(best*(scale-slip),scale),rate=maxRate(readiness.fees,buy);
 let price=buy?floor(raw,tick):ceil(raw,tick)*tick,modelEntryReview=null;
 if(buy&&policy.recheckModelValue){const selection=evaluation.trace?.find(n=>n.type==='MODEL'&&n.output?.selection)?.output.selection;modelEntryReview=reviewHourlyValueExecution(selection,{market:book.market,askPrice:out(best),maxSlippageBps:policy.maxSlippageBps??20,buyRate:out(rate),sellRate:out(maxRate(readiness.fees,false))});check(modelEntryReview.accepted,modelEntryReview.reason,'최신 호가로 다음 분봉에서 매수 판단을 갱신합니다.');const edgeCap=floor(n(modelEntryReview.maximumEntryPrice.toFixed(18))-1n,tick);price=min(price,edgeCap);check(price>=best,'LIVE_MODEL_EDGE_CONSUMED','현재 호가의 비용 차감 우위를 다시 판단합니다.');}
 check(buy?target>current:target<current,'LIVE_TARGET_REACHED','목표 비중에 도달해 추가 주문을 생략합니다.');let q;
 if(buy){const budget=min(target-current,cash,n(activation.config.perOrderLimit),n(readiness.account.available),...(entryCapacity?[n(entryCapacity.capitalRemaining),n(entryCapacity.cashRemaining)]:[]));q=floor(budget*Q*Q/(price*(Q+rate)),LOT);}else q=d.targetWeight===0?quantity:floor((current-target)*Q/bid,LOT);
 if(!buy&&d.positionFraction){check(d.positionFraction.instrumentId==='crypto:upbit:'+book.market&&Number.isFinite(d.positionFraction.fraction)&&d.positionFraction.fraction>0&&d.positionFraction.fraction<=1,'LIVE_TARGET_FRACTION_SCOPE','현재 보유 수량의 매도 비율을 확인하세요.');q=floor(quantity*n(d.positionFraction.fraction)/Q,LOT);if(d.risk?.maxOrderWeight!==undefined)q=min(q,floor(equity*n(d.risk.maxOrderWeight)/bid,LOT));}
 if(!buy&&d.positionTarget){check(d.positionTarget.instrumentId==='crypto:upbit:'+book.market,'LIVE_TARGET_QUANTITY_SCOPE','매도 수량과 자기 종목을 대조하세요.');q=floor(quantity>n(d.positionTarget.quantity)?quantity-n(d.positionTarget.quantity):0n,LOT);if(d.risk?.maxOrderWeight!==undefined)q=min(q,floor(equity*n(d.risk.maxOrderWeight)/bid,LOT));}
 q=buy?q:min(q,quantity,n(readiness.account.assetAvailable));check(q>0n,'LIVE_MINIMUM_ORDER','최소 주문에 못 미치는 수량은 올리지 않습니다.');
 const gross=q*price/Q;check(gross>=n(buy?readiness.rules.minBuyTotal:readiness.rules.minSellTotal),'LIVE_MINIMUM_ORDER','최소 주문에 못 미치는 목표를 생략합니다.');
 let left=q;const cap=n(participationRate);for(const l of book.levels){const p=n(l[buy?'askPrice':'bidPrice']);if(buy?p>price:p<price)break;left-=min(left,floor(n(l[buy?'askQuantity':'bidQuantity'])*cap/Q,LOT));if(left===0n)break;}
 check(left===0n,'LIVE_PARTICIPATION_DEPTH','정한 호가 참여 한도 안에서 주문량을 체결할 깊이가 필요합니다.');
 const intent={market:book.market,side:buy?'bid':'ask',ordType:'limit',price:out(price),volume:out(q),timeInForce:policy.orderType==='LIMIT_IOC'?'ioc':'fok'};
 return previewUpbitOrder({intent,readiness,book,now,maxAgeMs:evaluation.output.orderPolicy?.maxQuoteAgeMs??2000,signalEvidence:{...signalEvidence,...(modelEntryReview?{modelEntryReview}:{}),intent:clone(d.intent??null),targetWeight:d.targetWeight,participationRate,quantityRounding:'FLOOR_8DP_NO_MINIMUM_ROUNDUP'},policyRef:{manifestId:activation.config.manifestId,manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash}});
}
function maxRate(f,buy){const a=n(buy?f.takerBuyRate:f.takerSellRate),b=n(buy?f.makerBuyRate:f.makerSellRate);return a>b?a:b;}
async function defaultTrades(market,{fetchImpl,clock}){const capture=await captureUpbitPublic('/v1/trades/ticks',{market,count:'200'},{fetchImpl,clock}),rows=parseScalpFinancialJson(capture.source.rawBody.replace(/("sequential_id"\s*:\s*)(\d+)/g,'$1"$2"')),events=rows.map((row,index)=>{const raw=JSON.stringify({...row,type:'trade',code:market,trade_timestamp:row.timestamp}),e=normalizeUpbitScalpingEvent(raw,{receivedAt:capture.source.receivedAt,markets:[market]});return {...e,rawSourceHash:capture.source.rawSha256,rawRowIndex:index};});return {events,rawSources:[capture.source],coverage:{policy:'LAST_200_OBSERVED_TRADES_WITHIN_60_SECONDS_NOT_ASSUMED_COMPLETE'}};}
const initialRuntime=()=>({schemaVersion:1,contractVersion:EVENT_AUTOMATION_RUNNER_VERSION,cachedAnswers:{},cachedTiming:{},providerPending:null,providerUnknown:null,pendingDecision:null,lastDecisionBar:null,lastEvaluationAt:null,fundingConfirmed:null,lastState:'CREATED'});

/** One explicit activation starts the autonomous policy; no per-order UI approval. */
export function createEventAutomationRunner({env={},ownerId,options={},clock=()=>new Date().toISOString()}={}){
 check(typeof ownerId==='string'&&ownerId.length>0&&env.DB?.prepare,'LIVE_RUNNER_CONTEXT','자동 운용 주체와 저장소를 확인하세요.');const db=env.DB,owner=ownerId,marketCache=new Map(),serviceWait=new Map(),statusState={contractVersion:EVENT_AUTOMATION_RUNNER_VERSION,running:false,inFlight:false,lastTickAt:null,lastError:null,policies:{}};let timer=null,inFlight=null,operational=true,initialized=false;
 const now=()=>iso(clock()),fetchImpl=options.fetchImpl??fetch,list=()=> (options.listAutomations??listLiveAutomations)({db,owner}),get=id=>(options.getAutomation??getLiveAutomation)({db,owner,activationId:id}),orders=id=>(options.listOrders??listLiveAutomationOrders)({db,owner,activationId:id,limit:1000});
 async function init(){if(initialized)return;await db.prepare('CREATE TABLE IF NOT EXISTS live_event_runtime(owner_id TEXT NOT NULL,activation_id TEXT NOT NULL,revision INTEGER NOT NULL,mutation_token TEXT NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,activation_id))').bind().run();initialized=true;}
 async function readRuntime(id){const row=await db.prepare('SELECT revision,body FROM live_event_runtime WHERE owner_id=? AND activation_id=?').bind(owner,id).first();return {state:row?JSON.parse(row.body):initialRuntime(),revision:row?.revision??-1};}
 const resource='event-automation-owner';
 async function processActivation(initial,claim,memberContext=null){
  const runtimeId=memberContext?initial.id+':member:'+hash({epoch:memberContext.selection.epoch,member:memberContext.member.id}).slice(0,24):initial.id;
  const currentActivation=async()=>{const actual=await get(initial.id);if(!memberContext)return actual;const ledger=programMemberLedger(await programFillRows({db,owner,activationId:actual.id}),actual,memberContext,now());return {...actual,executionPolicy:{graphHash:memberContext.member.graphHash,manifestHash:memberContext.member.manifestHash},programMemberId:memberContext.member.id+':'+memberContext.selection.epoch,positions:Object.fromEntries(Object.entries(ledger.assets).map(([id,p])=>[id,{quantity:out(p.quantity),costBasis:out(p.basis)}])),capitalPrincipal:memberContext.budget};};
  const positionAccount=memberContext?async args=>programPositionAccount(activation,programMemberLedger(await programFillRows({db,owner,activationId:activation.id}),activation,memberContext,args.asOf),args):(options.readPositionAccount??readLiveAutomationPositionAccount);
  const strategyOrders=async()=>{const rows=await orders(initial.id);return memberContext?rows.filter(o=>{const p=o.plan?.signalEvidence?.programMember;return p?.memberId===memberContext.member.id&&p.epoch===memberContext.selection.epoch&&p.targetHash===memberContext.selection.modelHash;}).map(o=>({...o,idempotencyKey:o.plan.signalEvidence.programSignalKey??o.idempotencyKey})):rows;};
  let activation=memberContext?await currentActivation():initial,runtime=await readRuntime(runtimeId),context=null;const fence=async()=>{check(operational,'LIVE_RUNNER_STOPPED','자동 운용 루프가 중지되었습니다.');await assertClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now())});};
  const safe=v=>{let text=JSON.stringify(v);for(const [k,s]of Object.entries(env))if(/key|secret|token|passphrase/i.test(k)&&typeof s==='string'&&s)text=text.split(s).join('[redacted]');return JSON.parse(text);};
  let saveTail=Promise.resolve();
  function save(...args){const pending=saveTail.then(()=>saveNow(...args));saveTail=pending.catch(()=>{});return pending;}
  async function saveNow(kind,body,{eventId=null}={}){
   await fence();const at=now(),token=crypto.randomUUID(),payload=JSON.stringify(runtime.state),event=eventId??'live-event-'+crypto.randomUUID();const result=await db.batch([
    db.prepare("INSERT INTO live_event_runtime(owner_id,activation_id,revision,mutation_token,updated_at,body) SELECT ?,?,0,?,?,? WHERE EXISTS(SELECT 1 FROM operation_claims WHERE owner_id=? AND resource_id=? AND claim_token=? AND status='PENDING' AND lease_until>=?) ON CONFLICT(owner_id,activation_id) DO UPDATE SET revision=live_event_runtime.revision+1,mutation_token=excluded.mutation_token,updated_at=excluded.updated_at,body=excluded.body WHERE live_event_runtime.revision=?").bind(owner,runtimeId,token,at,payload,owner,resource,claim.token,Date.parse(at),runtime.revision),
    db.prepare('INSERT OR IGNORE INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM live_event_runtime WHERE owner_id=? AND activation_id=? AND mutation_token=?)').bind(event,owner,activation.id,kind,at,encodeLiveEventBody(safe({...body,...(memberContext?{programMember:memberContext.tag}:{}),policyRef:{manifestId:activation.config.manifestId,manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash}})),owner,runtimeId,token),
   ]);check(result[0]?.meta?.changes===1,'LIVE_RUNTIME_FENCE','다른 실행이 상태를 갱신했습니다.');runtime.revision++;return event;
  }
  async function record(kind,body){return save(kind,body);}
  async function dayLoss(position,at){
   if(memberContext)return memberContext.dayLoss(at);
   const day=at.slice(0,10),principal=signed(position.exact.initialCash);runtime.state.dayEquity??={};runtime.state.dayCapitalBasis??={};
   if(runtime.state.dayEquity[day]===undefined){runtime.state.dayEquity[day]=position.exact.equity;runtime.state.dayCapitalBasis[day]=position.exact.initialCash;}
   if(runtime.state.dayCapitalBasis[day]===undefined){
    // Existing daily marks predate capital editing; reconstruct their principal from transfer receipts.
    const rows=(await db.prepare("SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='CAPITAL_UPDATED' AND recorded_at>=? AND recorded_at<=?").bind(owner,activation.id,day+'T00:00:00.000Z',at).all()).results??[],flow=rows.reduce((sum,row)=>sum+signed(JSON.parse(row.body).capitalFlow??'0'),0n),basis=principal-flow;
    runtime.state.dayCapitalBasis[day]=basis<0n?'-'+out(-basis):out(basis);
   }
   const start=signed(runtime.state.dayEquity[day])+principal-signed(runtime.state.dayCapitalBasis[day]),current=n(position.exact.equity);return start>current?out(start-current):'0';
  }
  async function rejectProviderResponse(failed,failure,{recovered=false}={}){runtime.state.providerPending=null;runtime.state.providerUnknown=null;runtime.state.pendingDecision=null;runtime.state.cachedAnswers={};runtime.state.lastDecisionBar=Math.max(runtime.state.lastDecisionBar??-1,Math.floor(Date.parse(failed.snapshotAsOf)/(scope.decisionIntervalMs??Number(timeframe.slice(0,-1))*60000)));runtime.state.lastState='WAIT_NEXT_JEV_BAR';await save('JEV_RESPONSE_REJECTED',{callId:failed.callId,nodeId:failed.nodeId,snapshotAsOf:failed.snapshotAsOf,code:failure.code,usage:failure.provider.usage??null,httpStatus:failure.provider.httpStatus,automaticRetries:0,nextEvaluation:'NEXT_BAR_NEW_SNAPSHOT',recovered});statusState.policies[activation.id]={state:'WAIT_NEXT_JEV_BAR',code:failure.code,rejectedCallId:failed.callId};}
   async function pinned(config=activation.config){
    let m;
    if(options.workspace!=null||options.loadWorkspace){const w=options.workspace??await options.loadWorkspace(owner);m=w?.mindManifests?.find(m=>m.id===config.manifestId&&m.scope?.profileId===config.profileId);}
    else{const repository=options.repository??new WorkspaceRepository(db);if(typeof repository.readObject==='function')m=await repository.readObject(owner,'mindManifests',config.manifestId);else{const w=await readOperationalWorkspace(repository,owner);m=w?.mindManifests?.find(m=>m.id===config.manifestId&&m.scope?.profileId===config.profileId);}}
    check(m&&m.id===config.manifestId&&m.scope?.profileId===config.profileId&&mindDocumentHash(m)===config.manifestHash&&strategyGraphHash(m.data.strategyPlan.graph)===config.graphHash,'LIVE_PINNED_MANIFEST','사용자가 활성화한 정확한 발행 정책 원본을 확인하세요.');let deployment=null;if(programBinding(m)){
     if(memberContext){check(memberContext.tag.programHash===programBinding(m).programHash&&memberContext.member.manifestHash===mindDocumentHash(memberContext.member.manifest),'PROGRAM_CHILD_PIN','승인한 구성원 원문을 확인하세요.');const policy=clone(memberContext.member.manifest);policy.scope.profileId=config.profileId;return {manifest:policy,graph:policy.data.strategyPlan.graph,timeframe:memberContext.member.scope.timeframe,scope:memberContext.member.scope};}
     const repository=options.repository??new WorkspaceRepository(db),w=options.workspace??await (options.loadWorkspace?options.loadWorkspace(owner):readOperationalWorkspace(repository,owner));deployment=resolveProgramDeployment(m,w);check(hash(deployment.scope.marketIds)===hash(config.marketIds)&&deployment.scope.quoteCurrency===config.quoteCurrency&&deployment.requiresJev===config.requiresJev,'PROGRAM_ACTIVATION_PIN','승인한 묶음 범위와 판단 정책을 대조하세요.');return {manifest:m,graph:m.data.strategyPlan.graph,scope:deployment.scope,timeframe:deployment.scope.timeframe,deployment};
    }
    const graph=m.data.strategyPlan.graph,scope=eventAutomationScope(m),{timeframe}=scope;check(hash(scope.marketIds)===hash(config.marketIds)&&scope.quoteCurrency===config.quoteCurrency,'LIVE_RUNNER_MARKET_SCOPE','발행 정책과 활성화된 거래쌍을 맞추세요.');assertEventStrategyGraph(graph,scope);check(graph.nodes.find(n=>n.type==='ORDER')?.config.execution==='ACCOUNT'&&graphRequiresJev(graph)===config.requiresJev,'LIVE_PINNED_ORDER','활성화한 계좌 주문과 공급자 정책을 확인하세요.');return {manifest:m,graph,timeframe,scope};
   }
  let bookMaxAgeMs=3000;const readBook=async market=>freshBook(await (options.readBook??readAutomationBook)(market,{fetchImpl,clock:now}),market,now(),null,bookMaxAgeMs);
  const readiness=async market=>{const r=await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market,fetchImpl,clock:now});check(r.readiness?.ready,r.readiness?.blockedReasons?.[0]?.code??'LIVE_RUNNER_READINESS','현재 계좌·수수료·호가 단위를 확인하세요.');return r;};
  const permission=async()=>{const p=await (options.readPermission??readAutomationPermission)({db,owner,env});check(p?.status==='PASSED'&&p.orderWritePermission==='VERIFIED','LIVE_ORDER_WRITE_PERMISSION','현재 연결 계좌의 주문하기 권한을 확인하세요.');return p;};
  const bindings=(options.createBindings??createLiveAutomationBindings)({db,owner,activationId:activation.id,clock:now,readServerContext:async({plan})=>{await fence();await pinned();check(context,'LIVE_RUNNER_PLAN_CONTEXT','주문에 연결된 현재 계좌·호가를 확인하세요.');if(memberContext){const c=await memberContext.controller.load();return {...context,program:true,jevValidUntil:context.jevValidUntil??iso(Date.parse(c.state.classification.asOf)+memberContext.program.classifier.periodMs),jevCallsToday:await memberContext.jevCount(),assertProgram:()=>assertProgramOrder({db,owner,activation:activation,memberContext,plan,asOf:now()})};}return context;}}),adapter=(options.createOrderAdapter??createUpbitOrderAdapter)({...bindings,credentialProvider:options.credentialProvider??(()=>withUpbitReadConnection({db,owner,env},clone)),fetchImpl,clock:now});
  async function reconcile(row){await fence();return adapter.reconcile({idempotencyKey:row.idempotencyKey});}
  async function cancelProfits(market=null){for(const row of (await orders(activation.id)).filter(o=>isRestingTakeProfit(o)&&openStates.has(o.state)&&(!market||o.request.market===market))){await fence();await adapter.cancel({idempotencyKey:row.idempotencyKey});}return orders(activation.id);}
  let rows=await orders(activation.id);for(const row of rows.filter(o=>openStates.has(o.state)))await reconcile(row);rows=await orders(activation.id);for(const row of rows.filter(o=>isRestingTakeProfit(o)&&o.cancelAttempt&&openStates.has(o.state)))await adapter.cancel({idempotencyKey:row.idempotencyKey});activation=await currentActivation();rows=await orders(activation.id);const windowState=operationWindowState(activation.config,now());if(windowState!=='ACTIVE'){await cancelProfits();if(windowState==='ENDED'&&activation.status==='ENABLED')await (options.stopActivation??stopLiveAutomation)({db,owner,activationId:activation.id,now:now()});const target=windowState==='ENDED'?'PERIOD_ENDED':'WAITING_START',changed=runtime.state.lastState!==target;runtime.state.lastState=target;statusState.policies[activation.id]={state:target};if(changed)await save('OPERATION_WINDOW',{state:target,holdingsRetained:true});return;}
  if(activation.status!=='ENABLED')await cancelProfits();
  if(activation.status!=='ENABLED'){statusState.policies[activation.id]={state:'PAUSED',pending:rows.filter(o=>openStates.has(o.state)).length};return;}
  if((runtime.state.resumeRevision??0)!==(activation.resumeRevision??0)){
   const previous={pendingDecision:runtime.state.pendingDecision,hourlyValue:runtime.state.hourlyValue};
   Object.assign(runtime.state,{resumeRevision:activation.resumeRevision,pendingDecision:null,hourlyValue:null,cachedAnswers:{},cachedTiming:{},cachedMarket:null,lastDecisionBar:null});
   for(const key of marketCache.keys())if(key.startsWith(activation.id+':'))marketCache.delete(key);
   await save('RESUME_CONTEXT_RESET',{previous,resumedAt:activation.resumedAt,retainProviderOutcomeReconciliation:true});
  }
  if(activation.pendingStrategyUpdate){
   rows=await cancelProfits();
   if(rows.some(o=>openStates.has(o.state))){statusState.policies[activation.id]={state:'STRATEGY_UPDATE_WAIT_ORDERS',updateId:activation.pendingStrategyUpdate.id};return;}
   const update=activation.pendingStrategyUpdate;await pinned(update.config);
   await applyLiveStrategyUpdate({db,owner,activationId:activation.id,updateId:update.id,manifestHash:update.config.manifestHash,graphHash:update.config.graphHash,claimToken:claim.token,now:now()});activation=await currentActivation();
  }
  if((runtime.state.strategyRevision??0)!==(activation.strategyRevision??0)){
   const prior={strategyRevision:runtime.state.strategyRevision??0,providerPending:runtime.state.providerPending,providerUnknown:runtime.state.providerUnknown,pendingDecision:runtime.state.pendingDecision};
   Object.assign(runtime.state,{strategyRevision:activation.strategyRevision,cachedAnswers:{},cachedTiming:{},providerPending:null,providerUnknown:null,pendingDecision:null,lastDecisionBar:null,cachedMarket:null});
   for(const key of marketCache.keys())if(key.startsWith(activation.id+':'))marketCache.delete(key);
   await save('STRATEGY_CONTEXT_RESET',{previous:prior,manifestId:activation.config.manifestId,graphHash:activation.config.graphHash,strategyRevision:activation.strategyRevision,retryOriginalProviderRequest:false});
  }
  async function processFunding(market){
  if(activation.funding){
   const fundingRows=rows.filter(o=>o.purpose==='FUNDING'),pending=fundingRows.some(o=>openStates.has(o.state));if(pending){statusState.policies[activation.id]={state:'FUNDING_RECONCILING'};return true;}
   if(activation.funding.status==='FILLED'){
    const last=fundingRows[0];check(last,'LIVE_FUNDING_RECEIPT','실제 자금 전환 원장을 확인하세요.');if(runtime.state.fundingConfirmed!==last.identifier){const result=await reconcile(last);check(result.record?.state==='FILLED'&&result.record.reconciliation?.source?.httpStatus===200,'LIVE_FUNDING_GET_REQUIRED','동일 식별자의 실제 체결을 GET으로 확인한 뒤 전략을 시작합니다.');const fundedReady=await readiness(market);check(n(fundedReady.readiness.account.available)>=n(activation.config.capitalLimit),'LIVE_FUNDING_NET_CAPITAL','실제 전환 수수료 이후 가용 현금이 승인 운용액에 도달해야 합니다.');runtime.state.fundingConfirmed=last.identifier;await save('FUNDING_CONFIRMED_GET',{identifier:last.identifier});}activation=await currentActivation();
   }else{
    check(['REQUIRED','PARTIAL'].includes(activation.funding.status),'LIVE_FUNDING_REVIEW','초기 자금 전환의 실제 상태를 확인하세요.');const f=activation.funding,remaining=n(f.volume)-n(f.executedVolume??'0');check(remaining>0n,'LIVE_FUNDING_REMAINING','승인한 BTC 전환 잔량을 확인하세요.');const ready=await readiness(f.market),book=await readBook(f.market);await permission();const plan=previewUpbitOrder({intent:{market:f.market,side:'ask',ordType:'market',volume:out(remaining)},readiness:ready.readiness,book,now:now(),signalEvidence:{purpose:'USER_APPROVED_EXACT_FUNDING',approvedVolume:f.volume,remainingVolume:out(remaining),sourceHash:f.sourceHash},policyRef:{manifestId:activation.config.manifestId,manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash}});context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:ready.readiness,book,orderWritePermission:'VERIFIED'};await fence();const result=await adapter.submit({plan,activationId:activation.id,idempotencyKey:'fund:'+activation.id+':'+hash({executed:f.executedVolume??'0'}).slice(0,16)});await record('FUNDING_DISPATCH',{identifier:result.record?.identifier,state:result.record?.state,previewHash:plan.previewHash});statusState.policies[activation.id]={state:'FUNDING_SUBMITTED',orderState:result.record?.state};return true;
   }
  }
   return false;
  }
  async function processProgram(deployment){
   const store=await createRegimeRuntimeStore({db,owner,instanceId:activation.id,program:deployment.program});
   const readParent=async()=>{const actual=await get(activation.id),ledger=programAggregateLedger(await programFillRows({db,owner,activationId:actual.id}),actual,now());return {actual,ledger};};
   const jevCount=async()=>{const start=now().slice(0,10)+'T00:00:00.000Z';const a=await db.prepare("SELECT COUNT(*) AS n FROM regime_runtime_events WHERE owner_id=? AND instance_id=? AND kind='REGIME_PROVIDER_RESERVED' AND at>=?").bind(owner,activation.id,start).first(),b=await db.prepare("SELECT COUNT(*) AS n FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='JEV_STARTED' AND recorded_at>=?").bind(owner,activation.id,start).first();return Number(a.n)+Number(b.n);};
   const aggregateLoss=async at=>{const {ledger}=await readParent();let equity=ledger.cash;for(const [asset,p]of Object.entries(ledger.assets))if(p.quantity){const book=await readBook(deployment.scope.quoteCurrency+'-'+asset);equity+=p.quantity*n(book.levels[0].bidPrice)/Q;}return dayLoss({exact:{equity:out(equity),initialCash:out(ledger.initial)}},at);};
   const readOwn=async({orderPreviewHash=null}={})=>{const {ledger}=await readParent(),rows=(await orders(activation.id)).filter(o=>!(o.state==='RESERVED'&&orderPreviewHash&&o.plan?.previewHash===orderPreviewHash)),children=(await db.prepare('SELECT body FROM live_event_runtime WHERE owner_id=? AND activation_id LIKE ?').bind(owner,activation.id+':member:%').all()).results??[];return {hasPosition:Object.values(ledger.assets).some(p=>p.quantity>0n),hasOpenOrders:rows.some(o=>openStates.has(o.state)),hasUnknownOrders:rows.some(o=>['UNKNOWN','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED','RESERVED'].includes(o.state)),providerPending:children.some(r=>{const v=JSON.parse(r.body);return !!(v.providerPending||v.providerUnknown);})};};
   const result=await runRegimeProgram({program:deployment.program,models:deployment.resources,...store.controller,clock:now,env,fetchImpl,readInputs:options.readRegimeInputs,beforeClassify:async()=>{check(await jevCount()<activation.config.maxJevCallsPerDay,'PROGRAM_JEV_BUDGET','승인된 일일 판단 호출 한도에 도달했습니다.');await fence();},classify:async request=>{check(await jevCount()<=activation.config.maxJevCallsPerDay,'PROGRAM_JEV_BUDGET','승인된 일일 판단 호출 한도에 도달했습니다.');await fence();return (options.classifyRegime??(request=>callRegimeJevClassifier({request,env,fetchImpl,clock:now})))(request);},readOwn,runStrategy:async({model,selection,assertSelection})=>{
    const members=deployment.membersByTarget.get(model.id),saved=await store.children.load('allocation'),{actual,ledger}=await readParent();let allocation=saved?.epoch===selection.epoch?saved.runtime:null;
    if(!allocation){check(!Object.values(ledger.assets).some(p=>p.quantity>0n)&&!(await orders(activation.id)).some(o=>openStates.has(o.state)),'PROGRAM_ALLOCATION_SETTLEMENT','이전 묶음의 보유와 미확정 주문을 정리한 뒤 배분합니다.');allocation={budgets:allocateProgramCash(ledger.cash,members),cash:out(ledger.cash),targetHash:model.contentHash};await store.children.save({id:'allocation',modelHash:model.contentHash,epoch:selection.epoch,runtime:allocation,kind:'PROGRAM_ALLOCATION',evidence:allocation,selection,at:now()});}
    const controller=await store.controller.load(),draining=controller.state.phase==='DRAINING';
    if(draining){for(const row of (await orders(activation.id)).filter(o=>openStates.has(o.state)&&o.request?.side==='bid')){if(typeof adapter.cancel==='function')await adapter.cancel({idempotencyKey:row.idempotencyKey});await reconcile(row);}}
    const results=[];for(const member of members){await fence();const child={selection,member,budget:allocation.budgets[member.id],program:deployment.program,controller:store.controller,assertSelection,draining,dayLoss:aggregateLoss,jevCount,tag:programMemberTag(deployment,selection,member)};try{await processActivation(actual,claim,child);}catch(error){if(/CLAIM|LIVE_RUNTIME_FENCE|LIVE_RUNNER_STOPPED|PROGRAM_.*PIN/.test(error.code??''))throw error;statusState.policies[activation.id]={state:'BLOCKED',code:error.code??'PROGRAM_MEMBER_FAILED'};await save('PROGRAM_MEMBER_BLOCKED',{memberId:member.id,selection,code:statusState.policies[activation.id].code});}results.push({memberId:member.id,name:member.name,state:statusState.policies[activation.id]});}
    return results;
   }});
   runtime.state.lastState=result.phase;runtime.state.lastErrorCode=result.classificationError?.code??null;runtime.state.program={programHash:deployment.program.contentHash,phase:result.phase,targetName:deployment.resources.find(t=>t.contentHash===result.selection?.modelHash)?.name??null,selection:result.selection??null,members:result.result??[],classificationError:result.classificationError??null};
   const digest=hash(runtime.state.program);if(runtime.state.programHash!==digest){runtime.state.programHash=digest;await save('PROGRAM_DISPATCH',runtime.state.program);}statusState.policies[activation.id]={state:result.phase==='ACTIVE'?'PROGRAM_ACTIVE':result.phase,...(result.classificationError?{code:result.classificationError.code}:{}),program:runtime.state.program};
  }
  if(!memberContext&&activation.mandate?.durationDays===30&&!runtime.state.providerPending&&!runtime.state.providerUnknown){
   try{const promotion=await processMonthlyPortfolioPromotion({db,env,owner,policy:activation,clock:now,options});if(promotion.state==='STRATEGY_UPDATE_QUEUED'){await save('MONTHLY_MODEL_UPDATE_QUEUED',promotion);statusState.policies[activation.id]={state:promotion.state};return;}}
   catch(error){const code=error.code??error.message;if(runtime.state.monthlyPromotionIssue!==code){runtime.state.monthlyPromotionIssue=code;await save('MONTHLY_MODEL_UPDATE_REJECTED',{code});}}
  }
  const resolved=await pinned();
  if(resolved.deployment){if(await processFunding(resolved.scope.market))return;await processProgram(resolved.deployment);return;}
  bookMaxAgeMs=resolved.graph.nodes.find(n=>n.type==='ORDER')?.config.maxQuoteAgeMs??3000;
  const {manifest,graph,timeframe,scope}=resolved,multi=graph.executionScope?.kind==='EACH_ASSET',hourly=isHourlyRegimeGraph(graph),heldAssets=Object.entries(activation.positions??{}).filter(([,p])=>n(p.quantity)>0n);
  if(isAdaptivePortfolioGraph(graph)){
   check(!memberContext,'PORTFOLIO_MEMBER_SCOPE','공동 자금 학습 배분은 독립 운용 원장에 연결하세요.');
   if(await processFunding(scope.market))return;
   const readOwn=async market=>{
    await fence();activation=await currentActivation();await pinned();check(activation.status==='ENABLED'&&!activation.pendingStrategyUpdate,'LIVE_ACTIVATION_DISABLED','현재 승인된 운용 상태를 확인하세요.');
    const markets=[...new Set([market,...Object.entries(activation.positions??{}).filter(([,p])=>n(p.quantity)>0n).map(([asset])=>scope.quoteCurrency+'-'+asset)])],books={};
    const r=await readiness(market);for(const m of markets)books[m]=await readBook(m);
    const at=now();for(const m of markets)freshBook(books[m],m,at,null,bookMaxAgeMs);
    const position=await positionAccount({db,owner,activationId:activation.id,market,book:books[market],books,asOf:at});
    return {activation,position,book:books[market],readiness:r.readiness};
   };
   const placeProfit=async market=>placeRestingTakeProfit({graph,activationId:activation.id,market,rows:await orders(activation.id),readOwn,clock:now,submit:async({own,plan,key})=>{
    await permission();context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:own.readiness,book:own.book,orderWritePermission:'VERIFIED'};await fence();const result=await adapter.submit({plan,activationId:activation.id,idempotencyKey:key});await save('RESTING_TAKE_PROFIT_DISPATCH',{identifier:result.record?.identifier,state:result.record?.state,entryIdentifier:plan.signalEvidence.entryIdentifier,price:plan.intent.price,quantity:plan.intent.volume});return result;
   }});
   const protectProfit=async market=>{try{return await placeProfit(market);}catch(error){const code=error.code??'RESTING_TAKE_PROFIT_ERROR';if(runtime.state.takeProfitIssue!==code){runtime.state.takeProfitIssue=code;await save('RESTING_TAKE_PROFIT_RETRY',{market,code});}return null;}};
   if(graph.nodes.find(n=>n.type==='ORDER').config.takeProfitBps)for(const [asset]of heldAssets)await protectProfit(scope.quoteCurrency+'-'+asset);
   const result=await processAdaptivePortfolio({graph,scope,state:runtime.state,clock:now,readOrders:async()=>(await strategyOrders()).filter(o=>!isWorkingTakeProfit(o)),readOwn,save,capture:()=>capturePortfolioSources({graph,capture:async sourceSpec=>{
    const captured=await (options.adaptivePortfolioSource??(sourceSpec.timeframe==='1m'?readMinuteSurgeMarket:sourceSpec.timeframe==='1d'?readDailyPortfolioMarket:readHourlyRegimeMarket))({db,owner,activationId:activation.id,ownedMarketIds:heldAssets.map(([asset])=>scope.quoteCurrency+'-'+asset),policy:graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST')?.config.policy,marketIds:portfolioSourceMarkets(sourceSpec,scope.marketIds),historyBars:sourceSpec.historyBars,allowShortHistory:sourceSpec.allowShortHistory,eligibleOnly:true,fetchImpl,clock:now,heartbeat:()=>renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000})});
    if(graph.nodes.some(n=>n.type==='PORTFOLIO_EXPERT'&&n.config.mode==='NEWS')){
     let collector;try{const {refreshPortfolioNews}=await import('./portfolio-news-collector.mjs');collector=await refreshPortfolioNews({db,owner,env,fetchImpl,clock:now,guard:async()=>{await fence();await renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000});}});}catch(error){collector={issues:[{code:error.code??'NEWS_SOURCE',message:error.message}]};}
     await save('PORTFOLIO_NEWS_SOURCE_STATUS',{completed:collector.completed??[],issues:collector.issues??[]});
     const news=await readPortfolioNews({db,owner,asOf:now()});news.collector={completed:collector.completed?.length??0,issues:collector.issues??[]};captured.frame={...captured.frame,news,availableAt:now(),sourceRefs:[...captured.frame.sourceRefs,...news.sourceRefs]};
    }
    await save('PORTFOLIO_SOURCE',{...captured,inputNodeId:sourceSpec.input.id});return captured.frame;
   }}),resolveQuestions:async({args,boundary,own})=>resolvePortfolioQuestions({graph,args,boundary,state:runtime.state,save,env,fetchImpl,clock:now,guard:async({calling})=>{
    await renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000});await fence();activation=await currentActivation();await pinned();
    check(activation.status==='ENABLED'&&!activation.pendingStrategyUpdate,'LIVE_ACTIVATION_DISABLED','현재 승인된 운용 상태를 확인하세요.');check(operationWindowState(activation.config,now())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');
    check(!runtime.state.providerPending&&!runtime.state.providerUnknown,'LIVE_JEV_OUTCOME_UNKNOWN','이전 질문의 응답 확인이 필요합니다.');
    if(calling){check(await dailyCount()<activation.config.maxJevCallsPerDay,'LIVE_JEV_DAILY_BUDGET','일별 승인한 JEV 호출 예산을 모두 사용했습니다.');
     if(!own.position.positions.some(p=>p.marketValue>0)){const capacity=await readLiveAutomationEntryCapacity({db,owner,activationId:activation.id,now:now(),dayLoss:await dayLoss(own.position,now())}),budget=min(n(own.position.exact.cash),n(capacity.cashRemaining),n(capacity.capitalRemaining),n(activation.config.perOrderLimit),n(own.readiness.account.available));check(budget*Q/(Q+maxRate(own.readiness.fees,true))>=n(own.readiness.rules.minBuyTotal),'LIVE_MINIMUM_ORDER','최소 매수가 불가능해 유료 판단을 생략합니다.');}
    }
   }}),execute:async({own,market,evaluation,key,boundary})=>{
    if(evaluation.output.decision.action==='sell'){
     const current=await orders(activation.id);if(current.some(o=>isRestingTakeProfit(o)&&openStates.has(o.state)&&o.request.market===market)){
      const remaining=await cancelProfits(market);check(!remaining.some(o=>isRestingTakeProfit(o)&&openStates.has(o.state)&&o.request.market===market),'RESTING_TAKE_PROFIT_CANCEL_PENDING','지정가 익절 주문의 취소·부분 체결을 대사하고 남은 수량을 청산합니다.');activation=await currentActivation();own=await readOwn(market);
     }
    }
    await permission();freshBook(own.book,market,now(),null,bookMaxAgeMs);
    const entryCapacity=evaluation.output.decision.action==='buy'?await readLiveAutomationEntryCapacity({db,owner,activationId:activation.id,now:now(),dayLoss:await dayLoss(own.position,now())}):null;
    const plan=exactPlan({activation:own.activation,account:own.position,evaluation,book:own.book,readiness:own.readiness,now:now(),entryCapacity,signalEvidence:{snapshotAsOf:boundary,evaluationHash:evaluation.outputHash,inputHash:evaluation.sourceHash,portfolioTarget:evaluation.output.value},participationRate:graph.nodes.find(n=>n.type==='ORDER').config.participationRate??.1});
    context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:own.readiness,book:own.book,orderWritePermission:'VERIFIED',dayLoss:await dayLoss(own.position,now()),jevValidUntil:iso(Date.parse(boundary)+portfolioSourceSpec(graph).stepMs),jevCallsToday:await dailyCount()};await fence();const result=await adapter.submit({plan,activationId:activation.id,idempotencyKey:key});
    if(plan.intent.side==='bid'&&result.record?.state==='FILLED'&&graph.nodes.find(n=>n.type==='ORDER').config.takeProfitBps){activation=await currentActivation();await protectProfit(market);}return result;
   }});
   runtime.state.lastState=result.state;statusState.policies[activation.id]=result;return;
  }
  check(heldAssets.length<=1,'LIVE_RUNNER_POSITION_SCOPE','동시 1종목 전략의 보유 수량을 대조하세요.');
  if(runtime.state.providerPending){runtime.state.providerUnknown={...runtime.state.providerPending,status:'EXTERNAL_OUTCOME_UNKNOWN',detectedAt:now()};runtime.state.providerPending=null;await save('JEV_OUTCOME_UNKNOWN',runtime.state.providerUnknown);}
  if(runtime.state.providerUnknown?.status==='RESPONSE_REVIEW_REQUIRED'){const failed=runtime.state.providerUnknown,row=await db.prepare("SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND id=? AND kind='JEV_FAILURE'").bind(owner,activation.id,failed.callId+'-failure').first(),failure=row?JSON.parse(row.body):null;if(isRejectedProviderResponse(failure,failed))await rejectProviderResponse(failed,failure,{recovered:true});}
  let market=heldAssets.length?activation.config.quoteCurrency+'-'+heldAssets[0][0]:runtime.state.pendingDecision?.market??scope.market;
  let hourlyCapture=null,hourlyDecision=null;
  const quoteBranches=hourly&&graph.nodes.some(n=>n.type==='INPUT'&&n.config.kind==='POSITION');
  if(hourly&&!quoteBranches&&!runtime.state.pendingDecision&&runtime.state.lastDecisionBar===Math.floor(Date.parse(now())/3600000)){statusState.policies[activation.id]={state:'WAIT_NEXT_CLOSED_BAR'};return;}
  check(scope.marketIds.includes(market),'LIVE_RUNNER_MARKET_SCOPE','보유 종목과 대기 신호가 발행 범위에 속해야 합니다.');
  if(runtime.state.cachedMarket&&runtime.state.cachedMarket!==market)runtime.state.cachedAnswers={};
  const portfolioFor=(position,asOf)=>({profileId:activation.config.profileId,quoteCurrency:scope.quoteCurrency,asOf,equity:position.equity,cashWeight:position.cash/position.equity,weights:position.positions.map(p=>({instrumentId:p.instrumentId,weight:p.marketValue/position.equity})),lastRebalancedAt:null,universeHash:scope.universeHash});
  if(!memberContext&&await processFunding(market))return;
  if(memberContext?.draining){
   if(rows.some(o=>openStates.has(o.state))){statusState.policies[activation.id]={state:'PROGRAM_DRAIN_WAIT_ORDERS'};return;}
   if(!heldAssets.length)return;
   const ownedMarket=scope.quoteCurrency+'-'+heldAssets[0][0],r=await readiness(ownedMarket),book=await readBook(ownedMarket),position=await positionAccount({db,owner,activationId:activation.id,market:ownedMarket,book,asOf:now()});await permission();
   const evaluation={output:{ready:true,orderAllowed:true,riskAllowed:true,execution:'LIVE',orderPolicy:{orderType:'LIMIT_FOK',maxSlippageBps:20},decision:{action:'sell',targetWeight:0,intent:{reason:'PROGRAM_GROUP_HANDOVER'}}}},plan=exactPlan({activation,account:position,evaluation,book,readiness:r.readiness,now:now(),signalEvidence:{programMember:memberContext.tag,purpose:'PROGRAM_GROUP_HANDOVER',snapshotAsOf:now()},participationRate:options.participationRate??.1});
   context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:r.readiness,book,orderWritePermission:'VERIFIED',dayLoss:await dayLoss(position,now())};await fence();const result=await adapter.submit({plan,activationId:activation.id,idempotencyKey:'handover:'+hash({runtimeId,quantity:heldAssets[0][1].quantity,attempt:rows.filter(o=>o.plan?.signalEvidence?.purpose==='PROGRAM_GROUP_HANDOVER'&&o.plan.signalEvidence.programMember?.memberId===memberContext.member.id&&o.plan.signalEvidence.programMember?.epoch===memberContext.selection.epoch).length})});await save('PROGRAM_HANDOVER_DISPATCH',{identifier:result.record?.identifier,state:result.record?.state});return;
  }
  if(isHourlyValueGraph(graph)||isHourlyScreenGraph(graph)){
   if(rows.some(o=>openStates.has(o.state))){statusState.policies[activation.id]={state:'ORDER_RECONCILING'};return;}
   const readOwn=async selected=>{
    await fence();activation=await currentActivation();await pinned();
    check(activation.status==='ENABLED'&&!activation.pendingStrategyUpdate,'LIVE_ACTIVATION_DISABLED','현재 승인된 모델의 실행 상태를 확인하세요.');
    const held=Object.entries(activation.positions??{}).find(([,p])=>n(p.quantity)>0n),market=selected??(held?scope.quoteCurrency+'-'+held[0]:scope.market),r=await readiness(market),book=await readBook(market),position=await positionAccount({db,owner,activationId:activation.id,market,book,asOf:now()});
    return {activation,position,readiness:r.readiness,book};
   };
   const onRecord=body=>save('HOURLY_VALUE_SOURCE',body),source=options.hourlyValueSource??{
    snapshot:async()=>{const a=await currentActivation(),ownedMarketIds=Object.entries(a.positions??{}).filter(([,p])=>n(p.quantity)>0n).map(([asset])=>scope.quoteCurrency+'-'+asset);return captureHourlyValueMarket({marketIds:scope.marketIds,ownedMarketIds,fetchImpl,clock:now,onRecord,heartbeat:()=>renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000})});},
    readReview:args=>readHourlyValueReview({...args,fetchImpl,clock:now,onRecord})
   };
   const screening=isHourlyScreenGraph(graph),screenSource=screening?(options.hourlyScreenSource??hourlyScreenSource({marketIds:scope.marketIds,profileId:activation.config.profileId,clock:now,fetchImpl,onRecord:body=>save('HOURLY_SCREEN_SOURCE',body),heartbeat:()=>renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000})})):source;
   const result=await (screening?processHourlyScreenAccount:processHourlyValueLive)({manifest,graph,runtime:runtime.state,clock:now,readOwn,readOrders:strategyOrders,source:screenSource,save,ledgerHash:own=>liveHourlyValueAccount(own.activation,own.position,now()).sourceHash,hasPosition:()=>Object.values(activation.positions??{}).some(p=>n(p.quantity)>0n),execute:async signal=>{
    check(now()>=signal.readyAt&&now()<signal.expiresAt,'LIVE_SIGNAL_EXPIRED','고정된 판단의 준비 시각과 유효기간을 확인하세요.');
    const own=await readOwn(signal.market);if(signal.key.startsWith('profit:'))freshBook(own.book,signal.market,now(),signal.readyAt);check(liveHourlyValueAccount(own.activation,own.position,now()).sourceHash===signal.ledgerHash,'HOURLY_VALUE_LEDGER_CHANGED','판단 이후 자기 계좌가 바뀌었습니다.');await permission();
    const plan=exactPlan({activation:own.activation,account:own.position,evaluation:signal.evaluation,book:own.book,readiness:own.readiness,now:now(),signalEvidence:{...(memberContext?{programMember:memberContext.tag,programSignalKey:signal.key}:{}),snapshotAsOf:signal.snapshotAsOf,evaluationHash:signal.evaluation.outputHash,sourceHash:signal.sourceHash,hourlyValue:signal.evaluation.output.decision.hourlyValue},participationRate:options.participationRate??graph.nodes.find(n=>n.type==='ORDER').config.participationRate??.1});
    context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:own.readiness,book:own.book,orderWritePermission:'VERIFIED',dayLoss:await dayLoss(own.position,now()),jevCallsToday:0};
    await fence();const r=await adapter.submit({plan,activationId:activation.id,idempotencyKey:memberContext?'member:'+hash({runtimeId,key:signal.key}):signal.key});await save('STRATEGY_DISPATCH',{idempotencyKey:memberContext?'member:'+hash({runtimeId,key:signal.key}):signal.key,identifier:r.record?.identifier,state:r.record?.state,previewHash:plan.previewHash,signal:signal.snapshotAsOf});return r;
   }});
   statusState.policies[activation.id]=result;return;
  }
  const excludedCandidates=[],initialBooks=new Map();let book;
  try{book=await readBook(market);}catch(error){
   if(!multi||heldAssets.length||runtime.state.pendingDecision||error.code!=='LIVE_RUNNER_BOOK_TIME')throw error;
   excludedCandidates.push({market,code:error.code,...error.bookTime});
   const alternatives=await Promise.all(scope.marketIds.filter(m=>m!==market).map(async m=>{try{return {market:m,book:await readBook(m)};}catch(problem){if(problem.code!=='LIVE_RUNNER_BOOK_TIME')throw problem;excludedCandidates.push({market:m,code:problem.code,...problem.bookTime});return null;}}));
   for(const value of alternatives.filter(Boolean))initialBooks.set(value.market,value.book);const selected=alternatives.find(Boolean);if(!selected)throw error;market=selected.market;book=selected.book;
  }
  let at=now(),position=await positionAccount({db,owner,activationId:activation.id,market,book,asOf:at}),held=n(activation.positions?.[market.split('-')[1]]?.quantity??'0')>0n;
  const pending=rows.filter(o=>openStates.has(o.state));if(!held&&pending.length){statusState.policies[activation.id]={state:'ORDER_RECONCILING',pending:pending.length};return;}
  const cacheKey=market=>runtimeId+':'+market;
  let cache=marketCache.get(cacheKey(market)),barKey=Math.floor(Date.parse(hourlyCapture?.frame.asOf??at)/(scope.decisionIntervalMs??Number(timeframe.slice(0,-1))*60000));
  async function cancelEntryRemainders(){const current=await orders(activation.id);for(const o of current.filter(o=>openStates.has(o.state)&&o.request?.side==='bid')){check(typeof adapter.cancel==='function','LIVE_CANCEL_BEFORE_PROTECTION','미체결 매수 잔량을 취소·대사한 뒤 실제 보유를 보호합니다.');await fence();await adapter.cancel({idempotencyKey:o.idempotencyKey});await reconcile(o);}check(!(await orders(activation.id)).some(o=>openStates.has(o.state)&&o.request?.side==='bid'),'LIVE_CANCEL_CONFIRMATION_REQUIRED','미체결 매수 취소를 GET으로 대사하고 있습니다.');}
  // Protection runs first on each one-second book tick. It neither waits for new
  // candle/trade HTTP requests nor enters the provider branch of a holding router.
  async function protectHeldPosition(duringProvider,{book,at,position}){
   if(hourly&&!quoteBranches)return false;
   if(!held||n(activation.positions?.[market.split('-')[1]]?.quantity??'0')===0n)return false;
   const rawSources=book.rawSource?[book.rawSource]:[],sourceRef={id:'book-source-'+book.sourceHash.slice(0,24),contentHash:book.sourceHash,sourceRef:book.sourceUrl??'https://api.upbit.com/v1/orderbook'},body={instrumentId:'crypto:upbit:'+market,market,timeframe,asOf:at,availableAt:at,bars:cache?.bars??[],events:[...(cache?.trades?.events??[]),book],feeSnapshot:cache?.feeSnapshot??null,sourceRefs:[sourceRef]},dataset={...body,sourceHash:hash(body)},prepared=prepareEventStrategyInputs({graph,dataset,positionAccount:position,profileId:activation.config.profileId,accountId:position.id,asOf:at,decisions:runtime.state.cachedAnswers,executionMode:'LIVE',portfolio:multi?portfolioFor(position,at):null}),evaluation=prepared.request.state.strategyEvaluation.graphEvaluation;
   if(evaluation.output.ready&&['hold','sell'].includes(evaluation.output.decision?.action)&&(!duringProvider||evaluation.output.decision.action==='sell')){
    runtime.state.lastEvaluationAt=at;if(evaluation.output.decision.action==='hold'||!evaluation.output.orderAllowed){runtime.state.lastState='HOLD_PROTECTION';await save('PROTECTION_HOLD',{snapshotAsOf:at,sourceHash:dataset.sourceHash,evaluationHash:evaluation.outputHash});statusState.policies[activation.id]={state:'HOLD_PROTECTION',providerUnknown:!!runtime.state.providerUnknown};return true;}
    await cancelEntryRemainders();const signal={market,snapshotAsOf:at,readyAt:now(),validUntil:iso(Date.parse(at)+60000),inputHash:prepared.inputHash,sourceHash:dataset.sourceHash,evaluation,...(hourly?{quoteDecision:true}:{})};runtime.state.pendingDecision=signal;await save('PROTECTION_DECISION_READY',{...signal,dataset,rawSources,positionAccount:position});await submitDecision(signal);return true;
   }
   return false;
  }
  if(await protectHeldPosition(false,{book,at,position}))return;
  if(runtime.state.pendingDecision&&runtime.state.pendingDecision.validUntil<=at){const expired=runtime.state.pendingDecision;runtime.state.pendingDecision=null;await save('DECISION_EXPIRED',{snapshotAsOf:expired.snapshotAsOf,expiredAt:at,validUntil:expired.validUntil});}
  async function submitDecision(signal){
   try{
   check(!signal.market||signal.market===market,'LIVE_SIGNAL_MARKET','판단한 종목과 주문 종목을 맞추세요.');
   if(multi&&!held&&signal.evaluation.output.decision?.action==='buy')check(signal.evaluation.trace.some(t=>t.type==='SELECT'&&t.output.value?.instrumentIds.includes('crypto:upbit:'+market)),'LIVE_CANDIDATE_NOT_SELECTED','선택 노드가 고른 종목만 진입합니다.');
   check(signal.validUntil>now(),'LIVE_JEV_EXPIRED','신호 스냅샷의 유효기간이 끝났습니다.');activation=await currentActivation();check(activation.status==='ENABLED','LIVE_ACTIVATION_DISABLED','중지된 운용은 새 주문을 제출하지 않습니다.');
   if(activation.pendingStrategyUpdate){statusState.policies[activation.id]={state:'STRATEGY_UPDATE_PENDING',updateId:activation.pendingStrategyUpdate.id};return;}
   check((memberContext?.member.graphHash??activation.config.graphHash)===strategyGraphHash(graph),'LIVE_UPDATE_STALE_DECISION','새 전략과 이전 판단을 섞지 않습니다.');
   const r=await readiness(market);book=await readBook(market);freshBook(book,market,now(),signal.readyAt);await permission();position=await positionAccount({db,owner,activationId:activation.id,market,book,asOf:now()});
   if(signal.quoteDecision){
    const checkedAt=now(),rawSources=[...(book.rawSource?[book.rawSource]:[]),...(r.rawSources??[])],body={instrumentId:'crypto:upbit:'+market,market,timeframe,asOf:checkedAt,availableAt:checkedAt,bars:[],events:[book],feeSnapshot:r.readiness.fees,sourceRefs:[{id:'book-source-'+book.sourceHash.slice(0,24),contentHash:book.sourceHash,sourceRef:book.sourceUrl??'https://api.upbit.com/v1/orderbook'}]},dataset={...body,sourceHash:hash(body)},prepared=prepareEventStrategyInputs({graph,dataset,positionAccount:position,profileId:activation.config.profileId,accountId:position.id,asOf:checkedAt,executionMode:'LIVE'}),evaluation=prepared.request.state.strategyEvaluation.graphEvaluation;
    if(!evaluation.output.ready||!evaluation.output.orderAllowed||evaluation.output.decision?.action!=='sell'){runtime.state.pendingDecision=null;await save('QUOTE_DECISION_WITHDRAWN',{originalSnapshotAsOf:signal.snapshotAsOf,dataset,rawSources,evaluation,positionAccount:position});statusState.policies[activation.id]={state:'QUOTE_CONDITION_CHANGED'};return;}
    signal={...signal,snapshotAsOf:checkedAt,readyAt:checkedAt,validUntil:iso(Date.parse(checkedAt)+60000),inputHash:prepared.inputHash,sourceHash:dataset.sourceHash,evaluation};runtime.state.pendingDecision=signal;
    await save('QUOTE_DECISION_RECHECKED',{...signal,dataset,rawSources,positionAccount:position});
   }
   const plan=exactPlan({activation,account:position,evaluation:signal.evaluation,book,readiness:r.readiness,now:now(),signalEvidence:{...(memberContext?{programMember:memberContext.tag}:{}),snapshotAsOf:signal.snapshotAsOf,providerReadyAt:signal.readyAt,validUntil:signal.validUntil,inputHash:signal.inputHash,evaluationHash:signal.evaluation.outputHash,sourceHash:signal.sourceHash},participationRate:options.participationRate??.1}),stats=await dailyCount(),loss=await dayLoss(position,now());
   context={manifestHash:activation.config.manifestHash,graphHash:activation.config.graphHash,readiness:r.readiness,book,orderWritePermission:'VERIFIED',jevValidUntil:signal.validUntil,jevCallsToday:stats,dayLoss:loss};
   const key='strategy:'+runtimeId+':'+hash({snapshotAsOf:signal.snapshotAsOf,decision:signal.evaluation.output.decision,book:signal.sourceHash}).slice(0,24);await fence();const result=await adapter.submit({plan,activationId:activation.id,idempotencyKey:key});runtime.state.pendingDecision=null;runtime.state.lastDispatchFailure=null;runtime.state.lastState='ORDER_'+result.record?.state;await save('STRATEGY_DISPATCH',{idempotencyKey:key,identifier:result.record?.identifier,state:result.record?.state,previewHash:plan.previewHash,signal:signal.snapshotAsOf});statusState.policies[activation.id]={state:runtime.state.lastState,identifier:result.record?.identifier};return result;
   }catch(error){const code=error.code??'LIVE_DISPATCH_FAILURE';if(code==='UPBIT_ENTRY_INELIGIBLE'){runtime.state.pendingDecision=null;runtime.state.cachedAnswers={};runtime.state.lastState='ENTRY_EXCLUDED';}const key=signal.snapshotAsOf+':'+code;if(runtime.state.lastDispatchFailure!==key){runtime.state.lastDispatchFailure=key;await save('ORDER_DISPATCH_BLOCKED',{snapshotAsOf:signal.snapshotAsOf,readyAt:signal.readyAt,validUntil:signal.validUntil,code,...(error.bookTime?{bookTime:error.bookTime}:{})});}throw error;}
  }
  async function dailyCount(){return Number((await db.prepare("SELECT COUNT(*) AS n FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='JEV_STARTED' AND recorded_at>=? AND recorded_at<?").bind(owner,activation.id,now().slice(0,10)+'T00:00:00.000Z',iso(Date.parse(now().slice(0,10)+'T00:00:00.000Z')+86400000)).first()).n);}
  if(runtime.state.pendingDecision){if(runtime.state.providerUnknown&&runtime.state.pendingDecision.evaluation.output.decision?.action==='buy'){statusState.policies[activation.id]={state:'JEV_OUTCOME_UNKNOWN'};return;}await submitDecision(runtime.state.pendingDecision);return;}
  if(runtime.state.lastDecisionBar===barKey){statusState.policies[activation.id]={state:held?'WAIT_NEXT_JEV_BAR':'WAIT_NEXT_CLOSED_BAR'};return;}
  if(hourly){
   hourlyCapture=await (options.readHourlyRegimeMarket??readHourlyRegimeMarket)({marketIds:scope.marketIds,fetchImpl,clock:now,heartbeat:()=>renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000})});
   hourlyDecision=hourlyRegimeDecision(hourlyCapture.frame,held?{market,leg:runtime.state.hourlyLeg}:null);
   if(!held&&hourlyDecision.action!=='buy'){runtime.state.lastDecisionBar=barKey;runtime.state.lastState='QUANT_ENTRY_NOT_ELIGIBLE';await save('HOURLY_REGIME_WAIT',{frame:hourlyCapture.frame,decision:hourlyDecision,rawSources:hourlyCapture.rawSources});statusState.policies[activation.id]={state:'QUANT_ENTRY_NOT_ELIGIBLE'};return;}
   if(!held){market=hourlyDecision.market;runtime.state.hourlyLeg=hourlyDecision.leg;}
  }
  async function loadSignal(market,observedBook=null){
   if(hourly){
    const r=await readiness(market),book=await readBook(market),asOf=now(),fullFrame=hourlyCapture.frame,eligibility=fullFrame.entryEligibility;
    check(!eligibility||eligibility.markets?.[market],'HOURLY_REGIME_SOURCE','선택 종목의 거래 자격 원문을 확인하세요.');
    // The full market registry stays in rawSources; this execution consumes one market's eligibility.
    const frame=eligibility?{...fullFrame,entryEligibility:{...eligibility,markets:{[market]:eligibility.markets[market]}}}:fullFrame;
    const rawSources=[...hourlyCapture.rawSources,...(book.rawSource?[book.rawSource]:[]),...(r.rawSources??[])],body={id:'hourly-signal:'+activation.id+':'+asOf,instrumentId:'crypto:upbit:'+market,market,timeframe,asOf,availableAt:asOf,bars:[],events:[book],feeSnapshot:r.readiness.fees,sourceRefs:rawSources.map(s=>({id:s.id??'source-'+s.rawSha256,contentHash:s.rawSha256,sourceRef:s.sourceUrl})),hourlyRegime:{frame,decision:hourlyDecision,recentOrders:rows.filter(o=>o.state==='FILLED').slice(0,8).reverse().map(o=>({at:o.completedAt??o.startedAt??o.reservedAt,side:o.request?.side,market:o.request?.market})).filter(o=>o.at&&o.side&&o.market)}};
    return {dataset:{...body,sourceHash:hash(body)},rawSources,book,readiness:r.readiness,cache:{bars:[],feeSnapshot:r.readiness.fees}};
   }

   let c=marketCache.get(cacheKey(market));
   if(!c||c.barKey!==barKey){const candles=await (options.readCandles??readUpbitScalpingCandles)({market,timeframe,count:100,maxPages:1,fetchImpl,clock:now});c={barKey,bars:candles.bars.map(b=>({...b,availableAt:b.availableAt??candles.rawSources?.at(-1)?.receivedAt??candles.availableAt})),rawSources:clone(candles.rawSources??[]),trades:null,tradesAt:null};marketCache.set(cacheKey(market),c);}
   if(!c.tradesAt||Date.parse(now())-Date.parse(c.tradesAt)>=5000){c.trades=await (options.readTrades??defaultTrades)(market,{fetchImpl,clock:now});c.tradesAt=now();}
   const r=await readiness(market);c.feeSnapshot=clone(r.readiness.fees);let book=observedBook;
   try{freshBook(book,market,now());}catch{book=await readBook(market);}
   const asOf=now(),rawSources=[...c.rawSources,...(c.trades.rawSources??[]),...(book.rawSource?[book.rawSource]:[]),...(r.rawSources??[])],events=[...(c.trades.events??[]),book].filter(e=>e.eventTime<=asOf&&e.receivedAt<=asOf&&(!e.availableAt||e.availableAt<=asOf)),body={id:'live-signal:'+activation.id+':'+market+':'+asOf,instrumentId:'crypto:upbit:'+market,market,timeframe,asOf,availableAt:asOf,bars:c.bars,events,feeSnapshot:r.readiness.fees,sourceRefs:rawSources.map(s=>({id:s.id??'source-'+s.rawSha256,contentHash:s.rawSha256,sourceRef:s.sourceUrl})),flowCoverage:c.trades.coverage??null};
   check(body.sourceRefs.length>0&&body.bars.every(b=>b.availableAt&&b.availableAt<=asOf),'LIVE_SIGNAL_SOURCES','실제로 확보한 분봉·체결 원문과 확인 시각을 보존하세요.');
   return {dataset:{...body,sourceHash:hash(body)},rawSources,book,readiness:r.readiness,cache:c};
  }
  const captured=await Promise.all((multi?scope.marketIds:[market]).map(async m=>{try{return await loadSignal(m,m===market?book:initialBooks.get(m));}catch(error){if(!multi||held&&m===market||error.code!=='LIVE_RUNNER_BOOK_TIME')throw error;excludedCandidates.push({market:m,code:error.code,...error.bookTime});return null;}})),snapshots=[];
  for(let snapshot of captured.filter(Boolean)){try{freshBook(snapshot.book,snapshot.dataset.market,now());}catch(error){
   if(!multi||error.code!=='LIVE_RUNNER_BOOK_TIME')throw error;
   if(held&&snapshot.dataset.market===market)snapshot=await loadSignal(market);else{excludedCandidates.push({market:snapshot.dataset.market,code:error.code,...error.bookTime});continue;}
  }snapshots.push(snapshot);}
  check(snapshots.length,'LIVE_RUNNER_BOOK_TIME','투자 범위에서 3초 이내의 유효 호가를 기다립니다.');
  const excluded=[...new Map(excludedCandidates.filter(c=>!snapshots.some(s=>s.dataset.market===c.market)).map(c=>[c.market,c])).values()];
  if(excluded.length&&runtime.state.candidateExclusionBar!==barKey){runtime.state.candidateExclusionBar=barKey;await save('CANDIDATE_DATA_EXCLUDED',{snapshotAt:now(),candidates:excluded,reason:'PER_MARKET_QUOTE_FRESHNESS',executionBookMaxAgeMs:3000});}
  if(!snapshots.some(s=>s.dataset.market===market))market=snapshots[0].dataset.market;
  const datasets=snapshots.map(s=>s.dataset);
  at=now();let current=snapshots.find(s=>s.dataset.market===market),dataset=current.dataset,rawSources=snapshots.flatMap(s=>s.rawSources),r={readiness:current.readiness};book=current.book;cache=current.cache;
  position=await positionAccount({db,owner,activationId:activation.id,market,book,asOf:at});
  const candidateInput=multi?buildEventCandidateInput({datasets,profileId:activation.config.profileId,asOf:at,timeframe,universeHash:scope.universeHash,maxCandidates:graph.executionScope.maxCandidates}):null;
  const prepare=(source,frameAnswers={})=>prepareEventStrategyInputs({graph,dataset:source,positionAccount:position,profileId:activation.config.profileId,accountId:position.id,asOf:at,decisions:runtime.state.cachedAnswers,frameAnswers,executionMode:'LIVE',candidateInput,portfolio:multi?portfolioFor(position,at):null});
  if(multi&&!held){const chosen=datasets.find(d=>prepare(d).request.state.strategyEvaluation.graphEvaluation.trace.some(t=>t.type==='SELECT'&&t.output.value?.instrumentIds.includes(d.instrumentId)));if(chosen){market=chosen.market;current=snapshots.find(s=>s.dataset.market===market);dataset=chosen;book=current.book;cache=current.cache;r={readiness:current.readiness};if(runtime.state.cachedMarket&&runtime.state.cachedMarket!==market)runtime.state.cachedAnswers={};}}
  let prepared=prepare(dataset),evaluation=prepared.request.state.strategyEvaluation,ge=evaluation.graphEvaluation;
  runtime.state.lastEvaluationAt=at;const snapshotLoss=await dayLoss(position,at);
  if(ge.requiredJevNodeIds?.length){
   if(runtime.state.providerUnknown){statusState.policies[activation.id]={state:'JEV_OUTCOME_UNKNOWN',protectiveEvaluation:true};return;}
   if(runtime.state.lastDecisionBar===barKey){statusState.policies[activation.id]={state:'WAIT_NEXT_JEV_BAR'};return;}
   if(!held){
    const capacity=await readLiveAutomationEntryCapacity({db,owner,activationId:activation.id,now:at,dayLoss:snapshotLoss}),budget=min(n(position.exact.cash),n(capacity.cashRemaining),n(capacity.capitalRemaining),n(activation.config.perOrderLimit),n(r.readiness.account.available)),minimum=n(r.readiness.rules.minBuyTotal);
    check(budget*Q/(Q+maxRate(r.readiness.fees,true))>=minimum,'LIVE_MINIMUM_ORDER','최소 매수가 불가능해 유료 판단을 생략합니다.');
   }
   await save('SIGNAL_SNAPSHOT',{dataset,...(candidateInput?{datasets,candidateInput}:{}),rawSources,positionAccount:position,inputHash:prepared.inputHash});
   let providerSuperseded=false;
   const hooks={async beforeCall(stage){check(operationWindowState(activation.config,now())==='ACTIVE','OPERATION_WINDOW','운용 기간을 확인하세요.');check(!providerSuperseded,'LIVE_JEV_SUPERSEDED','보호 주문 이후의 추가 유료 질문을 생략합니다.');await renewClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000});activation=await currentActivation();check(activation.status==='ENABLED','LIVE_ACTIVATION_DISABLED','중지된 운용의 새 JEV 호출을 차단합니다.');check(!activation.pendingStrategyUpdate,'LIVE_STRATEGY_UPDATE_PENDING','변경 요청 이후 이전 전략의 추가 AI 호출을 생략합니다.');const own=memberContext?await memberContext.jevCount():await dailyCount();check(own<activation.config.maxJevCallsPerDay,'LIVE_JEV_DAILY_BUDGET','일별 승인한 JEV 호출 예산을 모두 사용했습니다.');check(Date.parse(now())<Date.parse(at)+60000,'LIVE_JEV_EXPIRED','60초가 지난 신호로 추가 유료 질문을 시작하지 않습니다.');const callId='live-jev-'+hash({owner,activation:runtimeId,snapshotAt:at,nodeId:stage.nodeId,requestHash:stage.rawRequestHash}).slice(0,40);runtime.state.providerPending={callId,nodeId:stage.nodeId,graphHash:activation.config.graphHash,completedNodeIds:stage.graphEvaluation.trace.filter(t=>t.output?.ready&&!t.output.disabled&&!t.output.omitted&&!['BLOCKED','PENDING_JEV'].includes(t.output.status)).map(t=>t.nodeId),snapshotAsOf:at,requestHash:stage.rawRequestHash,startedAt:now()};await save('JEV_STARTED',{...runtime.state.providerPending,stage}, {eventId:callId});},async afterCall(stage){const pending=runtime.state.providerPending;check(pending&&pending.requestHash===stage.rawRequestHash,'LIVE_JEV_RECEIPT','원 유료 요청과 실제 응답을 대조하세요.');const completedAt=stage.provider?.answeredAt??now(),id=pending.callId+'-result';await db.prepare('INSERT OR IGNORE INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) VALUES(?,?,?,?,?,?)').bind(id,owner,activation.id,'JEV_RESULT',completedAt,JSON.stringify(safe({callId:pending.callId,snapshotAsOf:at,stage}))).run();await fence();const node=graph.nodes.find(n=>n.id===stage.nodeId),validUntil=iso(Date.parse(at)+Math.min(60000,node.config.reuseWindowMs??0)),inputHash=stage.graphEvaluation.trace.find(t=>t.nodeId===stage.nodeId).inputHash;if(validUntil>completedAt)runtime.state.cachedAnswers[stage.nodeId]={kind:'JEV_QUESTION',answer:clone(stage.rawResponse.answers[stage.nodeId]),questionHash:hash(node.config.question),inputHash,rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash,reuse:{evaluatedAt:at,availableAt:completedAt,validUntil,graphHash:activation.config.graphHash,inputHash}};runtime.state.cachedTiming[stage.nodeId]={snapshotAsOf:at,actualCompletedAt:completedAt,validUntil,provider:clone(stage.provider),rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};runtime.state.providerPending=null;await save('JEV_COMPLETED',{callId:pending.callId,completedAt,validUntil,responseHash:stage.rawResponseHash});}};
   try{
    let settled=false,lastProtectionError=null;
    async function decide(){
     const selectionIds=multi&&!held?graph.edges.filter(e=>e.to.port==='choice'&&graph.nodes.some(n=>n.id===e.to.nodeId&&n.type==='SELECT')).map(e=>e.from.nodeId):[];
     const result=await evaluateGraphQuestions({request:prepared.request,manifest,env,fetchImpl,clock:now,providerHooks:hooks,allowHeldDecisions:true,stopAfterNodeIds:selectionIds});
     if(!selectionIds.length)return result;
     const answers=Object.fromEntries(selectionIds.filter(id=>result.evaluation.decisionInputs[id]).map(id=>[id,result.evaluation.decisionInputs[id]]));
     const candidates=datasets.map(d=>({dataset:d,prepared:prepare(d,answers)})),chosen=candidates.find(c=>c.prepared.request.state.strategyEvaluation.graphEvaluation.trace.some(t=>t.type==='SELECT'&&t.output.value?.instrumentIds.includes(c.dataset.instrumentId)))??candidates[0];
     market=chosen.dataset.market;current=snapshots.find(s=>s.dataset.market===market);dataset=chosen.dataset;book=current.book;cache=current.cache;r={readiness:current.readiness};
     if(runtime.state.cachedMarket&&runtime.state.cachedMarket!==market)runtime.state.cachedAnswers={};
     position=await positionAccount({db,owner,activationId:activation.id,market,book,asOf:at});prepared=prepare(dataset,answers);
     await save('CANDIDATE_SELECTED',{market,snapshotAsOf:at,inputHash:prepared.inputHash,candidateSourceHash:hash(candidateInput),selectionStages:result.providerStages.map(s=>({nodeId:s.nodeId,rawResponseHash:s.rawResponseHash}))});
     return evaluateGraphQuestions({request:prepared.request,manifest,env,fetchImpl,clock:now,providerHooks:hooks,allowHeldDecisions:true,completedStages:result.providerStages});
    }
    const provider=decide().then(result=>{settled=true;return {result};},error=>{settled=true;return {error};});
    while(held&&!settled){
     let timer;await Promise.race([provider,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);clearTimeout(timer);
     if(settled||providerSuperseded||!operational)continue;
     try{
      activation=await currentActivation();if(activation.status!=='ENABLED')continue;
      const protectionBook=await readBook(market),protectionAt=now(),protectionPosition=await positionAccount({db,owner,activationId:activation.id,market,book:protectionBook,asOf:protectionAt});
      providerSuperseded=await protectHeldPosition(true,{book:protectionBook,at:protectionAt,position:protectionPosition});
     }catch(error){if(error.code!==lastProtectionError){lastProtectionError=error.code??'LIVE_PROTECTION_FAILURE';await save('PROVIDER_WAIT_PROTECTION_BLOCKED',{code:lastProtectionError});}}
    }
    const completed=await provider;if(completed.error&&completed.error.code!=='LIVE_JEV_SUPERSEDED')throw completed.error;
    if(providerSuperseded){runtime.state.pendingDecision=null;runtime.state.lastDecisionBar=barKey;await save('JEV_SUPERSEDED_BY_PROTECTION',{providerResultRetained:true});return;}
    evaluation=completed.result.evaluation;ge=evaluation.graphEvaluation;
   }catch(error){if(runtime.state.providerPending){const failed=runtime.state.providerPending,retained=error.responseAvailability==='RETAINED',failure={callId:failed.callId,snapshotAsOf:at,code:error.code??'LIVE_JEV_FAILURE',responseAvailability:error.responseAvailability??'UNKNOWN',provider:error.provider??null,rawRequest:error.rawRequest??null,rawResponse:error.rawResponse??null,rawResponseText:error.rawResponseText??null,rawRequestHash:error.rawRequestHash??null,rawResponseHash:error.rawResponseHash??null,automaticRetries:0};await db.prepare('INSERT OR IGNORE INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) VALUES(?,?,?,?,?,?)').bind(failed.callId+'-failure',owner,activation.id,'JEV_FAILURE',now(),JSON.stringify(safe(failure))).run();// A retained rejection expires this frame; the next bar gets new inputs.
    if(isRejectedProviderResponse(failure,failed)){await rejectProviderResponse(failed,failure);return;}runtime.state.providerUnknown={...failed,status:retained?'RESPONSE_REVIEW_REQUIRED':'EXTERNAL_OUTCOME_UNKNOWN',code:failure.code,responseAvailability:failure.responseAvailability,failedAt:now()};runtime.state.providerPending=null;await save(retained?'JEV_RESPONSE_REVIEW':'JEV_OUTCOME_UNKNOWN',runtime.state.providerUnknown);}else await save('JEV_BLOCKED',{code:error.code??'LIVE_JEV_FAILURE',snapshotAsOf:at});runtime.state.lastDecisionBar=barKey;await save('RUNTIME_PAUSED_ENTRIES',{code:error.code??'LIVE_JEV_FAILURE'});throw error;}
  }
  runtime.state.lastDecisionBar=barKey;runtime.state.cachedMarket=market;const readyAt=now(),validUntil=iso(Date.parse(at)+60000),decision=ge.output.decision;
  if(!ge.output.ready||!ge.output.orderAllowed||decision?.action==='hold'){runtime.state.lastState=ge.output.ready?'HOLD':'MISSING_INPUT';await save('DECISION_SUMMARY',{snapshotAsOf:at,evaluation:ge,inputHash:prepared.inputHash});statusState.policies[activation.id]={state:runtime.state.lastState,missing:ge.output.reasonCodes??[]};return;}
  if(validUntil<=readyAt){runtime.state.pendingDecision=null;runtime.state.lastState='EXPIRED';await save('DECISION_EXPIRED',{snapshotAsOf:at,readyAt,validUntil,paidEvidenceRetained:true});statusState.policies[activation.id]={state:'EXPIRED'};return;}
  if(decision.action==='buy'&&(runtime.state.providerUnknown||pending.length)){statusState.policies[activation.id]={state:runtime.state.providerUnknown?'JEV_OUTCOME_UNKNOWN':'ORDER_RECONCILING'};return;}
  if(decision.action==='sell')await cancelEntryRemainders();
  const signal={market,snapshotAsOf:at,readyAt,validUntil,inputHash:prepared.inputHash,sourceHash:dataset.sourceHash,evaluation:ge};runtime.state.pendingDecision=signal;await save('ORDER_DECISION_READY',{...signal,dataset,rawSources,positionAccount:position});await submitDecision(signal);
 }
 async function execute(){statusState.lastTickAt=now();statusState.lastError=null;const policies=await list(),eligible=[];for(const p of policies){if(p.status==='ENABLED')eligible.push(p);else if((await orders(p.id)).some(o=>openStates.has(o.state)))eligible.push(p);}if(!eligible.length)return {state:'IDLE',externalCalls:0};await init();let claim;try{claim=await acquireClaim(db,{ownerId:owner,resourceId:resource,key:crypto.randomUUID(),fingerprint:hash({owner,policies:eligible.map(p=>p.id),at:now()}),baseRevision:0,nowMs:Date.parse(now()),leaseMs:120000});for(const activation of eligible){const wait=serviceWait.get(activation.id);if(wait&&wait.retryAt>now()&&!activation.pendingStrategyUpdate){statusState.policies[activation.id]=wait;continue;}try{await processActivation(activation,claim);serviceWait.delete(activation.id);}catch(error){const code=error.reasonCodes?.find(c=>EXCHANGE_DATA_RECOVERY.codes.includes(c))??error.code??'LIVE_RUNNER_FAILURE',transient=EXCHANGE_CONNECTION_RECOVERY.codes.includes(code),dataWait=EXCHANGE_DATA_RECOVERY.codes.includes(code)&&(code!=='LIVE_RUNNER_BOOK_TIME'||error.bookTime?.eventAgeMs>=0&&error.bookTime?.receiptAgeMs>=0),state=transient?{state:EXCHANGE_CONNECTION_RECOVERY.state,code,retryAt:iso(Date.parse(now())+EXCHANGE_CONNECTION_RECOVERY.retryMs)}:dataWait?{state:EXCHANGE_DATA_RECOVERY.state,code}:{state:'BLOCKED',code};if(transient)serviceWait.set(activation.id,state);statusState.policies[activation.id]=state;statusState.lastError={code,at:now(),...(error.bookTime?{bookTime:error.bookTime}:{})};}}return clone(statusState);}catch(error){if(!['IN_PROGRESS','CLAIM_CONFLICT'].includes(error.code))throw error;return {state:'CLAIM_IN_PROGRESS'};}finally{if(claim)try{await releaseClaim(db,{ownerId:owner,resourceId:resource,token:claim.token,nowMs:Date.parse(now()),status:'CANCELLED'});}catch{}}}
 async function tick(){if(!operational)return {state:'STOPPED'};if(inFlight)return {state:'IN_FLIGHT'};statusState.inFlight=true;inFlight=execute();try{return await inFlight;}finally{inFlight=null;statusState.inFlight=false;}}
 const schedule=()=>{if(!statusState.running)return;timer=setTimeout(async()=>{try{await tick();}catch(error){statusState.lastError={code:error.code??'LIVE_RUNNER_FAILURE',at:now(),...(error.bookTime?{bookTime:error.bookTime}:{})};}schedule();},Math.max(1000,options.pollIntervalMs??1000));timer.unref?.();};
 return {start(){if(statusState.running)return clone(statusState);operational=true;statusState.running=true;schedule();return clone(statusState);},async stop(){operational=false;statusState.running=false;clearTimeout(timer);timer=null;if(inFlight)try{await inFlight;}catch{}return clone(statusState);},tick,status:()=>clone(statusState)};
}
import {EXCHANGE_CONNECTION_RECOVERY,EXCHANGE_DATA_RECOVERY} from '../dist/system/automation-contracts.mjs';
