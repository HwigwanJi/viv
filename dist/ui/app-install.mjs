const installIcon='<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 6v8m-3-3 3 3 3-3M11 18h2"/></svg>';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function chromeInstallLink(href){
  if(!href)return null;
  const url=new URL('/install.html',href);
  if(url.protocol!=='https:'||url.username||url.password)return null;
  return 'intent://'+url.host+url.pathname+'#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(url.href)+';end';
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

export function manualInstallGuide(navigator){
  const platform=installPlatform(navigator);
  if(platform==='apple')return 'Safari에서 <strong>공유 → 홈 화면에 추가</strong>를 누르세요. <strong>웹 앱으로 열기</strong>가 보이면 켜고 추가하세요.';
  if(platform==='android')return 'Chrome의 <strong>더보기 → 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.';
  return 'PC에 웹앱으로 설치하려면 브라우저의 앱 설치 메뉴를 확인하세요.';
}

export function createAppInstall({window,navigator,open,onError=()=>{},onInstalled=()=>{},onDismissed=()=>{}}) {
  let pending=null,busy=false,completed=false;
  const installed=()=>completed||window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const sync=()=>window.document.querySelectorAll('[data-app-install]').forEach(button=>{button.hidden=installed()||button.dataset?.appInstallNative!==undefined&&!pending;button.disabled=busy;});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;sync();});
  window.addEventListener('appinstalled',()=>{completed=true;pending=null;sync();onInstalled();});
  async function install(){
    if(busy||installed())return;
    if(!pending){
      const steps=manualInstallGuide(navigator);
      const chrome=installPlatform(navigator)==='android'?chromeInstallLink(window.location?.href):null;
      const pageLink=window.location?.pathname==='/install.html'?'':'<p><a href="/install.html">휴대폰 설치 안내</a></p>';
      open('VIV 앱 설치','<p>'+steps+'</p>'+(chrome?'<p>채팅 앱에서 열었다면 Chrome으로 이동하세요.</p><p><a class="button primary" href="'+esc(chrome)+'">Chrome에서 열기</a></p>':'')+pageLink+'<p>휴대폰과 VIV 서버를 같은 Tailscale 네트워크에 연결하세요.</p>','<button class="button primary" data-app-install data-app-install-native hidden>VIV 앱 설치</button>');
      sync();
      return;
    }
    const prompt=pending;pending=null;busy=true;sync();
    try{await prompt.prompt();if((await prompt.userChoice)?.outcome==='dismissed')onDismissed();}catch(error){onError(error.message);}finally{busy=false;sync();}
  }
  return {button:()=>installed()?'':'<button class="shell-control" data-app-install aria-label="VIV 앱 설치" title="VIV 앱 설치"'+(busy?' disabled':'')+'>'+installIcon+'</button>',install};
}
