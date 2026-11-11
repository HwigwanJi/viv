import {captureUpbitPublic} from './upbit-scalping-market.mjs';
import {buildHourlyRegimeFrame} from '../dist/domain/hourly-regime.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';
import {UPBIT_ENTRY_ELIGIBILITY_CONTRACT} from '../dist/domain/universe-policy.mjs';
const cache=new Map(),H=3600000;
/** Shared hourly capture for every strategy using the same approved universe. */
export async function readHourlyRegimeMarket({marketIds,historyBars=30,eligibleOnly=false,fetchImpl=fetch,clock=()=>new Date().toISOString(),heartbeat=async()=>{}}){
 if(!Number.isInteger(historyBars)||historyBars<30||historyBars>1000)throw new Error('시간봉 조회 범위는 30~1000입니다.');
 const boundary=new Date(Math.floor(Date.parse(clock())/H)*H).toISOString(),key=JSON.stringify([boundary,historyBars,eligibleOnly,[...marketIds].sort()]);
 if(cache.has(key))return cache.get(key);
 const pending=(async()=>{const series=[],rawSources=[];let eligibility;
  try{const result=await readUpbitEntryEligibility({marketIds,fetchImpl,clock}),snapshot=result.snapshot;eligibility=result.eligibility;rawSources.push({id:snapshot.id,rawSha256:snapshot.rawBodySha256,sourceUrl:snapshot.url,rawBody:snapshot.rawBody,requestStartedAt:snapshot.requestStartedAt,receivedAt:snapshot.receivedAt});}
  catch(error){eligibility={contractVersion:UPBIT_ENTRY_ELIGIBILITY_CONTRACT.id,availableAt:clock(),sourceError:{code:error.code??'UPBIT_ELIGIBILITY_SOURCE'},markets:Object.fromEntries(marketIds.map(m=>[m,{allowed:false,reason:'SOURCE_UNAVAILABLE'}]))};}
  for(const market of marketIds){
   if(eligibleOnly&&eligibility.markets[market]?.allowed!==true)continue;
   let to=boundary;const bars=new Map();
   while(bars.size<historyBars){
    await heartbeat();const r=await captureUpbitPublic('/v1/candles/minutes/60',{market,count:String(Math.min(200,historyBars-bars.size)),to},{fetchImpl,clock});
    if(!Array.isArray(r.body))throw Object.assign(new Error('시간봉 원문 형식을 확인하세요.'),{code:'HOURLY_REGIME_SOURCE',source:r.source});
    rawSources.push(r.source);if(!r.body.length)break;
    const starts=[];
    for(const b of r.body){const start=Date.parse(b.candle_date_time_utc+'Z'),t=start+H;
     if(b.market!==market||!Number.isFinite(start)||start%H!==0||start>=Date.parse(to)||t>Date.parse(boundary)||bars.has(t)||![b.opening_price,b.high_price,b.low_price,b.trade_price,b.candle_acc_trade_price,b.candle_acc_trade_volume].every(v=>v!==null&&v!==''&&Number.isFinite(Number(v))))throw Object.assign(new Error('시간봉 원문의 종목·시점·수치를 확인하세요.'),{code:'HOURLY_REGIME_SOURCE',source:r.source});
     starts.push(start);bars.set(t,{t,open:Number(b.opening_price),high:Number(b.high_price),low:Number(b.low_price),close:Number(b.trade_price),quoteVolume:Number(b.candle_acc_trade_price),volume:Number(b.candle_acc_trade_volume),availableAt:r.source.receivedAt});
    }
    to=new Date(Math.min(...starts)).toISOString();
   }
   series.push({market,bars:[...bars.values()].sort((a,b)=>a.t-b.t).slice(-historyBars)});
  }
  return {frame:buildHourlyRegimeFrame({series,boundary,availableAt:clock(),entryEligibility:eligibility,sourceRefs:rawSources.map(s=>({id:s.id,contentHash:s.rawSha256,sourceRef:s.sourceUrl}))}),rawSources};
 })();cache.set(key,pending);
 try{const result=await pending;for(const k of cache.keys())if(k!==key)cache.delete(k);return result;}catch(error){cache.delete(key);throw error;}
}
