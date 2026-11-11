import net from 'node:net';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';

export function processAlive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
export async function acquireHostLock(root,kind='host'){
 const key=createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0,24),name=process.platform==='win32'?'\\\\.\\pipe\\cji-'+kind+'-'+key:path.join(root,'.runtime','cji-'+kind+'.sock'),server=net.createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(name,resolve);});
 return ()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
export async function writeHostState(file,value){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}finally{await rm(temp,{force:true});}}
export async function serverMaintenance(root,{now=Date.now,isAlive=processAlive}={}){
 try{const value=JSON.parse(await readFile(path.join(root,'.runtime/server-host-maintenance.json'),'utf8'));return Number.isInteger(value.pid)&&value.pid>0&&Date.parse(value.expiresAt)>now()&&isAlive(value.pid)?value:null;}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function withServerMaintenance(root,work){
 await mkdir(path.join(root,'.runtime'),{recursive:true});const release=await acquireHostLock(root,'maintenance'),file=path.join(root,'.runtime/server-host-maintenance.json'),id=randomUUID();let timer,pending=Promise.resolve();
 try{const renew=()=>pending=pending.then(()=>writeHostState(file,{id,pid:process.pid,expiresAt:new Date(Date.now()+120000).toISOString()}));await renew();timer=setInterval(()=>renew().catch(()=>{}),30000);timer.unref();return await work();}
 finally{clearInterval(timer);try{await pending.catch(()=>{});await rm(file,{force:true});}finally{await release();}}
}

/** Fence every runner before waiting for any drain; close storage last. */
export function createPreviewShutdown({runners=[],server,closeDatabase,exit}={}){
 let pending=null;
 return ()=>pending??=(async()=>{
  const drains=runners.filter(Boolean).map(runner=>runner.stop());
  const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await Promise.all([...drains,closed]);
  await closeDatabase();exit(0);
 })();
}
