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
let installUrl=null;
function showAddress(url){
  installUrl=url;copy.hidden=!url;address.hidden=!url||!desktop;
  address.querySelector('input').value=url||'';
}
async function checkConnection(){
  recheck.disabled=true;setup.hidden=true;help.hidden=true;retryCommand.hidden=true;showAddress(null);
  connection.textContent='연결을 확인하는 중입니다.';
  try{
    const response=await fetch(localDesktop?'/api/install/mobile':'/api/status',{cache:'no-store',signal:AbortSignal.timeout(9000)});
    if(!response.ok)throw Error('INSTALL_STATUS');
    const value=await response.json();
    if(localDesktop&&!['ready','needs-setup','unreachable','public-route','unsupported'].includes(value?.status))throw Error('INSTALL_STATUS');
    if(localDesktop&&value.status==='ready'){
      const url=new URL(value.url);
      if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/install.html'||!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname))throw Error('INSTALL_ORIGIN');
      showAddress(url.href);help.hidden=false;connection.textContent='PC에서 이 Tailscale 주소의 VIV 설치 화면을 확인했습니다. 휴대폰에서 설치를 이어가세요.';
    }else if(localDesktop){
      setup.hidden=false;
      if(typeof value?.retryCommand==='string'){
        retryCode.textContent=value.retryCommand;
        retryCommand.hidden=false;
      }
      connection.textContent=value?.status==='public-route'?'Tailscale의 공개 Funnel이 켜져 있습니다. 비공개 Serve를 설정한 뒤 다시 확인하세요.'
        :value?.status==='unreachable'?'저장한 휴대폰 주소에 연결할 수 없습니다. Tailscale과 VIV 서버를 확인한 뒤 다시 시도하세요.'
        :value?.status==='unsupported'?'이 서버에서는 휴대폰 주소를 확인할 수 없습니다. 기존 휴대폰 접속 주소는 서버 관리자에게 확인하세요.'
        :'이 PC에서 휴대폰 연결을 준비하려면 아래 복구 명령을 실행하세요.';
    }else if(value?.storage==='server'){
      if(location.protocol==='https:')showAddress(new URL('/install.html',location.origin).href);
      help.hidden=!desktop||!privateOrigin;
      connection.textContent='VIV 서버에 연결했습니다.';
    }else throw Error('INSTALL_STATUS');
  }catch{
    setup.hidden=!localDesktop;
    connection.textContent=!desktop&&privateOrigin
      ?'VIV 서버 연결을 확인할 수 없습니다. 휴대폰에서 Tailscale을 켜고 PC와 같은 네트워크에 연결했는지 확인하세요.'
      :'연결 상태를 확인할 수 없습니다. VIV 서버와 네트워크를 확인한 뒤 다시 시도하세요.';
  }finally{recheck.disabled=false;}
}
handoff.hidden=false;recheck.hidden=false;
if(!desktop||!localDesktop&&!privateOrigin)document.querySelector('[data-install-connection-title]').textContent='서버 연결';
recheck.addEventListener('click',checkConnection);
copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(installUrl);status.textContent='설치 주소를 복사했습니다.';}
  catch{address.hidden=false;const field=address.querySelector('input');field.focus();field.select();status.textContent='선택한 주소를 복사하세요.';}
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
if(aiView){
  guide.hidden=true;
  document.title=document.querySelector('[data-install-title]').textContent='AI 연결·복구 (MCP)';
  const ai=document.querySelector('[data-install-ai]');
  ai.hidden=false;
  const back=document.querySelector('[data-install-open]');
  const mode=params.get('executionMode')==='live'?'live':'paper';
  back.href='/#settings?view=connections&executionMode='+mode;
  back.textContent='서비스 연결로 돌아가기';
  const url=desktop&&localMcpAddress(location);
  if(url){
    ai.querySelector('[data-install-mcp-pc]').hidden=true;
    const address=ai.querySelector('[data-install-mcp-address]'),field=address.querySelector('input');
    address.hidden=false;field.value=url;
    const port=new URL(url).port;
    const system=navigator.platform;
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
    ai.querySelector('[data-install-copy-mcp="address"]').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(url);status.textContent='MCP 주소를 복사했습니다.';}
      catch{field.focus();field.select();status.textContent='선택한 MCP 주소를 복사하세요.';}
    });
  }
}else{
  if(alreadyInstalled)document.querySelector('[data-install-steps]').hidden=true;
  checkConnection();
}
const chrome=!aiView&&!alreadyInstalled&&platform==='android'?chromeInstallLink(location.href):null;
if(chrome){const link=document.createElement('a');link.className='button';link.href=chrome;link.textContent='채팅 앱에서 열었다면 Chrome으로 이동';document.querySelector('[data-install-browser]').append(link);}
const apk=document.querySelector('[data-apk-download]');
if(chrome&&apk){
  fetch(apk.querySelector('a').href,{method:'HEAD'}).then(response=>{
    const type=response.headers.get('content-type')?.split(';')[0];
    if(response.ok&&['application/vnd.android.package-archive','application/octet-stream'].includes(type))apk.hidden=false;
  }).catch(()=>{});
}
