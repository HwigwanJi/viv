import {evaluatePositionProfitGraph,hasPositionProfitLadder} from '../dist/domain/position-profit-ladder.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';

const lastChecks=new Map(),terminal=new Set(['FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND']);
/** Both runners keep the same prepared graph decision durable until normal order reconciliation settles it. */
export async function processPositionProfitLadder({id,graph,state,executionMode,clock,hasPosition,readAccount,readOrders,save,execute,onSettled,force=false}){
 if(!hasPositionProfitLadder(graph))return null;
 const now=()=>clock(),iso=n=>new Date(n).toISOString();
 if(state.dispatch){
  const signal=state.dispatch,row=(await readOrders()).find(r=>r.idempotencyKey===signal.key);
  if(row){
   if(!terminal.has(row.state))return {state:'ORDER_RECONCILING'};
   const filled=Number(row.appliedQuantity??0)>0||row.fills?.length>0||row.state==='FILLED';
   state.dispatch=null;if(filled)await onSettled();
   await save('POSITION_PROFIT_RECONCILED',{key:signal.key,state:row.state,filled});return {state:filled?'PROFIT_PARTIAL_FILLED':'PROFIT_UNFILLED'};
  }
  if(now()>=signal.expiresAt){state.dispatch=null;await save('POSITION_PROFIT_SIGNAL_EXPIRED',{key:signal.key});return {state:'PROFIT_RECHECK'};}
  if(now()<signal.readyAt)return {state:'PROFIT_ORDER_READY'};
  const r=await execute(signal);
  if(r.record?.state==='UNFILLED'){state.dispatch=null;await save('POSITION_PROFIT_UNFILLED',{key:signal.key});return {state:'PROFIT_UNFILLED'};}
  return {state:'ORDER_'+(r.record?.state??'SUBMITTED'),market:signal.market};
 }
 if(!hasPosition())return null;
 const cacheKey=id+':'+graph.nodes.map(n=>n.id).join(','),time=Date.parse(now());
 if(!force&&time-(lastChecks.get(cacheKey)??0)<5000)return null;
 lastChecks.set(cacheKey,time);
 const own=await readAccount(),asOf=now(),account=own.account;
 if(!account.positions.length)return null;
 const instrumentId=account.positions[0].instrumentId,market=instrumentId.slice('crypto:upbit:'.length);
 const evaluation=evaluatePositionProfitGraph({graph,account,instrumentId,asOf,executionMode,valuation:own.sellRate===undefined?null:{book:own.book,sellRate:own.sellRate}}),d=evaluation.output.decision;
 if(!evaluation.output.ready||!evaluation.output.orderAllowed||d?.action!=='sell'||d.intent?.code!=='TAKE_PROFIT')return null;
 if(own.minSellTotal!==undefined&&account.positions[0].quantity*d.positionFraction.fraction*Number(own.book.levels[0].bidPrice)<Number(own.minSellTotal))return null;
 const key='profit:'+id+':'+hash({graphHash:evaluation.graphHash,nodeId:d.intent.nodeId,ledgerHash:own.ledgerHash,asOf}).slice(0,24);
 state.dispatch={key,market,action:'sell',ledgerHash:own.ledgerHash,evaluation,positionAccount:account,snapshotAsOf:asOf,sourceHash:hash({account,book:own.book}),readyAt:iso(Date.parse(asOf)+100),expiresAt:iso(Date.parse(asOf)+10000)};
 await save('HOURLY_VALUE_EVALUATED',{snapshotAsOf:asOf,inputHash:state.dispatch.sourceHash,snapshot:{positionAccount:account,book:own.book},evaluation});
 await save('POSITION_PROFIT_ORDER_READY',{dispatch:state.dispatch});
 return {state:'PROFIT_ORDER_READY',market};
}
