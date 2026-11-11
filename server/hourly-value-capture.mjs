import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {readHourlyRegimeMarket} from './hourly-regime-input.mjs';
import {captureUpbitPublic,normalizeUpbitScalpingEvent,readUpbitScalpingCandles} from './upbit-scalping-market.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';

/** Shared delivery for the same graph in paper and live; scoring keeps observed BBO and availability. */
export async function captureHourlyValueMarket({marketIds,ownedMarketIds=[],fetchImpl=fetch,clock,onRecord,heartbeat=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(marketIds.length>50){
  const eligibility=await readUpbitEntryEligibility({marketIds,fetchImpl,clock});await onRecord({kind:'HOURLY_UNIVERSE_ELIGIBILITY',...eligibility});
  const eligible=marketIds.filter(m=>eligibility.eligibility.markets[m]?.allowed||ownedMarketIds.includes(m));
  if(!eligible.length)return {asOf:clock(),markets:[]};
  const tickers=await captureUpbitPublic('/v1/ticker',{markets:eligible.join(',')},{fetchImpl,clock});await onRecord({kind:'HOURLY_TURNOVER_CAPTURE',...tickers});
  if(!Array.isArray(tickers.body)||tickers.body.some(r=>!eligible.includes(r.market)||!Number.isFinite(Number(r.acc_trade_price_24h))))throw Object.assign(Error('HOURLY_VALUE_TURNOVER_SOURCE'),{code:'HOURLY_VALUE_TURNOVER_SOURCE'});
  marketIds=[...new Set([...tickers.body.filter(r=>eligibility.eligibility.markets[r.market]?.allowed).sort((a,b)=>Number(b.acc_trade_price_24h)-Number(a.acc_trade_price_24h)).slice(0,50).map(r=>r.market),...ownedMarketIds])];
 }
 const captured=await readHourlyRegimeMarket({marketIds,fetchImpl,clock,heartbeat});await onRecord({kind:'HOURLY_CANDLE_CAPTURE',...captured});
 const boundary=captured.frame.asOf,deadline=Date.parse(boundary)+120000,series=captured.frame.series.filter(s=>s.bars.length===30&&s.bars.at(-1).t===Date.parse(boundary)&&s.bars.every((b,i,a)=>!i||b.t-a[i-1].t===3600000));
 let result={asOf:clock(),markets:[]};
 // Retry only quotes, within the original selection window and existing request budget.
 for(let attempt=1;attempt<=3&&series.length&&Date.parse(clock())<deadline;attempt++){
  await heartbeat();const quotes=await captureUpbitPublic('/v1/orderbook',{markets:marketIds.join(',')},{fetchImpl,clock});await onRecord({kind:'HOURLY_BOOK_CAPTURE',attempt,...quotes});
  if(!Array.isArray(quotes.body)||new Set(quotes.body.map(r=>r.market)).size!==quotes.body.length)throw Object.assign(Error('HOURLY_VALUE_BOOK_SOURCE'),{code:'HOURLY_VALUE_BOOK_SOURCE'});
  const books=new Map(quotes.body.map(row=>{const e=normalizeUpbitScalpingEvent(JSON.stringify({...row,type:'orderbook',code:row.market,level:0}),{receivedAt:quotes.source.receivedAt,markets:marketIds});return [row.market,{...e,sourceHash:quotes.source.rawSha256,availableAt:[e.eventTime,e.receivedAt].sort().at(-1)}];}));
  const latest=Math.min(deadline,Math.max(...[...books.values()].map(q=>Date.parse(q.availableAt))));while(Date.parse(clock())<latest)await sleep(latest-Date.parse(clock()));
  const asOf=clock(),fresh=s=>books.has(s.market)&&books.get(s.market).availableAt<=asOf&&Date.parse(asOf)-Date.parse(books.get(s.market).eventTime)<=3000;
  result={asOf,markets:series.filter(fresh).map(s=>{const q=books.get(s.market);return {market:s.market,bars:s.bars.map(b=>[b.t-3600000,b.open,b.high,b.low,b.close,b.volume]),forecastAsOf:boundary,availableAt:[captured.frame.availableAt,q.availableAt].sort().at(-1),quoteAsOf:q.eventTime,bidPrice:q.levels[0].bidPrice,askPrice:q.levels[0].askPrice,entryAllowed:captured.frame.entryEligibility?.markets[s.market]?.allowed===true,sourceHash:hashInputPackage({market:s.market,candles:captured.frame.sourceRefs,book:q.sourceHash}),quoteBasis:'OBSERVED_BBO'};})};
  result.books=[...books.values()];
  if(Date.parse(asOf)>=deadline)return {asOf,markets:[]};
  if(result.markets.length&&ownedMarketIds.every(m=>result.markets.some(f=>f.market===m)))break;
  if(ownedMarketIds.some(m=>!series.some(s=>s.market===m)))break;
 }
 return result;
}
export async function readHourlyValueReview({market,forecastAsOf,fetchImpl=fetch,clock,onRecord}){
 const start=new Date(Date.parse(forecastAsOf)+60000).toISOString(),end=new Date(Date.parse(forecastAsOf)+120000).toISOString();if(clock()<end)return null;
 const capture=await readUpbitScalpingCandles({market,timeframe:'1m',count:1,to:end,startAt:start,endAt:end,maxPages:1,fetchImpl,clock});await onRecord({kind:'HOURLY_FIRST_MINUTE',capture});
 const b=capture.bars.find(b=>b.openTime===start&&b.closeTime===end);return b?{market,openAt:start,closeAt:end,availableAt:capture.availableAt,closePrice:String(b.close),sourceHash:b.sourceHash}:null;
}
