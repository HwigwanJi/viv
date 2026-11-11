import {buildInvestorPerformance} from '../dist/domain/investor-performance.mjs';
import {replayLiveAutomationFills} from '../dist/domain/live-trade-ledger.mjs';
import {gameUnits as n,gameDecimal as d} from '../dist/domain/mind-game.mjs';
import {currentPaperQuote} from './mind-execution-service.mjs';

const parse=v=>typeof v==='string'?JSON.parse(v):v;
export function projectLiveInvestorPerformance({activation,account,ledger,fillRows=[],capitalRows=[],gamification=null,asOf}){
 try{
  const rows=capitalRows.map(r=>({id:r.id,...parse(r.body)})).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const initial=rows[0]?.previousCapitalPrincipal??activation.capitalPrincipal??activation.config.capitalLimit;
  let principal=n(initial);for(const row of rows){if(n(row.previousCapitalPrincipal)!==principal||n(row.capitalPrincipal)-principal!==n(row.capitalFlow))throw Error('자금 변경 원장의 연결을 확인하세요.');principal=n(row.capitalPrincipal);}
  if(principal!==n(activation.capitalPrincipal??activation.config.capitalLimit)||!rows.length&&activation.lastCapitalUpdate)throw Error('최초 원금과 자금 변경 이력을 확인하세요.');
  const replay=replayLiveAutomationFills(fillRows,{marketIds:activation.config.marketIds,asOf});
  if(d(replay.realized)!==ledger.realizedPnl||d(replay.fees)!==ledger.feesPaid)throw Error('전체 체결과 손익·수수료 합계를 확인하세요.');
  for(const asset of new Set([...Object.keys(replay.assets),...Object.keys(account.positions?.[activation.id]??{})])){const saved=account.positions?.[activation.id]?.[asset];if((replay.assets[asset]?.quantity??0n)!==n(saved?.quantity??'0')||(replay.assets[asset]?.basis??0n)!==n(saved?.costBasis??'0'))throw Error('현재 보유와 체결 원장을 대조하세요.');}
  const equity=ledger.equity??gamification?.equity??null,valuationAt=ledger.equity!==null?ledger.valuationAsOf:gamification?.valuationAsOf;
  return buildInvestorPerformance({currency:activation.config.quoteCurrency,startAt:activation.userConfirmedAt,asOf,initialCapital:initial,netContributedCapital:d(principal),flows:rows.map(r=>({id:r.id,at:r.at,amount:r.capitalFlow})),currentEquity:equity,valuationAt,ledgerAsOf:ledger.ledgerAsOf,realizedPnl:ledger.realizedPnl,feesPaid:ledger.feesPaid,cash:ledger.cash,realizedTimeline:replay.ledger.map(t=>({id:t.exchangeTradeId,at:t.at,realizedPnl:t.exactRealizedPnl})),source:'OWN_ACTIVATION_FILLS_AND_CAPITAL_RECEIPTS'});
 }catch(error){return {status:'DATA_REQUIRED',reason:error.message,currency:activation.config.quoteCurrency,startAt:activation.userConfirmedAt,asOf,chart:{points:[]}};}
}

/** Optional display valuation, using the shared unsigned public quote reader. */
export async function refreshInvestorValuations(activities,{fetchImpl,quoteLoader=currentPaperQuote,now}={}){
 const quotes=new Map(),clock=()=>new Date(typeof now==='function'?now():now??Date.now()).toISOString();
 await Promise.all([...new Set(activities.flatMap(a=>a.ledger?.positions??[]).map(p=>p.market))].map(async market=>{
  if(!/^(KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(market))return;
  const [quoteCurrency,baseAsset]=market.split('-'),instrument={id:'crypto:upbit:'+market,symbol:market,quoteCurrency,baseAsset,assetClass:'crypto',venue:'UPBIT'};
  try{quotes.set(market,await quoteLoader(instrument,{fetchImpl,now:clock}));}catch{quotes.set(market,null);}
 }));
 return activities.map(activity=>{
  const m=activity.investorMetrics;if(!m||!['READY','PARTIAL'].includes(m.status)||!activity.ledger.positions.length)return activity;
  try{let equity=n(activity.ledger.cash);const stamps=[],sources=[];const at=clock();
   for(const position of activity.ledger.positions){const q=quotes.get(position.market);if(!q||q.instrumentId!==position.instrumentId||q.currency!==activity.quoteCurrency||!Number.isFinite(q.price)||q.price<=0||!q.rawSha256||q.asOf>q.receivedAt||q.receivedAt>at||Date.parse(at)-Date.parse(q.asOf)>30000||q.asOf<activity.ledger.ledgerAsOf)throw Error('평가 시세를 기다리고 있어요.');equity+=n(position.quantity)*n(q.price)/(10n**18n);stamps.push(q.asOf);sources.push({instrumentId:q.instrumentId,price:q.price,currency:q.currency,asOf:q.asOf,receivedAt:q.receivedAt,source:q.source,rawSha256:q.rawSha256});}
   // Rebuild the return from the already verified complete chart without rereading orders.
   const timeline=[];let previous=0n;for(const [index,p]of m.chart.points.entries()){const value=n(p.realizedPnl);if(value!==previous){timeline.push({id:'verified-'+index,at:p.at,realizedPnl:d(value-previous)});previous=value;}}
   const result=buildInvestorPerformance({currency:m.currency,startAt:m.startAt,asOf:at,initialCapital:m.initialCapital,netContributedCapital:m.netContributions,flows:m.flows,currentEquity:d(equity),valuationAt:stamps.sort()[0],ledgerAsOf:m.ledgerAsOf,realizedPnl:m.realizedPnl,feesPaid:m.feesPaid,cash:m.cash,realizedTimeline:timeline,source:m.source});
   if(result.status!=='READY')throw Error(result.reason);return {...activity,ledger:{...activity.ledger,equity:d(equity),unrealizedPnl:result.unrealizedPnl,valuationAsOf:result.valuationAt,valuationKind:'PUBLIC_QUOTE_DISPLAY',asOf:at},investorMetrics:{...result,sourceRevision:m.sourceRevision,fillCount:m.fillCount,chart:{...m.chart,points:[...m.chart.points,{...m.chart.points.at(-1),at}]},valuationSources:sources}};
  }catch{return activity;}
 });
}

export function projectPaperInvestorPerformance(account,valuation,{asOf}={}){
 try{
  const decimal=v=>{if(!Number.isFinite(v))throw Error('모의 계좌 원장을 확인하세요.');return v.toFixed(8);};
  const flows=(account.fundingLedger??[]).map((f,i)=>({id:f.id??'fund-'+i,at:f.at,amount:decimal(f.amount)})),capital=account.initialCash+(account.fundingLedger??[]).reduce((s,f)=>s+f.amount,0),fills=account.ledger??[];
  return buildInvestorPerformance({currency:account.quoteCurrency,startAt:account.createdAt,asOf,initialCapital:decimal(account.initialCash),netContributedCapital:decimal(capital),flows,currentEquity:['CURRENT','CASH_ONLY','UNTRADED'].includes(valuation?.status)?decimal(valuation.equity):null,valuationAt:valuation?.asOf??null,ledgerAsOf:fills.at(-1)?.at??account.createdAt,realizedPnl:decimal(fills.reduce((s,f)=>s+(f.realizedPnl??0),0)),feesPaid:decimal(account.feesPaid),cash:decimal(account.cash),realizedTimeline:fills.map((f,i)=>({id:f.runId??'trade-'+i,at:f.at,realizedPnl:decimal(f.realizedPnl??0)})),source:'OWN_PAPER_ACCOUNT_FUNDING_AND_FILLS'});
 }catch{return {status:'DATA_REQUIRED',reason:'모의 계좌의 원금과 체결 기록을 확인하세요.',chart:{points:[]}};}
}
