import {calibrateNewsCoefficient} from '../dist/domain/portfolio-news.mjs';
import {portfolioCostFraction,driftWeights} from '../dist/domain/adaptive-portfolio.mjs';
const H=3600000;
export function advancePortfolioNewsLearning(state,frame,config){
 const learning=state.portfolioNewsLearning??={forecasts:[],outcomes:[]},byId=new Map(frame.series.map(s=>['crypto:upbit:'+s.market,s.bars]));
 for(const f of learning.forecasts.filter(f=>f.status==='PENDING'&&f.outcomeAt<=frame.asOf)){
  const ids=Object.keys(f.weights),start=Date.parse(f.entryBarCloseAt),end=Date.parse(f.outcomeAt),relatives={};let complete=true;
  for(const id of ids){const rows=byId.get(id)??[],entry=rows.find(b=>b.t===start),exit=rows.find(b=>b.t===end);if(!entry||!exit||rows.filter(b=>b.t>=start&&b.t<=end).length!==f.horizonHours){complete=false;break;}relatives[id]=exit.close/entry.open;}
  if(!complete){f.status='MISSING_PRICE_PATH';continue;}
  const moved=driftWeights(f.weights,relatives),rate=f.costBps/10000,netLogReturn=Math.log(portfolioCostFraction({},f.weights,rate)*moved.gross*portfolioCostFraction(moved.weights,{},rate));
  f.status='MATURED';learning.outcomes.push({id:f.id,knownAt:f.knownAt,outcomeAvailableAt:frame.availableAt,signal:f.signal,excessLogReturn:netLogReturn-f.baselineNetLogReturn,netLogReturn,priceBasis:'NEXT_COMPLETE_HOUR_OPEN_THROUGH_3H_CLOSE_COST_PROXY'});
 }
 learning.forecasts=learning.forecasts.slice(-128);learning.outcomes=learning.outcomes.slice(-512);
 return calibrateNewsCoefficient(learning.outcomes,{asOf:frame.availableAt,priorBps:config.newsReturnBps});
}
export function retainPortfolioNewsForecast(state,{frame,evaluation,config,knownAt,graphHash}){
 const proposal=evaluation.trace.filter(n=>n.type==='PORTFOLIO_EXPERT').map(n=>n.output?.value).find(v=>v?.config.mode==='NEWS'),router=evaluation.trace.find(n=>n.type==='PORTFOLIO_ROUTER');
 const weights=proposal?.weights,signal=router?.experts?.find(e=>e.mode==='NEWS')?.newsSignal;
 if(!weights||!(signal>0))return;
 const learning=state.portfolioNewsLearning??={forecasts:[],outcomes:[]},id=frame.asOf+':'+graphHash;if(learning.forecasts.some(f=>f.id===id))return;
 const entryOpen=(Math.floor(Date.parse(knownAt)/H)+1)*H,baseline=Math.max(0,...router.experts.filter(e=>!['NEWS','CASH'].includes(e.mode)).map(e=>e.historicalNetLogReturn??0));
 learning.forecasts.push({id,status:'PENDING',knownAt,signal,weights:{...weights},baselineNetLogReturn:baseline,costBps:config.costBps,horizonHours:config.horizonHours,entryBarCloseAt:new Date(entryOpen+H).toISOString(),outcomeAt:new Date(entryOpen+config.horizonHours*H).toISOString()});
}
