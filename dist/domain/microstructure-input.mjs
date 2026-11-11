import {hashInputPackage} from './workspace.mjs';
import {vampBookFeatures} from './vamp-model.mjs';

export const MICROSTRUCTURE_INPUT_VERSION='market-microstructure-input-v1';
export const MICROSTRUCTURE_TIMEFRAMES=Object.freeze(['1m','3m','5m']);
export const MICROSTRUCTURE_METRICS=Object.freeze([
 {id:'SNAPSHOT',label:'체결·호가 전체',dataType:'CONTEXT',unit:'market_microstructure'},
 {id:'DECISION_CONTEXT',label:'가격 경로와 체결 흐름',dataType:'CONTEXT',unit:'market_microstructure'},
 {id:'RVOL',label:'평소 대비 거래량',dataType:'NUMBER',unit:'multiple'},
 {id:'RETURN_1',label:'직전 봉 수익률',dataType:'NUMBER',unit:'ratio'},
 {id:'RETURN_WINDOW',label:'관측 구간 수익률',dataType:'NUMBER',unit:'ratio'},
 {id:'DIRECTIONAL_EFFICIENCY',label:'가격 이동의 방향 일치도',dataType:'NUMBER',unit:'ratio'},
 {id:'BREAKOUT_RATIO',label:'직전 고가 돌파율',dataType:'NUMBER',unit:'ratio'},
 {id:'SPREAD_BPS',label:'매수·매도 호가 차이',dataType:'NUMBER',unit:'bps'},
 {id:'BUY_TRADE_RATIO',label:'매수 체결 비중',dataType:'NUMBER',unit:'ratio'},
 {id:'ORDERBOOK_IMBALANCE',label:'호가 잔량 불균형',dataType:'NUMBER',unit:'signed_score'},
 {id:'VAMP_BBO_BPS',label:'최우선 VAMP 이격',dataType:'NUMBER',unit:'bps'},
 {id:'VAMP_DEPTH_BPS',label:'상위 5호가 VAMP 이격',dataType:'NUMBER',unit:'bps'},
 {id:'VWAP_DISTANCE',label:'체결 평균가 이격',dataType:'NUMBER',unit:'ratio'},
 {id:'ROUND_TRIP_COST_BPS',label:'왕복 예상 비용',dataType:'NUMBER',unit:'bps'},
 {id:'QUOTE_AGE_MS',label:'호가 경과 시간',dataType:'NUMBER',unit:'ms'},
 {id:'TRADE_COUNT',label:'최근 체결 수',dataType:'NUMBER',unit:'count'},
].map(Object.freeze));
export const microstructureMetric=id=>MICROSTRUCTURE_METRICS.find(m=>m.id===id)??null;
const clone=structuredClone,finite=Number.isFinite,iso=v=>typeof v==='string'&&finite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code,status:409});};
const point=(value,sourceRefs)=>({value,sourceRefs});
const avg=xs=>xs.reduce((n,v)=>n+v,0)/xs.length;

/** Event availability, rather than later downloaded history, bounds every numeric input. */
export function buildMicrostructureSnapshot({instrumentId,market,timeframe='1m',asOf,availableAt=asOf,bars=[],events=[],sourceRefs=[],fees=null,flowCoverage=null,lookbackBars=20,flowWindowMs=60000,bookMaxAgeMs=3000,includePath=false}={}){
 check(typeof instrumentId==='string'&&MICROSTRUCTURE_TIMEFRAMES.includes(timeframe)&&iso(asOf)&&iso(availableAt)&&availableAt>=asOf,'MICROSTRUCTURE_SCOPE','종목·분봉·자료 확인 시각을 확인하세요.');
 check(Number.isSafeInteger(lookbackBars)&&lookbackBars>=2&&lookbackBars<=500&&Number.isSafeInteger(flowWindowMs)&&flowWindowMs>0&&Number.isSafeInteger(bookMaxAgeMs)&&bookMaxAgeMs>=0,'MICROSTRUCTURE_WINDOW','거래량·체결·호가의 평가 구간을 확인하세요.');
 const cutoff=Date.parse(asOf),known=Date.parse(availableAt),metrics={},missing={},used=new Set();
 const confirmed=bars.filter(b=>iso(b.closeTime)&&Date.parse(b.closeTime)<=cutoff&&(!b.availableAt||iso(b.availableAt)&&Date.parse(b.availableAt)<=known)).sort((a,b)=>a.closeTime.localeCompare(b.closeTime));
 const recent=confirmed.slice(-(lookbackBars+1)),step=Number(timeframe.slice(0,-1))*60000,fresh=recent.length>0&&cutoff-Date.parse(recent.at(-1).closeTime)<step,continuous=fresh&&recent.length===lookbackBars+1&&recent.every((b,i)=>['open','high','low','close','volume'].every(k=>finite(b[k])&&b[k]>=0)&&b.close>0&&(i===0||Date.parse(b.closeTime)-Date.parse(recent[i-1].closeTime)===step));
 if(continuous){
  const last=recent.at(-1),previous=recent.slice(0,-1),mean=avg(previous.map(b=>b.volume));
  if(mean>0)metrics.RVOL=point(last.volume/mean,sourceRefs.map(r=>r.id));else missing.RVOL='VOLUME_BASELINE_EMPTY';
  metrics.RETURN_1=point(last.close/recent.at(-2).close-1,sourceRefs.map(r=>r.id));
  const movement=recent.slice(1).reduce((sum,b,i)=>sum+Math.abs(b.close-recent[i].close),0),change=last.close-recent[0].close;
  metrics.RETURN_WINDOW=point(last.close/recent[0].close-1,sourceRefs.map(r=>r.id));
  metrics.DIRECTIONAL_EFFICIENCY=point(movement>0?Math.abs(change)/movement:0,sourceRefs.map(r=>r.id));
  metrics.BREAKOUT_RATIO=point(last.close/Math.max(...previous.map(b=>b.high))-1,sourceRefs.map(r=>r.id));
 }else for(const key of ['RVOL','RETURN_1','RETURN_WINDOW','DIRECTIONAL_EFFICIENCY','BREAKOUT_RATIO'])missing[key]=fresh?'CONTIGUOUS_CLOSED_BARS_REQUIRED':'RECENT_CLOSED_BAR_REQUIRED';
 const observed=events.filter(e=>iso(e.eventTime)&&iso(e.receivedAt)&&Date.parse(e.eventTime)<=cutoff&&Date.parse(e.receivedAt)<=known&&(!e.availableAt||iso(e.availableAt)&&Date.parse(e.availableAt)<=known)&&(!market||!e.market||e.market===market));
 const books=observed.filter(e=>e.kind==='ORDER_BOOK').sort((a,b)=>a.eventTime.localeCompare(b.eventTime)||a.receivedAt.localeCompare(b.receivedAt)),book=books.at(-1);
 const levels=book?.levels,asks=Array.isArray(levels)?levels.map(l=>({price:l.askPrice,quantity:l.askQuantity})):Array.isArray(levels?.asks)?levels.asks:[],bids=Array.isArray(levels)?levels.map(l=>({price:l.bidPrice,quantity:l.bidQuantity})):Array.isArray(levels?.bids)?levels.bids:[];
 const price=l=>Number(Array.isArray(l)?l[0]:l.price),quantity=l=>Number(Array.isArray(l)?l[1]:l.quantity);
 const validLevels=xs=>xs.length>0&&xs.every(l=>finite(price(l))&&price(l)>0&&finite(quantity(l))&&quantity(l)>=0);
 let mid=null;
 if(book&&validLevels(asks)&&validLevels(bids)&&price(asks[0])>=price(bids[0])&&cutoff-Date.parse(book.eventTime)<=bookMaxAgeMs){
  mid=(price(asks[0])+price(bids[0]))/2;const refs=[book.rawSha256??book.sourceHash??book.id];used.add(book.id);
  metrics.SPREAD_BPS=point((price(asks[0])-price(bids[0]))/mid*10000,refs);
  metrics.QUOTE_AGE_MS=point(cutoff-Date.parse(book.eventTime),refs);
  const depth=xs=>xs.slice(0,5).reduce((n,l)=>n+price(l)*quantity(l),0),buyDepth=depth(bids),sellDepth=depth(asks);
  if(buyDepth+sellDepth>0)metrics.ORDERBOOK_IMBALANCE=point((buyDepth-sellDepth)/(buyDepth+sellDepth),refs);
  const vamp=vampBookFeatures(book);if(vamp)for(const key of ['VAMP_BBO_BPS','VAMP_DEPTH_BPS'])metrics[key]=point(vamp[key],refs);
  const rate=v=>(typeof v==='number'||typeof v==='string'&&/^\d+(\.\d+)?$/.test(v))&&finite(Number(v))&&Number(v)>=0&&Number(v)<=.1;
  if(fees&&rate(fees.takerBuyRate)&&rate(fees.takerSellRate)&&/^[a-f0-9]{64}$/.test(fees.sourceHash??'')&&iso(fees.observedAt)&&fees.observedAt<=availableAt)metrics.ROUND_TRIP_COST_BPS=point((Number(fees.takerBuyRate)+Number(fees.takerSellRate))*10000+metrics.SPREAD_BPS.value,[...refs,fees.sourceHash]);
  else missing.ROUND_TRIP_COST_BPS='OBSERVED_ACCOUNT_FEES_REQUIRED';
 }else for(const key of ['SPREAD_BPS','ORDERBOOK_IMBALANCE','QUOTE_AGE_MS','ROUND_TRIP_COST_BPS'])missing[key]='FRESH_OBSERVED_ORDER_BOOK_REQUIRED';
 const trades=observed.filter(e=>e.kind==='TRADE'&&Date.parse(e.eventTime)>cutoff-flowWindowMs&&finite(Number(e.price))&&Number(e.price)>0&&finite(Number(e.quantity))&&Number(e.quantity)>0&&['BUY','SELL','BID','ASK'].includes(e.side));
 if(trades.length){
  const total=trades.reduce((n,e)=>n+Number(e.quantity),0),buy=trades.filter(e=>['BUY','BID'].includes(e.side)).reduce((n,e)=>n+Number(e.quantity),0),vwap=trades.reduce((n,e)=>n+Number(e.price)*Number(e.quantity),0)/total,refs=trades.map(e=>e.rawSha256??e.id);
  metrics.BUY_TRADE_RATIO=point(buy/total,refs);metrics.TRADE_COUNT=point(trades.length,refs);if(mid!==null)metrics.VWAP_DISTANCE=point(mid/vwap-1,refs);else missing.VWAP_DISTANCE='FRESH_OBSERVED_ORDER_BOOK_REQUIRED';for(const e of trades)used.add(e.id);
 }else for(const key of ['BUY_TRADE_RATIO','TRADE_COUNT','VWAP_DISTANCE'])missing[key]='OBSERVED_TRADES_REQUIRED';
 check(typeof includePath==='boolean','MICROSTRUCTURE_PATH','가격 경로의 포함 여부를 확인하세요.');
 const path=includePath&&recent.length>=2&&recent.every(b=>['open','high','low','close','volume'].every(k=>finite(b[k])&&b[k]>=0)&&b.close>0)?{
  bars:recent.map(b=>Object.fromEntries(['closeTime','availableAt','open','high','low','close','volume'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]))),
  flow:Array.from({length:12},(_,i)=>{const end=cutoff-flowWindowMs+(i+1)*flowWindowMs/12,start=end-flowWindowMs/12,rows=trades.filter(e=>Date.parse(e.eventTime)>start&&Date.parse(e.eventTime)<=end),total=rows.reduce((n,e)=>n+Number(e.quantity),0);return {endAt:new Date(end).toISOString(),tradeCount:rows.length,buyRatio:total>0?rows.filter(e=>['BUY','BID'].includes(e.side)).reduce((n,e)=>n+Number(e.quantity),0)/total:null,vwap:total>0?rows.reduce((n,e)=>n+Number(e.price)*Number(e.quantity),0)/total:null};}),
  policy:'CONFIRMED_AVAILABLE_BARS_AND_OBSERVED_TRADES_ONLY',
  ...(!continuous?{coverage:{continuous:false,requestedBars:lookbackBars+1,observedBars:recent.length,lastBarAgeMs:cutoff-Date.parse(recent.at(-1).closeTime),missingIntervals:recent.flatMap((b,i)=>i&&Date.parse(b.closeTime)-Date.parse(recent[i-1].closeTime)>step?[{after:recent[i-1].closeTime,before:b.closeTime}]:[])}}:{}),
 }:null;
 const value={contractVersion:MICROSTRUCTURE_INPUT_VERSION,instrumentId,market,timeframe,asOf,availableAt,metrics,missing,lookbackBars,flowWindowMs,bookMaxAgeMs,...(includePath?{path}:{}),...(flowCoverage?{flowCoverage:clone(flowCoverage)}:{}),usedEventIds:[...used],lastClosedBarAt:confirmed.at(-1)?.closeTime??null,sourceRefs:clone(sourceRefs)};
 return {...value,sourceHash:hashInputPackage(value)};
}

export function resolveMicrostructureInput({binding,snapshot,asOf,availableAt=asOf}={}){
 const metric=microstructureMetric(binding?.metricId),blocked=code=>({ready:false,value:null,unit:metric?.unit??null,asOf,availableAt:null,sourceRefs:[],missing:[code]});
 if(!metric||!snapshot||snapshot.contractVersion!==MICROSTRUCTURE_INPUT_VERSION||binding.instrumentId!==snapshot.instrumentId||binding.timeframe!==snapshot.timeframe||!iso(asOf)||!iso(availableAt)||snapshot.asOf>asOf||snapshot.availableAt>availableAt)return blocked('MICROSTRUCTURE_SCOPE_MISMATCH');
 const {sourceHash,...original}=snapshot;if(sourceHash!==hashInputPackage(original))return blocked('MICROSTRUCTURE_SOURCE_HASH');
 if(['lookbackBars','flowWindowMs','bookMaxAgeMs'].some(k=>binding[k]!==undefined&&binding[k]!==snapshot[k]))return blocked('MICROSTRUCTURE_WINDOW_MISMATCH');
 const selected=metric.id==='SNAPSHOT'||metric.id==='DECISION_CONTEXT'&&snapshot.path?{value:clone(snapshot)}:snapshot.metrics[metric.id];if(!selected)return blocked(snapshot.missing[metric.id]??'MICROSTRUCTURE_VALUE_REQUIRED');
 const refs=[{id:'microstructure:'+sourceHash.slice(0,24),contentHash:sourceHash,sourceRef:'market-microstructure:'+sourceHash}];
 return {contractVersion:MICROSTRUCTURE_INPUT_VERSION,ready:true,instrumentId:binding.instrumentId,metricId:metric.id,dataType:metric.dataType,value:clone(selected.value),unit:metric.unit,asOf:snapshot.asOf,availableAt:snapshot.availableAt,sourceRefs:refs,missing:[]};
}
export function validMicrostructureInput(binding,input){const m=microstructureMetric(binding?.metricId);return Boolean(m&&input?.contractVersion===MICROSTRUCTURE_INPUT_VERSION&&input.instrumentId===binding.instrumentId&&input.metricId===m.id&&input.dataType===m.dataType&&input.unit===m.unit&&(m.dataType==='CONTEXT'?input.value?.contractVersion===MICROSTRUCTURE_INPUT_VERSION:finite(input.value)));}
