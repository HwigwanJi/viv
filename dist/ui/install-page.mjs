import {createAppInstall,chromeInstallLink,installPlatform,manualInstallGuide} from './app-install.mjs';
const dialog=document.querySelector('#detail-dialog'),status=document.querySelector('[data-install-status]');
const guide=document.querySelector('[data-install-guide]'),copy=document.querySelector('[data-install-copy]'),address=document.querySelector('[data-install-address]');
document.querySelector('[data-install-steps]').innerHTML=manualInstallGuide(navigator);
const platform=installPlatform(navigator),desktop=platform==='desktop',localDesktop=desktop&&location.protocol==='http:';
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
retryCommand.querySelector('[data-install-copy-command]').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(retryCode.textContent);status.textContent='복구 명령을 복사했습니다.';}
  catch{const range=document.createRange();range.selectNodeContents(retryCode);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);status.textContent='선택한 명령을 복사하세요.';}
});
const install=createAppInstall({window,navigator,open(title,body,actions){
  const heading=document.createElement('h2');heading.id='dialog-title';heading.textContent=title;
  dialog.innerHTML='<div class="dialog-head"><button class="shell-control" data-install-close aria-label="닫기">×</button></div><div class="dialog-body">'+body+'</div><div class="dialog-actions">'+actions+'</div>';
  dialog.querySelector('.dialog-head').prepend(heading);if(!dialog.open)dialog.showModal();
},onError:message=>status.textContent=message,onDismissed(){status.textContent='설치 창을 닫았습니다. 위의 브라우저 메뉴로도 설치할 수 있습니다.';},onInstalled(){
  guide.hidden=true;status.textContent='설치를 완료했습니다. 홈 화면의 VIV 아이콘을 누르세요.';if(dialog.open)dialog.close();
}});
document.addEventListener('click',event=>{if(event.target.closest('[data-app-install]'))install.install();if(event.target.closest('[data-install-close]'))dialog.close();});
const alreadyInstalled=!install.button();
if(!alreadyInstalled)checkConnection();
if(alreadyInstalled){
  guide.hidden=true;status.textContent='VIV 앱을 여는 중입니다.';
  location.replace(document.querySelector('[data-install-open]').href);
}
const chrome=!alreadyInstalled&&platform==='android'?chromeInstallLink(location.href):null;
if(chrome){const link=document.createElement('a');link.className='button';link.href=chrome;link.textContent='채팅 앱에서 열었다면 Chrome으로 이동';document.querySelector('[data-install-browser]').append(link);}
const apk=document.querySelector('[data-apk-download]');
if(chrome&&apk){
  fetch(apk.querySelector('a').href,{method:'HEAD'}).then(response=>{
    const type=response.headers.get('content-type')?.split(';')[0];
    if(response.ok&&['application/vnd.android.package-archive','application/octet-stream'].includes(type))apk.hidden=false;
  }).catch(()=>{});
}
