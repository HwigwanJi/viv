import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {mkdir,appendFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {acquireHostLock,processAlive,serverMaintenance,writeHostState} from './preview-lifecycle.mjs';
import {inspectServerProcess,validateUpdateTarget,stopIdleLiveHost} from './server-update-assistant.mjs';
import {openLocalDatabase,reopenLocalDatabase} from '../server/local-db.mjs';
import {withServerMaintenance} from './preview-lifecycle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SERVER_HOST_VERSION='cji-server-host-v1';

export function createServerSupervisor({inspect,start,recover=null,isAlive=processAlive,maintenance=async()=>null,now=Date.now,persist=async()=>{},record=async()=>{},baseDelayMs=2000,stableMs=60000,unresponsiveMs=60000}={}){
 let pid=null,startedAt=0,attempts=0,nextStartAt=0,previous=null,pending=null,unhealthySince=null,nextRecoveryAt=0;
 async function state(phase,extra={}){const value={version:SERVER_HOST_VERSION,hostPid:process.pid,serverPid:pid,phase,checkedAt:new Date(now()).toISOString(),attempts,...extra};await persist(value);const signature=JSON.stringify([phase,pid,extra.code??null]);if(signature!==previous){previous=signature;await record({...value,kind:phase});}return value;}
 async function tick(){
  if(await maintenance())return state('MAINTENANCE');
  const current=await inspect();
  if(current.kind==='HEALTHY'){
   unhealthySince=null;
   if(pid!==current.pid){pid=current.pid;startedAt=now();await record({kind:'SERVER_ADOPTED',serverPid:pid});}
   if(now()-startedAt>=stableMs){attempts=0;nextStartAt=0;}
   return state('HEALTHY',{runnerRunning:current.runnerRunning});
  }
  if(current.kind==='UNRESPONSIVE'&&Number.isInteger(current.pid)&&recover){
   if(pid!==current.pid){pid=current.pid;unhealthySince=null;}
   unhealthySince??=now();
   if(now()-unhealthySince>=unresponsiveMs&&now()>=nextRecoveryAt){
    nextRecoveryAt=now()+30000;await state('RECOVERING_UNRESPONSIVE');
    try{await recover(pid);unhealthySince=null;return state('WAIT_PROCESS_EXIT');}
    catch(error){return state('RECOVERY_WAIT',{code:error.code??'RECOVERY_BLOCKED'});}
   }
  // An unavailable identity lookup proves neither recovery nor a different owner.
  }else if(!(current.kind==='PORT_CONFLICT'&&current.code==='PROCESS_IDENTITY_REQUIRED'&&pid&&isAlive(pid)))unhealthySince=null;
  if(current.kind!=='ABSENT')return state(current.kind,{code:current.code??null});
  // A closing or unresponsive process retains its execution ownership until it exits.
  if(pid&&isAlive(pid))return state('WAIT_PROCESS_EXIT');
  if(pid){await record({kind:'SERVER_EXIT_OBSERVED',serverPid:pid});pid=null;}
  if(now()<nextStartAt)return state('BACKOFF',{retryAt:new Date(nextStartAt).toISOString()});
  attempts++;nextStartAt=now()+Math.min(60000,baseDelayMs*2**Math.min(attempts-1,6));
  try{pid=await start();startedAt=now();return state('STARTING');}
  catch(error){return state('START_FAILED',{code:error.code??'SPAWN_FAILED'});}
 }
 return {tick(){return pending??=(async()=>{try{return await tick();}finally{pending=null;}})();}};
}

async function portFree(port){
 const probe=net.createServer();return new Promise((resolve,reject)=>{probe.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});
}
export function createHostInspector({port=4905,node=path.join(root,'portable/node.exe'),fetchImpl=fetch,findProcess=inspectServerProcess,free=portFree,runnersDisabled=false}={}){
 return async()=>{
  const disabled=typeof runnersDisabled==='function'?runnersDisabled():runnersDisabled;
  let body;
  try{const response=await fetchImpl('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(10000)});body=await response.json();if(!response.ok||body.storage!=='server'||body.runners?.disabled!==disabled||typeof body.runners.live?.running!=='boolean'||disabled&&body.runners.live.running)return {kind:'PORT_CONFLICT',code:'UNEXPECTED_APPLICATION'};}
  catch(error){if(await free(port))return {kind:'ABSENT'};try{const target=validateUpdateTarget(await findProcess(port),node,{allowDisabled:true});return {kind:'UNRESPONSIVE',pid:target.pid,code:error.name??'HEALTH_FAILED'};}catch{return {kind:'PORT_CONFLICT',code:'PROCESS_IDENTITY_REQUIRED'};}}
  try{const target=validateUpdateTarget(await findProcess(port),node,{allowDisabled:true});return {kind:'HEALTHY',pid:target.pid,runnerRunning:body.runners.live.running};}
  catch{return {kind:'PORT_CONFLICT',code:'PROCESS_IDENTITY_REQUIRED'};}
 };
}
export async function readServerHostConfig(directory=root){
 try{const config=JSON.parse(await readFile(path.join(directory,'.runtime/server-host-config.json'),'utf8'));if(!['REVIEW_ONLY','LIVE'].includes(config.mode))throw Error('SERVER_HOST_MODE');if(Object.hasOwn(config,'activationIds')&&(!Array.isArray(config.activationIds)||!config.activationIds.length||config.activationIds.some(id=>typeof id!=='string'||!/^live-[a-zA-Z0-9-]+$/.test(id))))throw Error('SERVER_HOST_ACTIVATIONS');return config;}
 catch(e){if(e.code==='ENOENT')return {mode:'LIVE'};throw e;}
}
export async function readServerHostMode(directory=root){return (await readServerHostConfig(directory)).mode;}
export async function runServerHost(){
 await mkdir(path.join(root,'.runtime'),{recursive:true});const release=await acquireHostLock(root),port=4905,node=path.join(root,'portable/node.exe');let stopping=false;
 let runnersDisabled=await readServerHostMode()==='REVIEW_ONLY';
 const record=body=>appendFile(path.join(root,'.runtime/server-host-lifecycle.ndjson'),JSON.stringify({at:new Date().toISOString(),hostPid:process.pid,...body})+'\n');
 const supervisor=createServerSupervisor({inspect:createHostInspector({port,node,runnersDisabled:()=>runnersDisabled}),maintenance:()=>serverMaintenance(root),persist:value=>writeHostState(path.join(root,'.runtime/server-host-state.json'),{...value,port,runnersDisabled}),record,
  recover:pid=>withServerMaintenance(root,async()=>{
   let local=await openLocalDatabase(path.join(root,'.runtime/investment.sqlite'));
   try{await stopIdleLiveHost({db:local.db,stop:async()=>{const current=validateUpdateTarget(await inspectServerProcess(port),node,{allowDisabled:runnersDisabled});if(current.pid!==pid)throw Object.assign(Error('Server process changed'),{code:'PROCESS_CHANGED'});process.kill(pid);for(let i=0;i<120&&processAlive(pid);i++)await delay(500);if(processAlive(pid))throw Object.assign(Error('Waiting for process exit'),{code:'PROCESS_EXIT_PENDING'});await record({kind:'UNRESPONSIVE_HOST_STOPPED',serverPid:pid});},reopen:async()=>{local=await reopenLocalDatabase(local,path.join(root,'.runtime/investment.sqlite'));return local.db;}});}finally{local?.close();}
  }),
  async start(){
   const unlock=await acquireHostLock(root,'maintenance');let log,child;
   try{
   if(await serverMaintenance(root))throw Object.assign(new Error('Maintenance in progress'),{code:'MAINTENANCE'});
   log=openSync(path.join(root,'.runtime/server-update-runtime.log'),'a');
   try{child=spawn(node,['--max-old-space-size=384','--env-file-if-exists=.env','scripts/preview.mjs',...(runnersDisabled?['--no-runners']:[])],{cwd:root,env:{...process.env,KEYNES_PREVIEW_PORT:String(port),KEYNES_PREVIEW_DB:path.join(root,'.runtime/investment.sqlite'),KEYNES_RUNNERS_DISABLED:runnersDisabled?'1':'0',KEYNES_MIND_PAPER_RUNNER:'0'},stdio:['ignore',log,log],windowsHide:true,detached:true});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});}
   finally{closeSync(log);}
   child.once('exit',(code,signal)=>record({kind:'SERVER_EXIT',serverPid:child.pid,code,signal}).catch(()=>{}));child.unref();return child.pid;
   }finally{await unlock();}
  }});
 process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
 try{await record({kind:'HOST_STARTED',automaticRestart:true,port,version:SERVER_HOST_VERSION});while(!stopping){runnersDisabled=await readServerHostMode()==='REVIEW_ONLY';await supervisor.tick();await delay(5000);}}
 finally{await release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runServerHost().catch(error=>{console.error('Server host:',error.code??error.message);process.exitCode=1;});
