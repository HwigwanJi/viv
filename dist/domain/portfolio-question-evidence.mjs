import {hashInputPackage} from './workspace.mjs';

export const BLIND_PORTFOLIO_HISTORY_VERSION='BLIND_PORTFOLIO_HISTORY_V1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const ratio=value=>finite(value)&&value>=0&&value<=1;
const check=(value,message)=>{if(!value)throw Object.assign(new TypeError(message),{code:'PORTFOLIO_BLIND_PROJECTION',status:409});};
const alias=id=>{check(typeof id==='string'&&id.length>0,'후보 종목 식별값을 확인하세요.');return 'asset-'+hashInputPackage({contract:BLIND_PORTFOLIO_HISTORY_VERSION,instrumentId:id}).slice(0,12);};
function timely(value,asOf){if(value.asOf!==undefined)check(typeof value.asOf==='string'&&Number.isFinite(Date.parse(value.asOf))&&value.asOf<=asOf,'질문 입력의 자료 기준을 확인하세요.');}
function rank(value,asOf){
 check(value?.contractVersion==='portfolio-asset-rank-v1'&&value.timeframe==='1d'&&Array.isArray(value.items)&&value.items.length<=64&&ratio(value.breadth),'질문에 연결한 종목 순위 원본을 확인하세요.');timely(value,asOf);
 const maximum=Math.max(0,...value.items.map(item=>item.quoteVolume)),scoreMaximum=Math.max(0,...value.items.map(item=>Math.abs(item.score)));
 const assets=value.items.map(item=>{
  check(finite(item.score)&&finite(item.volatility)&&item.volatility>=0&&finite(item.quoteVolume)&&item.quoteVolume>=0&&Array.isArray(item.terms),'순위의 수익률·변동성·유동성 값을 확인하세요.');
  const factors=item.terms.map(term=>{check(['MOMENTUM','VOLATILITY','BREAKOUT','SMA_DISTANCE','QUOTE_VOLUME'].includes(term.metric)&&Number.isInteger(term.lookback)&&term.lookback>0&&finite(term.weight)&&finite(term.value),'질문에 연결한 순위 계산 항목을 확인하세요.');const scale=term.metric==='QUOTE_VOLUME'?Math.max(0,...value.items.flatMap(row=>row.terms.filter(t=>t.metric===term.metric&&t.lookback===term.lookback).map(t=>t.value))):1;return {metric:term.metric,lookback:term.lookback,weight:term.weight,value:scale>0?term.value/scale:0};});
  return {asset:alias(item.instrumentId),score:scoreMaximum>0?item.score/scoreMaximum:0,dailyVolatility:item.volatility,relativeLiquidity:maximum>0?item.quoteVolume/maximum:0,factors};
 });
 check(new Set(assets.map(item=>item.asset)).size===assets.length,'순위의 종목 중복을 확인하세요.');
 for(const key of ['candidateCount','eligibleCount'])check(Number.isInteger(value[key])&&value[key]>=0,'후보 수와 평가 가능 종목 수를 확인하세요.');check(value.candidateCount>=value.eligibleCount&&value.eligibleCount>=assets.length,'순위와 후보 수의 범위를 확인하세요.');
 return {kind:'rank',breadth:value.breadth,candidateCount:value.candidateCount,eligibleCount:value.eligibleCount,assets};
}
function portfolio(value,asOf){
 check(value?.portfolioViewVersion==='position-portfolio-view-v1'&&Array.isArray(value.positions)&&value.portfolio&&ratio(value.portfolio.cashWeight)&&(value.portfolio.unrealizedReturn===null||finite(value.portfolio.unrealizedReturn)),'질문에 연결한 전체 보유 비중을 확인하세요.');timely(value,asOf);
 const positions=value.positions.map(position=>{check(ratio(position.weight)&&(position.unrealizedReturn===null||finite(position.unrealizedReturn)),'보유 비중과 평가 수익률을 확인하세요.');check(typeof position.priceAsOf==='string'&&Number.isFinite(Date.parse(position.priceAsOf))&&new Date(position.priceAsOf).toISOString()===position.priceAsOf&&position.priceAsOf<=asOf,'보유 평가 시각을 확인하세요.');return {asset:alias(position.instrumentId),weight:position.weight,unrealizedReturn:position.unrealizedReturn,priceAgeDays:(Date.parse(asOf)-Date.parse(position.priceAsOf))/86400000};});
 const weightSum=positions.reduce((sum,item)=>sum+item.weight,0)+value.portfolio.cashWeight;
 check(value.portfolio.positionCount===positions.length&&(weightSum<=1+1e-7||btcEquityRoundingExplains(value,weightSum)),'전체 보유 비중의 합을 확인하세요.');
 return {kind:'portfolio',cashWeight:value.portfolio.cashWeight,positionCount:positions.length,unrealizedReturn:value.portfolio.unrealizedReturn,positions};
}

// BTC equity is rounded to one satoshi; position-input keeps unrounded marks.
// Accept only the source-bound half-satoshi discrepancy, preserving sent ratios.
function btcEquityRoundingExplains(value,weightSum){
 if(value.quoteCurrency!=='BTC'||!finite(value.equity)||value.equity<=0||!finite(value.cash)||value.cash<0)return false;
 const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*8;
 if(!close(value.portfolio.cashWeight,value.cash/value.equity))return false;
 let marketValue=0;
 for(const position of value.positions){
  if(!finite(position.marketValue)||position.marketValue<0||!finite(position.quantity)||position.quantity<=0||!finite(position.marketPrice)||position.marketPrice<=0||!close(position.marketValue,position.quantity*position.marketPrice)||!close(position.weight,position.marketValue/value.equity))return false;
  marketValue+=position.marketValue;
 }
 if(!close(value.portfolio.marketValue,marketValue)||!close(weightSum,(value.cash+marketValue)/value.equity))return false;
 const tolerance=0.000000005+Number.EPSILON*Math.max(value.equity,value.cash+marketValue)*8;
 return Math.abs(value.cash+marketValue-value.equity)<=tolerance;
}

/** Exact, allowlisted provider projection. The complete clock/source/account stay in the saved graph evidence. */
export function projectBlindPortfolioHistory(state){
 check(state&&typeof state.asOf==='string'&&Number.isFinite(Date.parse(state.asOf))&&Array.isArray(state.connectedInputs),'저장된 질문 연결 자료를 확인하세요.');
 const inputs=state.connectedInputs.map((input,index)=>{
  let value;
  if(input.dataType==='ASSET_RANK'||input.value?.contractVersion==='portfolio-asset-rank-v1')value=rank(input.value,state.asOf);
  else if(input.binding?.kind==='POSITION'&&input.binding.metricId==='PORTFOLIO'||input.value?.portfolioViewVersion==='position-portfolio-view-v1')value=portfolio(input.value,state.asOf);
  else if(input.dataType==='NUMBER'&&finite(input.value)&&(!input.binding?ratio(input.value):input.binding.kind==='POSITION'&&(['WEIGHT','CASH_WEIGHT'].includes(input.binding.metricId)?ratio(input.value):['PORTFOLIO_RETURN','UNREALIZED_RETURN'].includes(input.binding.metricId)&&input.value>=-1)))value={kind:'ratio',value:input.value};
  else if(input.dataType==='BOOLEAN'&&typeof input.value==='boolean')value={kind:'condition',value:input.value};
  else check(false,'익명 역사 비교에는 종목 순위·전체 보유 비중·정규화 비율을 연결하세요.');
  return {input:'input-'+(index+1),...value};
 });
 check(inputs.length>0,'평가할 상대 지표나 보유 비중을 질문에 연결하세요.');
 return {contractVersion:BLIND_PORTFOLIO_HISTORY_VERSION,units:{returns:'fraction',volatility:'daily_log_return_std',liquidity:'relative_to_current_candidates',score:'relative_to_absolute_current_max',holdings:'fraction_of_equity',priceAge:'days',cash:'numeraire'},inputs};
}
