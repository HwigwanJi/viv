import {gameUnits,gameDecimal} from './mind-game.mjs';

export const INVESTOR_PERFORMANCE_POLICY='MIND_INVESTOR_CASHFLOW_V1';
const DAY=86400000,validTime=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const exact=gameDecimal,n=gameUnits;
const requireValue=(ok,message)=>{if(!ok)throw new TypeError(message);};
const ratio=(a,b)=>b>0n?Number(a)/Number(b):null;
export function buildInvestorPerformance({currency,startAt,asOf,initialCapital,netContributedCapital,flows=[],currentEquity=null,valuationAt=null,ledgerAsOf=null,realizedPnl='0',feesPaid='0',cash=null,realizedTimeline=[],source='OWN_LEDGER',historyComplete=true}={}){
 const base={policyVersion:INVESTOR_PERFORMANCE_POLICY,currency,startAt,asOf,source,method:'MODIFIED_DIETZ_ELAPSED_TIME',dailyMethod:'GEOMETRIC_DAILY_EQUIVALENT',costs:{tradingFees:'INCLUDED_IN_LEDGER',modelCalls:'EXCLUDED'},status:'DATA_REQUIRED'};
 try{
  requireValue(validTime(startAt)&&validTime(asOf)&&startAt<=asOf&&typeof currency==='string','운용 기간과 통화를 확인하세요.');
  requireValue(historyComplete,'전체 자금 이동 원장을 확인하세요.');
  const initial=n(initialCapital),net=n(netContributedCapital),realized=n(realizedPnl),fees=n(feesPaid),duration=Date.parse(asOf)-Date.parse(startAt);
  requireValue(initial>0n&&fees>=0n,'운용 원금을 확인하세요.');
  const span=BigInt(Math.max(1,duration)),seen=new Set();let deposited=0n,withdrawn=0n,principal=initial,weighted=initial*span;
  const capitalEvents=flows.slice().sort((a,b)=>a.at.localeCompare(b.at)||String(a.id).localeCompare(String(b.id)));
  for(const flow of capitalEvents){
   requireValue(flow.id&&!seen.has(flow.id)&&validTime(flow.at)&&flow.at>=startAt&&flow.at<=asOf,'자금 이동 시각과 식별자를 확인하세요.');seen.add(flow.id);
   const amount=n(flow.amount);principal+=amount;if(amount>0n)deposited+=amount;else withdrawn-=amount;
   weighted+=amount*BigInt(duration?Date.parse(asOf)-Date.parse(flow.at):1);
  }
  requireValue(principal===net,'자금 이동 합계와 순 납입 원금을 대조하세요.');
  const days=duration/DAY,equity=currentEquity===null?null:n(currentEquity);
  requireValue(equity===null||equity>=0n&&validTime(valuationAt)&&valuationAt<=asOf&&(!ledgerAsOf||valuationAt>=ledgerAsOf),'평가 시점과 원장을 대조하세요.');
  const pnl=equity===null?null:equity-net,adjusted=pnl!==null&&weighted>0n?Number(pnl*span)/Number(weighted):null;
  const daily=adjusted!==null&&adjusted>=-1&&days>0?Math.expm1(Math.log1p(adjusted)/days):null;
  const details={...base,status:equity===null?'PARTIAL':'READY',elapsedDays:days,initialCapital:exact(initial),additionalDeposits:exact(deposited),withdrawals:exact(withdrawn),grossContributions:exact(initial+deposited),netContributions:exact(net),timeWeightedCapital:exact(weighted/span),equity:equity===null?null:exact(equity),pnl:pnl===null?null:exact(pnl),realizedPnl:exact(realized),unrealizedPnl:pnl===null?null:exact(pnl-realized),feesPaid:exact(fees),cash,netCapitalReturn:pnl===null?null:ratio(pnl,net),flowAdjustedReturn:adjusted!==null&&Number.isFinite(adjusted)?adjusted:null,dailyEquivalentReturn:daily!==null&&Number.isFinite(daily)?daily:null,valuationAt,ledgerAsOf,flowCount:capitalEvents.filter(f=>n(f.amount)!==0n).length,flows:capitalEvents.map(f=>({id:String(f.id),at:f.at,amount:exact(n(f.amount))})),reason:equity===null?'보유 자산의 평가 시세를 기다리고 있어요.':null};
  let runningPnl=0n,runningCapital=initial;const points=[{at:startAt,realizedPnl:'0',netContributions:exact(initial),bookEquity:exact(initial)}],tradeIds=new Set();
  const timeline=[...capitalEvents.map(f=>({...f,type:'fund'})),...realizedTimeline.map(f=>({...f,type:'trade'}))].sort((a,b)=>a.at.localeCompare(b.at)||(a.type===b.type?String(a.id).localeCompare(String(b.id)):a.type==='fund'?-1:1));
  for(const event of timeline){
   requireValue(validTime(event.at)&&event.at>=startAt&&event.at<=asOf,'체결과 평가 시각을 확인하세요.');
   if(event.type==='fund')runningCapital+=n(event.amount);else{requireValue(event.id&&!tradeIds.has(event.id),'체결 식별자를 확인하세요.');tradeIds.add(event.id);runningPnl+=n(event.realizedPnl);}
   points.push({at:event.at,realizedPnl:exact(runningPnl),netContributions:exact(runningCapital),bookEquity:exact(runningCapital+runningPnl)});
  }
  requireValue(runningPnl===realized,'체결 손익과 합계 원장을 대조하세요.');
  points.push({at:asOf,realizedPnl:exact(runningPnl),netContributions:exact(net),bookEquity:exact(net+runningPnl)});
  return {...details,fillCount:tradeIds.size,chart:{basis:'EXACT_REALIZED_PNL_AND_CAPITAL_FLOWS',assetBasis:'CASH_PLUS_ACQUISITION_COST',points}};
 }catch(error){return {...base,reason:error.message,equity:null,flowAdjustedReturn:null,dailyEquivalentReturn:null,netCapitalReturn:null,chart:{basis:'DATA_REQUIRED',points:[]}};}
}

export function investorPerformanceOf(card){
 return card?.investorMetrics??card?.liveActivity?.investorMetrics??card?.paperActivity?.investorMetrics??null;
}
