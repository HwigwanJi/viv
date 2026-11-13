const installIcon='<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 6v8m-3-3 3 3 3-3M11 18h2"/></svg>';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function installPageUrl(href){
  if(!href)return null;
  const url=new URL('/install.html',href);
  return url.protocol==='https:'&&!url.username&&!url.password?url:null;
}
export function chromeInstallLink(href){
  const url=installPageUrl(href);
  return url?'intent://'+url.host+url.pathname+'#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(url.href)+';end':null;
}

export function installPlatform(navigator){
  if(/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)return 'apple';
  return /Android/.test(navigator.userAgent)?'android':'desktop';
}

export function localMcpAddress(location,setupId){
  if(location?.protocol!=='http:'||!['127.0.0.1','localhost'].includes(location.hostname))return null;
  const port=Number(location.port);
  if(!Number.isInteger(port)||port<1024||port>65535||port===4905)return null;
  const address='http://127.0.0.1:'+port+'/mcp';
  if(setupId===undefined)return address;
  return /^[a-f0-9]{32}$/.test(setupId)?address+'?installation='+setupId:null;
}

export function desktopMcpSetupLink(port,setupId,mode){
  const origin=new URL('http://127.0.0.1');
  if(!/^[1-9][0-9]{3,4}$/.test(port)||Number(port)>65535)return null;
  origin.port=port;
  if(!localMcpAddress(origin,setupId)||typeof setupId!=='string')return null;
  origin.pathname='/install.html';
  origin.search=new URLSearchParams({connect:'ai',executionMode:mode==='live'?'live':'paper',installation:setupId});
  return origin.href;
}

export function manualInstallGuide(navigator){
  const platform=installPlatform(navigator);
  if(platform==='apple')return 'Safari에서 <strong>공유 → 홈 화면에 추가</strong>를 누르세요. 메뉴에 없으면 공유 목록 아래 <strong>동작 편집</strong>에서 추가하세요. <strong>웹 앱으로 열기</strong>가 보이면 켠 뒤 <strong>추가</strong>를 누르세요.';
  if(platform==='android')return 'Chrome의 <strong>더보기 → 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.';
  return 'PC에 웹앱으로 설치하려면 브라우저의 앱 설치 메뉴를 확인하세요.';
}

export function createAppInstall({window,navigator,open,onError=()=>{},onInstalled=()=>{},onDismissed=()=>{}}) {
  let pending=null,busy=false,completed=false;
  const installed=()=>completed||window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const safariAddress=installPlatform(navigator)==='apple'?installPageUrl(window.location?.href):null;
  const safariHandoff=()=>!installed()&&safariAddress
    ?`<div class="spaced" data-app-safari-handoff><p>메신저에서 열었다면 설치 주소를 복사해 Safari 주소창에 붙여 넣으세요.</p><button type="button" class="button" data-app-safari-copy>Safari용 주소 복사</button><textarea class="input" rows="2" aria-label="VIV 설치 주소" readonly hidden>${esc(safariAddress.href)}</textarea><p role="status"></p></div>`:'';
  window.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-app-safari-copy]');
    if(!button||!safariAddress)return;
    const panel=button.closest('[data-app-safari-handoff]'),status=panel.querySelector('[role=status]');
    try{
      await navigator.clipboard.writeText(safariAddress.href);
      status.textContent='주소를 복사했습니다. Safari 주소창에 붙여 넣으세요.';
    }catch{
      const field=panel.querySelector('textarea');
      field.hidden=false;field.focus();field.select();
      status.textContent='선택한 주소를 복사해 Safari 주소창에 붙여 넣으세요.';
    }
  });
  const sync=()=>{
    window.document.querySelectorAll('[data-app-install]').forEach(button=>{button.hidden=installed()||button.dataset?.appInstallNative!==undefined&&!pending;button.disabled=busy;});
    window.document.querySelectorAll('[data-app-safari-handoff]').forEach(panel=>{panel.hidden=installed();});
  };
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;sync();});
  window.addEventListener('appinstalled',()=>{completed=true;pending=null;sync();onInstalled();});
  async function install(){
    if(busy||installed())return;
    if(!pending){
      const steps=manualInstallGuide(navigator);
      const chrome=installPlatform(navigator)==='android'?chromeInstallLink(window.location?.href):null;
      const pageLink=window.location?.pathname==='/install.html'?'':'<p><a href="/install.html">휴대폰 설치 안내</a></p>';
      open('VIV 앱 설치','<p>'+steps+'</p>'+(chrome?'<p>채팅 앱에서 열었다면 Chrome으로 이동하세요.</p><p><a class="button primary" href="'+esc(chrome)+'">Chrome에서 열기</a></p>':'')+safariHandoff()+pageLink+'<p>휴대폰과 VIV 서버를 같은 Tailscale 네트워크에 연결하세요.</p>','<button class="button primary" data-app-install data-app-install-native hidden>VIV 앱 설치</button>');
      sync();
      return;
    }
    const prompt=pending;pending=null;busy=true;sync();
    try{await prompt.prompt();if((await prompt.userChoice)?.outcome==='dismissed')onDismissed();}catch(error){onError(error.message);}finally{busy=false;sync();}
  }
  return {safariHandoff,button:()=>installed()?'':'<button class="shell-control" data-app-install aria-label="VIV 앱 설치" title="VIV 앱 설치"'+(busy?' disabled':'')+'>'+installIcon+'</button>',install};
}
