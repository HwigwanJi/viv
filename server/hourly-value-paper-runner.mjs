import {saveEventPaperSubscription,eventPaperTrace} from './event-paper-store.mjs';
import {preparePaperHourlyValueGraph,executePaperHourlyValueGraph,rotatePaperHourlyValueCampaign,hourlyPaperPositionAccount,executePaperPositionProfit} from './hourly-value-review.mjs';
import {processPositionProfitLadder} from './position-profit-ladder.mjs';
import {readHourlyReviewWithBackoff} from './hourly-review-retry.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {hourlyValueSelectionBoundary} from '../dist/domain/hourly-value-review.mjs';

const H=3600000,iso=n=>new Date(n).toISOString();
export {isHourlyValueGraph} from '../dist/domain/hourly-value-graph.mjs';

/** One normal runner tick advances a saved local-model frame; it never waits through the review interval. */
export async function processHourlyValuePaper({db,owner,subscription,source,clock,fence,claim}={}){
 let s=subscription;const now=()=>clock(),id=s.id,boundary=iso(Math.floor(Date.parse(now())/H)*H),expiry=()=>[iso(Date.parse(boundary)+H),s.config.endsAt].filter(Boolean).sort()[0];
 const args=()=>({db,owner,subscriptionId:id,expectedRevision:s.revision,asOf:now(),claim:claim()});
 async function fresh(){s=await fence();return s;}
 async function state(value,extra={}){
  await fresh();if(s.runtime.state===value&&Object.entries(extra).every(([k,v])=>s.runtime.hourlyValueDriver?.[k]===v))return;
  const next=structuredClone(s);next.runtime.state=value;next.runtime.hourlyValueDriver={...s.runtime.hourlyValueDriver,...extra};next.updatedAt=now();
  if(Object.hasOwn(extra,'inputError'))next.runtime.errorCode=extra.inputError;
  s=await saveEventPaperSubscription({db,owner,previous:s,next,claim:claim(),events:[{id:'hourly-driver:'+id+':'+next.revision+':'+now(),kind:'RUNTIME',at:now(),body:{state:value,...next.runtime.hourlyValueDriver}}]});
 }
 const held=()=>Number(s.state.account.connector.balances.base.available)>0||Number(s.state.account.connector.balances.base.reserved)>0;
 async function prepare(markets,review=null){
  const valuationBook=held()?await source.readBook({market:s.state.account.connector.instrument.symbol}):null;await fresh();
  const fees=source.fees(s.state.account.connector.instrument.symbol),result=await preparePaperHourlyValueGraph({...args(),markets,review,valuationBook,fees,expiresAt:expiry()});s=result.subscription;return result;
 }
 await fresh();let result;
 const profitState=structuredClone(s.runtime.positionProfit??{dispatch:null});
 const profitArgs={id:s.id,graph:s.manifest.data.strategyPlan.graph,state:profitState,executionMode:'PAPER',clock:now,hasPosition:held,
  readAccount:async()=>{const book=await source.readBook({market:s.state.account.connector.instrument.symbol});await fresh();return {account:hourlyPaperPositionAccount(s,book,now()),book,minSellTotal:s.state.account.connector.instrument.minNotional,ledgerHash:hashInputPackage({id:s.state.account.id,connector:s.state.account.connector})};},
  readOrders:async()=>s.state.account.connector.orders.map(o=>({idempotencyKey:o.id,state:o.status,fills:s.state.account.connector.fills.filter(f=>f.orderId===o.id)})),
  onSettled:async()=>{profitState.clearHourly=true;},
  save:async(kind,body)=>{await fresh();const next=structuredClone(s);next.runtime.positionProfit=structuredClone(profitState);next.updatedAt=now();
   if(profitState.clearHourly){next.runtime.hourlyValueReview=null;next.runtime.hourlyValuePrepared=null;next.runtime.hourlyValueProgress=null;delete next.runtime.positionProfit.clearHourly;delete profitState.clearHourly;}
   const events=[{id:'profit-event:'+id+':'+next.revision+':'+kind+':'+now(),kind:'RUNTIME',at:now(),body:{state:kind,...body}}];
   if(body.evaluation){const e=body.evaluation,d=e.output.decision;next.runtime.lastEvaluationAt=e.asOf;next.runtime.lastDecision={id:'profit-decision:'+e.outputHash,kind:'DECISION',at:e.asOf,recordedAt:now(),market:s.state.account.connector.instrument.symbol,action:d.action,targetWeight:d.targetWeight,orderAllowed:e.output.orderAllowed,trace:eventPaperTrace(s.manifest.data.strategyPlan.graph,e)};events.push({id:next.runtime.lastDecision.id,kind:'DECISION',at:e.asOf,body:next.runtime.lastDecision});}
   s=await saveEventPaperSubscription({db,owner,previous:s,next,claim:claim(),events});},
  execute:async signal=>{const book=await source.readBook({market:signal.market,after:signal.snapshotAsOf});await fresh();const r=await executePaperPositionProfit({...args(),executionKey:signal.key,book});s=r.subscription;return {record:{state:r.order?.status??'UNFILLED'}};}
 };
 const profit=await processPositionProfitLadder(profitArgs);
 if(profit){await state(profit.state);return profit;}
 if(s.runtime.hourlyValueDriver?.lastBoundary!==boundary){
  // The first-minute review must occur after selection; starting later would use hindsight.
  if(Date.parse(now())>=Date.parse(boundary)+120000){await state('WAIT_NEXT_HOURLY_SIGNAL',{lastBoundary:boundary});return {state:s.runtime.state};}
  const snapshot=await source.snapshot({asOf:now(),ownedMarketIds:held()?[s.state.account.connector.instrument.symbol]:[]});await fresh();
  if(Date.parse(now())>=Date.parse(boundary)+120000){await state('HOURLY_CAPTURE_TOO_LATE',{lastBoundary:boundary});return {state:s.runtime.state};}
  result=await prepare(snapshot.markets);await state('HOURLY_VALUE_SELECTED',{lastBoundary:boundary,inputError:null,reviewRetry:null});
 }else if(s.runtime.hourlyValueReview&&hourlyValueSelectionBoundary(s.runtime.hourlyValueReview.selection)===boundary){
  const old=s.runtime.hourlyValueReview;
  if(['STALE','EXPIRED'].includes(old.phase)){await state('HOURLY_VALUE_'+old.phase);return {state:s.runtime.state};}
  const progress=s.runtime.hourlyValueProgress;
  if(old.phase==='REJECTED'&&(s.runtime.hourlyValueDriver?.rejectionResolvedSelectionHash===old.selection.hash||progress?.selectionHash===old.selection.hash&&progress.completedSteps>0)){await state('WAIT_NEXT_HOURLY_SIGNAL');return {state:s.runtime.state};}
  if(old.phase==='REJECTED'&&now()<old.review.readyAt){await state('HOURLY_VALUE_WAITING_REJECTED_EXIT');return {state:s.runtime.state};}
  if(progress?.selectionHash===old.selection.hash&&progress.completedSteps>=old.selection.steps.length){await state('WAIT_NEXT_HOURLY_SIGNAL');return {state:s.runtime.state};}
  if(old.phase==='WAITING_REVIEW'&&Date.parse(now())<Date.parse(boundary)+120000){await state('HOURLY_VALUE_WAITING_REVIEW');return {state:s.runtime.state};}
  if(old.phase==='WAITING_ENTRY'&&now()<old.review.readyAt){await state('HOURLY_VALUE_WAITING_ENTRY');return {state:s.runtime.state};}
  const retry=structuredClone(s.runtime.hourlyValueDriver?.reviewRetry??{}),review=old.selection.selected.kind!=='ENTER'||old.rawReview?null:await readHourlyReviewWithBackoff(retry,{market:old.selection.selected.market,forecastAsOf:boundary,expiresAt:old.expiresAt,clock:now,read:args=>source.readReview(args),save:async(phase,value)=>{await fresh();const next=structuredClone(s);next.runtime.hourlyValueDriver={...s.runtime.hourlyValueDriver,reviewRetry:value};next.updatedAt=now();s=await saveEventPaperSubscription({db,owner,previous:s,next,claim:claim(),events:[{id:'review-fetch:'+id+':'+next.revision+':'+now(),kind:'RUNTIME',at:now(),body:{state:'HOURLY_REVIEW_FETCH',phase,retry:value}}]});}});await fresh();
  if(old.selection.selected.kind==='ENTER'&&!old.rawReview&&!review){await state('HOURLY_REVIEW_UNAVAILABLE');return {state:s.runtime.state};}
  result=await prepare([],review);
 }else if(s.runtime.hourlyValueDriver?.inputError){await state('HOURLY_INPUT_REQUIRED');return {state:s.runtime.state};
 }else{await state('WAIT_NEXT_HOURLY_SIGNAL');return {state:s.runtime.state};}
 if(result.evaluation.output.decision?.intent?.code==='TAKE_PROFIT'&&!result.evaluation.output.decision.hourlyValue){const profit=await processPositionProfitLadder({...profitArgs,force:true});if(profit){await state(profit.state);return profit;}await state('HOURLY_VALUE_RECHECK',{lastBoundary:null});return {state:s.runtime.state};}
 for(let leg=0;leg<2;leg++){
  const decision=result.evaluation.output.decision;
  if(!result.evaluation.output.orderAllowed||!['buy','sell'].includes(decision?.action)){await state(result.evaluation.output.reasonCodes.includes('HOURLY_VALUE_WAITING_REJECTED_EXIT')?'HOURLY_VALUE_WAITING_REJECTED_EXIT':result.review?'HOURLY_VALUE_'+result.review.phase:result.evaluation.output.ready?'HOLD':'HOURLY_INPUT_REQUIRED',result.review?.phase==='REJECTED'&&result.evaluation.output.ready?{rejectionResolvedSelectionHash:result.review.selection.hash}:!result.review&&!result.evaluation.output.ready?{inputError:result.evaluation.output.reasonCodes[0]??'HOURLY_INPUT_REQUIRED'}:{});return {state:s.runtime.state};}
  let entrySnapshot=null;const market=decision.hourlyValue.executionMarket;
  if(decision.action==='buy'){
   entrySnapshot=await source.readEntrySnapshot();await fresh();
   const rotated=await rotatePaperHourlyValueCampaign({...args(),dataset:source.dataset(market),entrySnapshot});s=rotated.subscription;
   if(rotated.transfer){result=await prepare([]);}
  }
  const book=await source.readBook({market,after:result.evaluation.asOf});await fresh();
  const executed=await executePaperHourlyValueGraph({...args(),executionKey:result.evaluation.output.decision.hourlyValue.executionKey,book,entrySnapshot,participationRate:s.config.participationRate,maxDailyLossRatio:s.config.maxDailyLossRatio,maxSlippageBps:s.config.slippageBps});s=executed.subscription;
  if(!executed.fills?.length){await state('HOURLY_ORDER_UNFILLED');return {state:s.runtime.state};}
  if(decision.action==='sell'&&s.runtime.hourlyValueReview?.phase==='READY'&&s.runtime.hourlyValueReview.selection.hash===decision.hourlyValue.selectionHash&&s.runtime.hourlyValueReview.selection.steps.length>decision.hourlyValue.stepIndex+1){result=await prepare([]);continue;}
  await state('ORDER_FILLED');return {state:s.runtime.state,market};
 }
 await state('HOURLY_ROTATION_PENDING');return {state:s.runtime.state};
}
