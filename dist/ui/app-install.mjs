const installIcon='<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 6v8m-3-3 3 3 3-3M11 18h2"/></svg>';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function chromeInstallLink(href){
  if(!href)return null;
  const url=new URL('/install.html',href);
  if(url.protocol!=='https:'||url.username||url.password)return null;
  return 'intent://'+url.host+url.pathname+'#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(url.href)+';end';
}

export function createAppInstall({window,navigator,open,onError=()=>{},onInstalled=()=>{}}) {
  let pending=null,busy=false,completed=false;
  const installed=()=>completed||window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const sync=()=>window.document.querySelectorAll('[data-app-install]').forEach(button=>{button.hidden=installed()||button.dataset?.appInstallNative!==undefined&&!pending;button.disabled=busy;});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event;sync();});
  window.addEventListener('appinstalled',()=>{completed=true;pending=null;sync();onInstalled();});
  async function install(){
    if(busy||installed())return;
    if(!pending){
      const apple=/iPhone|iPad|iPod/.test(navigator.userAgent),steps=apple?'Safari의 공유 메뉴에서 <strong>홈 화면에 추가</strong>를 선택하세요.':'Chrome 또는 삼성 인터넷의 메뉴에서 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.';
      const chrome=/Android/.test(navigator.userAgent)?chromeInstallLink(window.location?.href):null;
      open('VIV 앱 설치','<p>'+steps+'</p>'+(chrome?'<p>채팅 앱에서 열었다면 Chrome으로 이동하세요.</p><p><a class="button primary" href="'+esc(chrome)+'">Chrome에서 열기</a></p>':'')+'<p><a href="/install.html">VIV 설치 페이지 열기</a></p><p>외부에서는 휴대폰 Tailscale을 연결하고, 서버 노트북을 켜 두세요.</p>','<button class="button primary" data-app-install data-app-install-native hidden>VIV 앱 설치</button>');
      sync();
      return;
    }
    const prompt=pending;pending=null;busy=true;sync();
    try{await prompt.prompt();await prompt.userChoice;}catch(error){onError(error.message);}finally{busy=false;sync();}
  }
  return {button:()=>installed()?'':'<button class="shell-control" data-app-install aria-label="VIV 앱 설치" title="VIV 앱 설치"'+(busy?' disabled':'')+'>'+installIcon+'</button>',install};
}
