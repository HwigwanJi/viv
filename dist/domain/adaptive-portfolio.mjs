import {PORTFOLIO_TARGET_VERSION} from './portfolio-graph.mjs';
import {scorePortfolioNews} from './portfolio-news.mjs';

export const ADAPTIVE_PORTFOLIO_VERSION='causal-regime-experts-v1';
export const ADAPTIVE_PORTFOLIO_TYPES=['MARKET_STATE','PORTFOLIO_EXPERT','PORTFOLIO_ROUTER'];
export const EXPERT_MODES=['TREND','BREAKOUT','RECOVERY','CASH'];
export const SUPPORTED_EXPERT_MODES=[...EXPERT_MODES,'BTC_HOLD','NEWS'];
const H=3600000,sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length?sum(a)/a.length:0;
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'ADAPTIVE_PORTFOLIO_INPUT'});};
const sd=a=>Math.sqrt(mean(a.map(x=>(x-mean(a))**2)));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function adaptiveDefaults(type){
 if(type==='MARKET_STATE')return {lookback:24};
 if(type==='PORTFOLIO_EXPERT')return {mode:'TREND',maxPositions:3,maxAssetWeight:.5};
 if(type==='PORTFOLIO_ROUTER')return {trainingBars:120,horizonHours:6,bandwidth:1,temperature:.002,costBps:15,minWeightChange:.1};
}
export function assertAdaptiveConfig(type,c){
 const keys=Object.keys(adaptiveDefaults(type)),optional=type==='PORTFOLIO_ROUTER'?['rebalanceEveryHours','newsReturnBps','newsHalfLifeHours','returnQuantile']:[];check(c&&Object.keys(c).every(k=>keys.includes(k)||optional.includes(k))&&keys.every(k=>Object.hasOwn(c,k)),'학습 포트폴리오의 정식 설정을 확인하세요.');
 if(type==='PORTFOLIO_ROUTER'&&Object.hasOwn(c,'returnQuantile'))check(Number.isFinite(c.returnQuantile)&&c.returnQuantile>=.5&&c.returnQuantile<=.99,'수익 분포의 선택 백분위를 확인하세요.');
 if(type==='PORTFOLIO_ROUTER'&&Object.hasOwn(c,'newsReturnBps'))check(Number.isFinite(c.newsReturnBps)&&Math.abs(c.newsReturnBps)<=10000&&Number.isFinite(c.newsHalfLifeHours)&&c.newsHalfLifeHours>0&&c.newsHalfLifeHours<=720,'뉴스 수익 계수와 반감기를 확인하세요.');
 if(type==='PORTFOLIO_ROUTER'&&Object.hasOwn(c,'rebalanceEveryHours'))check(Number.isInteger(c.rebalanceEveryHours)&&c.rebalanceEveryHours>=1&&c.rebalanceEveryHours<=24,'배분 판단 주기는 1~24시간입니다.');
 if(type==='MARKET_STATE')check(Number.isInteger(c.lookback)&&c.lookback>=24&&c.lookback<=72,'국면 계산 기간은 24~72개 확정 시간봉입니다.');
 if(type==='PORTFOLIO_EXPERT')check(SUPPORTED_EXPERT_MODES.includes(c.mode)&&Number.isInteger(c.maxPositions)&&c.maxPositions>=1&&c.maxPositions<=20&&Number.isFinite(c.maxAssetWeight)&&c.maxAssetWeight>0&&c.maxAssetWeight<=1,'전략 종류·동시 종목 수·종목 비중을 확인하세요.');
 if(type==='PORTFOLIO_ROUTER')check(Number.isInteger(c.trainingBars)&&c.trainingBars>=24&&c.trainingBars<=720&&Number.isInteger(c.horizonHours)&&c.horizonHours>=1&&c.horizonHours<=24&&Number.isFinite(c.bandwidth)&&c.bandwidth>0&&c.bandwidth<=10&&Number.isFinite(c.temperature)&&c.temperature>0&&c.temperature<=.1&&Number.isFinite(c.costBps)&&c.costBps>=0&&c.costBps<=100&&Number.isFinite(c.minWeightChange)&&c.minWeightChange>=0&&c.minWeightChange<=1,'학습 기간·국면 유사도·배분 민감도·편도 비용·최소 조정 비중을 확인하세요.');
}
/** Continuous state, computed only from closed bars; no hindsight regime labels. */
export function marketState(value,config){
 assertAdaptiveConfig('MARKET_STATE',config);check(value?.timeframe==='1h'&&Array.isArray(value.items)&&Number.isFinite(Date.parse(value.asOf)),'확정 시간봉 후보를 연결하세요.');
 const end=Date.parse(value.asOf),features=[];
 for(const item of value.items){
  const bars=item.bars.filter(b=>Date.parse(b.closeTime)<=end).slice(-config.lookback-1);
  if(bars.length<config.lookback+1||Date.parse(bars.at(-1).closeTime)!==end||bars.some((b,i)=>!Number.isFinite(b.close)||b.close<=0||i&&Date.parse(b.closeTime)-Date.parse(bars[i-1].closeTime)!==H))continue;
  const last=bars.at(-1),returns=bars.slice(1).map((b,i)=>Math.log(b.close/bars[i].close)),volatility=sd(returns),prior=bars.slice(0,-1);
  const news=value.news?scorePortfolioNews(value.news,{instrumentId:item.instrumentId,assetClass:item.instrumentId.startsWith('crypto:')?'crypto':'equity',asOf:value.evaluatedAt??value.asOf,halfLifeHours:value.newsHalfLifeHours??24}):null;
  features.push({instrumentId:item.instrumentId,price:last.close,quoteVolume:item.quoteVolume,r1:Math.log(last.close/bars.at(-2).close),r6:Math.log(last.close/bars.at(-7).close),r24:Math.log(last.close/bars.at(-25).close),volatility,breakout:Math.log(last.close/Math.max(...prior.map(b=>b.high))),drawdown:Math.log(last.close/Math.max(...bars.map(b=>b.high))),warning:item.warning,warningKnown:item.warningKnown,...(news?{newsScore:news.score,newsEventCount:news.eventCount}:{})});
 }
 check(features.length>0,'국면 계산에 연속된 확정 시간봉이 필요합니다.');
 const breadth=mean(features.map(f=>Number(f.r6>0))),volatility=mean(features.map(f=>f.volatility)),trend=mean(features.map(f=>f.r6)),dispersion=sd(features.map(f=>f.r6));
 const vector=[clamp(trend/Math.max(volatility*Math.sqrt(6),.001),-4,4),2*breadth-1,Math.log1p(volatility*100),Math.log1p(dispersion*100),clamp(mean(features.map(f=>f.drawdown))/Math.max(volatility*Math.sqrt(24),.001),-6,0)];
 return {contractVersion:ADAPTIVE_PORTFOLIO_VERSION,asOf:value.asOf,lookback:config.lookback,vector,metrics:{trend6h:trend,breadth6h:breadth,volatility1h:volatility,dispersion6h:dispersion},features};
}
export function expertPortfolio(state,config){
 assertAdaptiveConfig('PORTFOLIO_EXPERT',config);check(state?.contractVersion===ADAPTIVE_PORTFOLIO_VERSION,'시장 상태 계산을 연결하세요.');
 if(config.mode==='NEWS'){
  const scores=state.features.filter(f=>f.warning===false&&f.warningKnown!==false&&f.newsScore>0).sort((a,b)=>b.newsScore-a.newsScore||(b.quoteVolume??0)-(a.quoteVolume??0)||a.instrumentId.localeCompare(b.instrumentId)).slice(0,config.maxPositions),total=sum(scores.map(f=>f.newsScore)),weights=Object.fromEntries(scores.map(f=>[f.instrumentId,Math.min(config.maxAssetWeight,f.newsScore/total)]));
  return {contractVersion:ADAPTIVE_PORTFOLIO_VERSION,asOf:state.asOf,config:structuredClone(config),weights,cashWeight:1-sum(Object.values(weights)),scores:scores.map(f=>({instrumentId:f.instrumentId,score:f.newsScore}))};
 }
 if(config.mode==='BTC_HOLD'){
  const btc=state.features.find(f=>f.instrumentId==='crypto:upbit:KRW-BTC');
  check(btc,'BTC 보유 전략에는 투자 범위 안의 확정 BTC 시세가 필요합니다.');
  const weights=btc.warning===false&&btc.warningKnown!==false?{[btc.instrumentId]:config.maxAssetWeight}:{};
  return {contractVersion:ADAPTIVE_PORTFOLIO_VERSION,asOf:state.asOf,config:structuredClone(config),weights,cashWeight:1-sum(Object.values(weights)),scores:[]};
 }
 const eligible=state.features.filter(f=>f.warning===false&&f.warningKnown!==false),scores=eligible.map(f=>({instrumentId:f.instrumentId,score:config.mode==='TREND'?(f.r6>0&&f.r24>0?f.r6/Math.max(.001,f.volatility):-Infinity):config.mode==='BREAKOUT'?(f.breakout>=0&&f.r6>0?f.r6/Math.max(.001,f.volatility):-Infinity):config.mode==='RECOVERY'?(f.r24<0&&f.r1>0?f.r1/Math.max(.001,f.volatility):-Infinity):-Infinity})).filter(f=>Number.isFinite(f.score)).sort((a,b)=>b.score-a.score||a.instrumentId.localeCompare(b.instrumentId)).slice(0,config.maxPositions);
 const weights=Object.fromEntries(scores.map(f=>[f.instrumentId,Math.min(config.maxAssetWeight,1/scores.length)]));
 return {contractVersion:ADAPTIVE_PORTFOLIO_VERSION,asOf:state.asOf,config:structuredClone(config),weights,cashWeight:1-sum(Object.values(weights)),scores};
}
const distance=(a,b)=>mean(a.map((v,i)=>(v-b[i])**2));
export function driftWeights(weights,relatives){
 const gross=1-sum(Object.values(weights))+sum(Object.entries(weights).map(([id,w])=>w*relatives[id]));
 check(Number.isFinite(gross)&&gross>0,'모든 보유 종목의 다음 평가 가격이 필요합니다.');
 return {gross,weights:Object.fromEntries(Object.entries(weights).map(([id,w])=>[id,w*relatives[id]/gross]))};
}
export const portfolioTurnover=(a,b)=>sum([...new Set([...Object.keys(a),...Object.keys(b)])].map(id=>Math.abs((a[id]??0)-(b[id]??0))));
/** Self financing: fees reduce the NAV used to size the target, including sells. */
export function portfolioCostFraction(before,after,costRate){
 let left=1-costRate*2,right=1;
 for(let i=0;i<48;i++){const m=(left+right)/2,turnover=sum([...new Set([...Object.keys(before),...Object.keys(after)])].map(id=>Math.abs(m*(after[id]??0)-(before[id]??0))));if(m+costRate*turnover>1)right=m;else left=m;}
 return (left+right)/2;
}
export function routePortfolio(value,state,experts,config,portfolio){
 assertAdaptiveConfig('PORTFOLIO_ROUTER',config);check(experts.length>=2&&experts.length<=12&&experts.some(e=>e.config.mode==='CASH')&&new Set(experts.map(e=>e.config.mode)).size===experts.length&&experts.every(e=>e.asOf===state.asOf),'현금과 서로 다른 전략을 같은 시장 시점으로 연결하세요.');
 check(!experts.some(e=>e.config.mode==='NEWS')||value.news&&Object.hasOwn(config,'newsReturnBps'),'뉴스 전략의 실제 입력과 수익 계수를 연결하세요.');
 const period=(config.rebalanceEveryHours??1)*H,last=Date.parse(portfolio.lastRebalancedAt),now=Date.parse(value.asOf);
 check(!Number.isFinite(last)||last<=now,'이전 배분 시각과 현재 확정봉을 확인하세요.');
 if(Number.isFinite(last)&&Math.floor(last/period)===Math.floor(now/period))return {value:{contractVersion:PORTFOLIO_TARGET_VERSION,profileId:portfolio.profileId,quoteCurrency:portfolio.quoteCurrency,asOf:value.asOf,universeHash:portfolio.universeHash,targets:portfolio.weights.map(w=>({instrumentId:w.instrumentId,targetWeight:w.weight})),cashWeight:portfolio.cashWeight,rebalanceDue:false},learning:{status:'WAIT_RESEARCH_INTERVAL',nextAnalysisAt:new Date((Math.floor(now/period)+1)*period).toISOString(),rebalanceEveryHours:config.rebalanceEveryHours??1}};
 const end=Date.parse(value.asOf),rate=config.costBps/10000,records=experts.map(()=>[]),horizon=config.horizonHours*H;
 let samples=0;
 for(let t=end-(config.trainingBars+config.horizonHours)*H;t<=end-horizon;t+=H){
  const clipped={...value,asOf:new Date(t).toISOString(),evaluatedAt:new Date(t).toISOString(),items:value.items.map(item=>({...item,bars:item.bars.filter(b=>Date.parse(b.closeTime)<=t)}))};
  let s;try{s=marketState(clipped,{lookback:state.lookback});}catch{continue;}
  const relatives={};
  for(const item of value.items){const bars=item.bars.filter(b=>Date.parse(b.closeTime)>t&&Date.parse(b.closeTime)<=t+horizon);if(bars.length===config.horizonHours&&bars.every((b,i)=>Date.parse(b.closeTime)===t+(i+1)*H)&&bars[0].open>0)relatives[item.instrumentId]=bars.at(-1).close/bars[0].open;}
  for(let i=0;i<experts.length;i++){
   const weights=expertPortfolio(s,experts[i].config).weights;
   if(Object.keys(weights).some(id=>!relatives[id]))continue;
   const entry=portfolioCostFraction({},weights,rate),next=driftWeights(weights,relatives),exit=portfolioCostFraction(next.weights,{},rate);
   records[i].push({state:s.vector,netLogReturn:Math.log(entry*next.gross*exit),at:t+horizon});
  }
  samples++;
 }
 check(samples>=24,'적어도 24개의 완료된 다음 시간봉 결과가 필요합니다.');
 const current=Object.fromEntries(portfolio.weights.map(w=>[w.instrumentId,w.weight]));
 const estimates=records.map((rows,i)=>{
  let weight=0,weighted=0,squared=0;const distribution=[];for(const row of rows){const w=Math.exp(-distance(state.vector,row.state)/(2*config.bandwidth**2))*.5**((end-row.at)/(config.trainingBars*H));weight+=w;weighted+=w*row.netLogReturn;squared+=w*w;distribution.push({value:row.netLogReturn,weight:w});}
  check(weight>0,'전략별 완료된 학습 표본이 필요합니다.');
  let quantile=weighted/weight;if(Object.hasOwn(config,'returnQuantile')){let accumulated=0;for(const row of distribution.sort((a,b)=>a.value-b.value)){accumulated+=row.weight;quantile=row.value;if(accumulated>=config.returnQuantile*weight)break;}}
  const expected=weighted/weight,costNow=-Math.log(portfolioCostFraction(current,experts[i].weights,rate)),entryAlreadyModelled=-Math.log(portfolioCostFraction({},experts[i].weights,rate));
  const newsSignal=sum(Object.entries(experts[i].weights).map(([id,w])=>w*(state.features.find(f=>f.instrumentId===id)?.newsScore??0))),effectiveNewsBps=value.news?.coefficient?.returnBps??config.newsReturnBps??0,newsAdjustment=newsSignal*effectiveNewsBps/10000;
  const newsRoundTrip=Math.log(portfolioCostFraction({},experts[i].weights,rate)*portfolioCostFraction(experts[i].weights,{},rate)),netReturn=experts[i].config.mode==='NEWS'?newsAdjustment+newsRoundTrip:expected+newsAdjustment;
  return {mode:experts[i].config.mode,netLogReturn:netReturn,historicalNetLogReturn:expected,switchCost:costNow,newsSignal,newsAdjustment,selectionBasis:config.returnQuantile?'WEIGHTED_QUANTILE':'CONDITIONAL_MEAN',returnQuantile:config.returnQuantile??null,selectionNetLogReturn:experts[i].config.mode==='NEWS'?netReturn:quantile+newsAdjustment,score:(experts[i].config.mode==='NEWS'?netReturn:quantile+newsAdjustment)-costNow+entryAlreadyModelled,effectiveSamples:weight*weight/squared,samples:rows.length};
 });
 const cashScore=estimates.find(e=>e.mode==='CASH').score;
 // Cash is an investable alternative: do not subsidize an expert with lower estimated net growth.
 const maximum=Math.max(...estimates.map(e=>e.score)),raw=estimates.map(e=>e.mode==='CASH'||e.score>cashScore?Math.exp((e.score-maximum)/config.temperature):0),total=sum(raw),mix=raw.map(v=>v/total),weights={};
 for(let i=0;i<experts.length;i++)for(const [id,w] of Object.entries(experts[i].weights))weights[id]=(weights[id]??0)+mix[i]*w;
 const all=[...new Set([...Object.keys(weights),...Object.keys(current)])].sort(),largest=Math.max(0,...all.map(id=>Math.abs((weights[id]??0)-(current[id]??0)))),rebalanceDue=largest+1e-12>=config.minWeightChange;
 const targets=all.map(instrumentId=>({instrumentId,targetWeight:rebalanceDue?(weights[instrumentId]??0):(current[instrumentId]??0)}));
 return {value:{contractVersion:PORTFOLIO_TARGET_VERSION,profileId:portfolio.profileId,quoteCurrency:portfolio.quoteCurrency,asOf:value.asOf,universeHash:portfolio.universeHash,targets,cashWeight:1-sum(targets.map(t=>t.targetWeight)),rebalanceDue},learning:{trainedThrough:value.asOf,predictionHorizon:config.horizonHours+'h',regime:state.metrics,experts:estimates.map((e,i)=>({...e,allocation:mix[i]})),samples,costBps:config.costBps,largestWeightChange:largest}};
}
