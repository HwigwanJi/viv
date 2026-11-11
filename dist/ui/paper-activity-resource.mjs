import {hashInputPackage} from '../domain/workspace.mjs';
import {mindDocumentHash} from '../domain/mind-manifest.mjs';

const list=value=>Array.isArray(value)?value:[];
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value)?value:'PAPER_ACTIVITY_UNAVAILABLE';
function latestRun(workspace,profileId){
 return list(workspace?.mindRuns).filter(run=>run.profileId===profileId&&run.experimentType==='FORWARD_PAPER'&&run.mode!=='replay'&&run.executionMode!=='live'&&run.automation?.portfolioCycle?.phase!=='SCREENING'&&run.execution?.status!=='SCREENING_ONLY'&&['buy','sell','hold'].includes(run.decision?.action)&&iso(run.decisionAt)).sort((a,b)=>(b.decisionCompletedAt??b.provider?.answeredAt??b.decisionAt).localeCompare(a.decisionCompletedAt??a.provider?.answeredAt??a.decisionAt)||String(b.id).localeCompare(String(a.id)))[0]??null;
}
function key(run){return run?hashInputPackage({id:run.id,profileId:run.profileId,instrumentId:run.instrumentId,manifestId:run.manifestId,manifestHash:run.manifestHash,asOf:run.asOf,decisionAt:run.decisionAt,decision:run.decision,execution:run.execution?.status??null,executionAt:run.execution?.at??null}):null;}
function detailFor(response,expected){
 const detail=response?.decision,run=detail?.record??detail?.run,manifest=detail?.manifest??null;
 if(response?.ok!==true||!run||['id','profileId','instrumentId','manifestId','manifestHash','experimentType','asOf','decisionAt'].some(field=>run[field]!==expected[field])||run.experimentType!=='FORWARD_PAPER'||run.mode==='replay'||run.executionMode==='live'||run.automation?.portfolioCycle?.phase==='SCREENING'||run.execution?.status==='SCREENING_ONLY'||hashInputPackage(run.decision)!==hashInputPackage(expected.decision))throw Object.assign(new Error('결정 원본과 선택한 모의 기록을 대조하세요.'),{code:'PAPER_ACTIVITY_DETAIL_MISMATCH'});
 if(detail.record&&detail.run&&hashInputPackage(detail.record)!==hashInputPackage(detail.run))throw Object.assign(new Error('결정 원본을 대조하세요.'),{code:'PAPER_ACTIVITY_DETAIL_MISMATCH'});
 if(manifest&&(manifest.kind!=='mind-policy'||manifest.id!==run.manifestId||manifest.scope?.profileId!==run.profileId||mindDocumentHash(manifest)!==run.manifestHash))throw Object.assign(new Error('판단 당시 정책 원본을 대조하세요.'),{code:'PAPER_ACTIVITY_MANIFEST_MISMATCH'});
 return structuredClone({run,manifest});
}

/** Cached local GET only. Original requests stay in memory and are never rendered here. */
export function createPaperActivityResource({request,onChange=()=>{},getWorkspace,getProfileId,getExecutionMode}={}){
 if([request,getWorkspace,getProfileId,getExecutionMode].some(value=>typeof value!=='function'))throw new TypeError('모의 활동의 조회 경로를 확인하세요.');
 const entries=new Map(),pending=new Map();let destroyed=false,generation=0;
 const state=(profileId=getProfileId())=>{
  if(destroyed||getExecutionMode()!=='paper')return {status:'INACTIVE',profileId};
  const run=latestRun(getWorkspace(),profileId),signature=key(run),entry=entries.get(profileId);
  if(!run)return {status:'EMPTY',profileId,runId:null};
  if(pending.has(profileId+':'+signature))return {status:'LOADING',profileId,runId:run.id};
  return entry?.signature===signature?{status:entry.status,profileId,runId:run.id,errorCode:entry.errorCode??null}:{status:'IDLE',profileId,runId:run.id};
 };
 function load(options={}){
  const explicit=Object.hasOwn(options,'profileId'),profileId=explicit?options.profileId:getProfileId(),initial=state(profileId);
  if(['INACTIVE','EMPTY'].includes(initial.status))return Promise.resolve(initial);
  if(typeof profileId!=='string'||!profileId||profileId==='all')return Promise.resolve({status:'EMPTY',profileId,runId:null});
  const run=latestRun(getWorkspace(),profileId),signature=key(run),entry=entries.get(profileId),pendingKey=profileId+':'+signature;
  if(pending.has(pendingKey))return pending.get(pendingKey);
  if(!options.force&&entry?.signature===signature)return Promise.resolve(state(profileId));
  const startedGeneration=generation;
  const current=()=>!destroyed&&generation===startedGeneration&&getExecutionMode()==='paper'&&(explicit||getProfileId()===profileId)&&key(latestRun(getWorkspace(),profileId))===signature;
  const promise=Promise.resolve().then(()=>current()?request('/api/workspace/decisions/detail?id='+encodeURIComponent(run.id)):null).then(response=>{
   if(!current())return {status:'STALE',profileId,runId:run.id};
   const detail=detailFor(response,run);entries.set(profileId,{signature,status:'READY',detail});
   return {status:'READY',profileId,runId:run.id};
  }).catch(error=>{
   if(!current())return {status:'STALE',profileId,runId:run.id};
   const errorCode=safeCode(error?.code);entries.set(profileId,{signature,status:'UNAVAILABLE',errorCode});
   return {status:'UNAVAILABLE',profileId,runId:run.id,errorCode};
  }).then(result=>{
   pending.delete(pendingKey);
   if(current())onChange(result);
   return result;
  });
  pending.set(pendingKey,promise);return promise;
 }
 function workspace(){
  const source=getWorkspace();
  if(destroyed||getExecutionMode()!=='paper'||!source)return source;
  const runs=[...list(source.mindRuns)],manifests=[...list(source.mindManifests)];let changed=false;
  for(const [profileId,entry] of entries){
   if(entry.status!=='READY'||entry.signature!==key(latestRun(source,profileId)))continue;
   const {run,manifest}=entry.detail,index=runs.findIndex(value=>value.id===run.id&&value.profileId===profileId);
   if(index<0)continue;
   const saved=manifest?manifests.filter(value=>value.id===manifest.id):[];
   if(saved.length>1||saved.some(value=>{try{return mindDocumentHash(value)!==run.manifestHash;}catch{return true;}}))continue;
   runs[index]=structuredClone(run);if(manifest&&!saved.length)manifests.push(structuredClone(manifest));changed=true;
  }
  return changed?{...source,mindRuns:runs,mindManifests:manifests}:source;
 }
 return {load,workspace,status:state,destroy(){destroyed=true;generation++;entries.clear();pending.clear();}};
}
