import {createHash,randomUUID} from 'node:crypto';
import {validateAppNotification,notificationDismissalState} from '../dist/domain/app-notifications.mjs';
import {approveAppNotification} from './app-notification-approval.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results??[];
const exists=async db=>!!db&&!!await stmt(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='app_notifications'").first();
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function initializeAppNotifications(db){
 await db.batch([
  stmt(db,'CREATE TABLE IF NOT EXISTS app_notifications(owner_id TEXT NOT NULL,id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,read_at TEXT,PRIMARY KEY(owner_id,id))'),
  stmt(db,'CREATE TABLE IF NOT EXISTS app_push_subscriptions(owner_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,id))'),
  stmt(db,'CREATE TABLE IF NOT EXISTS app_push_deliveries(owner_id TEXT NOT NULL,subscription_id TEXT NOT NULL,notification_id TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,next_at TEXT NOT NULL,PRIMARY KEY(owner_id,subscription_id,notification_id))')
 ]);
 await stmt(db,'CREATE TABLE IF NOT EXISTS app_notification_dismissals(owner_id TEXT NOT NULL,notification_id TEXT NOT NULL,deleted_at TEXT NOT NULL,PRIMARY KEY(owner_id,notification_id))').run();
 await stmt(db,'CREATE TABLE IF NOT EXISTS app_notification_approvals(owner_id TEXT NOT NULL,notification_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,notification_id))').run();
 await stmt(db,'CREATE INDEX IF NOT EXISTS app_notifications_time ON app_notifications(owner_id,created_at DESC)').run();
}
export async function publishAppNotification({db,owner,notification}){
 if(typeof owner!=='string'||!owner)throw Error('NOTIFICATION_OWNER');
 const item=validateAppNotification(notification);await initializeAppNotifications(db);
 const before=await stmt(db,'SELECT body FROM app_notifications WHERE owner_id=? AND id=?',owner,item.id).first();
 if(before){if(before.body!==JSON.stringify(item))throw Error('NOTIFICATION_ID_CONFLICT');return item;}
 await stmt(db,'INSERT INTO app_notifications(owner_id,id,created_at,body) VALUES(?,?,?,?)',owner,item.id,item.createdAt,JSON.stringify(item)).run();return item;
}
async function currentNotification(db,owner,n){
 if(n.status!=='APPROVAL_READY'||!n.approval)return n;
 const ready=await stmt(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='live_automation_previews'").first(),p=ready?await stmt(db,'SELECT status,preview_hash FROM live_automation_previews WHERE owner_id=? AND id=?',owner,n.approval.previewId).first():null;
 if(!p||p.preview_hash!==n.approval.previewHash)return {...n,status:'FAILED',expired:true,body:'승인 대상이 바뀌었습니다. 새 요청을 확인하세요.'};
 if(p.status==='CONSUMED'){
  const receipt=await stmt(db,'SELECT body FROM app_notification_approvals WHERE owner_id=? AND notification_id=?',owner,n.id).first();
  return receipt?{...n,status:'COMPLETED',body:'이 요청의 승인을 이미 반영했습니다. 앱에서 운용 상태를 확인하세요.'}:{...n,body:'승인 설정은 저장됐습니다. 승인 버튼으로 운용 연결을 완료하세요. 같은 설정은 중복 생성되지 않습니다.'};
 }
 if(p.status!=='PREPARED')return {...n,status:'FAILED',expired:true,body:'설정이 변경된 요청입니다. 현재 요청을 확인하세요.'};return {...n,details:n.details.filter(d=>!['승인 유효 시각','검토 유효 시각'].includes(d.label))};
}
export function validatePushSubscription(value){
 const u=new URL(value?.endpoint),host=u.hostname;
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||value.endpoint.length>4096||!['fcm.googleapis.com','updates.push.services.mozilla.com'].includes(host)&&!host.endsWith('.push.apple.com')&&!host.endsWith('.notify.windows.com'))throw Error('PUSH_ENDPOINT');
 const keys=value.keys,decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),valid=(s,n)=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s)&&decode(s).length===n;
 if(!valid(keys?.p256dh,65)||decode(keys.p256dh)[0]!==4||!valid(keys?.auth,16))throw Error('PUSH_KEYS');
 return {endpoint:u.href,keys:{p256dh:keys.p256dh,auth:keys.auth},expirationTime:null};
}
export async function handleAppNotificationsAPI(request,env,options={}){
 const url=new URL(request.url),owner=request.headers.get('oai-authenticated-user-id'),db=env.DB;
 if(!owner)return json({ok:false,code:'UNAUTHORIZED'},401);
 try{
  if(request.method==='GET'&&url.pathname==='/api/app-notifications'){
   if(await exists(db))await initializeAppNotifications(db);
   const query='SELECT n.body,n.read_at,a.body approval_result,d.deleted_at FROM app_notifications n LEFT JOIN app_notification_approvals a ON a.owner_id=n.owner_id AND a.notification_id=n.id LEFT JOIN app_notification_dismissals d ON d.owner_id=n.owner_id AND d.notification_id=n.id WHERE n.owner_id=? AND d.deleted_at IS ';
   const rows=await exists(db)?[...await all(db,query+'NULL ORDER BY n.created_at DESC LIMIT 100',owner),...await all(db,query+'NOT NULL ORDER BY d.deleted_at DESC LIMIT 100',owner)]:[],resolved=await Promise.all(rows.map(r=>currentNotification(db,owner,{...JSON.parse(r.body),readAt:r.read_at,...(r.deleted_at?{deletedAt:r.deleted_at}:{}),...(r.approval_result?{status:'COMPLETED',approvalResult:JSON.parse(r.approval_result)}:{})},options.now?.()??new Date().toISOString())));
   return json({ok:true,items:resolved.filter(n=>!n.deletedAt).slice(0,100),deletedItems:resolved.filter(n=>n.deletedAt).slice(0,100),publicKey:env.APP_PUSH_KEYS?.publicKey??null,pushConfigured:!!env.APP_PUSH_KEYS});
  }
  if(request.method!=='POST')return json({ok:false,code:'METHOD'},405);
  if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({ok:false,code:'ORIGIN'},403);
  const text=await request.text();if(text.length>10000)return json({ok:false,code:'INPUT_SIZE'},413);const body=JSON.parse(text);
  if(!db)return json({ok:false,code:'STORAGE_REQUIRED'},503);await initializeAppNotifications(db);
  if(url.pathname==='/api/app-notifications/read-all'){
   if(Object.keys(body).length)return json({ok:false,code:'INPUT'},400);
   const result=await stmt(db,'UPDATE app_notifications SET read_at=? WHERE owner_id=? AND read_at IS NULL AND NOT EXISTS (SELECT 1 FROM app_notification_dismissals d WHERE d.owner_id=app_notifications.owner_id AND d.notification_id=app_notifications.id)',options.now?.()??new Date().toISOString(),owner).run();
   return json({ok:true,count:result.meta?.changes??0});
  }
  if(url.pathname==='/api/app-notifications/dismiss-expired'){
   if(Object.keys(body).length)return json({ok:false,code:'INPUT'},400);
   const rows=await all(db,'SELECT body FROM app_notifications WHERE owner_id=?',owner);let count=0;
   for(const row of rows){const n=await currentNotification(db,owner,JSON.parse(row.body));if(!n.expired)continue;
    const r=await stmt(db,'INSERT OR IGNORE INTO app_notification_dismissals(owner_id,notification_id,deleted_at) VALUES(?,?,?)',owner,n.id,options.now?.()??new Date().toISOString()).run();count+=r.meta?.changes??0;
   }return json({ok:true,count});
  }
  if(['/api/app-notifications/dismiss','/api/app-notifications/restore','/api/app-notifications/unread'].includes(url.pathname)){
   if(Object.keys(body).length!==1||typeof body.id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(body.id))return json({ok:false,code:'INPUT'},400);
   const row=await stmt(db,'SELECT n.body,n.read_at,a.body approval_result FROM app_notifications n LEFT JOIN app_notification_approvals a ON a.owner_id=n.owner_id AND a.notification_id=n.id WHERE n.owner_id=? AND n.id=?',owner,body.id).first();
   if(!row)return json({ok:false,code:'NOTIFICATION_NOT_FOUND',message:'알림을 찾을 수 없습니다.'},404);
   if(url.pathname.endsWith('/dismiss')){
    const item=await currentNotification(db,owner,{...JSON.parse(row.body),readAt:row.read_at,...(row.approval_result?{status:'COMPLETED'}:{})}),state=notificationDismissalState(item);
    if(!state.allowed)return json({ok:false,code:'NOTIFICATION_PENDING',message:state.reason},409);
    await stmt(db,'INSERT OR IGNORE INTO app_notification_dismissals(owner_id,notification_id,deleted_at) VALUES(?,?,?)',owner,body.id,options.now?.()??new Date().toISOString()).run();
   }else if(url.pathname.endsWith('/restore'))await stmt(db,'DELETE FROM app_notification_dismissals WHERE owner_id=? AND notification_id=?',owner,body.id).run();
   else await stmt(db,'UPDATE app_notifications SET read_at=NULL WHERE owner_id=? AND id=?',owner,body.id).run();
   return json({ok:true});
  }
  if(url.pathname==='/api/app-notifications/approve'){
   if(Object.keys(body).length!==1||typeof body.id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(body.id))return json({ok:false,code:'INPUT'},400);
   const result=await approveAppNotification({request,env,owner,id:body.id,now:options.now,automationOptions:options.automationOptions});return json(result,result.status==='PROCESSING'?202:200);
  }
  if(url.pathname==='/api/app-notifications/read'){
   if(typeof body.id!=='string'||body.id.length>160)return json({ok:false,code:'INPUT'},400);
   await stmt(db,'UPDATE app_notifications SET read_at=COALESCE(read_at,?) WHERE owner_id=? AND id=?',new Date().toISOString(),owner,body.id).run();return json({ok:true});
  }
  if(url.pathname==='/api/app-notifications/subscribe'){
   if(!env.APP_PUSH_KEYS)return json({ok:false,code:'PUSH_UNCONFIGURED'},503);
   const sub=validatePushSubscription(body.subscription),id=hash(sub.endpoint);
   await stmt(db,'INSERT INTO app_push_subscriptions(owner_id,id,body,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET body=excluded.body',owner,id,JSON.stringify(sub),new Date().toISOString()).run();
   return json({ok:true,subscriptionId:id});
  }
  if(url.pathname==='/api/app-notifications/unsubscribe'){
   if(typeof body.subscriptionId!=='string'||!/^[a-f0-9]{64}$/.test(body.subscriptionId))return json({ok:false,code:'INPUT'},400);
   await stmt(db,'DELETE FROM app_push_subscriptions WHERE owner_id=? AND id=?',owner,body.subscriptionId).run();return json({ok:true});
  }
  if(url.pathname==='/api/app-notifications/test'){
   const item=await publishAppNotification({db,owner,notification:{id:'test-'+randomUUID(),title:'청지 알림 연결 확인',body:'이 알림을 누르면 청지 앱의 같은 요청 화면이 열립니다.',status:'INFO',createdAt:new Date().toISOString()}});return json({ok:true,item});
  }
  return json({ok:false,code:'NOT_FOUND'},404);
 }catch(error){return json({ok:false,code:error.code??'NOTIFICATION_INPUT',message:error.code?error.message:'알림 요청 형식과 연결 상태를 확인하세요.'},error.status??400);}
}
export function createAppPushDispatcher({db,keys,subject,send,now=()=>new Date().toISOString(),setTimer=setInterval,clearTimer=clearInterval}){
 if(keys&&typeof send!=='function')throw Error('PUSH_TRANSPORT_REQUIRED');
 let timer=null,pending=null,stopped=false,lastError=null,schemaReady=false;
 async function deliver(){
  if(stopped||!keys||!await exists(db))return;
  if(!schemaReady){await initializeAppNotifications(db);schemaReady=true;}
  const rows=await all(db,"SELECT n.owner_id,n.id,n.body,s.id subscription_id,s.body subscription_body,COALESCE(d.attempts,0) attempts FROM app_notifications n JOIN app_push_subscriptions s ON s.owner_id=n.owner_id LEFT JOIN app_push_deliveries d ON d.owner_id=n.owner_id AND d.subscription_id=s.id AND d.notification_id=n.id WHERE n.read_at IS NULL AND NOT EXISTS(SELECT 1 FROM app_notification_dismissals hidden WHERE hidden.owner_id=n.owner_id AND hidden.notification_id=n.id) AND (d.status IS NULL OR d.status='RETRY' AND d.next_at<=?) ORDER BY n.created_at DESC LIMIT 5",now());
  for(const r of rows){
   if(stopped)break;const n=JSON.parse(r.body),args=[r.owner_id,r.subscription_id,r.id];if(await stmt(db,'SELECT notification_id FROM app_notification_approvals WHERE owner_id=? AND notification_id=?',r.owner_id,r.id).first())continue;let status='SENT',nextAt=now();
   if(n.status==='APPROVAL_READY'&&(await currentNotification(db,r.owner_id,n,now())).status!=='APPROVAL_READY'){await stmt(db,"INSERT OR REPLACE INTO app_push_deliveries(owner_id,subscription_id,notification_id,status,attempts,next_at) VALUES(?,?,?,'OBSOLETE',?,?)",...args,r.attempts,now()).run();continue;}
   try{await send(JSON.parse(r.subscription_body),JSON.stringify({title:n.status==='APPROVAL_READY'?n.title:'청지 · 확인할 요청이 있습니다',body:n.status==='APPROVAL_READY'?n.body:'앱에서 대상과 변경 내용을 확인하세요.',id:n.id,url:n.href,approvalReady:n.status==='APPROVAL_READY'}),{TTL:86400,timeout:10000,urgency:'normal',vapidDetails:{subject,publicKey:keys.publicKey,privateKey:keys.privateKey}});}
   catch(e){if([404,410].includes(e.statusCode)){status='EXPIRED';await stmt(db,'DELETE FROM app_push_subscriptions WHERE owner_id=? AND id=?',r.owner_id,r.subscription_id).run();}else{status='RETRY';nextAt=new Date(Date.parse(now())+Math.min(3600000,30000*2**Math.min(r.attempts,7))).toISOString();lastError={at:now(),code:e.statusCode??'PUSH_DELIVERY'};}}
   await stmt(db,'INSERT INTO app_push_deliveries(owner_id,subscription_id,notification_id,status,attempts,next_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,subscription_id,notification_id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,next_at=excluded.next_at',...args,status,r.attempts+1,nextAt).run();
  }
 }
 const tick=()=>pending??=(async()=>{try{await deliver();}finally{pending=null;}})();
 return {start(){stopped=false;timer=setTimer(()=>tick().catch(()=>{lastError={at:now(),code:'PUSH_STORAGE'};}),15000);timer?.unref?.();},async stop(){stopped=true;clearTimer(timer);if(pending)await pending;},tick,status:()=>({lastError})};
}
