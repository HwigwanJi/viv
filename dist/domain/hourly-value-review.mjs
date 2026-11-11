import {hashInputPackage} from './workspace.mjs';
import {recheckHourlyValueEntry} from './hourly-value-policy.mjs';

const HASH=/^[a-f0-9]{64}$/,iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});};
const seal=body=>({...body,hash:hashInputPackage(body)});
const phases=['WAITING_REVIEW','WAITING_ENTRY','READY','REJECTED','STALE','EXPIRED'];
export const hourlyValueSelectionBoundary=selection=>new Date(Math.floor(Date.parse(selection.asOf)/3600000)*3600000).toISOString();
function pins(binding){
 check(binding&&['graphHash','manifestHash','modelHash','ledgerHash','configHash','feeHash'].every(k=>HASH.test(binding[k]??''))&&['profileId','accountId','subscriptionId'].every(k=>typeof binding[k]==='string'&&binding[k])&&['ENABLED','PAUSED'].includes(binding.subscriptionStatus),'HOURLY_REVIEW_BINDING');
 return Object.fromEntries(['profileId','accountId','subscriptionId','subscriptionStatus','graphHash','manifestHash','modelHash','ledgerHash','configHash','feeHash'].map(k=>[k,binding[k]]));
}
export function assertHourlyValueReview(state){
 const {hash,...body}=state??{};check(state?.contractVersion==='hourly-value-review-state-v1'&&hash===hashInputPackage(body)&&phases.includes(state.phase)&&iso(state.createdAt)&&iso(state.updatedAt)&&state.updatedAt>=state.createdAt&&iso(state.expiresAt)&&state.expiresAt>state.createdAt,'HOURLY_REVIEW_STATE');
 check(hashInputPackage(pins(state.binding))===hashInputPackage(state.binding),'HOURLY_REVIEW_BINDING');const {hash:selectionHash,...selectionBody}=state.selection??{};check(selectionHash===hashInputPackage(selectionBody)&&state.selection.contractVersion==='hourly-cash-value-selection-v1'&&state.selection.ready===true&&['ENTER','HOLD','CASH'].includes(state.selection.selected.kind)&&state.selection.modelHash===state.binding.modelHash&&state.selection.profileId===state.binding.profileId&&state.selection.accountId===state.binding.accountId,'HOURLY_REVIEW_SELECTION');
 check(state.selection.asOf===state.createdAt&&Number.isSafeInteger(state.readyDelayMs)&&state.readyDelayMs>=0&&Number.isFinite(state.entrySlippageBps)&&state.entrySlippageBps>=0&&state.entrySlippageBps<10000,'HOURLY_REVIEW_POLICY');
 check(state.executionAuthority==='VALUATION_ONLY'&&state.executionKey==='hourly-review:'+hashInputPackage({selectionHash,binding:state.binding})&&Boolean(state.rawReview)===Boolean(state.review),'HOURLY_REVIEW_STATE');
 if(state.review){const expected=recheckHourlyValueEntry(state.selection,state.rawReview,{asOf:state.review.asOf,entrySlippageBps:state.entrySlippageBps,readyDelayMs:state.readyDelayMs});check(hashInputPackage(expected)===hashInputPackage(state.review)&&state.review.asOf<=state.updatedAt,'HOURLY_REVIEW_RESULT');}
 const direct=state.selection.selected.kind!=='ENTER';
 check(!direct||state.review===null&&state.rawReview===null&&['READY','STALE','EXPIRED'].includes(state.phase),'HOURLY_REVIEW_PHASE');
 check(state.phase==='WAITING_REVIEW'?state.review===null:state.phase==='WAITING_ENTRY'?state.review?.accepted===true&&state.review.readyToEnter===false:state.phase==='READY'?(direct||state.review?.readyToEnter===true)&&state.updatedAt<state.expiresAt:state.phase==='REJECTED'?state.review?.accepted===false:true,'HOURLY_REVIEW_PHASE');
 return state;
}
export function createHourlyValueReview({selection,binding,expiresAt,entrySlippageBps,readyDelayMs}={}){
 const b=pins(binding),direct=selection?.selected?.kind!=='ENTER',readyTime=direct?Date.parse(selection?.asOf):Date.parse(selection?.selected?.forecastAsOf)+readyDelayMs;check(Number.isSafeInteger(readyDelayMs)&&readyDelayMs>=0&&Number.isFinite(new Date(readyTime).getTime()),'HOURLY_REVIEW_POLICY');const readyAt=new Date(readyTime).toISOString();
 check(iso(expiresAt)&&expiresAt>readyAt,'HOURLY_REVIEW_EXPIRY');
 return assertHourlyValueReview(seal({contractVersion:'hourly-value-review-state-v1',phase:direct?'READY':'WAITING_REVIEW',binding:b,selection:structuredClone(selection),createdAt:selection.asOf,updatedAt:selection.asOf,expiresAt,entrySlippageBps,readyDelayMs,rawReview:null,review:null,executionKey:'hourly-review:'+hashInputPackage({selectionHash:selection.hash,binding:b}),executionAuthority:'VALUATION_ONLY'}));
}
export function advanceHourlyValueReview(state,{binding,asOf,review=null}={}){
 assertHourlyValueReview(state);const b=pins(binding);check(iso(asOf)&&asOf>=state.updatedAt,'HOURLY_REVIEW_CLOCK');
 const next=structuredClone(state);delete next.hash;next.updatedAt=asOf;
 if(hashInputPackage(b)!==hashInputPackage(state.binding)){next.phase='STALE';next.reason='DECISION_BINDING_CHANGED';return seal(next);}
 if(asOf>=state.expiresAt){next.phase='EXPIRED';next.reason='ENTRY_WINDOW_ENDED';return seal(next);}
 if(['STALE','EXPIRED','REJECTED'].includes(state.phase))return seal(next);
 if(review){check(state.selection.selected.kind==='ENTER','HOURLY_REVIEW_SCOPE');if(state.rawReview)check(hashInputPackage(state.rawReview)===hashInputPackage(review),'HOURLY_REVIEW_REPLACEMENT');next.rawReview=structuredClone(review);}
 if(next.rawReview){next.review=recheckHourlyValueEntry(next.selection,next.rawReview,{asOf,entrySlippageBps:next.entrySlippageBps,readyDelayMs:next.readyDelayMs});next.phase=!next.review.accepted?'REJECTED':next.review.readyToEnter?'READY':'WAITING_ENTRY';}
 return assertHourlyValueReview(seal(next));
}
export function hourlyValueReviewHandoff(state,{binding,asOf}={}){
 const current=advanceHourlyValueReview(state,{binding,asOf});
 return {state:current,ready:current.phase==='READY',executionKey:current.executionKey,selectionHash:current.selection.hash,market:current.selection.selected.market,steps:current.phase==='READY'?structuredClone(current.review?.steps??current.selection.steps):[],executionAuthority:'VALUATION_ONLY'};
}
