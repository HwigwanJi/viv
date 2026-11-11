import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash,evaluateStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {resolveStrategyGraphInputs} from './quant-inputs.mjs';
import {getEventPaperReport,applyEventTargetOrder,eventPaperPositionAccount} from '../dist/domain/event-paper-execution.mjs';
import {evaluatePositionProfitGraph,hasPositionProfitLadder} from '../dist/domain/position-profit-ladder.mjs';
import {operationWindowState} from '../dist/domain/operation-window.mjs';
import {selectHourlyValue} from '../dist/domain/hourly-value-policy.mjs';
import {createHourlyValueReview,advanceHourlyValueReview,hourlyValueReviewHandoff,hourlyValueSelectionBoundary} from '../dist/domain/hourly-value-review.mjs';
import {getEventPaperSubscription,saveEventPaperSubscription,eventPaperTrace,eventPaperUnits,eventPaperDecimal} from './event-paper-store.mjs';
import {rotateSettledEventCampaign} from '../dist/domain/event-campaign-runtime.mjs';
import {resolveUpbitEntryEligibility} from '../dist/domain/universe-policy.mjs';

const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});};
export function hourlyPaperPositionAccount(s,book,asOf){
 const account=eventPaperPositionAccount(s.state.account,{book,asOf});
 account.ledger=[...(s.state.closedCampaigns??[]).flatMap(c=>eventPaperPositionAccount(c.account,{asOf}).ledger),...account.ledger].sort((a,b)=>a.at.localeCompare(b.at));
 return account;
}

export async function executePaperPositionProfit({db,owner,subscriptionId,expectedRevision,executionKey,book,asOf,claim=null}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);check(s.revision===expectedRevision,'EVENT_PAPER_REVISION');
 const signal=s.runtime.positionProfit?.dispatch,graph=s.manifest.data.strategyPlan.graph;
 check(signal?.key===executionKey&&hasPositionProfitLadder(graph)&&strategyGraphHash(graph)===s.pins.graphHash&&mindDocumentHash(s.manifest)===s.pins.manifestHash,'PROFIT_GRAPH_PIN');
 check(s.status==='ENABLED'&&operationWindowState(s.config,asOf)==='ACTIVE'&&asOf>=signal.readyAt&&asOf<signal.expiresAt,'PROFIT_EXECUTION_TIME');
 check(signal.ledgerHash===hashInputPackage({id:s.state.account.id,connector:s.state.account.connector}),'PROFIT_LEDGER_CHANGED');
 check(book.market===signal.market&&book.eventTime>=signal.readyAt&&book.receivedAt>=signal.readyAt,'PROFIT_BOOK_PREPARATION');
 const evaluation=evaluatePositionProfitGraph({graph,account:signal.positionAccount,instrumentId:s.state.account.instrumentId,asOf:signal.snapshotAsOf,executionMode:'PAPER'});
 check(evaluation.outputHash===signal.evaluation.outputHash&&evaluation.output.orderAllowed&&evaluation.output.decision.intent?.code==='TAKE_PROFIT','PROFIT_DECISION_PROOF');
 const prior=s.state.account.receipts.find(r=>r.orderId===executionKey);if(prior)return {subscription:s,...prior,idempotent:true};
 const result=applyEventTargetOrder(s.state.account,{evaluation:{...evaluation,providerReadyAt:signal.readyAt},orderId:executionKey,book,now:asOf,participationRate:s.config.participationRate,maxDailyLossRatio:s.config.maxDailyLossRatio,maxSlippageBps:s.config.slippageBps});
 const next=structuredClone(s);next.state.account=result.account;next.updatedAt=asOf;
 const fee=eventPaperDecimal(result.fills.reduce((v,f)=>v+eventPaperUnits(f.fee),0n));
 const events=[{id:executionKey,kind:'STRATEGY_ORDER',at:asOf,body:{executionMode:'paper',market:book.market,instrumentId:s.state.account.instrumentId,action:'sell',state:result.order?.status??'UNFILLED',quoteCurrency:s.config.quoteCurrency,filledQuantity:eventPaperDecimal(result.fills.reduce((v,f)=>v+eventPaperUnits(f.quantity),0n)),fee,feesPaid:fee,firstFillAt:result.fills[0]?.occurredAt??null,lastFillAt:result.fills.at(-1)?.occurredAt??null,fills:result.fills.map(f=>({id:f.fillId,price:f.price,quantity:f.quantity,gross:f.notional,at:f.occurredAt})),decision:next.runtime.lastDecision}}];
 const subscription=await saveEventPaperSubscription({db,owner,previous:s,next,claim,events});return {subscription,...result};
}
function binding(s,{modelHash,fees}){
 check(s&&['ENABLED','PAUSED'].includes(s.status)&&s.state?.account?.mode==='paper','HOURLY_REVIEW_SUBSCRIPTION');
 const graph=s.manifest?.data.strategyPlan.graph;check(graph&&strategyGraphHash(graph)===s.pins.graphHash&&mindDocumentHash(s.manifest)===s.pins.manifestHash&&graph.nodes.some(n=>n.type==='MODEL'&&n.config.model?.hash===modelHash),'HOURLY_REVIEW_PINNED_MODEL');
 const a=s.state.account;check(a.profileId===s.profileId&&a.connector.orders.every(o=>['FILLED','CANCELLED','REJECTED'].includes(o.status))&&!s.runtime.pending&&!s.runtime.unknown&&!s.runtime.completedFrame,'HOURLY_REVIEW_ACCOUNT_BUSY');
 check(Number.isFinite(Number(fees?.buyRate))&&Number(fees.buyRate)>=0&&Number(fees.buyRate)<1&&Number.isFinite(Number(fees?.sellRate))&&Number(fees.sellRate)>=0&&Number(fees.sellRate)<1,'HOURLY_REVIEW_FEES');
 return {subscriptionId:s.id,subscriptionStatus:s.status,profileId:s.profileId,accountId:s.runtime.hourlyValueWalletId??a.id,graphHash:s.pins.graphHash,manifestHash:s.pins.manifestHash,modelHash,ledgerHash:hashInputPackage({id:a.id,connector:a.connector}),configHash:hashInputPackage(s.config),feeHash:hashInputPackage({buyRate:Number(fees.buyRate),sellRate:Number(fees.sellRate)})};
}
async function current(args){const s=await getEventPaperSubscription(args);check(s,'HOURLY_REVIEW_SUBSCRIPTION');return s;}
function clock(s,asOf){check(typeof asOf==='string'&&Number.isFinite(Date.parse(asOf))&&new Date(asOf).toISOString()===asOf&&asOf>=s.updatedAt,'HOURLY_REVIEW_CLOCK');}
async function persist({db,owner,previous,state,asOf,claim,evidence}){
 const next=structuredClone(previous);if(state)next.runtime.hourlyValueReview=state;next.updatedAt=asOf;
 let decisionEvent=null;
 if(evidence.evaluation){
  const evaluation=evidence.evaluation,d=evaluation.output.decision;
  next.runtime.hourlyValueWalletId??=previous.state.account.id;next.runtime.hourlyValuePrepared={evaluation,ledgerHash:evidence.snapshot.account.sourceHash,expiresAt:evidence.snapshot.expiresAt};
  const record={id:previous.id+':hourly-decision:'+evaluation.outputHash,kind:'DECISION',at:asOf,recordedAt:asOf,market:d?.hourlyValue?.executionMarket??state?.selection.selected.market??null,action:d?.action??null,targetWeight:d?.targetWeight??null,orderAllowed:evaluation.output.orderAllowed===true,trace:eventPaperTrace(previous.manifest.data.strategyPlan.graph,evaluation)};
  next.runtime.lastEvaluationAt=asOf;next.runtime.lastDecision=record;decisionEvent={id:record.id,kind:'DECISION',at:asOf,body:record};
  const selection=evaluation.trace.find(t=>t.type==='MODEL')?.output?.selection;
  if(selection)next.runtime.candidates=selection.values.filter(v=>v.market).map(v=>({instrumentId:'crypto:upbit:'+v.market,selected:v.market===selection.selected.market,action:v.kind==='ENTER'?'buy':'hold',ready:true}));
 }
 const body={state:state?.phase??'EVALUATED',hourlyValueReview:state,...evidence};check(new TextEncoder().encode(JSON.stringify(body)).length<=2000000,'EVENT_PAPER_EVIDENCE_SIZE');
 return saveEventPaperSubscription({db,owner,previous,next,claim,events:[{id:'hourly-review:'+(evidence.evaluation?.outputHash??state.hash),kind:'RUNTIME',at:asOf,body},...(decisionEvent?[decisionEvent]:[])]});
}
/** This adapter only adds a review checkpoint to the existing CAS-backed paper subscription. */
export async function stagePaperHourlyValueReview({db,owner,subscriptionId,expectedRevision,frames,fees,modelHash,forecastExitSlippageBps,expiresAt,entrySlippageBps,readyDelayMs,asOf,claim=null}={}){
 check(Array.isArray(frames),'HOURLY_REVIEW_FRAMES');
 const s=await current({db,owner,subscriptionId});clock(s,asOf);const b=binding(s,{modelHash,fees}),old=s.runtime.hourlyValueReview;
 if(old){const advanced=advanceHourlyValueReview(old,{binding:b,asOf});if(hourlyValueSelectionBoundary(old.selection)===frames?.[0]?.forecastAsOf){check(advanced.phase!=='STALE','HOURLY_REVIEW_STALE');return {subscription:s,review:advanced,reused:true};}check(['STALE','EXPIRED','REJECTED'].includes(advanced.phase),'HOURLY_REVIEW_ACTIVE');}
 check(Number.isInteger(expectedRevision)&&expectedRevision===s.revision,'EVENT_PAPER_REVISION');
 const report=getEventPaperReport(s.state.account),account={profileId:s.profileId,accountId:b.accountId,asOf,cash:report.cash,positions:Number(report.quantity)>0?[{market:s.state.account.connector.instrument.symbol,quantity:report.quantity}]:[],sourceHash:b.ledgerHash};
 const compact=frames.map(f=>({...f,forecast:{ready:f.forecast?.ready,unit:f.forecast?.unit,modelHash:f.forecast?.modelHash,trainingLabelCutoff:f.forecast?.trainingLabelCutoff,value:f.forecast?.value,marketPathForecast:structuredClone(f.forecast?.marketPathForecast)}}));
 const selection=selectHourlyValue({asOf,profileId:s.profileId,accountId:b.accountId,account,frames:compact,fees,modelHash,forecastExitSlippageBps});check(selection.ready,'HOURLY_REVIEW_SELECTION_UNAVAILABLE');
 const review=createHourlyValueReview({selection,binding:b,expiresAt,entrySlippageBps,readyDelayMs});const next=await persist({db,owner,previous:s,state:review,asOf,claim,evidence:{selectionInput:{account,frames:compact,fees,modelHash,forecastExitSlippageBps},supersededHash:old?.hash??null}});
 return {subscription:next,review,reused:false};
}
export async function advancePaperHourlyValueReview({db,owner,subscriptionId,expectedRevision,modelHash,fees,review=null,asOf,claim=null}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);check(s.revision===expectedRevision,'EVENT_PAPER_REVISION');check(s.runtime.hourlyValueReview,'HOURLY_REVIEW_REQUIRED');
 const state=advanceHourlyValueReview(s.runtime.hourlyValueReview,{binding:binding(s,{modelHash,fees}),asOf,review});
 if(state.hash===s.runtime.hourlyValueReview.hash)return {subscription:s,review:state,reused:true};
 return {subscription:await persist({db,owner,previous:s,state,asOf,claim,evidence:{}}),review:state,reused:false};
}
export async function readPaperHourlyValueReview({db,owner,subscriptionId,modelHash,fees,asOf}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);if(!s.runtime.hourlyValueReview)return {subscriptionId:s.id,state:null,ready:false,steps:[]};
 const handoff=hourlyValueReviewHandoff(s.runtime.hourlyValueReview,{binding:binding(s,{modelHash,fees}),asOf});
 const windowState=operationWindowState(s.config,asOf),ready=handoff.ready&&s.status==='ENABLED'&&windowState==='ACTIVE';
 return {subscriptionId:s.id,revision:s.revision,...handoff,ready,steps:ready?handoff.steps:[],subscriptionEnabled:s.status==='ENABLED',windowState};
}

/** Prepare through the saved graph, committing its review and evidence in the same subscription CAS. */
export async function preparePaperHourlyValueGraph({db,owner,subscriptionId,expectedRevision,markets,fees,expiresAt,review=null,valuationBook=null,asOf,claim=null}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);check(s.revision===expectedRevision,'EVENT_PAPER_REVISION');
 const graph=s.manifest.data.strategyPlan.graph,node=graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST');check(node?.config.model,'HOURLY_VALUE_GRAPH_REQUIRED');
 const b=binding(s,{modelHash:node.config.model.hash,fees}),report=getEventPaperReport(s.state.account,valuationBook?{book:valuationBook,asOf}:{}),account={profileId:s.profileId,accountId:b.accountId,asOf,cash:report.cash,positions:Number(report.quantity)>0?[{market:s.state.account.connector.instrument.symbol,quantity:report.quantity}]:[],sourceHash:b.ledgerHash};
 const schedule=s.state.account.connector.feeSchedule;check(['buy','sell'].every(side=>Number(fees[side+'Rate'])===Number(schedule.sideBps?.[side]??schedule.bps)/10000),'HOURLY_VALUE_FEE_SCHEDULE');
 check(typeof expiresAt==='string'&&Number.isFinite(Date.parse(expiresAt))&&new Date(expiresAt).toISOString()===expiresAt,'HOURLY_REVIEW_EXPIRY');
 const old=s.runtime.hourlyValueReview,boundary=new Date(Math.floor(Date.parse(asOf)/3600000)*3600000).toISOString();
 const same=old&&hourlyValueSelectionBoundary(old.selection)===boundary;
 if(old&&!same)check(['STALE','EXPIRED','REJECTED'].includes(advanceHourlyValueReview(old,{binding:b,asOf}).phase),'HOURLY_REVIEW_ACTIVE');
 if(Number(report.quantity)>0&&(!same||old.binding.ledgerHash===b.ledgerHash))check(valuationBook,'HOURLY_VALUE_VALUATION_BOOK_REQUIRED');
 const executionAttempt=s.state.account.receipts.filter(r=>r.fills.length===0).length;
 const snapshot={contractVersion:'hourly-value-input-v1',asOf,account,markets,fees,expiresAt,valuationBook,executionAttempt,...(same?{reviewState:old,review}:{})};
 const sourceHash=hashInputPackage(snapshot),inputs=resolveStrategyGraphInputs({graph,manifest:s.manifest,asOf,source:{datasetSha256:sourceHash},hourlyValueSnapshot:snapshot,account:hourlyPaperPositionAccount(s,valuationBook,asOf),executionInstrumentId:s.state.account.instrumentId});
 const executionMarket=Number(report.quantity)>0?s.state.account.connector.instrument.symbol:same?old.selection.selected.market:s.state.account.connector.instrument.symbol;
 const completed=same&&s.runtime.hourlyValueProgress?.selectionHash===old.selection.hash?s.runtime.hourlyValueProgress.completedSteps:0;
 const evaluation=evaluateStrategyGraph(graph,[],{asOf,sourceHash,inputs,trigger:'closed_bar',context:{profileId:s.profileId,accountId:b.accountId,currentWeight:Number(report.equity)>0?Number(report.marketValue)/Number(report.equity):0,executionMode:'PAPER',executionInstrumentId:'crypto:upbit:'+executionMarket,hourlyValueBinding:b,hourlyValueUniverse:s.manifest.data.universe.instrumentIds,hourlyValueExecutionEnabled:s.status==='ENABLED'&&operationWindowState(s.config,asOf)==='ACTIVE',hourlyValueCompletedSteps:completed}});
 const result=evaluation.trace.find(t=>t.nodeId===node.id)?.output,state=result?.reviewState;
 if(!result?.selection||state?.hash===old?.hash&&evaluation.outputHash===s.runtime.hourlyValuePrepared?.evaluation.outputHash)return {subscription:s,evaluation,selection:result?.selection??null,review:state??null,reused:true};
 const next=await persist({db,owner,previous:s,state,asOf,claim,evidence:{evaluation,sourceHash,snapshot}});
 return {subscription:next,evaluation,selection:result.selection,review:state,reused:false};
}

/** Execute only this subscription's saved preparation in the existing exact-decimal paper engine. */
export async function executePaperHourlyValueGraph({db,owner,subscriptionId,expectedRevision,executionKey,book,entrySnapshot=null,asOf,participationRate,maxDailyLossRatio,maxSlippageBps,claim=null}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);
 check(typeof executionKey==='string'&&executionKey.startsWith('hourly-'),'HOURLY_VALUE_EXECUTION_KEY');
 const receipt=[s.state.account,...(s.state.closedCampaigns??[]).map(c=>c.account)].flatMap(a=>a.receipts).find(r=>r.orderId===executionKey);
 if(receipt)return {subscription:s,receipt,idempotent:true};
 check(s.revision===expectedRevision,'EVENT_PAPER_REVISION');const saved=s.runtime.hourlyValuePrepared,evaluation=saved?.evaluation,decision=evaluation?.output?.decision,graph=s.manifest.data.strategyPlan.graph;
 check(saved&&evaluation.graphHash===s.pins.graphHash&&strategyGraphHash(graph)===s.pins.graphHash&&mindDocumentHash(s.manifest)===s.pins.manifestHash,'HOURLY_VALUE_PREPARATION_REQUIRED');
 const {outputHash,...body}=evaluation;check(hashInputPackage(body)===outputHash&&decision?.hourlyValue?.executionKey===executionKey,'HOURLY_VALUE_PREPARATION_HASH');
 check(s.status==='ENABLED'&&operationWindowState(s.config,asOf)==='ACTIVE'&&asOf<saved.expiresAt&&evaluation.output.execution==='PAPER','HOURLY_VALUE_OPERATION_INACTIVE');
 check(saved.ledgerHash===hashInputPackage({id:s.state.account.id,connector:s.state.account.connector}),'HOURLY_VALUE_LEDGER_CHANGED');
 check(!s.runtime.pending&&!s.runtime.unknown&&!s.runtime.completedFrame&&s.state.account.connector.orders.every(o=>['FILLED','CANCELLED','REJECTED'].includes(o.status)),'HOURLY_REVIEW_ACCOUNT_BUSY');
 check(decision.hourlyValue.executionMarket===s.state.account.connector.instrument.symbol&&book?.market===decision.hourlyValue.executionMarket,'HOURLY_VALUE_EXECUTION_MARKET');
 const eligibility=decision.action==='buy'?entryEligibility(entrySnapshot,book.market,asOf):null;
 check([participationRate,maxDailyLossRatio,maxSlippageBps].every(Number.isFinite),'HOURLY_VALUE_EXECUTION_COSTS');
 const result=applyEventTargetOrder(s.state.account,{evaluation,orderId:executionKey,book,now:asOf,participationRate,maxDailyLossRatio,maxSlippageBps});
 const next=structuredClone(s);next.state.account=result.account;next.updatedAt=asOf;
 let transition=null;
 if(result.fills.length&&result.order?.status==='FILLED'){
  const proof=decision.hourlyValue,complete=decision.action==='buy'||getEventPaperReport(result.account).quantity==='0';next.runtime.hourlyValueProgress={selectionHash:proof.selectionHash,completedSteps:proof.stepIndex+(complete?1:0)};
  if(decision.action==='sell'&&(s.runtime.hourlyValueReview?.phase==='READY'&&(!complete||s.runtime.hourlyValueReview.selection.steps.length>proof.stepIndex+1)||s.runtime.hourlyValueReview?.phase==='REJECTED'&&!complete))transition=rebindAfterSettledStep(next,asOf);
 }
 const {account:executedAccount,...resultEvidence}=result,eventBody={state:'HOURLY_VALUE_PAPER_EXECUTION',executionKey,evaluationHash:outputHash,transition,eligibility,entrySnapshot,...resultEvidence};check(new TextEncoder().encode(JSON.stringify(eventBody)).length<=2000000,'EVENT_PAPER_EVIDENCE_SIZE');
 const events=[{id:'hourly-execution:'+hashInputPackage({executionKey,asOf,resultEvidence}),kind:'RUNTIME',at:asOf,body:eventBody}];
 if(result.order){const fee=eventPaperDecimal(result.fills.reduce((n,f)=>n+eventPaperUnits(f.fee),0n));events.push({id:executionKey,kind:'STRATEGY_ORDER',at:asOf,body:{executionMode:'paper',market:book.market,instrumentId:s.state.account.instrumentId,action:decision.action,state:result.order.status,quoteCurrency:s.config.quoteCurrency,filledQuantity:eventPaperDecimal(result.fills.reduce((n,f)=>n+eventPaperUnits(f.quantity),0n)),fee,feesPaid:fee,firstFillAt:result.fills[0]?.occurredAt??null,lastFillAt:result.fills.at(-1)?.occurredAt??null,fills:result.fills.map(f=>({id:f.fillId,price:f.price,quantity:f.quantity,gross:f.notional,at:f.occurredAt})),decision:next.runtime.lastDecision}});}
 const subscription=await saveEventPaperSubscription({db,owner,previous:s,next,claim,events});
 return {subscription,...result,idempotent:false};
}

function rebindAfterSettledStep(next,asOf){
 const old=next.runtime.hourlyValueReview;check(['READY','REJECTED'].includes(old?.phase)&&asOf<old.expiresAt,'HOURLY_VALUE_REBIND_STATE');
 const b=binding(next,{modelHash:old.binding.modelHash,fees:old.selection.fees});
 const recreated=createHourlyValueReview({selection:old.selection,binding:b,expiresAt:old.expiresAt,entrySlippageBps:old.entrySlippageBps,readyDelayMs:old.readyDelayMs});
 next.runtime.hourlyValueReview=advanceHourlyValueReview(recreated,{binding:b,asOf,review:old.rawReview});
 next.runtime.hourlyValuePrepared=null;
 return {fromReviewHash:old.hash,toReviewHash:next.runtime.hourlyValueReview.hash,selectionHash:old.selection.hash,fromLedgerHash:old.binding.ledgerHash,toLedgerHash:b.ledgerHash};
}

/** Transfer settled cash with the same archived-campaign lifecycle used by the ordinary paper runner. */
export async function rotatePaperHourlyValueCampaign({db,owner,subscriptionId,expectedRevision,dataset,entrySnapshot=null,asOf,claim=null}={}){
 const s=await current({db,owner,subscriptionId});clock(s,asOf);check(s.revision===expectedRevision,'EVENT_PAPER_REVISION');
 const old=s.runtime.hourlyValueReview;check(old&&s.status==='ENABLED'&&operationWindowState(s.config,asOf)==='ACTIVE','HOURLY_VALUE_OPERATION_INACTIVE');
 const b=binding(s,{modelHash:old.binding.modelHash,fees:old.selection.fees}),state=advanceHourlyValueReview(old,{binding:b,asOf});check(state.phase==='READY','HOURLY_VALUE_REBIND_STATE');
 const progress=s.runtime.hourlyValueProgress,completed=progress?.selectionHash===old.selection.hash?progress.completedSteps:0,step=old.selection.steps[completed];
 check(step?.action==='buy'&&step.market===dataset?.market&&dataset.instrumentId==='crypto:upbit:'+step.market&&s.manifest.data.universe.instrumentIds.includes(dataset.instrumentId),'HOURLY_VALUE_EXECUTION_MARKET');
 if(s.state.account.instrumentId===dataset.instrumentId)return {subscription:s,transfer:null,reused:true};
 const eligibility=entryEligibility(entrySnapshot,dataset.market,asOf);check(Number(dataset.feeSnapshot?.takerBuyRate)===old.selection.fees.buyRate&&Number(dataset.feeSnapshot?.takerSellRate)===old.selection.fees.sellRate,'HOURLY_VALUE_FEE_SCHEDULE');
 const result=rotateSettledEventCampaign({state:s.state,dataset,config:{mindId:s.profileId,quoteCurrency:s.config.quoteCurrency},frame:{asOf,sequence:s.state.transfers?.length??0},id:s.id});
 const next=structuredClone(s);next.state=result.state;next.state.account.dailyEquity=structuredClone(s.state.account.dailyEquity);next.updatedAt=asOf;const transition=rebindAfterSettledStep(next,asOf);
 const instrumentInput={market:dataset.market,instrumentId:dataset.instrumentId,rules:dataset.rules,feeSnapshot:dataset.feeSnapshot},eventBody={state:'HOURLY_VALUE_SETTLED_CAMPAIGN_ROTATED',transfer:result.transfer,transition,eligibility,entrySnapshot,instrumentInput,review:next.runtime.hourlyValueReview};check(new TextEncoder().encode(JSON.stringify(eventBody)).length<=2000000,'EVENT_PAPER_EVIDENCE_SIZE');
 const subscription=await saveEventPaperSubscription({db,owner,previous:s,next,claim,events:[{id:result.transfer.id,kind:'RUNTIME',at:asOf,body:eventBody}]});
 return {subscription,transfer:result.transfer,reused:false};
}

function entryEligibility(snapshot,market,asOf){
 check(snapshot,'UPBIT_ENTRY_SNAPSHOT_REQUIRED');const resolved=resolveUpbitEntryEligibility(snapshot,{marketIds:[market],asOf});check(resolved.markets[market].allowed,'UPBIT_ENTRY_INELIGIBLE');return resolved;
}
