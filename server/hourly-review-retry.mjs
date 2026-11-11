export const HOURLY_REVIEW_RETRY_VERSION='hourly-first-minute-retry-v1';
const delays=[1000,2000,4000,8000,16000,30000];
const check=ok=>{if(!ok)throw Object.assign(Error('HOURLY_REVIEW_RETRY_STATE'),{code:'HOURLY_REVIEW_RETRY_STATE'});};

/** Persist request timing before fetching so a restart retains the same retry window. */
export async function readHourlyReviewWithBackoff(state,{market,forecastAsOf,expiresAt,clock,read,save}){
 const key=market+':'+forecastAsOf,time=Date.parse(clock()),end=Date.parse(expiresAt);check(Number.isFinite(time)&&Number.isFinite(end));
 if(state.key!==key)Object.assign(state,{contractVersion:HOURLY_REVIEW_RETRY_VERSION,key,misses:0,nextAt:0,review:null});
 check(state.contractVersion===HOURLY_REVIEW_RETRY_VERSION&&Number.isInteger(state.misses)&&state.misses>=0&&state.misses<=delays.length&&Number.isSafeInteger(state.nextAt)&&state.nextAt>=0);
 if(time>=end)return null;
 if(state.review)return state.review;
 if(time<state.nextAt)return null;
 state.misses=Math.min(state.misses+1,delays.length);const delay=delays[state.misses-1];state.nextAt=Math.min(end,time+delay);
 await save('REQUESTED',structuredClone(state));
 const review=await read({market,forecastAsOf});
 state.review=review;state.nextAt=review?0:Math.min(end,Date.parse(clock())+delay);
 await save(review?'READY':'MISSING',structuredClone(state));return review;
}
