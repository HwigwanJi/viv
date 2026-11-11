import {replayLiveAutomationFills} from '../domain/live-trade-ledger.mjs';
import {projectMindGame,gameUnits,gameDecimal,koreaDay} from '../domain/mind-game.mjs';

/** Reads the existing order registry and public book; all execution stays in the runner. */
export function createMindGameEnricher(){
 const cache=new Map();
 return async function enrich(items,{request,fetchImpl=globalThis.window?.fetch?.bind(globalThis.window),clock=()=>new Date().toISOString()}={}){
  if(!fetchImpl)return items;
  const ids=new Set(items.map(a=>a.activationId));for(const id of cache.keys())if(!ids.has(id))cache.delete(id);
  return Promise.all(items.map(async activity=>{
   if(!activity.activationId||activity.ledger?.status!=='READY')return activity;
   let knownGame=null;try{
    const at=clock(),key=activity.ledger.ledgerAsOf+':'+activity.ledger.realizedPnl+':'+koreaDay(at),saved=cache.get(activity.activationId);let game=activity.gamification?.status==='READY'?activity.gamification:saved?.key===key?saved.game:null;
    if(!game){
     const result=await request('/api/workspace/automated-trading/orders?'+new URLSearchParams({activationId:activity.activationId}));
     if(!Array.isArray(result.items)||result.items.length>=100)return activity;
     let sequence=0;const rows=result.items.slice().reverse().flatMap(order=>(order.order?.trades??[]).map(trade=>({fill_sequence:++sequence,trade_body:JSON.stringify(trade),order_body:JSON.stringify(order),applied_fee:order.appliedFee})));
     const replay=replayLiveAutomationFills(rows,{marketIds:activity.marketIds,asOf:at});
     for(const position of activity.ledger.positions??[]){const asset=position.asset??position.market?.split('-')[1];if(replay.assets[asset]?.quantity!==gameUnits(position.quantity)||replay.assets[asset]?.basis!==gameUnits(position.costBasis))throw Error('보유 대조');}
     game=projectMindGame({ledger:replay.ledger,currency:activity.quoteCurrency,asOf:at,expectedRealized:activity.ledger.realizedPnl,equity:activity.ledger.equity,valuationAsOf:activity.ledger.valuationAsOf});cache.set(activity.activationId,{key,game});
    }
    knownGame=game;let equity=activity.ledger.equity,valuationAsOf=activity.ledger.valuationAsOf;
    const positions=activity.ledger.positions??[];
    if(equity===null&&positions.length){
     const markets=positions.map(p=>p.market),response=await fetchImpl('https://api.upbit.com/v1/orderbook?'+new URLSearchParams({markets:markets.join(',')}),{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('호가 조회');
     const books=await response.json(),receivedAt=clock();let units=gameUnits(activity.ledger.cash);
     for(const p of positions){const book=books.find(b=>b.market===p.market);if(!book?.orderbook_units?.length||!Number.isFinite(book.timestamp)||Math.abs(Date.parse(receivedAt)-book.timestamp)>5000)throw Error('호가 시각');units+=gameUnits(p.quantity)*gameUnits(String(book.orderbook_units[0].bid_price))/(10n**18n);}
     equity=gameDecimal(units);valuationAsOf=receivedAt;
    }
    return {...activity,gamification:{...game,equity,valuationAsOf}};
   }catch{return knownGame?{...activity,gamification:{...knownGame,equity:activity.ledger.equity,valuationAsOf:activity.ledger.valuationAsOf}}:activity;}
  }));
 };
}
