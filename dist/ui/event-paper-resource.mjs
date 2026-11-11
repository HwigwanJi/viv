/** Owner-scoped paper ledgers and budget totals share one read model. */
export function createEventPaperResource({request,onChange=()=>{},now=Date.now}={}){
 let data=null,error='',loading=false,readAt=0,pending=null,abort=null,generation=0,disposed=false,invalidated=true;
 const state=()=>({data,error,loading,readAt}),items=()=>data?.subscriptions;
 const valid=value=>value?.executionMode==='paper'&&Array.isArray(value.subscriptions)&&Array.isArray(value.budgets);
 function acceptProfile(value,profileId){
  if(disposed||!valid(value))return;generation++;abort?.abort();pending=null;
  data={...value,subscriptions:[...(data?.subscriptions??[]).filter(item=>item.profileId!==profileId),...value.subscriptions.filter(item=>item.profileId===profileId)]};readAt=now();invalidated=false;error='';loading=false;onChange();
 }
 function invalidate(){if(disposed)return;generation++;abort?.abort();pending=null;loading=false;invalidated=true;}
 async function load({force=false,maxAgeMs=5000}={}){
  if(disposed)return;if(pending)return pending;if(!force&&!invalidated&&data&&now()-readAt<maxAgeMs)return data;
  const token=++generation,controller=new AbortController();abort=controller;loading=true;error='';
  const task=(async()=>{
   try{const value=await Promise.resolve().then(()=>request('/api/workspace/event-paper?profileId=all',undefined,{signal:controller.signal}));if(disposed||token!==generation)return;if(!valid(value))throw new Error('분봉 모의 원장을 다시 조회하세요.');data=value;readAt=now();invalidated=false;return data;}
   catch(problem){if(disposed||token!==generation||problem.name==='AbortError')return;error='분봉 모의 원장을 불러오지 못했어요. 다시 조회해 주세요.';}
   finally{if(token===generation){loading=false;pending=null;onChange();}}
  })();pending=task;return task;
 }
 return {items,state,load,acceptProfile,invalidate,destroy(){disposed=true;generation++;abort?.abort();pending=null;}};
}
