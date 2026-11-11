import {acquireClaim,completeClaim,releaseClaim} from './claims.mjs';
import {researchSha256} from '../dist/domain/research.mjs';

const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const check=(ok,code,message,status=409)=>{if(!ok)throw Object.assign(Error(message),{code,status});};
export async function approveAppNotification({request,env,owner,id,now=()=>new Date().toISOString(),automationOptions={}}){
 const db=env.DB,row=await first(db,'SELECT body FROM app_notifications WHERE owner_id=? AND id=?',owner,id);
 check(row,'NOTIFICATION_NOT_FOUND','승인 요청을 찾을 수 없습니다.',404);const n=JSON.parse(row.body),target=n.approval;
 check(n.status==='APPROVAL_READY'&&target,'NOTIFICATION_NOT_READY','현재 알림은 승인 대기 요청이 아닙니다.');
 const prior=()=>first(db,'SELECT body FROM app_notification_approvals WHERE owner_id=? AND notification_id=?',owner,id),saved=await prior();if(saved)return {...JSON.parse(saved.body),idempotent:true};
 const resourceId='notification-approval:'+id,claimArgs={ownerId:owner,resourceId,key:id,fingerprint:researchSha256(JSON.stringify(target)),baseRevision:0,nowMs:Date.parse(now()),leaseMs:120000};let claim;
 try{claim=await acquireClaim(db,claimArgs);}catch(error){if(error.code==='IN_PROGRESS')return {ok:true,status:'PROCESSING'};throw error;}
 let completed=false;
 try{
  const existing=await prior();if(existing){await completeClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(now())});completed=true;return {...JSON.parse(existing.body),idempotent:true};}
  const p=await first(db,'SELECT body,status,preview_hash,nonce_hash FROM live_automation_previews WHERE owner_id=? AND id=?',owner,target.previewId),plan=p?JSON.parse(p.body):null;
  const contract=target.kind==='LIVE_ACTIVATION'?'LIVE_AUTOMATION_ACTIVATION_V1':'LIVE_ALLOCATION_PLAN_V1';
  check(plan?.contractVersion===contract&&p.preview_hash===target.previewHash&&plan.previewHash===target.previewHash,'NOTIFICATION_TARGET_CHANGED','승인 대상이나 버전이 바뀌었습니다. 새 요청을 확인하세요.');
  if(target.kind==='LIVE_ACTIVATION')check(plan.config.profileId===target.profileId,'NOTIFICATION_TARGET_CHANGED','승인 대상 마인드가 바뀌었습니다.');
  let ids=[];
  if(p.status==='CONSUMED'){
   const rows=(await db.prepare("SELECT id FROM live_automation_activations WHERE owner_id=? AND json_extract(body,'$.previewId')=? ORDER BY id").bind(owner,target.previewId).all()).results??[];
   check(rows.length===(target.kind==='LIVE_ALLOCATION'?2:1),'NOTIFICATION_RESULT_REVIEW','승인 결과를 앱에서 확인하세요.');ids=rows.map(r=>r.id);
  }else{
   check(p.status==='PREPARED','NOTIFICATION_SUPERSEDED','설정이 변경된 요청입니다. 현재 요청을 확인하세요.');
   check(typeof plan.nonce==='string'&&researchSha256(plan.nonce)===p.nonce_hash,'NOTIFICATION_CONFIRMATION_MISSING','이전 요청은 앱에서 다시 준비하세요.');
   const {handleAutomatedTradingAPI}=await import('./automated-trading.mjs'),url=new URL(request.url);url.pathname='/api/workspace/automated-trading/'+(target.kind==='LIVE_ALLOCATION'?'allocation/activate':'activate');url.search='';
   const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
   const response=await handleAutomatedTradingAPI(new Request(url,{method:'POST',headers,body:JSON.stringify({previewId:target.previewId,previewHash:target.previewHash,nonce:plan.nonce,userAction:target.kind==='LIVE_ALLOCATION'?'LIVE_ALLOCATION_ACTIVATION':'LIVE_AUTOMATION_ACTIVATION'})}),env,automationOptions),result=await response.json();
   check(response.ok&&result.ok,result.code??'NOTIFICATION_APPROVAL_FAILED',result.message??'승인 처리 결과를 확인하세요.',response.status);
   ids=(result.policies??[result.policy]).map(p=>p.id);
  }
  if(p.status==='CONSUMED')await env.START_APPROVED_LIVE?.(owner,ids);
  const host=env.EVENT_AUTOMATION_STATUS?.(),result={ok:true,status:'APPROVED',approvedAt:now(),activationIds:ids,runtimeStatus:host?.running?'RUNNING':host?.status??null};
  await db.batch([db.prepare('INSERT OR IGNORE INTO app_notification_approvals(owner_id,notification_id,body) VALUES(?,?,?)').bind(owner,id,JSON.stringify(result)),db.prepare('UPDATE app_notifications SET read_at=COALESCE(read_at,?) WHERE owner_id=? AND id=?').bind(result.approvedAt,owner,id)]);
  await completeClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(now())});completed=true;
  return result;
 }finally{if(!completed)await releaseClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(now()),status:'FAILED'}).catch(()=>{});}
}
