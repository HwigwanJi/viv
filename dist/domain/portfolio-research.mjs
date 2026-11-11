import {createManagedPortfolioGraph,evaluateAdaptivePortfolio} from './adaptive-portfolio-graph.mjs';
import {portfolioCostFraction,driftWeights} from './adaptive-portfolio.mjs';
import {hashInputPackage} from './workspace.mjs';
const H=3600000;
/** Entry starts after input availability; historical closes cannot be traded retroactively. */
export function scorePortfolioForecast(forecast,frame){
 if(forecast.contractVersion!=='available-next-hour-forecast-v2')return {status:'LEGACY_ENTRY_BEFORE_INPUT_AVAILABILITY',returnPct:null,mddPct:null};
 const start=Date.parse(forecast.entryOpenAt),hours=forecast.horizonHours,end=start+hours*H;
 const values=Object.values(forecast.weights??{});
 if(!Number.isFinite(start)||start%H||!Number.isInteger(hours)||hours<1||hours>24||!Number.isFinite(Date.parse(forecast.knownAt))||Date.parse(forecast.knownAt)>=start||!Number.isFinite(forecast.costBps)||forecast.costBps<0||forecast.costBps>100||values.some(w=>!Number.isFinite(w)||w<0||w>1)||values.reduce((a,b)=>a+b,0)>1+1e-12)throw Error('고정한 예측 시각, 비용과 목표 비중을 확인하세요.');
 if(Date.parse(frame.asOf)<end)return {status:'WAITING',dueAt:new Date(end).toISOString()};
 const byId=new Map(frame.series.map(s=>['crypto:upbit:'+s.market,s.bars])),ids=Object.keys(forecast.weights),rate=forecast.costBps/10000;
 const marks=Array.from({length:hours+1},(_,i)=>Object.fromEntries(ids.map(id=>[id,i===0?byId.get(id)?.find(b=>b.t===start+H)?.open:byId.get(id)?.find(b=>b.t===start+i*H)?.close])));
 if(marks.some(row=>ids.some(id=>!(row[id]>0))))return {status:'MISSING_PRICE_PATH',returnPct:null,mddPct:null};
 let equity=portfolioCostFraction({},forecast.weights,rate),weights={...forecast.weights},peak=1,mdd=1-equity,underwaterSince=equity<1?start:null,maxRecoveryHours=0;
 const curve=[{at:forecast.entryOpenAt,equity}];
 for(let i=1;i<=hours;i++){
  const moved=driftWeights(weights,Object.fromEntries(ids.map(id=>[id,marks[i][id]/marks[i-1][id]])));equity*=moved.gross;weights=moved.weights;
  if(i===hours)equity*=portfolioCostFraction(weights,{},rate);
  peak=Math.max(peak,equity);mdd=Math.max(mdd,1-equity/peak);
  if(equity<peak-1e-12)underwaterSince??=start+i*H;else if(underwaterSince!==null){maxRecoveryHours=Math.max(maxRecoveryHours,(start+i*H-underwaterSince)/H);underwaterSince=null;}
  curve.push({at:new Date(start+i*H).toISOString(),equity});
 }
 return {status:'MATURED_BAR_COST_PROXY',from:forecast.entryOpenAt,to:new Date(end).toISOString(),returnPct:100*(equity-1),mddPct:100*mdd,maxCompletedRecoveryHours:maxRecoveryHours,unrecovered:underwaterSince!==null,curve,costBpsPerSide:forecast.costBps,externalModelCost:0,execution:'NEXT_COMPLETE_HOUR_OPEN_AND_CLOSED_HOUR_MARKS_WITH_ROUND_TRIP_COST_PROXY'};
}
export function researchPortfolio(frame,{graph=createManagedPortfolioGraph(),previous=null}={}){
 const universe=frame.series.map(s=>'crypto:upbit:'+s.market),evaluation=evaluateAdaptivePortfolio(graph,{frame,account:{id:'research',quoteCurrency:'KRW',cash:100000,equity:100000,positions:[]},asOf:frame.availableAt,profileId:'research',universe});
 if(!evaluation.output.ready)throw Object.assign(Error(evaluation.output.reasonCodes.join(', ')),{code:'PORTFOLIO_RESEARCH_INPUT'});
 const router=graph.nodes.find(n=>n.type==='PORTFOLIO_ROUTER'),learning=evaluation.trace.find(n=>n.type==='PORTFOLIO_ROUTER'),weights=Object.fromEntries(evaluation.output.value.targets.filter(t=>t.targetWeight>0).map(t=>[t.instrumentId,t.targetWeight])),costBps=router.config.costBps;
 const timing={contractVersion:'available-next-hour-forecast-v2',asOf:frame.asOf,knownAt:frame.availableAt,entryOpenAt:new Date((Math.floor(Date.parse(frame.availableAt)/H)+1)*H).toISOString(),horizonHours:router.config.horizonHours,costBps};
 const forecasts={LEARNED:{...timing,weights},BTC_HOLD:{...timing,weights:{'crypto:upbit:KRW-BTC':1}},CASH:{...timing,weights:{}}};
 const sourceHash=hashInputPackage({...frame,...(frame.entryEligibility?{entryEligibility:{...frame.entryEligibility,markets:Object.entries(frame.entryEligibility.markets).sort(([a],[b])=>a.localeCompare(b))}}:{})});
 return {contractVersion:'managed-portfolio-research-v1',asOf:frame.asOf,observedAt:frame.availableAt,graphHash:hashInputPackage(graph),sourceHash,sourceHashContract:'market-map-sorted-entries-v1',universeCount:universe.length,observedStateCount:frame.features?.length??null,eligibleCount:universe.filter(id=>frame.entryEligibility?.markets[id.slice('crypto:upbit:'.length)]?.allowed===true).length,learning,forecasts,forecastMeaning:'FROZEN_CANDIDATE_WEIGHTS',previousOutcomes:previous?Object.fromEntries(Object.entries(previous.forecasts).map(([id,f])=>[id,scorePortfolioForecast(f,frame)])):null,performanceMeaning:'Independent frozen 3h paper forecasts; not a continuous live portfolio ledger',costs:{feeBpsAssumption:5,spreadSlippageProxyBps:costBps-5,modelCalls:0,externalModelCost:0,agentConversationCostIncluded:false,fundingCostIncluded:false}};
}
/** Long-horizon forecasts survive intervening research cycles until their own outcomes mature. */
export function advancePortfolioResearchQueue(previous,current,frame){
 const forecasts=report=>report?Object.entries({BASE:report,...(report.horizonComparisons??{})}).flatMap(([variant,r])=>
  Object.entries(r.forecasts).map(([name,forecast])=>({id:hashInputPackage({sourceHash:report.sourceHash,variant,name,forecast}),cohortAsOf:report.asOf,variant,name,forecast}))):[];
 const pending=[],outcomes=[],unique=new Map([...(previous?.pendingForecasts??forecasts(previous)),...forecasts(current)].map(f=>[f.id,f]));
 for(const f of unique.values()){const result=scorePortfolioForecast(f.forecast,frame);if(result.status==='WAITING')pending.push(f);else outcomes.push({...f,result});}
 return {pendingForecasts:pending,outcomesThisCycle:outcomes,cumulativeOutcomeCount:(previous?.cumulativeOutcomeCount??0)+outcomes.filter(o=>o.result.status==='MATURED_BAR_COST_PROXY').length};
}
