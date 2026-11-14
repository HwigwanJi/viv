import {createHourlyLearningRunner} from '../server/hourly-model-learning.mjs';
import {trainHourlyModel} from '../server/hourly-model-trainer.mjs';
import {createLocalEventDatasetBinding} from '../server/local-event-datasets.mjs';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {promisify} from 'node:util';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { handleAPI } from '../server/api.mjs';
import { openLocalDatabase } from '../server/local-db.mjs';
import { handleMcp } from '../server/mcp.mjs';
import {createPreviewRunners} from './preview-runners.mjs';
import {createPreviewShutdown,withServerMaintenance,writeHostState} from './preview-lifecycle.mjs';
import {getLiveAutomation} from '../server/live-automation-store.mjs';
import {initializeAppNotifications,createAppPushDispatcher,publishAppNotification} from '../server/app-notifications.mjs';
import {loadPushKeys} from './app-push.mjs';
import webpush from 'web-push';
import {initializeLiveAutomationEventIndexes} from '../server/live-automation-store.mjs';
import {validateMobileOrigin,privateMobileRouteStatus,verifyMobileInstallAddress,previewRequestOrigin} from './preview-origin.mjs';
import {readServerHostConfig} from './server-host.mjs';
import {createBrokerageReportRunner} from '../server/brokerage-reports.mjs';
import {readAutomationBook} from '../server/automated-trading.mjs';
const selfHostId=process.env.VIV_SELF_HOST_ID;
const runFile=promisify(execFile);
const tailCli=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Tailscale','tailscale.exe')
  :'/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const readMobileOrigin=async()=>validateMobileOrigin(JSON.parse(await readFile('.runtime/mobile-access.json','utf8')).origin);
async function installConnection(){
  if(!selfHostId)return {status:'unsupported'};
  try{
    const origin=await readMobileOrigin();
    if(!origin)return {status:'needs-setup'};
    const {stdout}=await runFile(existsSync(tailCli)?tailCli:'tailscale',['serve','status','--json'],{
      timeout:3000,windowsHide:true,maxBuffer:65536,env:{...process.env,TAILSCALE_BE_CLI:'1'}
    });
    const route=privateMobileRouteStatus(JSON.parse(stdout),origin,'http://127.0.0.1:'+previewPort);
    if(route==='public')return {status:'public-route'};
    if(route==='conflict')return {status:'installation-mismatch'};
    if(route!=='ready')return {status:'needs-setup'};
    const result=await verifyMobileInstallAddress(origin,selfHostId);
    return result.status==='unreachable'?{status:'temporarily-unreachable'}:result;
  }catch(error){return {status:error.code==='ENOENT'?'needs-setup':'temporarily-unreachable'};}
}
let mobileOrigin=null;
if(!selfHostId){
  try{mobileOrigin=await readMobileOrigin();}catch(error){if(error.code!=='ENOENT')throw error;}
}
const localDatabase=await openLocalDatabase(process.env.KEYNES_PREVIEW_DB?path.resolve(process.env.KEYNES_PREVIEW_DB):undefined);
const previewPort=Number(process.env.KEYNES_PREVIEW_PORT||4317);
const env={BROKER_VAULT_KEY:process.env.BROKER_VAULT_KEY,BROKER_NETWORK_READY:process.env.BROKER_NETWORK_READY,BROKER_EGRESS_IP:process.env.BROKER_EGRESS_IP,TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY,KIS_APP_KEY:process.env.KIS_APP_KEY,KIS_APP_SECRET:process.env.KIS_APP_SECRET,KIS_ACCESS_TOKEN:process.env.KIS_ACCESS_TOKEN,MARKET_DATA_PROVIDER:process.env.MARKET_DATA_PROVIDER,COMPARISON_MEMBERS_PER_RUN:process.env.COMPARISON_MEMBERS_PER_RUN,DB:localDatabase.db};
env.EVENT_DATASETS=createLocalEventDatasetBinding();
if(await localDatabase.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='live_automation_events'").bind().first())await initializeLiveAutomationEventIndexes(localDatabase.db);
await initializeAppNotifications(localDatabase.db);
env.APP_PUSH_KEYS=await loadPushKeys(process.cwd());
env.APP_NOTIFY=(owner,notification)=>publishAppNotification({db:localDatabase.db,owner,notification});
const appPush=createAppPushDispatcher({db:localDatabase.db,keys:env.APP_PUSH_KEYS,subject:mobileOrigin??'https://chungji.local/',send:webpush.sendNotification.bind(webpush)});
const hostConfig=previewPort===4905?await readServerHostConfig():{};
const runners=createPreviewRunners({env,url:'http://127.0.0.1:'+previewPort,approvedActivationIds:hostConfig.activationIds??null});
if(previewPort===4905)env.START_APPROVED_LIVE=async(owner,ids)=>{
 if(owner!=='local-preview-owner')throw Error('APPROVAL_OWNER');
 for(const id of ids){const p=await getLiveAutomation({db:env.DB,owner,activationId:id});if(p?.status!=='ENABLED')throw Error('APPROVED_ACTIVATION_REQUIRED');}
 const previous=runners.approvedIds(),activationIds=runners.runnersDisabled?[...new Set([...(previous??[]),...ids])]:previous?[...new Set([...previous,...ids])]:null;
 return withServerMaintenance(process.cwd(),async()=>{
  await writeHostState('.runtime/server-host-config.json',{mode:'LIVE',...(activationIds?{activationIds}:{}),updatedAt:new Date().toISOString(),reason:'Canonical human approval of the pinned activation; legacy stopped scope is preserved.'});
  const result=runners.enableApprovedLive(ids);brokerageReports.start();return result;
 });
};
env.TRAIN_HOURLY_MODEL=trainHourlyModel;
const hourlyLearning=createHourlyLearningRunner({env,enabled:!runners.runnersDisabled});
env.HOURLY_LEARNING_WAKE=()=>hourlyLearning.wake();
env.HOURLY_LEARNING_STATUS=()=>hourlyLearning.status();
const brokerageReports=createBrokerageReportRunner({env,enabled:()=>!runners.runnersDisabled,bookLoader:readAutomationBook});
env.BROKERAGE_REPORT_STATUS=()=>brokerageReports.status();
const root = path.resolve('dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.apk':'application/vnd.android.package-archive'};
const installationMismatchPage=`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VIV 설치 주소 확인</title>
<link rel="stylesheet" href="/ui/tailwind.css"><link rel="stylesheet" href="/style.css"></head>
<body><main class="content"><section class="studio-sheet"><div class="studio-sheet-head">
<h1>다른 VIV 설치에서 열린 링크</h1></div><div class="studio-sheet-body">
<p>이 링크를 발급한 VIV가 현재 주소에서 응답하지 않습니다. 원래 설치 폴더에서 서버를 다시 시작한 뒤 이 링크를 다시 여세요.</p>
<p>새 폴더로 기록을 복원했다면 새 VIV의 AI 연결에서 같은 기록을 조회해 새 링크를 받으세요.</p>
<a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#기존-기록-복원" target="_blank" rel="noopener noreferrer">설치 복구 안내 (새 탭)</a>
</div></section></main></body></html>`;
const server = http.createServer(async (req,res)=>{
  try {
    let requestOrigin;
    try{
      const origin=selfHostId&&req.headers.host?.endsWith('.ts.net')
        ? await readMobileOrigin()
        : mobileOrigin;
      requestOrigin=previewRequestOrigin(req,previewPort,origin);
    }catch{res.writeHead(403);res.end('Unrecognized app host');return;}
    if(selfHostId)res.setHeader('X-VIV-Setup',selfHostId);
    const requestUrl=new URL(req.url,requestOrigin),pathname=requestUrl.pathname;
    if(selfHostId&&requestOrigin.startsWith('https:')&&pathname==='/install.html'&&req.method==='HEAD'){
      res.setHeader('X-VIV-Desktop-Port',String(previewPort));
    }
    if(pathname==='/mcp'&&requestUrl.searchParams.has('installation')&&(!selfHostId||requestUrl.searchParams.get('installation')!==selfHostId)){
      res.writeHead(409,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:{code:'VIV_INSTALLATION_MISMATCH',message:'MCP 주소가 이 VIV 설치와 일치하지 않습니다. 새 폴더에 기록을 복원했다면 새 VIV 앱의 설정 → 서비스 연결 → AI 연결·복구 (MCP)에서 주소를 복사해 등록하세요. 기존 설치를 열려면 원래 폴더에서 서버를 다시 시작하세요.'}}));
      return;
    }
    if(pathname==='/api/install/mobile'&&req.method==='GET'){
      if(!requestOrigin.startsWith('http://')||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
      const connection=await installConnection();
      if(selfHostId&&connection.status!=='ready'){
        connection.retryCommand=process.platform==='win32'
          ?'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-self-host.ps1 -MobileOnly -Port '+previewPort
          :process.platform==='darwin'?'bash scripts/install-viv-mac.sh --mobile-only --port '+previewPort:null;
      }
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(JSON.stringify(connection));return;
    }
    if((req.method==='GET'||req.method==='HEAD')&&['/','/index.html'].includes(pathname)&&
       requestUrl.searchParams.has('installation')&&(!selfHostId||requestUrl.searchParams.get('installation')!==selfHostId)){
      res.writeHead(409,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'",
        'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:installationMismatchPage);
      return;
    }
    if (pathname.startsWith('/api/')||pathname==='/mcp') {
      const chunks=[];let bytes=0;
      for await (const chunk of req) { bytes+=chunk.length;if(bytes>220000){res.writeHead(413);res.end('Input too large');return;}chunks.push(chunk); }
      const request=new Request(requestOrigin+req.url,{method:req.method,headers:{...req.headers,'oai-authenticated-user-id':'local-preview-owner'},...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const requestStarted=performance.now();
      const response=await (pathname==='/mcp'?handleMcp(request,env,{installation:selfHostId}):handleAPI(request,env));
      if(process.env.KEYNES_REQUEST_TIMING==='1')console.log(JSON.stringify({kind:'API_TIMING',method:req.method,path:new URL(request.url).pathname,status:response.status,elapsedMs:Math.round(performance.now()-requestStarted)}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const name=decodeURIComponent(pathname);
    const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)) throw new Error('Forbidden');
    if(!(await stat(file)).isFile()) throw new Error('Not found');
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(previewPort,'127.0.0.1',()=>{runners.start();appPush.start();hourlyLearning.start();brokerageReports.start();console.log('Local: http://127.0.0.1:'+previewPort);});
runners.runners.push(appPush);
runners.runners.push(hourlyLearning);
runners.runners.push(brokerageReports);
const stop=createPreviewShutdown({runners:runners.runners,server,closeDatabase:()=>localDatabase.close(),exit:code=>process.exit(code)});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
