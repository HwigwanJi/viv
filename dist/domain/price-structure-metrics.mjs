const DAY=86400000;
export const PRICE_STRUCTURE_METRICS=['EMA_DISTANCE','EMA_RATIO','WEEKLY_EMA_DISTANCE'];
/** Seed from the first supplied close; callers retain a fixed, explicit daily history window. */
export function priceStructureMetric(bars,metric,lookback,slowLookback){
 const fail=()=>{throw Object.assign(new Error('연속 확정 일봉과 충분한 주봉 이력을 확인하세요.'),{code:'PRICE_STRUCTURE_HISTORY_REQUIRED'});};
 if(bars.some((b,i)=>Date.parse(b.closeTime)-Date.parse(b.openTime)!==DAY||i&&bars[i-1].closeTime!==b.openTime))fail();
 const selected=metric==='WEEKLY_EMA_DISTANCE'?bars.filter(b=>new Date(b.closeTime).getUTCDay()===1):bars;
 if(selected.length<Math.max(lookback,slowLookback??0))return null;
 const ema=n=>selected.reduce((v,b,i)=>i?v+(b.close-v)*2/(n+1):b.close,0);
 return metric==='EMA_RATIO'?ema(lookback)/ema(slowLookback)-1:selected.at(-1).close/ema(lookback)-1;
}
