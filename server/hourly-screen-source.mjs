import {collectUpbitScalpingEvents} from './upbit-scalping-market.mjs';
import {readHourlyRegimeMarket} from './hourly-regime-input.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {hourlyScreenCandidateInput} from '../dist/domain/hourly-pullback.mjs';

const feeds=new Map(),WINDOW=300000,KEEP=600000,Q=10n**18n;
const units=v=>{const [a,b='']=String(v).split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));};
/** Bounded public telemetry. A reconnect invalidates the intersected five-minute window. */
export function createHourlyScreenObservations(){
 const books=new Map(),minutes=new Map(),connections=[],gaps=[];let connectedAt=null;
 return {
  ingest(record){
   if(record.kind==='STREAM_CONNECTED'){connectedAt=record.at;connections.push(record.at);return;}
   if(['STREAM_GAP','STREAM_STOP','STREAM_ERROR'].includes(record.kind)){gaps.push(record.at??record.completedAt);return;}
   if(record.kind!=='MARKET_EVENT')return;
   const e=record.event,t=Date.parse(e.eventTime),received=Date.parse(e.receivedAt),cut=received-KEEP;
   if(e.kind==='ORDER_BOOK'){
    let rows=books.get(e.market);if(!rows)books.set(e.market,rows=new Map());const second=Math.floor(t/1000),old=rows.get(second);if(!old||old.eventTime<=e.eventTime)rows.set(second,structuredClone(e));for(const [key,row]of rows)if(Date.parse(row.eventTime)<cut)rows.delete(key);
   }else if(e.kind==='TRADE'){
    let rows=minutes.get(e.market);if(!rows)minutes.set(e.market,rows=new Map());const minute=Math.floor(t/60000)*60000;let row=rows.get(minute);if(!row)rows.set(minute,row={buy:0n,sell:0n,count:0,availableAt:e.receivedAt,sourceHash:hash([])});
    row[e.side==='BUY'?'buy':'sell']+=units(e.price)*units(e.quantity);row.count++;row.availableAt=[row.availableAt,e.receivedAt].sort().at(-1);row.sourceHash=hash({previous:row.sourceHash,id:e.id,sourceHash:e.sourceHash});for(const key of rows.keys())if(key<cut)rows.delete(key);
   }
   while(gaps.length&&Date.parse(gaps[0])<cut)gaps.shift();while(connections.length>1&&Date.parse(connections[1])<cut)connections.shift();
  },
  read(market,boundary,asOf){
   const t=Date.parse(boundary),start=t-WINDOW,connection=connections.filter(at=>at<=asOf&&Date.parse(at)<=start).at(-1);
   if(!connection||gaps.some(at=>at<=asOf&&Date.parse(at)>=start&&Date.parse(at)<=t))return {ready:false,reason:!connectedAt?'FEED_CONNECTING':'FIVE_MINUTE_COVERAGE_REQUIRED'};
   const rows=[...(books.get(market)?.values()??[])],before=end=>rows.filter(e=>Date.parse(e.eventTime)<end&&e.receivedAt<=asOf).sort((a,b)=>b.eventTime.localeCompare(a.eventTime))[0],past=before(start),now=before(t);
   if(!past||!now||start-Date.parse(past.eventTime)>3000||t-Date.parse(now.eventTime)>3000)return {ready:false,reason:'FIVE_MINUTE_ENDPOINT_BOOK_REQUIRED'};
   const flow=[...(minutes.get(market)?.entries()??[])].filter(([minute,row])=>minute>=start&&minute<t&&row.availableAt<=asOf).map(([,row])=>row),buy=flow.reduce((n,r)=>n+r.buy,0n),sell=flow.reduce((n,r)=>n+r.sell,0n);
   if(buy+sell===0n)return {ready:false,reason:'FIVE_MINUTE_TRADE_FLOW_REQUIRED'};
   const mid=e=>(Number(e.levels[0].bidPrice)+Number(e.levels[0].askPrice))/2,source={connection,boundary,windowStart:new Date(start).toISOString(),buyQuoteUnits36:String(buy),sellQuoteUnits36:String(sell),tradeCount:flow.reduce((n,r)=>n+r.count,0),minuteHashes:flow.map(r=>r.sourceHash),pastBook:past,currentBook:now};
   return {ready:true,observations:{asOf:boundary,availableAt:asOf,sourceHash:hash(source),buyQuoteRatio5m:Number(buy)/Number(buy+sell),midReturn5m:mid(now)/mid(past)-1},source};
  }
 };
}
function feedFor(marketIds,clock){
 const key=[...marketIds].sort().join(',');let feed=feeds.get(key);
 if(!feed){feed={observations:createHourlyScreenObservations(),capture:null};feeds.set(key,feed);}
 if(!feed.capture||feed.capture.state().status==='STOPPED')feed.capture=collectUpbitScalpingEvents({markets:marketIds,durationMs:3600000,clock,onRecord:record=>feed.observations.ingest(record)});
 // Capture failure is recorded by its stream controls and retried by the next runner tick.
 feed.capture.done.catch(()=>{});return feed;
}
export function hourlyScreenSource({marketIds,profileId,clock,fetchImpl,onRecord,heartbeat}){
 if(marketIds.length>10)throw Object.assign(Error('현재 공개 체결·호가 구독은 10종목까지 지원합니다.'),{code:'HOURLY_SCREEN_SOURCE_SCOPE'});
 const feed=feedFor(marketIds,clock);
 return {async snapshot(){
  const captured=await readHourlyRegimeMarket({marketIds,clock,fetchImpl,heartbeat}),asOf=clock(),boundary=captured.frame.asOf,items=[],exclusions=[],observed=[];
  for(const series of captured.frame.series){const result=feed.observations.read(series.market,boundary,asOf);if(!result.ready){exclusions.push({market:series.market,reason:result.reason});continue;}const allowed=captured.frame.entryEligibility?.markets[series.market]?.allowed===true;
   items.push({instrumentId:'crypto:upbit:'+series.market,bars:series.bars.map(b=>({openTime:new Date(b.t-3600000).toISOString(),closeTime:new Date(b.t).toISOString(),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,quoteVolume:b.quoteVolume})),quoteVolume:series.bars.slice(-24).reduce((n,b)=>n+b.quoteVolume,0),warning:!allowed,warningKnown:!!captured.frame.entryEligibility?.markets[series.market],observations:result.observations});observed.push(result.source);
  }
  const sourceRefs=[...captured.frame.sourceRefs,...items.map(item=>({id:'flow-'+item.observations.sourceHash,contentHash:item.observations.sourceHash,sourceRef:'UPBIT_CONTINUOUS_PUBLIC_TRADE_AND_BOOK'}))],input=hourlyScreenCandidateInput({profileId,marketIds,boundary,asOf,items,sourceRefs});
  await onRecord({kind:'HOURLY_SCREEN_CAPTURE',boundary,asOf,exclusions,observed,rawSources:captured.rawSources,input});return {input,exclusions};
 }};
}
