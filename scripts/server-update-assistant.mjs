import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openSync,closeSync} from 'node:fs';
import {readFile,writeFile,mkdir,statfs,rm,rename} from 'node:fs/promises';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {openLocalDatabase,reopenLocalDatabase} from '../server/local-db.mjs';
import {acquireClaim,assertClaim,releaseClaim} from '../server/claims.mjs';
import {EVENT_AUTOMATION_RUNNER_VERSION} from '../server/event-automation-runner.mjs';
import {supportsLiveStrategyUpdate} from '../dist/system/automation-contracts.mjs';
import {compileStrategyGraph,strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {handleAutomatedTradingAPI} from '../server/automated-trading.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from '../server/repository.mjs';
import {liveChangeReview} from '../dist/ui/live-change-review.mjs';
import {labGraphChanges} from '../dist/ui/lab-graph-diff.mjs';
import {withServerMaintenance} from './preview-lifecycle.mjs';
import {validateMobileOrigin,previewRequestOrigin} from './preview-origin.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),run=promisify(execFile),sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const check=(ok,message)=>{if(!ok)throw new Error(message);};
export function openBackupDatabase(file,{Database=DatabaseSync,platform=process.platform}={}){
 let database;
 // Windows WAL metadata must stay writable even for SQL-only inspection before the last writer exits.
 if(platform==='win32'){
  database=new Database(file);try{database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');database.prepare('SELECT name FROM sqlite_master LIMIT 1').get();return database;}catch(error){database.close();throw error;}
 }
 try{database=new Database(file,{readOnly:true});database.prepare('SELECT name FROM sqlite_master LIMIT 1').get();return database;}
 catch(error){if(database?.isOpen)database.close();if(error.errcode!==1546)throw error;}
 // Windows may need to recreate WAL shared memory after the final writer exits.
 database=new Database(file);try{database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');return database;}catch(error){database.close();throw error;}
}
export function operationsView(profileId){const query=new URLSearchParams({executionMode:'live',view:'operations'});if(profileId)query.set('profileId',profileId);return '/#minds?'+query;}
const fingerprint=policies=>sha(policies.map(p=>({id:p.id,status:p.status,config:p.config})).sort((a,b)=>a.id.localeCompare(b.id)));
export function strategyChangePayload(change,expectedRevision){
 const graphMode=Object.hasOwn(change,'graph');
 if(graphMode){compileStrategyGraph(change.graph);check(strategyGraphHash(change.graph)===change.graphHash,'승인할 그래프 원본과 해시를 확인하세요.');}
 else check(typeof change.targetManifestId==='string'&&/^[a-f0-9]{64}$/.test(change.targetManifestHash??''),'교체할 발행 모델을 확인하세요.');
 return {activationId:change.activationId,expectedGraphHash:change.expectedGraphHash,...(graphMode?{graph:structuredClone(change.graph)}:{targetManifestId:change.targetManifestId,targetManifestHash:change.targetManifestHash}),maxJevCallsPerDay:change.maxJevCallsPerDay,...(change.perOrderLimit===undefined?{}:{perOrderLimit:change.perOrderLimit}),expectedRevision,idempotencyKey:change.idempotencyKey,userAction:'LIVE_STRATEGY_UPDATE'};
}
export async function stageStrategyChange({db,change,owner='local-preview-owner'}){
 if(change.expectedPositions){const row=await db.prepare('SELECT body FROM live_automation_activations WHERE owner_id=? AND id=?').bind(owner,change.activationId).first(),policy=row?JSON.parse(row.body):null,accountRow=policy?await db.prepare('SELECT body FROM live_automation_accounts WHERE owner_id=? AND account_id=?').bind(owner,policy.config.accountId).first():null,positions=accountRow?JSON.parse(accountRow.body).positions?.[change.activationId]??{}:{};check(sha(positions)===sha(change.expectedPositions),'승인 준비 이후 보유 수량이나 원가가 바뀌었습니다. 변경안을 다시 준비하세요.');}
 const repository=new WorkspaceRepository(db),workspace=await readOperationalWorkspace(repository,owner),response=await handleAutomatedTradingAPI(new Request('http://127.0.0.1:4905/api/workspace/automated-trading/update-strategy',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(strategyChangePayload(change,workspace.revision))}),{DB:db},{repository});
 const result=await response.json();check(response.ok,result.message??'전략 변경 저장 결과를 확인하세요.');return result;
}
export function updateStrategyChanges({strategyChange=null,strategyChanges=null}={}){
 check(!(strategyChange&&strategyChanges),'단일 변경과 묶음 변경 중 하나를 사용하세요.');const changes=strategyChanges??(strategyChange?[strategyChange]:[]);
 check(Array.isArray(changes)&&changes.length<=2&&new Set(changes.map(c=>c.activationId)).size===changes.length,'서로 다른 두 운용까지 한 번에 변경할 수 있습니다.');
 check(changes.length<=1||changes.every(c=>Object.hasOwn(c,'graph')),'묶음 변경에는 고정한 그래프 원본을 지정하세요.');for(const change of changes)strategyChangePayload(change,0);return structuredClone(changes);
}
export async function stageStrategyChanges({db,changes,owner='local-preview-owner',stage=stageStrategyChange}){
 const results=[];for(const change of changes)results.push(await stage({db,change,owner}));return results;
}
export function validateUpdateTarget(target,node,{allowDisabled=false}={}){
 check(Number.isInteger(target?.pid)&&target.pid>0,'기존 서버의 프로세스를 확인하지 못했습니다.');
 check(path.resolve(target.executable).toLowerCase()===path.resolve(node).toLowerCase(),'이 설치 폴더의 서버가 아닙니다.');
 const command=target.commandLine.replaceAll('\\','/').toLowerCase(),expected=path.join(root,'scripts','preview.mjs').replaceAll('\\','/').toLowerCase();
 check(/(?:^|\s)"?scripts\/preview\.mjs"?(?:\s|$)/.test(command)||command.includes('"'+expected+'"'),'다른 실행 프로그램은 종료하지 않습니다.');
 check(allowDisabled||!command.includes('--no-runners'),'이관 확인용 서버는 이 창에서 재개하지 않습니다.');return target;
}

export function createServerUpdater({inspect,interrupt,waitStopped,snapshot,start,waitReady,beforeStart=null,afterReady=null,maintenance=work=>work(),persist=async()=>{}}){
 let state={phase:'READY',message:'현재 서버를 확인하고 있습니다.'},work=null;
 const set=async(phase,message,extra={})=>{state={...state,phase,message,...extra};await persist(state);};
 async function prepare(){if(work)return state;const target=await inspect();state={...state,target};if(target.appliedResult)state={...state,phase:'DONE',message:'변경 반영을 확인했습니다.',result:target.appliedResult};else if(target.version===EVENT_AUTOMATION_RUNNER_VERSION&&!target.requiresRestart&&!target.resumeRequired&&!afterReady)state={...state,phase:'CURRENT',message:'최신 실행 서버가 가동 중입니다.'};else state={...state,phase:'READY',message:afterReady?'모델 교체를 준비했습니다. 버튼을 누르면 서버 갱신과 모델 반영을 순서대로 진행합니다.':'갱신을 준비했습니다. 버튼을 누르면 기존 운용 설정으로 재개합니다.'};return state;}
 function begin(expected){
  if(work)return {accepted:false,state};check(state.phase==='READY'||state.phase==='ERROR','이미 처리한 요청입니다.');
  check(expected===state.target?.fingerprint,'화면을 새로 열어 현재 서버를 다시 확인하세요.');
  work=(async()=>{try{
   const target=await inspect();check(target.fingerprint===expected,'운용 설정이나 실행 서버가 바뀌었습니다. 화면을 새로 여세요.');
   if(target.appliedResult){await set('DONE','변경 반영을 확인했습니다.',{target,result:target.appliedResult});return;}
   let result={version:target.version,appUrl:target.appUrl};
   if(target.version!==EVENT_AUTOMATION_RUNNER_VERSION||target.requiresRestart||target.resumeRequired){
    await maintenance(async()=>{
    await set('STOPPING','기존 서버의 판단·주문 처리가 끝나기를 기다리고 있습니다.');await interrupt(target);await waitStopped(target);
    await set('BACKUP','서버가 종료됐습니다. 계좌·전략·체결 원장을 백업하고 있습니다.');const saved=await snapshot(target);
    if(beforeStart){await set('CHANGING','승인한 새 그래프를 저장해 첫 판단부터 적용하도록 준비합니다.');await beforeStart(target,saved);}
    await set('STARTING','백업을 완료했습니다. 같은 운용 설정으로 최신 서버를 시작합니다.',{backup:saved.file});await start(target,saved);result=await waitReady(target);
    });
   }
   if(afterReady){await set('CHANGING','새 모델을 저장하고 미확정 주문 대사 후 실행 반영을 기다립니다.');result={...result,...await afterReady(target)};}
   await set('DONE',afterReady?'새 AI 모델을 기존 봇에 반영했습니다. 계좌·총 배정액·보유 기록을 유지했습니다.':'최신 서버 갱신을 완료했습니다. 기존 운용 설정과 보유 기록을 유지했습니다.',{result});
  }catch(error){await set('ERROR',error.message,{failedPhase:state.phase,error:{code:error.code??null,errcode:error.errcode??null,errstr:error.errstr??null,sqlitePhase:error.sqlitePhase??null},...(error.cleanupError?{cleanupError:error.cleanupError}:{})});}finally{work=null;}})();
  return {accepted:true,state};
 }
 return {prepare,begin,status:()=>state,settled:()=>work};
}

export async function stopIdleLiveHost({db,owner='local-preview-owner',stop,reopen=null,now=Date.now,key='server-update-'+randomBytes(12).toString('hex')}={}){
 const resourceId='event-automation-owner',claim=await acquireClaim(db,{ownerId:owner,resourceId,key,fingerprint:sha({key}),baseRevision:0,nowMs:now(),leaseMs:120000});let failure=null;
 try{
  const pending=await db.prepare("SELECT count(*) AS n FROM live_automation_orders WHERE owner_id=? AND state NOT IN ('FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND')").bind(owner).first();
  check(pending.n===0,'미확정 주문의 체결 확인을 기다리고 있습니다.');
  await assertClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:now()});await stop();
  if(reopen)db=await reopen();
 }catch(error){failure=error;throw error;}finally{try{await releaseClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:now(),status:'CANCELLED'});}catch(error){if(!failure)throw error;failure.cleanupError={code:error.code??null,message:error.message};}}
}
async function waitProcessGone(pid){for(let attempt=0;attempt<240;attempt++){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}await delay(500);}throw new Error('기존 서버의 종료를 확인하고 있습니다. 두 번째 서버는 시작하지 않았습니다.');}

async function powershell(code){const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,maxBuffer:65536,timeout:20000});return JSON.parse(result.stdout.trim());}
export async function inspectServerProcess(port){return powershell(`$ErrorActionPreference='Stop';$c=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue);if($c.Count -ne 1){throw '서버 포트의 소유자를 확인하세요.'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c[0].OwningProcess);@{pid=[int]$p.ProcessId;executable=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress`);}
export async function consoleControl(pid,mode){check(Number.isInteger(pid)&&pid>0&&['Inspect','Interrupt'].includes(mode),'서버 프로세스를 확인하세요.');const code=await readFile(path.join(root,'scripts/server-update-console.ps1'),'utf8'),file=path.join(root,'.runtime/server-update-console-'+randomBytes(12).toString('hex')+'.json'),command='& {\n'+code+'\n} -TargetProcessId '+pid+' -Mode '+mode+" -OutputPath '"+file.replaceAll("'","''")+"'";try{await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,env:{...process.env,CJI_CONSOLE_RESULT:file}});return JSON.parse(await readFile(file,'utf8'));}finally{await rm(file,{force:true});}}
async function readHost(base){const r=await fetch(base+'/api/status',{signal:AbortSignal.timeout(30000)}),body=await r.json();check(r.ok&&body.storage==='server'&&typeof body.runners?.live?.running==='boolean','청지 실행 서버의 상태를 확인하세요.');return body;}
export function readServerUpdatePolicies(file){const database=openBackupDatabase(file);try{return database.prepare('SELECT body FROM live_automation_activations WHERE owner_id=? ORDER BY id').all('local-preview-owner').map(row=>JSON.parse(row.body));}finally{database.close();}}
async function openBrowser(url){const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});}

export function productionUpdater({strategyChange=null,strategyChanges=null,resumeTarget=null,restartRequired=false,beforeStart=null}={}){
 const changes=updateStrategyChanges({strategyChange,strategyChanges});strategyChange=changes[0]??null;
 const port=4905,base='http://127.0.0.1:'+port,node=path.join(root,'portable/node.exe'),dbFile=path.join(root,'.runtime/investment.sqlite');let stoppedTarget=resumeTarget?validateUpdateTarget(resumeTarget,node):null,child=null,staged=[];
 return createServerUpdater({
  maintenance:work=>withServerMaintenance(root,async()=>{
   // Keep an open writable SQLite handle across the last server writer's exit on Windows.
   const keeper=new DatabaseSync(dbFile);keeper.exec('PRAGMA busy_timeout=5000');keeper.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
   try{return await work();}finally{keeper.close();}
  }),
  async inspect(){
   if(stoppedTarget&&(!child||child.exitCode!==null)){try{process.kill(stoppedTarget.pid,0);throw new Error('기존 서버가 아직 종료되지 않았습니다.');}catch(error){if(error.code!=='ESRCH')throw error;}return {...stoppedTarget,resumeRequired:true};}
   const target=validateUpdateTarget(await inspectServerProcess(port),node),host=await readHost(base),policies=readServerUpdatePolicies(dbFile);check(host.runners.disabled===false&&host.runners.live.running,'현재 가동 중인 실전 서버를 확인하세요.');
   let requiresRestart=restartRequired||changes.length>1,strategyReview=null,profileId=null,appliedResult=null;const strategyReviews=[],strategyScopes=[];for(const change of changes){const r=await fetch(base+'/api/workspace/automated-trading/strategy?activationId='+change.activationId);check(r.ok,'운용 변경 대상을 확인하세요.');const current=await r.json();profileId??=current.policy.config.profileId;strategyScopes.push({profileId:current.policy.config.profileId,activationId:change.activationId,graphHash:change.graphHash});requiresRestart ||= change.perOrderLimit!==undefined&&current.strategyUpdates?.perOrderLimit!==true;strategyReviews.push({...liveChangeReview({name:change.modelName??current.manifest.data.name,before:current.policy.config,after:{...current.policy.config,...change},changes:change.graph?labGraphChanges(current.manifest.data.strategyPlan.graph,change.graph):[]}),...(change.summary?{summary:change.summary}:{})});}strategyReview=strategyReviews[0]??null;
   const version=host.runners.live.contractVersion;check(/^canonical-live-event-runner-v[1-9]\d*$/.test(version??''),'지원하는 실행 서버 버전을 확인하세요.');
   let shutdownMode='CONSOLE';if(version!==EVENT_AUTOMATION_RUNNER_VERSION||requiresRestart){try{await consoleControl(target.pid,'Inspect');}catch{check(supportsLiveStrategyUpdate(version),'콘솔 종료가 가능한 실행 서버를 확인하세요.');shutdownMode='IDLE_OWNER_FENCE';}}
   const disk=await statfs(path.dirname(dbFile)),database=openBackupDatabase(dbFile);let bytes;try{bytes=database.prepare('PRAGMA page_count').get().page_count*database.prepare('PRAGMA page_size').get().page_size;for(const change of changes.filter(c=>c.expectedPositions)){const a=policies.find(p=>p.id===change.activationId);if(a?.config.graphHash===change.graphHash)continue;const row=database.prepare('SELECT body FROM live_automation_accounts WHERE owner_id=? AND account_id=?').get('local-preview-owner',a?.config.accountId??''),positions=row?JSON.parse(row.body).positions?.[change.activationId]??{}:{};check(sha(positions)===sha(change.expectedPositions),'승인 준비 이후 보유 수량이나 원가가 바뀌었습니다. 변경안을 다시 준비하세요.');}}finally{database.close();}
   check(disk.bavail*disk.bsize>bytes+64*1024*1024,'백업을 위한 저장 공간이 부족합니다. 기존 서버를 유지합니다.');
   const applied=[];for(const change of changes){const a=policies.find(p=>p.id===change.activationId),alreadyApplied=a?.lastStrategyUpdate?.id==='strategy-update-'+change.idempotencyKey&&a.lastStrategyUpdate.status==='APPLIED'&&a.config.graphHash===change.graphHash&&(change.perOrderLimit===undefined||a.config.perOrderLimit===change.perOrderLimit);if(alreadyApplied)applied.push({activationId:a.id,graphHash:a.config.graphHash,perOrderLimit:a.config.perOrderLimit,appUrl:base+operationsView(a.config.profileId),receipt:{id:a.lastStrategyUpdate.id,status:a.lastStrategyUpdate.status,appliedAt:a.lastStrategyUpdate.appliedAt}});check(a?.status==='ENABLED'&&(a.config.graphHash===change.expectedGraphHash||alreadyApplied),'운용 전략이 바뀌었습니다. 교체 설정을 다시 준비하세요.');if(!Object.hasOwn(change,'graph')){const r=await fetch(base+'/api/workspace/minds'),catalog=await r.json(),m=catalog.minds.find(m=>m.manifest?.id===change.targetManifestId)?.manifest;check(r.ok&&m&&sha(m)===change.targetDocumentSha,'교체할 AI 모델이 변경됐습니다. 교체 설정을 다시 준비하세요.');}}
   if(changes.length&&applied.length===changes.length)appliedResult=changes.length===1?applied[0]:{changes:applied,appUrl:base+operationsView(profileId)};
   return {...target,version,requiresRestart,shutdownMode,profileId,strategyReview,strategyReviews,strategyScopes,appliedResult,...(strategyChange?{strategyChange,strategyChanges:changes}:{}),policyFingerprint:fingerprint(policies),fingerprint:sha({pid:target.pid,version,policies:fingerprint(policies),changes}),activeCount:policies.filter(p=>p.status==='ENABLED').length,appUrl:base+operationsView(profileId)};
  },
  async interrupt(target){
   if(stoppedTarget)return;const current=validateUpdateTarget(await inspectServerProcess(port),node);check(current.pid===target.pid,'기존 서버가 바뀌었습니다. 종료 요청을 보내지 않았습니다.');
   if(target.shutdownMode==='IDLE_OWNER_FENCE'){
    let local=await openLocalDatabase(dbFile),stopped=false;
    try{for(let i=0;i<240;i++){try{await stopIdleLiveHost({db:local.db,stop:async()=>{const latest=validateUpdateTarget(await inspectServerProcess(port),node);check(latest.pid===target.pid,'서버가 바뀌어 종료하지 않았습니다.');process.kill(target.pid);await waitProcessGone(target.pid);stoppedTarget=target;},reopen:async()=>{local=await reopenLocalDatabase(local,dbFile);return local.db;}});stopped=true;break;}catch(error){if(!['IN_PROGRESS','CLAIM_CONFLICT'].includes(error.code)&&!error.message.startsWith('미확정 주문'))throw error;await delay(500);}}check(stopped,'실행 중인 판단과 주문의 종료를 기다리고 있습니다. 기존 서버를 유지했습니다.');}finally{local?.close();}
   }else await consoleControl(target.pid,'Interrupt');stoppedTarget=target;
  },
  async waitStopped(target){await waitProcessGone(target.pid);},
  async snapshot(target){
   // Keep WAL shared memory writable across the asynchronous backup after the last server writer exits.
   const dir=path.join(root,'.runtime/backups');await mkdir(dir,{recursive:true});const file=path.join(dir,'server-update-'+new Date().toISOString().replaceAll(':','-')+'-'+randomBytes(4).toString('hex')+'.sqlite'),database=new DatabaseSync(dbFile);database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
   try{check(database.prepare('PRAGMA quick_check').get().quick_check==='ok','원장의 무결성을 확인하지 못했습니다.');await backup(database,file,{rate:10000});}finally{database.close();}
   const copy=openBackupDatabase(file);try{check(copy.prepare('PRAGMA quick_check').get().quick_check==='ok','백업 원장의 무결성을 확인하지 못했습니다.');const policies=copy.prepare('SELECT body FROM live_automation_activations WHERE owner_id=?').all('local-preview-owner').map(r=>JSON.parse(r.body));check(fingerprint(policies)===target.policyFingerprint,'종료 대기 중 운용 설정이 바뀌었습니다. 백업은 보존했으며 자동 재개는 하지 않았습니다.');}finally{copy.close();}return {file};
  },
  async start(){
   try{await readHost(base);throw new Error('같은 포트의 다른 실행기가 있어 재시작하지 않았습니다.');}catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
   const log=openSync(path.join(root,'.runtime/server-update-runtime.log'),'a');try{child=spawn(node,['--max-old-space-size=384','--env-file-if-exists=.env','scripts/preview.mjs'],{cwd:root,env:{...process.env,KEYNES_PREVIEW_PORT:String(port),KEYNES_PREVIEW_DB:dbFile,KEYNES_RUNNERS_DISABLED:'0',KEYNES_MIND_PAPER_RUNNER:'0',BROKER_NETWORK_READY:'true'},stdio:['ignore',log,log],windowsHide:true,detached:true});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();}finally{closeSync(log);}
  },
  async waitReady(target){for(let attempt=0;attempt<120;attempt++){if(child?.exitCode!==null)throw new Error('새 서버가 종료됐습니다. .runtime/server-update-runtime.log를 확인하세요.');try{const host=await readHost(base);check(host.runners.live.contractVersion===EVENT_AUTOMATION_RUNNER_VERSION&&host.runners.live.running,'새 실행 서버를 확인하고 있습니다.');const policies=readServerUpdatePolicies(dbFile),normalized=policies.map(p=>{const s=staged.find(s=>p.id===s.policy.id&&p.config.graphHash===s.update.config.graphHash&&sha(p.config)===sha(s.update.config));return s?{...p,config:s.policy.config}:p;});check(fingerprint(normalized)===target.policyFingerprint,'재개한 운용 설정이 다릅니다. 운용 화면을 확인하세요.');return {version:host.runners.live.contractVersion,appUrl:target.appUrl,activeCount:target.activeCount};}catch(error){if(error.message.includes('운용 설정이 다릅니다'))throw error;}await delay(500);}throw new Error('새 서버의 응답을 기다리고 있습니다. 다시 실행하지 말고 운용 화면을 확인하세요.');},
  ...(beforeStart||strategyChange&&Object.hasOwn(strategyChange,'graph')?{beforeStart:async(target,saved)=>{await beforeStart?.(target,saved);if(strategyChange&&Object.hasOwn(strategyChange,'graph')){const local=await openLocalDatabase(dbFile);try{staged=await stageStrategyChanges({db:local.db,changes});}finally{local.close();}}}}:{}),
  ...(strategyChange?{afterReady:async(target)=>{
   if(!staged.length)for(const change of changes){const w=await(await fetch(base+'/api/workspace?view=studio')).json(),payload=strategyChangePayload(change,w.workspace.revision),r=await fetch(base+'/api/workspace/automated-trading/update-strategy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),value=await r.json();check(r.ok,value.message??'모델 변경 요청을 확인하세요.');}
   for(let i=0;i<180;i++){const policies=readServerUpdatePolicies(dbFile),applied=[];for(const change of changes){const a=policies.find(p=>p.id===change.activationId);check(a?.status==='ENABLED','봇 상태가 변경됐습니다. 저장된 변경 요청과 운용 화면을 확인하세요.');if(a.lastStrategyUpdate?.id==='strategy-update-'+change.idempotencyKey&&a.lastStrategyUpdate.status==='APPLIED'){check(a.config.graphHash===change.graphHash&&(change.perOrderLimit===undefined||a.config.perOrderLimit===change.perOrderLimit),'적용된 그래프와 1회 주문 한도를 확인하세요.');applied.push({graphHash:a.config.graphHash,activationId:a.id});}}if(applied.length===changes.length)return {...(changes.length===1?applied[0]:{changes:applied}),appUrl:target.appUrl};await delay(1000);}
   throw Error('모델 변경은 저장됐고 실행 반영을 기다리고 있습니다. 미확정 주문과 운용 상태를 확인하세요.');
  }}:{}),
  persist:state=>writeFile(path.join(root,strategyChange?'.runtime/server-model-switch-state.json':'.runtime/server-update-state.json'),JSON.stringify(state,null,2)),
 });
}

export async function startUpdateAssistant({port=4932,updater=productionUpdater(),token=randomBytes(32).toString('hex'),mobileOrigin=null}={}){
 mobileOrigin=validateMobileOrigin(mobileOrigin);const mobilePath='/operation-change/';
 let origin='http://127.0.0.1:'+port;const authorized=req=>{const raw=Buffer.from(req.headers.authorization??''),wanted=Buffer.from('Bearer '+token);return raw.length===wanted.length&&timingSafeEqual(raw,wanted);};
 const server=http.createServer(async(req,res)=>{try{
  const requestOrigin=previewRequestOrigin(req,new URL(origin).port,mobileOrigin),remote=requestOrigin===mobileOrigin,url=new URL(req.url,requestOrigin);
  if(remote&&url.pathname.startsWith(mobilePath))url.pathname='/'+url.pathname.slice(mobilePath.length);
  const state=()=>{const value=structuredClone(updater.status());if(remote)for(const field of [value.target,value.result])if(field?.appUrl){const app=new URL(field.appUrl,origin);field.appUrl=requestOrigin+app.pathname+app.search+app.hash;}return value;};
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; base-uri 'self'");
  if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end((await readFile(path.join(root,'scripts/server-update-view.html'),'utf8')).replace('__CONTROL_TOKEN__',token).replace('__BASE_PATH__',remote?mobilePath:'/'));return;}
  if(req.method==='GET'&&['/view.mjs','/view.css','/theme.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(await readFile(path.join(root,url.pathname==='/view.css'?'dist/style.css':url.pathname==='/theme.css'?'dist/ui/tailwind.css':'scripts/server-update/view.mjs')));return;}
  if(req.method==='GET'&&url.pathname==='/identity'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({application:'cji-server-update-assistant'}));return;}
  check(authorized(req),'갱신 아이콘으로 이 창을 다시 여세요.');res.setHeader('Content-Type','application/json');
  if(req.method==='GET'&&url.pathname==='/status'){res.end(JSON.stringify(state()));return;}
  if(req.method==='GET'&&url.pathname==='/refresh'){await updater.prepare();res.end(JSON.stringify(state()));return;}
  if(req.method==='POST'&&url.pathname==='/update'){
   check(req.headers.origin===requestOrigin&&req.headers['sec-fetch-site']!=='cross-site'&&req.headers['content-type']==='application/json','이 갱신 창의 버튼으로 실행하세요.');let raw='';for await(const chunk of req){raw+=chunk;check(Buffer.byteLength(raw)<=2000,'요청 범위를 줄이세요.');}const body=JSON.parse(raw);check(body.action==='UPDATE_AND_RESUME_CURRENT_SERVER'&&Object.keys(body).every(k=>['action','expected'].includes(k)),'갱신 요청을 확인하세요.');const result=updater.begin(body.expected);res.statusCode=202;res.end(JSON.stringify(result));return;
  }res.statusCode=404;res.end('{}');
 }catch(error){res.statusCode=409;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 try{await updater.prepare();}catch(error){server.close();throw error;}
 return {server,url:origin+'/',mobileUrl:mobileOrigin?mobileOrigin+mobilePath:null,token,updater};
}

export async function publishMobileUpdate(assistant){
 check(assistant.mobileUrl,'비공개 모바일 주소를 먼저 설정하세요.');
 const tailscale=path.join(process.env.LOCALAPPDATA,'ChungJi-Remote/Tailscale/tailscale.exe'),host=new URL(assistant.mobileUrl).host+':443',route='/operation-change/';
 const read=async()=>JSON.parse((await run(tailscale,['serve','status','--json'],{windowsHide:true,timeout:15000})).stdout);
 const before=await read(),handlers=before.Web?.[host]?.Handlers;
 check(handlers?.['/']?.Proxy==='http://127.0.0.1:4905','기존 모바일 앱 연결을 확인하세요.');
 await run(tailscale,['serve','--bg','--yes','--set-path='+route,assistant.url],{windowsHide:true,timeout:15000});
 const after=await read();check(JSON.stringify(after.Web?.[host]?.Handlers?.['/'])===JSON.stringify(handlers['/'])&&new URL(after.Web?.[host]?.Handlers?.[route]?.Proxy??'http://unconfigured').href===assistant.url,'모바일 승인 연결을 확인하세요.');
 const target=assistant.updater.status().target,change=target?.strategyChange;
 if(change){const file=path.join(root,'dist/data/pending-operation-change.json');await writeFile(file+'.tmp',JSON.stringify({profileId:target.profileId,activationId:change.activationId,graphHash:change.graphHash,...(target.strategyScopes?.length>1?{changes:target.strategyScopes}:{}),url:assistant.mobileUrl,localUrl:assistant.url}));await rename(file+'.tmp',file);}
 return assistant.mobileUrl;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await mkdir(path.join(root,'.runtime'),{recursive:true});const sessionFile=path.join(root,'.runtime/server-update-session.json');
 try{
  let existing=false;try{const r=await fetch('http://127.0.0.1:4932/identity',{signal:AbortSignal.timeout(1500)});existing=r.ok&&(await r.json()).application==='cji-server-update-assistant';}catch{}
  if(existing){const session=JSON.parse(await readFile(sessionFile,'utf8'));if(process.env.KEYNES_NO_BROWSER!=='1')await openBrowser(session.url);}
  else{let mobileOrigin=null;try{mobileOrigin=JSON.parse(await readFile(path.join(root,'.runtime/mobile-access.json'),'utf8')).origin;}catch(error){if(error.code!=='ENOENT')throw error;}const assistant=await startUpdateAssistant({mobileOrigin});if(mobileOrigin)await publishMobileUpdate(assistant);await writeFile(sessionFile,JSON.stringify({url:assistant.url,mobileUrl:assistant.mobileUrl,pid:process.pid,createdAt:new Date().toISOString()}));if(process.env.KEYNES_NO_BROWSER!=='1')await openBrowser(assistant.url);}
 }catch(error){await writeFile(path.join(root,'.runtime/server-update-error.txt'),error.message+'\n');process.exitCode=1;}
}
