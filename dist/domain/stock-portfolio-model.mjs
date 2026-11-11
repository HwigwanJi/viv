const sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length;
function state(bars,i){
 const returns=bars.slice(i-19,i+1).map((b,k)=>Math.log(b.close/bars[i-20+k].close)),vol=Math.max(.001,Math.sqrt(mean(returns.map(v=>(v-mean(returns))**2))));
 return [Math.log(bars[i].close/bars[i-1].close)/vol,Math.log(bars[i].close/bars[i-5].close)/(vol*Math.sqrt(5)),Math.log(bars[i].close/bars[i-20].close)/(vol*Math.sqrt(20)),Math.log1p(vol*100)];
}
export function forecastStockPortfolioAsset(bars,{horizonSessions=3,trainingSessions=100,costBpsPerSide=15,newsScore=0,newsReturnBps=100}={}){
 if(!Array.isArray(bars)||bars.length<45||!Number.isInteger(horizonSessions)||horizonSessions<1||horizonSessions>20||!Number.isInteger(trainingSessions)||trainingSessions<20||!Number.isFinite(costBpsPerSide)||costBpsPerSide<0||!Number.isFinite(newsScore)||Math.abs(newsScore)>1||!Number.isFinite(newsReturnBps)||Math.abs(newsReturnBps)>10000||costBpsPerSide>100)throw Error('주식 학습의 관측 봉, 보유 세션과 비용을 확인하세요.');
 for(let i=0;i<bars.length;i++){const b=bars[i];if(!(b.close>0&&b.open>0)||!Number.isFinite(Date.parse(b.closeTime))||i&&b.closeTime<=bars[i-1].closeTime)throw Error('거래일별 확정 가격의 시각과 순서를 확인하세요.');}
 const end=bars.length-1,current=state(bars,end);let total=0,weighted=0,squared=0,count=0,lastLabelAt=null;
 for(let i=Math.max(20,end-horizonSessions-trainingSessions+1);i<=end-horizonSessions;i++){
  const historical=state(bars,i),distance=mean(historical.map((v,j)=>(v-current[j])**2)),w=Math.exp(-distance/2)*.5**((end-i)/trainingSessions),gross=bars[i+horizonSessions].close/bars[i+1].open,label=Math.log(gross)-2*costBpsPerSide/10000;
  total+=w;weighted+=w*label;squared+=w*w;count++;lastLabelAt=bars[i+horizonSessions].closeTime;
 }
 if(!(total>0))throw Error('완료된 주식 학습 결과가 필요합니다.');
 return {modelVersion:'session-kernel-price-news-v1',horizonSessions,netLogReturnEstimate:weighted/total+newsScore*newsReturnBps/10000,priceNetLogReturnEstimate:weighted/total,newsScore,newsReturnBps,samples:count,effectiveSamples:total*total/squared,lastLabelAt,decisionPriceAt:bars.at(-1).closeTime,costBpsPerSide,costBasis:'EXPLICIT_RESEARCH_ASSUMPTION',executionBasis:'NEXT_SESSION_OPEN_TO_HORIZON_SESSION_CLOSE'};
}
export function allocateStockResearchCash(assets,{currency,available,feeBps=15,maxPositions=3}={}){
 if(!['KRW','USD'].includes(currency)||!Number.isFinite(available)||available<0||!Number.isFinite(feeBps)||feeBps<0||!Number.isSafeInteger(maxPositions)||maxPositions<1)throw Error('거래 가능한 통화별 자금과 수수료를 확인하세요.');
 if(!Array.isArray(assets)||assets.some(a=>!a?.instrumentId||!(a.price>0)||!Number.isFinite(a.price)||!Number.isFinite(a.forecast?.netLogReturnEstimate)))throw Error('주식별 종목, 현재 가격과 예측값을 확인하세요.');
 const chosen=assets.filter(a=>a.currency===currency&&a.forecast.netLogReturnEstimate>0&&a.price*(1+feeBps/10000)<=available).sort((a,b)=>b.forecast.netLogReturnEstimate-a.forecast.netLogReturnEstimate||a.instrumentId.localeCompare(b.instrumentId)).slice(0,maxPositions);
 if(currency==='USD')return {currency,available,targets:[],residualCash:available,phase:available?'FRACTIONAL_ORDER_RULES_REQUIRED':'RESEARCH_TARGETS',executionPerformed:false};
 const top=chosen[0]?.forecast.netLogReturnEstimate??0,weights=chosen.map(a=>Math.exp((a.forecast.netLogReturnEstimate-top)/.01)),total=sum(weights);let remaining=available;
 const targets=chosen.map((a,i)=>{const budget=available*weights[i]/total,unitCost=a.price*(1+feeBps/10000),quantity=Math.floor(Math.min(budget,remaining)/unitCost);remaining-=quantity*unitCost;return {instrumentId:a.instrumentId,symbol:a.symbol,currency,quantity,limitPrice:a.price,unitCost};});
 for(const t of targets){const extra=Math.floor(Math.max(0,remaining)/t.unitCost);t.quantity+=extra;remaining-=extra*t.unitCost;}
 return {currency,available,targets:targets.filter(t=>t.quantity>0).map(({unitCost,...t})=>({...t,researchCost:t.quantity*unitCost,order:{symbol:t.symbol,side:'BUY',orderType:'LIMIT',timeInForce:'DAY',quantity:String(t.quantity),price:String(t.limitPrice)}})),residualCash:remaining,phase:'RESEARCH_TARGETS',executionPerformed:false};
}
