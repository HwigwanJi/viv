import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';

const loopback=port=>'http://127.0.0.1:'+port;
const usablePort=port=>Number.isInteger(port)&&port>=1024&&port<=65535&&port!==4905;

function canBind(port){
  return new Promise((resolve,reject)=>{
    const probe=createServer();
    probe.once('error',error=>{
      if(['EADDRINUSE','EACCES'].includes(error.code))resolve(false);
      else reject(error);
    });
    probe.listen({host:'127.0.0.1',port,exclusive:true},()=>probe.close(error=>error?reject(error):resolve(true)));
  });
}

export async function selectSelfHostPort(port,setupId,allowFallback){
  if(!usablePort(port)||!(/^[a-f0-9]{32}$/).test(setupId))throw new Error('Invalid VIV port or installation ID.');
  if(await canBind(port))return {port,state:'free'};
  const page=await fetch(loopback(port)+'/',{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(1500)}).catch(()=>null);
  const owner=page?.ok?page.headers.get('X-VIV-Setup'):null;
  if(owner===setupId)return {port,state:'existing'};
  for(let offset=1;offset<=32;offset++){
    const alternative=port+offset>65535?4317+(port+offset-65536):port+offset;
    if(usablePort(alternative)&&await canBind(alternative)){
      return allowFallback?{port:alternative,state:'free',previousPort:port}:{port,state:'occupied',alternative,otherViv:/^[a-f0-9]{32}$/.test(owner)};
    }
  }
  return {port,state:'occupied',otherViv:/^[a-f0-9]{32}$/.test(owner)};
}

export const boundMcpUrl=(port,setupId)=>loopback(port)+'/mcp?installation='+setupId;

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [port,setupId,fallback]=process.argv.slice(2);
  console.log(JSON.stringify(await selectSelfHostPort(Number(port),setupId,fallback==='fallback')));
}
