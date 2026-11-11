import {hashInputPackage} from './workspace.mjs';
import {createSessionAccount,SESSION_RULE_VERSION} from './session-rule.mjs';
import {runSessionStrategyDay} from './session-strategy.mjs';
import {sessionSignalHistory} from './session-regime.mjs';
const check=(v,m)=>{if(!v)throw Object.assign(new Error(m),{code:'SESSION_DATASET',status:400});};
export function assertSessionDataset(d){
 check(d?.contractVersion==='us-equity-daily-approx-v1'&&['TQQQ','SOXL','QQQ'].includes(d.symbol)&&/^[a-f0-9]{64}$/.test(d.sourceHash??'')&&Array.isArray(d.bars)&&d.bars.length>5&&d.bars.length<10000,'USD 일봉 자료 및 출처 확인');
 let previous='';for(const b of d.bars){check(/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.date>previous&&[b.open,b.high,b.low,b.close,b.split,b.futureSplitFactor].every(n=>Number.isFinite(n)&&n>0)&&Number.isFinite(b.dividend)&&b.dividend>=0&&Number.isSafeInteger(b.volume)&&b.volume>=0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)&&b.low<=b.high,'일봉 가격, 날짜, 기업행사 및 거래량 확인');previous=b.date;}
 return d;
}
export function sessionInitialAccount(d,{startAt,initialCash}){
 assertSessionDataset(d);const first=d.bars.findIndex(b=>b.date>=startAt.slice(0,10));check(first>=5,'직전 5거래일 준비 자료 필요');
 const s=createSessionAccount({symbol:d.symbol,initialCash}),factor=d.bars[first].futureSplitFactor;s.history=d.bars.slice(first-5,first).map(b=>b.close/b.futureSplitFactor*factor*d.bars[first].split);return s;
}
export function applySessionCorporateActions(account,bar){
 const s=structuredClone(account);
 if(bar.split!==1){check(Number.isSafeInteger(s.quantity*bar.split),'주식분할 잔여 단주 처리 자료 필요');s.quantity*=bar.split;s.history=s.history.map(p=>p/bar.split);}
 if(bar.dividend>0){const amount=s.quantity*bar.dividend;s.cash+=amount;s.dividendsPaid+=amount;}
 return s;
}
export function dailySessionEvents(bar,path='HIGH_FIRST'){
 check(['HIGH_FIRST','LOW_FIRST'].includes(path),'일봉 내 가격 순서 가정 확인');
 const prices=path==='HIGH_FIRST'?[bar.open,bar.high,bar.low,bar.close]:[bar.open,bar.low,bar.high,bar.close];
 return prices.map((price,i)=>({id:bar.date+'-'+i,at:bar.date+'T'+['13:30','15:00','18:00','20:00'][i]+':00.000Z',session:i===3?'CLOSE':'REGULAR',price,liquidity:Math.max(0,Math.floor(bar.volume/4))}));
}
export function runSessionSimulationFrame({graph,account,bar,feeBps=10,slippageBps=5,path='HIGH_FIRST',sourceHash,signalHistory}){
 const adjusted=applySessionCorporateActions(account,bar),decisionAt=bar.date+'T08:00:00.000Z';
 return runSessionStrategyDay({graph,account:adjusted,date:bar.date,decisionAt,feeBps,slippageBps,sourceHash,signalHistory,events:dailySessionEvents(bar,path),limitFillPolicy:'LIMIT'});
}
export function sessionPerformance(curve,initialCash,{terminalFeeBps=0,terminalSlippageBps=0}={}){
 check(curve.length>0&&Number.isFinite(initialCash)&&initialCash>0,'평가자산 경로 및 초기 자금 확인');
 let peak=initialCash,mdd=0,peakAt=null,longest=0,underSince=null;
 for(const r of curve){check(Number.isFinite(r.equity)&&r.equity>=0,'평가자산 확인');if(r.equity>=peak){if(underSince)longest=Math.max(longest,(Date.parse(r.at)-Date.parse(underSince))/86400000);peak=r.equity;peakAt=r.at;underSince=null;}else{underSince??=peakAt??curve[0].at;longest=Math.max(longest,(Date.parse(r.at)-Date.parse(underSince))/86400000);mdd=Math.max(mdd,1-r.equity/peak);}}
 const last=curve.at(-1),terminalCost=last.quantity*(last.price??0)*(1-(1-terminalSlippageBps/10000)*(1-terminalFeeBps/10000)),final=last.equity-terminalCost,terminalMdd=Math.max(mdd,1-final/peak);
 return {initialEquity:initialCash,finalEquity:final,totalReturn:final/initialCash-1,totalReturnPct:(final/initialCash-1)*100,maxDrawdown:terminalMdd,averageExposure:curve.reduce((n,r)=>n+(r.equity?r.quantity*r.price/r.equity:0),0)/curve.length,terminalLiquidationCost:terminalCost,longestUnderwaterDays:longest,unrecoveredAtEnd:Boolean(underSince),quoteCurrency:'USD'};
}
export function runSessionBacktest(d,{graph,startAt,endAt,initialCash=100000,feeBps=10,slippageBps=5,path='HIGH_FIRST',signalDataset,signalLag=0}){
 let account=sessionInitialAccount(d,{startAt,initialCash});const selected=d.bars.filter(b=>b.date>=startAt.slice(0,10)&&b.date<endAt.slice(0,10)),curve=[],fills=[],decisions=[];check(selected.length>0,'선택 기간의 일봉 확인');
 for(const bar of selected){const signalHistory=graph.nodes.some(n=>n.type==='SESSION_SIGNAL')?sessionSignalHistory(signalDataset,bar.date,{lag:signalLag}):undefined,r=runSessionSimulationFrame({graph,account,bar,feeBps,slippageBps,path,sourceHash:d.sourceHash,signalHistory});account=r.account;fills.push(...r.fills);curve.push({at:bar.date+'T20:00:00.000Z',equity:r.equity,cash:account.cash,quantity:account.quantity,price:bar.close,mode:account.mode,t:account.t,...(account.sessionRegime?{regime:account.sessionRegime}:{})});decisions.push({date:bar.date,mode:r.evaluation.output.value.mode,t:account.t,planHash:account.lastPlanHash,fillCount:r.fills.length,...(account.sessionRegime?{regime:account.sessionRegime,signal:r.evaluation.trace.find(n=>n.type==='SESSION_SIGNAL')?.value}:{})});}
 const metrics=sessionPerformance(curve,initialCash,{terminalFeeBps:feeBps,terminalSlippageBps:slippageBps});return {contractVersion:SESSION_RULE_VERSION,metrics:{...metrics,tradeCount:fills.length,feesPaid:account.feesPaid,dividendsPaid:account.dividendsPaid,slippagePaid:fills.reduce((n,f)=>n+f.slippageCost,0),totalCosts:account.feesPaid+fills.reduce((n,f)=>n+f.slippageCost,0)+metrics.terminalLiquidationCost,cycleCount:account.cycle-1},curve,fills,decisions,account,assumptions:{execution:'REGULAR_OHLC_APPROXIMATION',actualBrokerFills:false,extendedSessionCoverage:false,intradayPath:path,slippagePolicy:'ADVERSE_FILL_WITH_LIMIT_ENFORCEMENT',dividends:'EX_DATE_GROSS_CASH',feesIncluded:true,taxesIncluded:false,cashInterest:0,compounding:'FULL',rulePublication:'2026-08-02',historicalDataAvailableBeforeRulePublication:true}};
}
export function compactSessionEvaluation(evaluation){
 const visit=v=>{
  if(Array.isArray(v))return v.map(visit);
  if(v&&typeof v==='object'){
   if(v.contractVersion===SESSION_RULE_VERSION&&Array.isArray(v.orders)){const {orders,...plan}=v;return {...visit(plan),orderCount:orders.length,ordersHash:hashInputPackage(orders)};}
   return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
  }return v;
 };return visit(evaluation);
}
