import {captureUpbitPublic} from './upbit-scalping-market.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';
const DAY=86400000,cache=new Map();
export async function readDailyPortfolioMarket({marketIds,historyBars,allowShortHistory=false,fetchImpl=fetch,clock=()=>new Date().toISOString(),heartbeat=async()=>{}}){
 if(typeof allowShortHistory!=='boolean'||!marketIds?.length||new Set(marketIds).size!==marketIds.length||marketIds.some(m=>!/^KRW-[A-Z0-9]+$/.test(m))||!Number.isInteger(historyBars)||historyBars<30||historyBars>1000)throw Object.assign(new Error('일봉의 종목과 조회 범위를 확인하세요.'),{code:'PORTFOLIO_DAILY_SCOPE'});
 const boundary=new Date(Math.floor(Date.parse(clock())/DAY)*DAY).toISOString(),key=JSON.stringify([boundary,historyBars,[...marketIds].sort(),allowShortHistory]);
 let pending=cache.get(key);
 if(!pending){pending=(async()=>{
  const series=[],rawSources=[];
  for(const market of marketIds){let to=boundary;const bars=new Map();
   while(bars.size<historyBars){await heartbeat();const r=await captureUpbitPublic('/v1/candles/days',{market,count:String(Math.min(200,historyBars-bars.size)),to},{fetchImpl,clock});rawSources.push(r.source);
    if(!Array.isArray(r.body))throw Object.assign(new Error('일봉 원문 형식을 확인하세요.'),{code:'PORTFOLIO_DAILY_SOURCE'});
    if(!r.body.length){if(allowShortHistory)break;throw Object.assign(new Error('필요한 확정 일봉 이력이 없습니다.'),{code:'CALENDAR_HISTORY_REQUIRED'});}
    const starts=[];for(const b of r.body){const start=Date.parse(b.candle_date_time_utc+'Z'),t=start+DAY,values=[b.opening_price,b.high_price,b.low_price,b.trade_price,b.candle_acc_trade_price,b.candle_acc_trade_volume];
     if(b.market!==market||!Number.isFinite(start)||start%DAY!==0||start>=Date.parse(to)||t>Date.parse(boundary)||values.some(v=>v===null||v===''||!Number.isFinite(Number(v))))throw Object.assign(new Error('일봉 원문의 종목·시점·수치를 확인하세요.'),{code:'PORTFOLIO_DAILY_SOURCE'});
     starts.push(start);bars.set(t,{t,open:Number(b.opening_price),high:Number(b.high_price),low:Number(b.low_price),close:Number(b.trade_price),quoteVolume:Number(b.candle_acc_trade_price),volume:Number(b.candle_acc_trade_volume)});
    }
    to=new Date(Math.min(...starts)).toISOString();
   }
   const sorted=[...bars.values()].sort((a,b)=>a.t-b.t).slice(-historyBars);
   if(sorted.length&&(sorted.at(-1).t!==Date.parse(boundary)||sorted.some((b,i)=>i&&b.t-sorted[i-1].t!==DAY)))throw Object.assign(new Error('일봉 누락을 보간하지 않고 원문을 확인합니다.'),{code:'CALENDAR_HISTORY_REQUIRED'});
   series.push({market,bars:sorted});
  }
  return {series,rawSources};
 })();cache.set(key,pending);}
 try{
  const daily=await pending;await heartbeat();const {eligibility,snapshot}=await readUpbitEntryEligibility({marketIds,fetchImpl,clock});
  const source={id:snapshot.id,rawSha256:snapshot.rawBodySha256,sourceUrl:snapshot.url,rawBody:snapshot.rawBody,requestedAt:snapshot.requestStartedAt,receivedAt:snapshot.receivedAt};
  const rawSources=[...daily.rawSources,source];for(const k of cache.keys())if(JSON.parse(k)[0]!==boundary)cache.delete(k);
  return {frame:{timeframe:'1d',asOf:boundary,availableAt:clock(),series:daily.series,entryEligibility:eligibility,sourceRefs:rawSources.map(s=>({id:s.id,contentHash:s.rawSha256,sourceRef:s.sourceUrl}))},rawSources};
 }catch(error){cache.delete(key);throw error;}
}
