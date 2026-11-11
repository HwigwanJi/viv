import {replayLiveAutomationFills} from '../dist/domain/live-trade-ledger.mjs';
import {projectMindGame,gameUnits,gameDecimal} from '../dist/domain/mind-game.mjs';

export function liveMindGame({activation,account,fillRows,ledger,snapshot,asOf}){
 try{
  const replay=replayLiveAutomationFills(fillRows,{marketIds:activation.config.marketIds,asOf});
  if(gameDecimal(replay.realized)!==ledger.realizedPnl)throw new TypeError('원장 합계 불일치');
  for(const asset of new Set([...Object.keys(replay.assets),...Object.keys(account.positions?.[activation.id]??{})])){
   const saved=account.positions?.[activation.id]?.[asset];if((replay.assets[asset]?.quantity??0n)!==gameUnits(saved?.quantity??'0')||(replay.assets[asset]?.basis??0n)!==gameUnits(saved?.costBasis??'0'))throw new TypeError('보유 원장 불일치');
  }
  let equity=ledger.equity,valuationAsOf=ledger.valuationAsOf;
  try{if(equity===null&&snapshot){
   const datasets=snapshot.datasets??[snapshot.dataset];let marked=gameUnits(ledger.cash);const stamps=[];
   for(const position of ledger.positions){
    const events=datasets.find(d=>d?.market===position.market)?.events??[],book=events.filter(e=>e.kind==='ORDER_BOOK'&&e.market===position.market&&e.eventTime<=asOf&&(e.availableAt??e.receivedAt)<=asOf).at(-1),at=book?.availableAt??book?.receivedAt;
    if(!at||Date.parse(asOf)-Date.parse(at)>120000||at<ledger.ledgerAsOf)throw new TypeError('저장 평가 시각 확인');
    marked+=gameUnits(position.quantity)*gameUnits(book.levels[0].bidPrice)/(10n**18n);stamps.push(at);
   }
   equity=gameDecimal(marked);valuationAsOf=stamps.sort()[0];
  }}catch{equity=null;valuationAsOf=null;}
  return projectMindGame({ledger:replay.ledger,currency:activation.config.quoteCurrency,asOf,expectedRealized:ledger.realizedPnl,equity,valuationAsOf});
 }catch{return {status:'DATA_REQUIRED',currency:activation.config.quoteCurrency,todayRealizedPnl:null,equity:null,settlements:[],asOf};}
}
