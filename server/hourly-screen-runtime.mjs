import {evaluateHourlyScreen} from '../dist/domain/hourly-pullback.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {processPositionProfitLadder} from './position-profit-ladder.mjs';

const H=3600000,iso=t=>new Date(t).toISOString(),terminal=new Set(['FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND']);
export async function processHourlyScreenAccount({graph,manifest,runtime,clock,readOwn,readOrders,source,save,execute,hasPosition,executionMode='LIVE',ledgerHash}){
 if(runtime.exitDeliveryVersion!=='hourly-exit-delivery-v2'){runtime.exitDeliveryVersion='hourly-exit-delivery-v2';await save('EXIT_DELIVERY_UPGRADED',{version:runtime.exitDeliveryVersion});}
 const now=()=>clock(),boundary=iso(Math.floor(Date.parse(now())/H)*H),state=runtime.hourlyScreen??={boundary:null,dispatch:null},order=graph.nodes.find(n=>n.type==='ORDER').config;
 async function status(value,extra={}){if(runtime.lastState!==value){runtime.lastState=value;await save('HOURLY_SCREEN_STATE',{state:value,...extra});}return {state:value,...extra};}
 if(state.dispatch){const signal=state.dispatch,row=(await readOrders()).find(r=>r.idempotencyKey===signal.key);
  if(row&&!terminal.has(row.state))return status('ORDER_RECONCILING');
  if(row){state.dispatch=null;if(signal.action==='sell'){state.attempt=(state.attempt??0)+1;if(hasPosition()||Date.parse(now())<Date.parse(boundary)+(order.captureWindowMs??120000))state.boundary=null;}await save('HOURLY_SCREEN_ORDER_RECONCILED',{key:signal.key,state:row.state});return status('WAIT_NEXT_HOURLY_SIGNAL');}
  if(now()>=signal.expiresAt){state.dispatch=null;if(signal.action==='sell'){state.boundary=null;state.attempt=(state.attempt??0)+1;}await save('HOURLY_SCREEN_EXPIRED',{key:signal.key});return status('WAIT_NEXT_HOURLY_SIGNAL');}
  if(now()<signal.readyAt)return status('HOURLY_SCREEN_WAITING_ENTRY',{market:signal.market,readyAt:signal.readyAt});
  const result=await execute(signal);if(result.record?.state==='UNFILLED'){state.dispatch=null;if(signal.action==='sell'){state.boundary=null;state.attempt=(state.attempt??0)+1;}await save('HOURLY_SCREEN_UNFILLED',{key:signal.key});}return status('ORDER_'+result.record?.state,{market:signal.market});
 }
 const profit=await processPositionProfitLadder({id:manifest.scope.profileId,graph,state:runtime.positionProfit??={dispatch:null},executionMode,clock:now,hasPosition,readOrders,save,execute,onSettled:async()=>{},readAccount:async()=>{const own=await readOwn();return {account:own.position,book:own.book,sellRate:own.readiness.fees.takerSellRate,minSellTotal:own.readiness.rules.minSellTotal,ledgerHash:ledgerHash(own)};}});if(profit)return profit;
 if(state.boundary===boundary)return status('WAIT_NEXT_HOURLY_SIGNAL');
 const own=await readOwn(),held=own.position.positions.find(p=>p.quantity>0);
 if(!held&&Date.parse(now())>=Date.parse(boundary)+(order.captureWindowMs??120000)){state.boundary=boundary;await save('HOURLY_SCREEN_DEADLINE',{boundary});return status('WAIT_NEXT_HOURLY_SIGNAL');}
 const captured=held?null:await source.snapshot();
 if(!held&&Date.parse(now())>=Date.parse(boundary)+(order.captureWindowMs??120000)){state.boundary=boundary;return status('WAIT_NEXT_HOURLY_SIGNAL');}
 const input=captured?.input??null,markets=held?[held.instrumentId.slice('crypto:upbit:'.length)]:(input?.value.items??[]).map(i=>i.instrumentId.slice('crypto:upbit:'.length)),evaluations=[];let selected=null;
 for(const market of markets){const valuation={book:own.book,sellRate:own.readiness.fees.takerSellRate},evaluation=evaluateHourlyScreen({graph,account:own.position,market,candidateInput:input,asOf:now(),executionMode,valuation});evaluations.push({market,evaluation});if(evaluation.output.ready&&evaluation.output.orderAllowed&&['buy','sell'].includes(evaluation.output.decision?.action)){selected={market,evaluation};break;}}
 const blocked=evaluations.find(row=>!row.evaluation.output.ready);runtime.lastErrorCode=blocked?.evaluation.output.reasonCodes?.[0]??null;
 if(!selected)state.boundary=boundary;
 runtime.lastEvaluationAt=now();await save('HOURLY_SCREEN_EVALUATED',{boundary,input,exclusions:captured?.exclusions??[],selected,evaluations});
 if(!selected){if(evaluations[0])await save('DECISION_SUMMARY',{snapshotAsOf:evaluations[0].evaluation.asOf,inputHash:hash({input,boundary}),evaluation:evaluations[0].evaluation});return status(blocked?'HOURLY_INPUT_REQUIRED':held?'HOLD_POSITION':input?.value.items.length?'CASH_NO_PULLBACK_CANDIDATE':'FIVE_MINUTE_INPUT_WARMUP',blocked?{code:runtime.lastErrorCode}:{});}
 const chosen=await readOwn(selected.market),asOf=now();
 selected.evaluation=evaluateHourlyScreen({graph,account:chosen.position,market:selected.market,candidateInput:input,asOf,executionMode,valuation:{book:chosen.book,sellRate:chosen.readiness.fees.takerSellRate}});
 if(!selected.evaluation.output.orderAllowed||!['buy','sell'].includes(selected.evaluation.output.decision?.action))return status('ACCOUNT_CHANGED_RECHECK');
 const readyAt=iso(Math.max(Date.parse(asOf)+100,Date.parse(boundary)+(held?0:order.entryDelayMs??181000))),expiresAt=iso(Date.parse(boundary)+H),sourceHash=hash({input,boundary,evaluation:selected.evaluation});
 await save('DECISION_SUMMARY',{snapshotAsOf:asOf,inputHash:sourceHash,evaluation:selected.evaluation});
 state.dispatch={key:'screen:'+chosen.activation.id+':'+hash({boundary,market:selected.market,graphHash:chosen.activation.config.graphHash,ledgerHash:ledgerHash(chosen),attempt:state.attempt??0}).slice(0,24),market:selected.market,action:selected.evaluation.output.decision.action,evaluation:selected.evaluation,ledgerHash:ledgerHash(chosen),snapshotAsOf:asOf,sourceHash,readyAt,expiresAt};state.boundary=boundary;await save('HOURLY_SCREEN_ORDER_READY',{dispatch:state.dispatch});return status('HOURLY_SCREEN_WAITING_ENTRY',{market:selected.market,readyAt});
}
