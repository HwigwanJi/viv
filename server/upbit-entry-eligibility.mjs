import {collectUpbitMarketSnapshot} from './universe-sources.mjs';
import {resolveUpbitEntryEligibility} from '../dist/domain/universe-policy.mjs';

export async function readUpbitEntryEligibility({marketIds,fetchImpl=fetch,clock=()=>new Date().toISOString()}={}){
 const snapshot=await collectUpbitMarketSnapshot({fetchImpl,now:clock});
 return {eligibility:resolveUpbitEntryEligibility(snapshot,{marketIds,asOf:clock()}),snapshot};
}
