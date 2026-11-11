import {createMindGameEnricher} from './mind-game-resource.mjs';
import {callAutomation} from '../system/automation-contracts.mjs';
import {selectMindActivity} from './mind-activity.mjs';

/** One owner-scoped read supplies cards, headings, controls and receipts. */
export function createMindActivityResource({request,onChange=()=>{},now=Date.now}={}){
 const enrichGame=createMindGameEnricher();
 let data=null,error='',loading=false,readAt=0,pending=null,abort=null,generation=0,disposed=false;
 const fingerprint=value=>JSON.stringify((value?.items??[]).map(item=>({...item,ledger:item.ledger?{...item.ledger,asOf:null}:null})));
 const state=()=>({data,error,loading,readAt});
 function get(profileId){return data?selectMindActivity(data.items,profileId):undefined;}
 function items(){if(!data)return undefined;return [...new Set(data.items.map(item=>item.profileId))].map(get).filter(Boolean);}
 async function load({force=false,maxAgeMs=5000}={}){
  if(disposed)return;if(pending)return pending;if(!force&&data&&now()-readAt<maxAgeMs)return data;
  const token=++generation,previous=fingerprint(data),oldError=error;let changed=false;abort=new AbortController();loading=true;if(!data){error='';onChange();}
  pending=(async()=>{
   try{const value=await callAutomation(request,'automation.trading.activity.read',{},{signal:abort.signal});if(disposed||token!==generation)return;
    if(value?.contractVersion!=='live-automation-activity-v1'||!Array.isArray(value.items))throw new Error('운용 상태를 다시 불러와 주세요.');
    value.items=await enrichGame(value.items,{request});if(disposed||token!==generation)return;const firstRead=data===null;data=value;readAt=now();error='';changed=Boolean(firstRead||previous!==fingerprint(data)||oldError);return data;
   }catch(problem){if(disposed||token!==generation||problem.name==='AbortError')return;error='운용 상태를 불러오지 못했어요. 다시 조회해 주세요.';changed=error!==oldError||!data;}
   finally{if(token===generation){loading=false;pending=null;if(changed)onChange();}}
  })();return pending;
 }
 return {get,items,state,load,destroy(){disposed=true;generation++;abort?.abort();pending=null;}};
}
