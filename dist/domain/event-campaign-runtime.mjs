import {hashInputPackage} from './workspace.mjs';
import {observedAccountFeeSchedule} from './connectors.mjs';
import {createEventPaperAccount,applyEventTargetOrder,getEventPaperReport} from './event-paper-execution.mjs';
import {prepareEventStrategyFrame,prepareEventStrategyInputs} from './event-strategy-runtime.mjs';
import {buildEventCandidateInput} from './multi-asset-event-runtime.mjs';
import {strategyGraphHash} from './strategy-graph.mjs';
const clone=structuredClone,at=t=>new Date(t).toISOString(),check=(v,c,m)=>{if(!v)throw Object.assign(new Error(m),{code:c,status:409});};
export const multiEventSourcePins=ds=>ds.map(d=>({id:d.id,instrumentId:d.instrumentId,sourceHash:d.sourceHash,feeHash:hashInputPackage(d.feeSnapshot),rulesHash:hashInputPackage(d.rules)}));
const frozen=multiEventSourcePins;
export function eventDatasetInstrument(d){const r=d.rules,[quoteAsset,baseAsset]=d.market.split('-'),source={kind:'OBSERVED_ACCOUNT_RULE',source:'UPBIT_AUTHENTICATED_ORDER_CHANCE',asOf:r.observedAt??d.feeSnapshot.observedAt,sourceHash:r.sourceHash??d.feeSnapshot.sourceHash},tickSource=r.tickSourceHash?{kind:'PUBLIC_API',source:'https://api.upbit.com/v1/orderbook/instruments',asOf:r.tickObservedAt??source.asOf,sourceHash:r.tickSourceHash}:clone(source);return {id:'upbit:'+d.market,venueId:'upbit',symbol:d.market,baseAsset,quoteAsset,assetClass:'CRYPTO',instrumentType:'SPOT',contractMultiplier:'1',settlement:'SPOT',tradingStatus:'ACTIVE',tickSize:String(r.tickSize),lotSize:String(r.quantityStep),minQuantity:String(r.quantityStep),minNotional:String(Math.max(Number(r.minBuyTotal),Number(r.minSellTotal))),constraintSources:{tickSize:tickSource,lotSize:clone(source),minQuantity:clone(source),minNotional:clone(source)},dataOrigin:'PUBLIC_API',sourceUrl:'https://api.upbit.com/v1/orders/chance',receivedAt:d.feeSnapshot.observedAt};}
export function createMultiEventCampaignState({id,config,datasets,now=config.startAt}={}){return {account:newAccount(id,config,datasets[0],config.initialCash,1,now),closedCampaigns:[],transfers:[],dailyEquity:[],cachedAnswers:{},serial:1};}
function newAccount(id,config,d,cash,serial,now){return createEventPaperAccount({id:id+':campaign:'+serial,profileId:config.mindId,instrumentId:d.instrumentId,instrument:eventDatasetInstrument(d),initialCash:String(cash),feeSchedule:observedAccountFeeSchedule(d.feeSnapshot),now});}
function portfolio(position,config,asOf){return {profileId:config.mindId,quoteCurrency:config.quoteCurrency,asOf,equity:position.equity,cashWeight:position.cash/position.equity,weights:position.positions.map(p=>({instrumentId:p.instrumentId,weight:p.marketValue/position.equity})),lastRebalancedAt:null,universeHash:config.universeHash};}

/** Shared pure preparation; exactly one existing cash ledger is active at a time. */
export function prepareMultiEventFrame({state,graph,datasets,config,asOf,selectionAnswers={}}){
 const d=datasets.find(d=>d.instrumentId===state.account.instrumentId);check(d,'EVENT_ACTIVE_DATASET','보유 종목의 원 관측 자료를 보존하세요.');
 const probe=prepareEventStrategyFrame({graph,account:state.account,dataset:d,asOf}),position=probe.positionAccount;
 if(!position)return {chosen:probe,dataset:d,candidates:[],held:true,sourceHash:hashInputPackage(frozen(datasets))};
 const p=portfolio(position,config,asOf),candidate=buildEventCandidateInput({datasets,profileId:config.mindId,asOf,timeframe:config.timeframe,universeHash:config.universeHash,maxCandidates:graph.executionScope.maxCandidates}),held=position.positions.some(p=>p.quantity>0);
 const evaluated=(held?[d]:datasets).map(source=>{const prepared=prepareEventStrategyInputs({graph,dataset:source,positionAccount:position,profileId:config.mindId,accountId:state.account.id,asOf,decisions:source.instrumentId===d.instrumentId?state.cachedAnswers:{},frameAnswers:selectionAnswers,executionMode:'PAPER',candidateInput:candidate,portfolio:p});return {dataset:source,prepared};});
 const selected=evaluated.find(r=>r.prepared.request.state.strategyEvaluation.graphEvaluation.trace.some(t=>t.type==='SELECT'&&t.output.value?.instrumentIds.includes(r.dataset.instrumentId)))??evaluated[0];
 const selectionPending=selected.prepared.request.state.strategyEvaluation.graphEvaluation.trace.some(t=>t.type==='SELECT'&&!t.output.ready&&t.output.requiredQuestionNodeIds?.length);
 return {chosen:{...selected.prepared,account:probe.account,book:probe.book,valuationComplete:probe.valuationComplete},dataset:selected.dataset,candidates:evaluated.map(r=>({instrumentId:r.dataset.instrumentId,graphEvaluation:r.prepared.request.state.strategyEvaluation.graphEvaluation,inputHash:r.prepared.inputHash})),held,selectionPending,selectionAnswers,sourceHash:hashInputPackage(frozen(datasets)),candidateInput:candidate,portfolio:p};
}

/** Atomic campaign rotation keeps the previous ledger and transfers only settled residual cash. */
export function rotateSettledEventCampaign({state,account=state.account,dataset,config,frame,id}={}){
 const old=getEventPaperReport(account);check(old.quantity==='0'&&old.orders.every(o=>['FILLED','CANCELLED','REJECTED'].includes(o.status)),'EVENT_CAMPAIGN_UNSETTLED','보유 수량과 미확정 주문을 먼저 정리하세요.');
 check(account.id===state.account.id&&account.profileId===config.mindId&&account.quoteCurrency===config.quoteCurrency&&dataset.market.split('-')[0]===config.quoteCurrency&&dataset.instrumentId==='crypto:upbit:'+dataset.market,'EVENT_CAMPAIGN_SCOPE','같은 마인드와 결제 통화의 정산 자금만 이관하세요.');
 const serial=(state.serial??1)+1,next=newAccount(id,config,dataset,old.cash,serial,frame.asOf),transfer={id:id+':transfer:'+frame.sequence,at:frame.asOf,fromAccountId:account.id,toAccountId:next.id,quoteCurrency:config.quoteCurrency,amount:old.cash,fromLedgerHash:hashInputPackage(account),reason:'FLAT_SETTLED_CANDIDATE_ROTATION'};
 return {state:{...state,account:next,closedCampaigns:[...(state.closedCampaigns??[]),{account:clone(account),report:old}],transfers:[...(state.transfers??[]),transfer],serial,cachedAnswers:{}},transfer};
}
export function rotateMultiEventCampaign({state,multi,graph,config,frame,id,busy=false}={}){
 let prepared=multi.chosen;if(busy||multi.held||multi.selectionPending||multi.dataset.instrumentId===state.account.instrumentId)return {state,prepared,transfer:null};
 const {state:result,transfer}=rotateSettledEventCampaign({state,account:prepared.account,dataset:multi.dataset,config,frame,id});
 prepared=prepareEventStrategyFrame({graph,account:result.account,dataset:multi.dataset,asOf:frame.asOf,candidateInput:multi.candidateInput,portfolio:multi.portfolio,frameAnswers:multi.selectionAnswers});return {state:result,prepared,transfer};
}
/** Resolve the shared asset choice before preparing that asset's own entry context. */
export async function evaluateMultiEventFrame({state,multi,prepared,graph,datasets,config,frame,id,busy=false,evaluateQuestions}){
 let output={evaluation:prepared.request.state.strategyEvaluation,providerStages:[],provider:null,jevCalled:false,jevCallCount:0};
 const selectionIds=graph.edges.filter(e=>e.to.port==='choice'&&graph.nodes.some(n=>n.id===e.to.nodeId&&n.type==='SELECT')).map(e=>e.from.nodeId);
 if(!busy&&output.evaluation.graphEvaluation.requiredJevNodeIds?.length)output=await evaluateQuestions(prepared.request,[],selectionIds);
 const answers=Object.fromEntries(selectionIds.filter(key=>output.evaluation.decisionInputs?.[key]).map(key=>[key,output.evaluation.decisionInputs[key]]));
 if(!busy&&!multi.held&&Object.keys(answers).length){
  multi=prepareMultiEventFrame({state,graph,datasets,config,asOf:frame.asOf,selectionAnswers:answers});
  const rotated=rotateMultiEventCampaign({state,multi,graph,config,frame,id});state=rotated.state;prepared=rotated.prepared;
  const pending=prepared.request.state.strategyEvaluation.graphEvaluation.requiredJevNodeIds?.length;
  output=pending?await evaluateQuestions(prepared.request,output.providerStages):{...output,evaluation:prepared.request.state.strategyEvaluation};
 }
 return {state,multi,prepared,output};
}

/** Both historical replay and forward paper use this exact target-order and loss gate. */
export function applyMultiEventDecision({state,prepared,multi,evaluation,frame,config,orderId,readyAt,deadline,busy=false,book,executionAt}={}){
 const next=clone(state),decision=evaluation.output.decision??null,day=frame.asOf.slice(0,10),equity=prepared.positionAccount?.equity;
 if(Number.isFinite(equity)&&!next.dailyEquity.some(r=>r.day===day))next.dailyEquity.push({day,at:frame.asOf,equity});
 const opening=next.dailyEquity.find(r=>r.day===day)?.equity,dailyLossBlocked=decision?.action==='buy'&&(!Number.isFinite(equity)||!Number.isFinite(opening)||equity<opening*(1-config.maxDailyLossRatio));
 let execution={account:prepared.account,fills:[],order:null,blockedReasons:[],executionEvidence:{mode:'paper',liveOrders:0}};
 if(busy)execution.blockedReasons=['PROVIDER_IN_FLIGHT_AT_DECISION'];
 else if(!evaluation.output.ready)execution.blockedReasons=evaluation.output.reasonCodes;
 else if(!evaluation.output.orderAllowed)execution.blockedReasons=['HOLD_DECISION'];
 else if(dailyLossBlocked)execution.blockedReasons=['SHARED_DAILY_LOSS_LIMIT'];
 else if(!multi.held&&decision?.action==='buy'&&!evaluation.trace.some(t=>t.type==='SELECT'&&t.output.value?.instrumentIds.includes(multi.dataset.instrumentId)))execution.blockedReasons=['CANDIDATE_NOT_SELECTED'];
 else if(readyAt>=deadline)execution.blockedReasons=['DECISION_EXPIRED_BEFORE_READY'];
 else {const actual=book===undefined?multi.dataset.events.find(e=>e.kind==='ORDER_BOOK'&&e.eventTime>=readyAt&&e.receivedAt>=readyAt&&e.receivedAt<deadline&&(!e.availableAt||e.availableAt<deadline)&&Date.parse(e.receivedAt)-Date.parse(e.eventTime)<=3000):book,executedAt=executionAt??actual?.availableAt??actual?.receivedAt;if(!actual)execution.blockedReasons=['NO_POST_DECISION_BOOK'];else if(actual.eventTime<readyAt||actual.receivedAt<readyAt||actual.receivedAt>=deadline)execution.blockedReasons=['NO_POST_DECISION_BOOK'];else if(actual.availableAt&&executedAt<actual.availableAt)execution.blockedReasons=['EVENT_NOT_AVAILABLE'];else if(executedAt>=deadline)execution.blockedReasons=['DECISION_EXPIRED_BEFORE_EXECUTION'];else if(Date.parse(executedAt)-Date.parse(actual.eventTime)>3000||Date.parse(executedAt)-Date.parse(actual.receivedAt)>3000)execution.blockedReasons=['STALE_POST_DECISION_BOOK'];else execution=applyEventTargetOrder(prepared.account,{evaluation:{...evaluation,decisionAt:frame.asOf,providerReadyAt:readyAt},orderId,book:actual,now:executedAt,orderType:config.orderType,maxSlippageBps:config.slippageBps,participationRate:config.participationRate,maxDailyLossRatio:config.maxDailyLossRatio});}
 next.account=execution.account;return {state:next,execution};
}
export function cacheMultiEventAnswers({graph,decisionInputs,asOf,availableAt,elapsedMs}={}){const cached={},graphHash=strategyGraphHash(graph);for(const [id,a]of Object.entries(decisionInputs??{})){const window=graph.nodes.find(n=>n.id===id)?.config.reuseWindowMs??0;if(a.reuse)cached[id]=clone(a);else if(window>elapsedMs)cached[id]={...clone(a),reuse:{evaluatedAt:asOf,availableAt,validUntil:at(Date.parse(asOf)+window),graphHash,inputHash:a.inputHash}};}return cached;}
