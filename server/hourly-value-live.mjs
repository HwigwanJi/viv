import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {evaluateStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {resolveStrategyGraphInputs} from './quant-inputs.mjs';
import {createHourlyValueReview,advanceHourlyValueReview} from '../dist/domain/hourly-value-review.mjs';
import {rejectedHourlyValueFallback} from '../dist/domain/hourly-value-policy.mjs';
import {processPositionProfitLadder} from './position-profit-ladder.mjs';
import {readHourlyReviewWithBackoff} from './hourly-review-retry.mjs';

const H=3600000,iso=t=>new Date(t).toISOString(),check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:409});};
const steps=s=>s.phase==='REJECTED'?rejectedHourlyValueFallback(s.selection).steps:s.phase==='READY'&&s.review?s.review.steps:s.selection.steps;
function ownAtCapturedBook(own,book,asOf){
 const price=Number(book?.levels?.[0]?.bidPrice);
 if(!(price>0&&Number.isFinite(price))||book.market!==own.book.market||![book.eventTime,book.receivedAt,book.availableAt??book.receivedAt].every(t=>Number.isFinite(Date.parse(t))&&t<=asOf&&Date.parse(asOf)-Date.parse(t)<=3000))return null;
 const instrumentId='crypto:upbit:'+book.market,positions=own.position.positions.map(p=>p.instrumentId===instrumentId?{...p,marketPrice:price,marketValue:p.quantity*price,priceAsOf:book.eventTime}:p);
 return {...own,book,position:{...own.position,positions,equity:own.position.cash+positions.reduce((n,p)=>n+p.marketValue,0)}};
}
export function liveHourlyValueAccount(activation,position,asOf){
 const positions=Object.entries(activation.positions??{}).filter(([,p])=>Number(p.quantity)>0).map(([asset,p])=>({market:activation.config.quoteCurrency+'-'+asset,quantity:p.quantity}));
 return {profileId:activation.config.profileId,accountId:position.id,asOf,cash:position.exact.cash,positions,sourceHash:hash({id:position.id,cash:position.exact.cash,positions,initialCash:position.exact.initialCash})};
}
function binding(activation,account,node,fees){return {subscriptionId:activation.id,subscriptionStatus:activation.status,profileId:activation.config.profileId,accountId:account.accountId,graphHash:activation.executionPolicy?.graphHash??activation.config.graphHash,manifestHash:activation.executionPolicy?.manifestHash??activation.config.manifestHash,modelHash:node.config.model.hash,ledgerHash:account.sourceHash,configHash:hash(activation.config),feeHash:hash({buyRate:Number(fees.buyRate),sellRate:Number(fees.sellRate)})};}

/** The same sealed graph/review feeds the existing live order adapter and reconciled own ledger. */
export function processHourlyValueLive(args){return processHourlyValueAccount({...args,executionMode:'LIVE'});}

/** The same decision/review state machine also drives isolated learning paper wallets. */
export async function processHourlyValueAccount({manifest,graph,runtime,clock,readOwn,readOrders,source,save,execute,hasPosition=()=>true,executionMode}={}){
 check(['LIVE','PAPER'].includes(executionMode),'HOURLY_VALUE_EXECUTION_MODE');
 if(runtime.exitDeliveryVersion!=='hourly-exit-delivery-v2'){runtime.exitDeliveryVersion='hourly-exit-delivery-v2';await save('EXIT_DELIVERY_UPGRADED',{version:runtime.exitDeliveryVersion});}
 const now=()=>clock(),boundary=iso(Math.floor(Date.parse(now())/H)*H),node=graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST');
 const state=runtime.hourlyValue??={lastBoundary:null,review:null,completedSteps:0,attempt:0,dispatch:null};
 async function profitCheck(force=false,capturedOwn=null){
  if(state.dispatch)return null;
  const profitState=runtime.positionProfit??={dispatch:null};
  const profit=await processPositionProfitLadder({id:manifest.scope.profileId,graph,state:profitState,force,executionMode,clock:now,hasPosition,readOrders,save,execute,
   readAccount:async()=>{const own=capturedOwn??await readOwn();return {account:own.position,book:own.book,sellRate:own.readiness.fees.takerSellRate,minSellTotal:own.readiness.rules.minSellTotal,ledgerHash:liveHourlyValueAccount(own.activation,own.position,now()).sourceHash};},
   onSettled:async()=>{state.review=null;state.completedSteps=0;state.attempt=0;}
  });
  if(profit)runtime.lastState=profit.state;return profit;
 }
 const urgentProfit=await profitCheck();if(urgentProfit)return urgentProfit;
 async function status(value,extra={}){if(runtime.lastState!==value){runtime.lastState=value;await save('HOURLY_VALUE_STATE',{state:value,...extra});}return {state:value,...extra};}
 let markets=[],review=null,captureRequired=false;
 if(state.lastBoundary!==boundary){
  if(Date.parse(now())>=Date.parse(boundary)+120000){state.lastBoundary=boundary;state.review=null;state.reviewRetry=null;return status('WAIT_NEXT_HOURLY_SIGNAL');}
  captureRequired=true;
  Object.assign(state,{review:null,reviewRetry:null,completedSteps:0,attempt:0,dispatch:null,inputError:null});
 }else{
  if(state.inputError)return status('HOURLY_INPUT_REQUIRED',{code:state.inputError});
  const old=state.review;if(!old||['STALE','EXPIRED'].includes(old.phase)||now()>=old.expiresAt)return status(old&&now()>=old.expiresAt?'HOURLY_VALUE_EXPIRED':'WAIT_NEXT_HOURLY_SIGNAL');
  if(state.dispatch){
   const row=(await readOrders()).find(o=>o.idempotencyKey===state.dispatch.key);
   if(!row){
    if(now()<state.dispatch.readyAt)return status('HOURLY_ORDER_READY');
    const dispatched=await execute(state.dispatch);return status('ORDER_'+dispatched.record?.state,{market:state.dispatch.market,identifier:dispatched.record?.identifier});
   }
   if(row&&!['FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND'].includes(row.state))return status('ORDER_RECONCILING');
   if(row){
    const own=await readOwn(state.dispatch.market),account=liveHourlyValueAccount(own.activation,own.position,now()),fees=state.fees,b=binding(own.activation,account,node,fees);
    if(Number(row.appliedQuantity??row.applied_quantity??row.executedQuantity??0)>0||row.fills?.length||row.state==='FILLED'){
     const remaining=account.positions.some(p=>p.market===state.dispatch.market&&Number(p.quantity)>0),complete=state.dispatch.action==='buy'||!remaining;
     if(complete)state.completedSteps++;
     const recreated=createHourlyValueReview({selection:old.selection,binding:b,expiresAt:old.expiresAt,...node.config.policy});state.review=advanceHourlyValueReview(recreated,{binding:b,asOf:now(),review:old.rawReview});
    }else state.attempt++;
    state.dispatch=null;await save('HOURLY_VALUE_ORDER_RECONCILED',{identifier:row.identifier,orderState:row.state,completedSteps:state.completedSteps,review:state.review});
   }
  }
  if(state.completedSteps>=steps(state.review).length)return status('WAIT_NEXT_HOURLY_SIGNAL');
  if(state.review.phase==='WAITING_REVIEW'&&Date.parse(now())<Date.parse(boundary)+120000)return status('HOURLY_VALUE_WAITING_REVIEW');
  if(['WAITING_ENTRY','REJECTED'].includes(state.review.phase)&&now()<state.review.review?.readyAt)return status('HOURLY_VALUE_WAITING_ENTRY');
  if(state.review.selection.selected.kind==='ENTER'&&!state.review.rawReview){review=await readHourlyReviewWithBackoff(state.reviewRetry??={}, {market:state.review.selection.selected.market,forecastAsOf:boundary,expiresAt:state.review.expiresAt,clock:now,read:args=>source.readReview(args),save:(phase,retry)=>save('HOURLY_REVIEW_FETCH',{phase,retry})});if(!review)return status('HOURLY_REVIEW_UNAVAILABLE');}
 }
 const chosen=state.review?steps(state.review)[state.completedSteps]?.market??state.review.selection.selected.market:null,own=await readOwn(chosen);
 // Account/network reads must finish before capturing the three-second scoring quotes.
 if(captureRequired){
  check(Date.parse(now())<Date.parse(boundary)+120000,'HOURLY_CAPTURE_TOO_LATE');
  const captured=await source.snapshot();markets=captured.markets;
  // Reuse captured depth: another account read would age the scoring quotes.
  const book=captured.books?.find(b=>b.market===own.book.market);
  const marked=book?ownAtCapturedBook(own,book,now()):null;
  if(marked){const afterCaptureProfit=await profitCheck(true,marked);if(afterCaptureProfit)return afterCaptureProfit;}
 }
 const asOf=now(),account=liveHourlyValueAccount(own.activation,own.position,asOf);
 if(!state.review)check(Date.parse(asOf)<Date.parse(boundary)+120000,'HOURLY_CAPTURE_TOO_LATE');
 const r=own.readiness,fees={buyRate:r.fees.takerBuyRate,sellRate:r.fees.takerSellRate,availableAt:r.fees.observedAt,sourceHash:r.fees.sourceHash},b=binding(own.activation,account,node,fees);
 if(state.review&&state.dispatch===null&&state.review.binding.ledgerHash!==b.ledgerHash){state.review=advanceHourlyValueReview(state.review,{binding:b,asOf});await save('HOURLY_VALUE_BINDING_CHANGED',{review:state.review});return status('HOURLY_VALUE_STALE');}
 const expiresAt=[iso(Date.parse(boundary)+H),own.activation.config.endsAt].filter(Boolean).sort()[0],snapshot={contractVersion:'hourly-value-input-v1',asOf,account,markets,fees,expiresAt,valuationBook:own.book,executionAttempt:state.attempt,...(state.review?{reviewState:state.review,review}:{})},sourceHash=hash(snapshot),inputs=resolveStrategyGraphInputs({graph,manifest,asOf,source:{datasetSha256:sourceHash},hourlyValueSnapshot:snapshot,account:own.position,executionInstrumentId:'crypto:upbit:'+(chosen??own.book.market)});
 const evaluation=evaluateStrategyGraph(graph,[],{asOf,sourceHash,inputs,trigger:'closed_bar',context:{profileId:account.profileId,accountId:account.accountId,currentWeight:own.position.equity>0?own.position.positions.reduce((n,p)=>n+p.marketValue,0)/own.position.equity:0,executionMode,executionInstrumentId:'crypto:upbit:'+(chosen??own.book.market),hourlyValueBinding:b,hourlyValueUniverse:manifest.data.universe.instrumentIds,hourlyValueExecutionEnabled:own.activation.status==='ENABLED',hourlyValueCompletedSteps:state.completedSteps}}),result=evaluation.trace.find(t=>t.nodeId===node.id)?.output;
 state.review=result?.reviewState??state.review;state.lastBoundary=boundary;state.fees=fees;runtime.lastEvaluationAt=asOf;
 state.inputError=!evaluation.output.ready&&!state.review?evaluation.output.reasonCodes?.[0]??'HOURLY_INPUT_REQUIRED':null;runtime.lastErrorCode=state.inputError;
 await save('HOURLY_VALUE_EVALUATED',{snapshotAsOf:asOf,inputHash:sourceHash,snapshot,evaluation,review:state.review});
 const d=evaluation.output.decision;if(!evaluation.output.ready||!evaluation.output.orderAllowed||!['buy','sell'].includes(d?.action))return status(result?.reviewState?'HOURLY_VALUE_'+result.reviewState.phase:'HOURLY_INPUT_REQUIRED',state.inputError?{code:state.inputError}:{});
 if(d.intent?.code==='TAKE_PROFIT'&&!d.hourlyValue){const profit=await profitCheck(true);if(profit)return profit;state.lastBoundary=null;return status('HOURLY_VALUE_RECHECK');}
 const key='hourly:'+own.activation.id+':'+hash(d.hourlyValue.executionKey).slice(0,24);state.dispatch={key,market:d.hourlyValue.executionMarket,action:d.action,ledgerHash:account.sourceHash,evaluation,expiresAt,sourceHash,snapshotAsOf:asOf,readyAt:iso(Date.parse(asOf)+100)};await save('HOURLY_VALUE_ORDER_READY',{dispatch:state.dispatch,evaluationHash:evaluation.outputHash});
 if(now()<state.dispatch.readyAt)return status('HOURLY_ORDER_READY');
 const dispatched=await execute(state.dispatch);
 return status('ORDER_'+dispatched.record?.state,{market:state.dispatch.market,identifier:dispatched.record?.identifier});
}
