import {createAppInstall,chromeInstallLink,desktopMcpSetupLink,installPlatform,localMcpAddress,manualInstallGuide} from './app-install.mjs';
const dialog=document.querySelector('#detail-dialog'),status=document.querySelector('[data-install-status]');
const guide=document.querySelector('[data-install-guide]'),copy=document.querySelector('[data-install-copy]'),address=document.querySelector('[data-install-address]');
document.querySelector('[data-install-steps]').innerHTML=manualInstallGuide(navigator);
const platform=installPlatform(navigator),desktop=platform==='desktop',localDesktop=desktop&&location.protocol==='http:';
const params=new URLSearchParams(location.search),aiView=params.get('connect')==='ai';
const privateOrigin=/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(location.hostname);
const handoff=document.querySelector('[data-install-handoff]'),connection=document.querySelector('[data-install-connection]');
const recheck=document.querySelector('[data-install-recheck]'),setup=document.querySelector('[data-install-setup]'),help=document.querySelector('[data-install-handoff-help]');
const openLink=document.querySelector('[data-install-open]'),openApp=openLink.parentElement;
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
function connectionFailure(statusCode){
  if(!privateOrigin)return '연결 상태를 확인할 수 없습니다. VIV 서버와 네트워크를 확인한 뒤 다시 시도하세요.';
  if(statusCode===401||statusCode===403)return '이 주소에 대한 접근이 거부되었습니다. PC와 같은 Tailscale 네트워크에 로그인했는지 확인하세요.';
  if([502,503,504].includes(statusCode))return 'VIV 서버 연결을 확인할 수 없습니다. 설치한 컴퓨터에서 VIV PC 주소를 열어 서버 상태를 확인하세요.';
  return 'VIV 서버 연결을 확인할 수 없습니다. 인터넷과 Tailscale 연결을 확인한 뒤 다시 시도하세요.';
}
async function checkConnection(){
  if(recheck.disabled)return;
  const restoreFocus=document.activeElement===recheck;
  recheck.disabled=true;setup.hidden=true;help.hidden=true;retryCommand.hidden=true;
  if(!localDesktop)openApp.hidden=true;
  status.textContent='';
  showPreviousAddress();
  connection.textContent='연결을 확인하는 중입니다.';
  let temporaryFailure=true;
  let statusCode=0;
  let responseProblem='';
  try{
    const response=await fetch(localDesktop?'/api/install/mobile':'/api/status',{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(9000)});
    statusCode=response.status;
    temporaryFailure=response.status>=500;
    const contentType=response.headers.get('content-type')||'';
    if(response.type==='opaqueredirect'||(response.ok&&/^text\/html\b/i.test(contentType))){
      responseProblem='이 주소에서 다른 웹페이지가 응답했습니다. PC에서 확인한 VIV 설치 주소와 비교하세요. 네트워크 로그인이 필요하면 브라우저에서 연결한 뒤 연결 다시 확인을 누르세요.';
      throw Error('INSTALL_WEB_PAGE');
    }
    if(!response.ok)throw Error('INSTALL_STATUS');
    responseProblem='VIV 서버 상태 응답을 확인할 수 없습니다. 설치한 컴퓨터에서 VIV PC 주소를 열어 확인한 뒤 연결 다시 확인을 누르세요.';
    if(!/^application\/json\b/i.test(contentType))throw Error('INSTALL_STATUS');
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
      openApp.hidden=false;
    }else throw Error('INSTALL_STATUS');
  }catch{
    if(!temporaryFailure){lastVerified=null;showAddress(null);}
    setup.hidden=!(localDesktop||privateOrigin);
    connection.textContent=responseProblem||connectionFailure(statusCode);
  }finally{
    recheck.disabled=false;
    if(restoreFocus&&document.activeElement===document.body)recheck.focus();
  }
}
handoff.hidden=false;recheck.hidden=false;
if(!desktop||!localDesktop&&!privateOrigin)document.querySelector('[data-install-connection-title]').textContent='서버 연결';
recheck.addEventListener('click',checkConnection);
openLink.addEventListener('viv:open-failed',()=>{
  if(aiView)return;
  openLink.textContent='VIV 다시 열기';
  if(privateOrigin)setup.hidden=false;
});
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
  const pcGuide=ai.querySelector('[data-install-mcp-pc]');
  const check=ai.querySelector('[data-install-mcp-check]'),again=ai.querySelector('[data-install-mcp-recheck]');
  const fetchIdentity=path=>fetch(path,{method:'HEAD',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(4000)});
  function copyAddress(button,field,label){
    button.addEventListener('click',async()=>{
      if(!field.value)return;
      try{await navigator.clipboard.writeText(field.value);status.textContent=label+'를 복사했습니다.';}
      catch{field.focus();field.select();status.textContent='선택한 주소를 복사하세요.';}
    });
  }
  if(desktop&&localMcpAddress(location)){
    pcGuide.hidden=true;
    const address=ai.querySelector('[data-install-mcp-address]'),field=address.querySelector('input');
    const expectedInstallation=params.get('installation');
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
      back.hidden=expectedInstallation!==null;
      address.hidden=true;field.value='';again.disabled=true;check.hidden=false;
      check.textContent='이 VIV 설치의 MCP 주소를 확인하는 중입니다.';
      try{
        const response=await fetchIdentity('/');
        const installation=response.headers.get('X-VIV-Setup');
        const verified=response.ok&&localMcpAddress(location,installation);
        if(!verified)throw Error('VIV_INSTALLATION_ID');
        if(expectedInstallation!==null&&expectedInstallation!==installation){
          check.textContent='휴대폰에서 열었던 VIV와 다른 설치입니다. 원래 VIV 폴더에서 서버를 다시 시작한 뒤 복사한 주소를 다시 확인하세요.';
          again.hidden=false;
          return;
        }
        field.value=verified;address.hidden=false;again.hidden=true;back.hidden=false;
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
    copyAddress(ai.querySelector('[data-install-copy-mcp="address"]'),field,'MCP 주소');
    checkMcpAddress();
  }else if(privateOrigin&&location.protocol==='https:'&&!location.port){
    const panel=ai.querySelector('[data-install-mcp-handoff]'),field=panel.querySelector('input');
    again.textContent='PC 주소 다시 확인';
    async function checkDesktopAddress(){
      const restoreFocus=document.activeElement===again;
      panel.hidden=true;field.value='';again.disabled=true;check.hidden=false;
      check.textContent='이 VIV 설치의 PC 주소를 확인하는 중입니다.';
      try{
        const response=await fetchIdentity('/install.html');
        const link=response.ok&&desktopMcpSetupLink(response.headers.get('X-VIV-Desktop-Port'),response.headers.get('X-VIV-Setup'),mode);
        if(!link)throw Error('VIV_DESKTOP_ADDRESS');
        field.value=link;panel.hidden=false;pcGuide.hidden=true;check.hidden=true;again.hidden=true;
      }catch{
        pcGuide.hidden=false;
        check.textContent='PC 주소를 가져오지 못했습니다.';
        again.hidden=false;
      }finally{
        again.disabled=false;
        if(restoreFocus&&[again,document.body].includes(document.activeElement))(field.value?field:again).focus();
      }
    }
    again.addEventListener('click',checkDesktopAddress);
    copyAddress(ai.querySelector('[data-install-copy-mcp="desktop"]'),field,'PC에서 이어갈 주소');
    checkDesktopAddress();
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

const recovery=document.querySelector('[data-viv-install-failure]');
if(recovery){
  recovery.dataset.ready='true';
  if(!recovery.hidden){
    if(recovery.contains(document.activeElement))document.querySelector('[data-install-title]').focus();
    recovery.hidden=true;
  }
}
