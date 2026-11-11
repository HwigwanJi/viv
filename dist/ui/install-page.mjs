import {createAppInstall,chromeInstallLink} from './app-install.mjs';
const dialog=document.querySelector('#detail-dialog'),status=document.querySelector('[data-install-status]');
const install=createAppInstall({window,navigator,open(title,body,actions){
  const heading=document.createElement('h2');heading.id='dialog-title';heading.textContent=title;
  dialog.innerHTML='<div class="dialog-head"><button class="shell-control" data-install-close aria-label="닫기">×</button></div><div class="dialog-body">'+body+'</div><div class="dialog-actions">'+actions+'</div>';
  dialog.querySelector('.dialog-head').prepend(heading);if(!dialog.open)dialog.showModal();
},onError:message=>status.textContent=message,onInstalled(){status.textContent='설치를 완료했습니다. 홈 화면의 VIV 아이콘을 누르세요.';if(dialog.open)dialog.close();}});
document.addEventListener('click',event=>{if(event.target.closest('[data-app-install]'))install.install();if(event.target.closest('[data-install-close]'))dialog.close();});
if(!install.button()){document.querySelector('[data-app-install]').hidden=true;status.textContent='VIV 앱으로 실행 중입니다.';}
const chrome=/Android/.test(navigator.userAgent)?chromeInstallLink(location.href):null;
if(chrome){const link=document.createElement('a');link.className='button';link.href=chrome;link.textContent='Chrome에서 열기';document.querySelector('[data-install-browser]').append(link);}
const apk=document.querySelector('[data-apk-download]');
if(chrome&&apk){
  fetch(apk.querySelector('a').href,{method:'HEAD'}).then(response=>{
    const type=response.headers.get('content-type')?.split(';')[0];
    if(response.ok&&['application/vnd.android.package-archive','application/octet-stream'].includes(type))apk.hidden=false;
  }).catch(()=>{});
}
