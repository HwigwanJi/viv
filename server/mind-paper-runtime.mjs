import {MAX_ACTIVE_MIND_SUBSCRIPTIONS,activeMindSubscriptionCount} from '../dist/domain/mind-subscriptions.mjs';

const states=new WeakMap();
export function setMindPaperRunnerState(db,ownerId,state){
  if(!states.has(db))states.set(db,new Map());
  states.get(db).set(ownerId,structuredClone(state));
}
export function clearMindPaperRunnerHistory(db,ownerId,now){const state=states.get(db)?.get(ownerId);if(state)states.get(db).set(ownerId,{...state,lastReport:null,lastFailure:null,lastCompletedAt:now,dispatchCount:0});}
export function mindPaperRunnerStatus(db,ownerId,workspace,{now=new Date().toISOString()}={}){
  const saved=states.get(db)?.get(ownerId),enabled=(workspace.mindSubscriptions??[]).filter(s=>s.ownerId===ownerId&&s.status==='ENABLED'),due=enabled.map(s=>s.runtime?.nextAttemptAt??(s.nextCloseAt?new Date(Date.parse(s.nextCloseAt)+300000).toISOString():null)).filter(Boolean).sort();
  const value=saved??{status:'DISABLED',startedAt:null,heartbeatAt:null,lastDispatchAt:null,lastCompletedAt:null,lastFailure:null,intervalMs:30000,dispatchCount:0,lastReport:null};
  const stale=!!value.heartbeatAt&&Date.parse(now)-Date.parse(value.heartbeatAt)>Math.max(value.intervalMs*3,120000);
  return {...structuredClone(value),status:stale&&!['STOPPED','DISABLED'].includes(value.status)?'UNRESPONSIVE':value.status,nextDueAt:due[0]??null,activeCount:activeMindSubscriptionCount(workspace,{ownerId}),enabledCount:enabled.length,capacity:MAX_ACTIVE_MIND_SUBSCRIPTIONS,scope:'LOCAL_CANONICAL_PAPER',executionMode:'paper'};
}
