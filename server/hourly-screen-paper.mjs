import {processHourlyScreenAccount} from './hourly-screen-runtime.mjs';
import {hourlyPaperPositionAccount} from './hourly-value-review.mjs';
import {saveEventPaperSubscription,eventPaperTrace} from './event-paper-store.mjs';
import {rotateSettledEventCampaign} from '../dist/domain/event-campaign-runtime.mjs';
import {applyEventTargetOrder} from '../dist/domain/event-paper-execution.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {resolveUpbitEntryEligibility} from '../dist/domain/universe-policy.mjs';

/** Paper uses the same graph/timing driver and the existing exact depth/fee ledger. */
export async function processHourlyScreenPaper({db,owner,subscription,source,clock,fence,claim}){
 let s=subscription;const runtime=structuredClone(s.runtime),graph=s.manifest.data.strategyPlan.graph,now=()=>clock(),held=()=>Number(s.state.account.connector.balances.base.available)>0||Number(s.state.account.connector.balances.base.reserved)>0,ledgerHash=()=>hash({id:s.state.account.id,connector:s.state.account.connector});
 async function persist(kind,body,nextState=null){s=await fence();const next=structuredClone(s);next.runtime={...structuredClone(runtime),hourlyValueRequestsUsed:s.runtime.hourlyValueRequestsUsed};if(nextState)next.state=nextState;next.updatedAt=now();const events=[{id:'screen:'+s.id+':'+s.revision+':'+kind+':'+now(),kind:'RUNTIME',at:now(),body}];
  const evaluation=body.evaluation??body.dispatch?.evaluation??body.selected?.evaluation??body.evaluations?.[0]?.evaluation;if(evaluation){next.runtime.lastEvaluationAt=evaluation.asOf;next.runtime.lastDecision={id:'screen-decision:'+evaluation.outputHash,kind:'DECISION',at:evaluation.asOf,recordedAt:now(),action:evaluation.output.decision?.action,targetWeight:evaluation.output.decision?.targetWeight,orderAllowed:evaluation.output.orderAllowed,trace:eventPaperTrace(graph,evaluation)};events.push({id:next.runtime.lastDecision.id,kind:'DECISION',at:evaluation.asOf,body:next.runtime.lastDecision});}
  s=await saveEventPaperSubscription({db,owner,previous:s,next,claim:claim(),events});
 }
 const result=await processHourlyScreenAccount({graph,manifest:s.manifest,runtime,clock:now,executionMode:'PAPER',source,hasPosition:held,ledgerHash,
  readOrders:async()=>s.state.account.connector.orders.map(o=>({idempotencyKey:o.id,state:o.status,fills:s.state.account.connector.fills.filter(f=>f.orderId===o.id)})),
  save:persist,
  readOwn:async market=>{s=await fence();market??=s.state.account.connector.instrument.symbol;
   if(!held()&&market!==s.state.account.connector.instrument.symbol){const frame={sequence:s.runtime.sequence+1,asOf:now()},rotated=rotateSettledEventCampaign({state:s.state,dataset:source.dataset(market),config:s.config,frame,id:s.id});await persist('HOURLY_SCREEN_ROTATION',{transfer:rotated.transfer},rotated.state);}
   const book=await source.readBook({market});s=await fence();const fees=source.dataset(market).feeSnapshot;return {activation:{id:s.id,config:{graphHash:s.pins.graphHash}},position:hourlyPaperPositionAccount(s,book,now()),book,readiness:{fees,rules:{minSellTotal:source.dataset(market).rules.minSellTotal}}};
  },execute:async signal=>{s=await fence();if(signal.ledgerHash!==ledgerHash())throw Object.assign(Error('모의 원장이 바뀌었습니다.'),{code:'HOURLY_SCREEN_LEDGER_CHANGED'});
   if(signal.action==='buy'){const snapshot=await source.readEntrySnapshot(),eligibility=resolveUpbitEntryEligibility(snapshot,{marketIds:[signal.market],asOf:now()});if(!eligibility.markets[signal.market]?.allowed)throw Object.assign(Error('현재 신규 매수 제외 종목입니다.'),{code:'UPBIT_ENTRY_INELIGIBLE'});}
   const book=await source.readBook({market:signal.market,after:signal.readyAt});s=await fence();
   const execution=applyEventTargetOrder(s.state.account,{evaluation:{...signal.evaluation,decisionAt:signal.snapshotAsOf,providerReadyAt:signal.readyAt},orderId:signal.key,book,now:now(),orderType:s.config.orderType,maxSlippageBps:s.config.slippageBps,participationRate:s.config.participationRate,maxDailyLossRatio:s.config.maxDailyLossRatio});
   await persist('HOURLY_SCREEN_PAPER_EXECUTION',{key:signal.key,execution}, {...s.state,account:execution.account});return {record:{state:execution.order?.status??'UNFILLED'}};
  }});
 runtime.state=result.state;await persist('HOURLY_SCREEN_DRIVER',result);return result;
}
