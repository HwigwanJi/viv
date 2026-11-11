import {captureHourlyValueMarket,readHourlyValueReview} from './hourly-value-capture.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';
import {captureUpbitPublic,normalizeUpbitScalpingEvent,readUpbitScalpingCandles,shareUpbitPublicRateLimit} from './upbit-scalping-market.mjs';
import {saveLearningCandles} from './hourly-model-learning-store.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';
const H=3600000,check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c,status:409});};

/** Read-only providers are shared by every arm; no order adapter is available here. */
export function createHourlyLearningSource({db,owner,env,head,clock,fetchImpl=fetch,reserve,readiness=readUpbitTradingReadiness,templates={}}){
 const books=new Map(),datasets=new Map(Object.entries(templates)),reviews=new Map(),store=new StrategyLearningStore(db);let snapshot=null,boundary=null;
 const now=()=>clock(),fetchRead=async(url,init)=>{const u=new URL(url);check(u.origin==='https://api.upbit.com'&&(init?.method??'GET')==='GET'&&['/v1/market/all','/v1/ticker','/v1/candles/minutes/60','/v1/candles/minutes/1','/v1/orderbook','/v1/orderbook/instruments','/v1/accounts','/v1/orders/chance'].includes(u.pathname),'HOURLY_LEARNING_READ_ONLY');await reserve();return fetchImpl(url,init);};
 shareUpbitPublicRateLimit(fetchRead,fetchImpl);
 // Full-market maps exceed the workspace object's key limit; keep their JSON bytes in bounded string chunks.
 const archive=async value=>{const text=JSON.stringify(value),chunks=[];for(let i=0;i<text.length;){let end=Math.min(i+24000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(i,end));i=end;}return store.write(owner,{contractVersion:'HOURLY_LEARNING_SOURCE_JSON_CHUNKS_V1',chunks});};
 function keepBook(row,source){const b=normalizeUpbitScalpingEvent(JSON.stringify({...row,type:'orderbook',code:row.market,level:0}),{receivedAt:source.receivedAt,markets:head.marketIds});const book={...b,availableAt:[b.eventTime,b.receivedAt].sort().at(-1),sourceHash:source.rawSha256};books.set(row.market,book);return book;}
 async function journal(record){
  const ref=await archive(record);
  if(record.kind==='HOURLY_BOOK_CAPTURE')for(const row of record.body)keepBook(row,record.source);
  if(record.kind==='HOURLY_CANDLE_CAPTURE')await saveLearningCandles(db,owner,record.frame.series.flatMap(s=>s.bars.map(b=>({market:s.market,bar:[b.t-H,b.open,b.high,b.low,b.close,b.volume],availableAt:record.frame.availableAt,sourceHash:ref.hash}))));
  return ref;
 }
 const source={
  async dataset(market){
   if(datasets.has(market))return structuredClone(datasets.get(market));
   const result=await readiness({db,owner,env,market,fetchImpl:fetchRead,clock:now}),r=result.readiness;
   check(r.ready&&r.rules.state==='active'&&r.rules.tickSize,'HOURLY_LEARNING_RULES');
   const d={market,instrumentId:'crypto:upbit:'+market,feeSnapshot:r.fees,rules:r.rules};datasets.set(market,d);return structuredClone(d);
  },
  templates:()=>Object.fromEntries(datasets),
  async assertEntry(market){const e=await readUpbitEntryEligibility({marketIds:[market],fetchImpl:fetchRead,clock:now});await archive(e);check(e.eligibility.markets[market]?.allowed,'UPBIT_ENTRY_INELIGIBLE');},
  async snapshot({ownedMarketIds=[]}={}){
   const hour=Math.floor(Date.parse(now())/H)*H;
   if(snapshot&&boundary===hour)return structuredClone(snapshot);
   snapshot=await captureHourlyValueMarket({marketIds:head.marketIds,ownedMarketIds,fetchImpl:fetchRead,clock:now,onRecord:journal});boundary=hour;return structuredClone(snapshot);
  },
  async readReview({market,forecastAsOf}){const key=market+':'+forecastAsOf;if(!reviews.has(key)){const r=await readHourlyValueReview({market,forecastAsOf,fetchImpl:fetchRead,clock:now,onRecord:journal});if(r)reviews.set(key,r);}return structuredClone(reviews.get(key)??null);},
  async readBook({market,after=null}){
   const cached=books.get(market);if(cached&&Date.parse(now())-Date.parse(cached.eventTime)<=2000&&cached.availableAt<=now()&&(!after||cached.eventTime>=after&&cached.receivedAt>=after))return structuredClone(cached);
   const r=await captureUpbitPublic('/v1/orderbook',{markets:market},{fetchImpl:fetchRead,clock:now});await archive({kind:'LEARNING_BOOK',...r});check(Array.isArray(r.body)&&r.body.length===1,'HOURLY_LEARNING_BOOK');const book=keepBook(r.body[0],r.source);
   const delay=Date.parse(book.availableAt)-Date.parse(now());if(delay>0)await new Promise(r=>setTimeout(r,delay));check(!after||book.eventTime>=after&&book.receivedAt>=after,'PRE_DECISION_BOOK');return structuredClone(book);
  },
  async bootstrap(markets,{count=204}={}){
   for(const market of markets){const r=await readUpbitScalpingCandles({market,timeframe:'60m',count,maxPages:2,to:new Date(Math.floor(Date.parse(now())/H)*H).toISOString(),fetchImpl:fetchRead,clock:now});const ref=await archive(r);await saveLearningCandles(db,owner,r.bars.map(b=>({market,bar:[Date.parse(b.openTime),b.open,b.high,b.low,b.close,b.volume],availableAt:r.availableAt,sourceHash:ref.hash})));}
  }
 };
 return source;
}
