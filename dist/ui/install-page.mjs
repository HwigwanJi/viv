import {createAppInstall,chromeInstallLink,installPlatform,localMcpAddress,manualInstallGuide} from './app-install.mjs';
const dialog=document.querySelector('#detail-dialog'),status=document.querySelector('[data-install-status]');
const guide=document.querySelector('[data-install-guide]'),copy=document.querySelector('[data-install-copy]'),address=document.querySelector('[data-install-address]');
document.querySelector('[data-install-steps]').innerHTML=manualInstallGuide(navigator);
const platform=installPlatform(navigator),desktop=platform==='desktop',localDesktop=desktop&&location.protocol==='http:';
const params=new URLSearchParams(location.search),aiView=params.get('connect')==='ai';
const privateOrigin=/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(location.hostname);
const handoff=document.querySelector('[data-install-handoff]'),connection=document.querySelector('[data-install-connection]');
const recheck=document.querySelector('[data-install-recheck]'),setup=document.querySelector('[data-install-setup]'),help=document.querySelector('[data-install-handoff-help]');
const retryCommand=document.querySelector('[data-install-retry-command]'),retryCode=retryCommand.querySelector('code');
const addressField=address.querySelector('input'),addressCheck=address.querySelector('#viv-install-address-check');
let installUrl=null,lastVerified=null;
function showAddress(url,{previous=false}={}){
  installUrl=previous?null:url;
  copy.hidden=!url||safariHandoff;copy.disabled=previous;
  address.hidden=!url||!desktop;
  addressField.value=url||'';
  addressField.disabled=previous;
  addressCheck.hidden=!url||!lastVerified;
  addressCheck.textContent=lastVerified
    ?(previous?'이전에 확인한 주소입니다. 복사하려면 연결을 다시 확인하세요. ':'')+'마지막 확인 '+lastVerified.time
    :'';
}
function showPreviousAddress(){
  showAddress(lastVerified?.url??null,{previous:true});
}
async function checkConnection(){
  if(recheck.disabled)return;
  const restoreFocus=document.activeElement===recheck;
  recheck.disabled=true;setup.hidden=true;help.hidden=true;retryCommand.hidden=true;
  status.textContent='';
  showPreviousAddress();
  connection.textContent='연결을 확인하는 중입니다.';
  let temporaryFailure=true;
  try{
    const response=await fetch(localDesktop?'/api/install/mobile':'/api/status',{cache:'no-store',signal:AbortSignal.timeout(9000)});
    temporaryFailure=response.status>=500;
    if(!response.ok)throw Error('INSTALL_STATUS');
    const value=await response.json();
    if(localDesktop&&!['ready','needs-setup','unreachable','temporarily-unreachable','public-route','installation-mismatch','unsupported'].includes(value?.status))throw Error('INSTALL_STATUS');
    if(localDesktop&&value.status==='ready'){
      const url=new URL(value.url);
      if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/install.html'||!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname))throw Error('INSTALL_ORIGIN');
      lastVerified={url:url.href,time:new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'medium'}).format(new Date())};
      showAddress(url.href);help.hidden=false;connection.textContent='PC에서 이 Tailscale 주소의 VIV 설치 화면을 확인했습니다. 휴대폰에서 설치를 이어가세요.';
    }else if(localDesktop){
      if(value.status!=='temporarily-unreachable'){lastVerified=null;showAddress(null);}
      setup.hidden=false;
      if(typeof value?.retryCommand==='string'){
        retryCode.textContent=value.retryCommand;
        retryCommand.hidden=false;
      }
      connection.textContent=value?.status==='public-route'?'Tailscale의 공개 Funnel이 켜져 있습니다. 비공개 Serve를 설정한 뒤 다시 확인하세요.'
        :value?.status==='installation-mismatch'?'휴대폰 주소가 이 VIV 설치와 일치하지 않습니다. 원래 설치 폴더의 비공개 Serve 연결을 확인하세요.'
        :['unreachable','temporarily-unreachable'].includes(value.status)?'저장한 휴대폰 주소에 연결할 수 없습니다. Tailscale과 VIV 서버를 확인한 뒤 다시 시도하세요.'
        :value?.status==='unsupported'?'이 서버에서는 휴대폰 주소를 확인할 수 없습니다. 기존 휴대폰 접속 주소는 서버 관리자에게 확인하세요.'
        :'이 PC에서 휴대폰 연결을 준비하려면 아래 복구 명령을 실행하세요.';
    }else if(value?.storage==='server'){
      if(location.protocol==='https:')showAddress(new URL('/install.html',location.origin).href);
      help.hidden=!desktop||!privateOrigin;
      connection.textContent='마지막 확인 '+new Intl.DateTimeFormat('ko-KR',{timeStyle:'medium'}).format(new Date())+' · VIV 서버 응답 확인';
    }else throw Error('INSTALL_STATUS');
  }catch{
    if(!temporaryFailure){lastVerified=null;showAddress(null);}
    setup.hidden=!localDesktop;
    connection.textContent=!desktop&&privateOrigin
      ?'VIV 서버 연결을 확인할 수 없습니다. 휴대폰에서 Tailscale을 켜고 PC와 같은 네트워크에 연결했는지 확인하세요.'
      :'연결 상태를 확인할 수 없습니다. VIV 서버와 네트워크를 확인한 뒤 다시 시도하세요.';
  }finally{
    recheck.disabled=false;
    if(restoreFocus&&document.activeElement===document.body)recheck.focus();
  }
}
handoff.hidden=false;recheck.hidden=false;
if(!desktop||!localDesktop&&!privateOrigin)document.querySelector('[data-install-connection-title]').textContent='서버 연결';
recheck.addEventListener('click',checkConnection);
copy.addEventListener('click',async()=>{
  const url=installUrl;
  if(!url)return;
  try{await navigator.clipboard.writeText(url);if(installUrl===url)status.textContent='설치 주소를 복사했습니다.';}
  catch{if(installUrl!==url)return;address.hidden=false;addressField.focus();addressField.select();status.textContent='선택한 주소를 복사하세요.';}
});
async function copyCommand(code,label){
  try{await navigator.clipboard.writeText(code.textContent);status.textContent=label+'을 복사했습니다.';}
  catch{const range=document.createRange();range.selectNodeContents(code);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);status.textContent='선택한 명령을 복사하세요.';}
}
retryCommand.querySelector('[data-install-copy-command]').addEventListener('click',()=>copyCommand(retryCode,'복구 명령'));
const install=createAppInstall({window,navigator,open(title,body,actions){
  const heading=document.createElement('h2');heading.id='dialog-title';heading.textContent=title;
  dialog.innerHTML='<div class="dialog-head"><button class="shell-control" data-install-close aria-label="닫기">×</button></div><div class="dialog-body">'+body+'</div><div class="dialog-actions">'+actions+'</div>';
  dialog.querySelector('.dialog-head').prepend(heading);if(!dialog.open)dialog.showModal();
},onError:message=>status.textContent=message,onDismissed(){status.textContent='설치 창을 닫았습니다. 위의 브라우저 메뉴로도 설치할 수 있습니다.';},onInstalled(){
  if(aiView)return;
  document.querySelector('[data-install-steps]').hidden=true;
  status.textContent='설치를 완료했습니다. 홈 화면의 VIV 아이콘을 누르세요.';if(dialog.open)dialog.close();
}});
document.addEventListener('click',event=>{if(event.target.closest('[data-app-install]'))install.install();if(event.target.closest('[data-install-close]'))dialog.close();});
const alreadyInstalled=!install.button();
const browser=document.querySelector('[data-install-browser]');
const safariHandoff=aiView?'':install.safariHandoff();
if(aiView){
  guide.hidden=true;
  document.title=document.querySelector('[data-install-title]').textContent='AI 연결·복구 (MCP)';
  const ai=document.querySelector('[data-install-ai]');
  ai.hidden=false;
  const back=document.querySelector('[data-install-open]');
  const mode=params.get('executionMode')==='live'?'live':'paper';
  back.href='/#settings?view=connections&executionMode='+mode;
  back.textContent='서비스 연결로 돌아가기';
  if(desktop&&localMcpAddress(location)){
    ai.querySelector('[data-install-mcp-pc]').hidden=true;
    const address=ai.querySelector('[data-install-mcp-address]'),field=address.querySelector('input');
    const check=ai.querySelector('[data-install-mcp-check]'),again=ai.querySelector('[data-install-mcp-recheck]');
    const port=location.port,system=navigator.platform;
    const command=system.startsWith('Win')
      ? client=>'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install-viv-mcp.ps1 -Port '+port+' -Client '+client
      : system.startsWith('Mac')?client=>'bash scripts/install-viv-mac.sh --target pc --port '+port+' --client '+client.toLowerCase():null;
    if(command){
      const codex=ai.querySelector('[data-install-mcp-codex]'),claude=ai.querySelector('[data-install-mcp-claude]');
      codex.textContent=command('Codex');
      claude.textContent=command('Claude');
      ai.querySelector('[data-install-copy-mcp="codex"]').addEventListener('click',()=>copyCommand(codex,'Codex 명령'));
      ai.querySelector('[data-install-copy-mcp="claude"]').addEventListener('click',()=>copyCommand(claude,'Claude Code 명령'));
      ai.querySelector('[data-install-mcp-commands]').hidden=false;
    }
    async function checkMcpAddress(){
      const restoreFocus=document.activeElement===again;
      address.hidden=true;field.value='';again.disabled=true;check.hidden=false;
      check.textContent='이 VIV 설치의 MCP 주소를 확인하는 중입니다.';
      try{
        const response=await fetch('/',{method:'HEAD',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(4000)});
        const verified=response.ok&&localMcpAddress(location,response.headers.get('X-VIV-Setup'));
        if(!verified)throw Error('VIV_INSTALLATION_ID');
        field.value=verified;address.hidden=false;again.hidden=true;
        check.textContent='이 설치에 연결되는 MCP 주소입니다.';
      }catch{
        check.textContent='이 설치를 확인할 수 없습니다. 원래 VIV 폴더에서 서버를 다시 시작한 뒤 주소를 다시 확인하세요.';
        again.hidden=false;
      }finally{
        again.disabled=false;
        if(restoreFocus&&[again,document.body].includes(document.activeElement))(field.value?field:again).focus();
      }
    }
    again.addEventListener('click',checkMcpAddress);
    ai.querySelector('[data-install-copy-mcp="address"]').addEventListener('click',async()=>{
      if(!field.value)return;
      try{await navigator.clipboard.writeText(field.value);status.textContent='MCP 주소를 복사했습니다.';}
      catch{field.focus();field.select();status.textContent='선택한 MCP 주소를 복사하세요.';}
    });
    checkMcpAddress();
  }
}else{
  if(alreadyInstalled)document.querySelector('[data-install-steps]').hidden=true;
  browser.innerHTML=safariHandoff;
  checkConnection();
}
const chrome=!aiView&&!alreadyInstalled&&platform==='android'?chromeInstallLink(location.href):null;
if(chrome){const link=document.createElement('a');link.className='button';link.href=chrome;link.textContent='채팅 앱에서 열었다면 Chrome으로 이동';browser.append(link);}
const apk=document.querySelector('[data-apk-download]');
if(chrome&&apk){
  fetch(apk.querySelector('a').href,{method:'HEAD'}).then(response=>{
    const type=response.headers.get('content-type')?.split(';')[0];
    if(response.ok&&['application/vnd.android.package-archive','application/octet-stream'].includes(type))apk.hidden=false;
  }).catch(()=>{});
}
