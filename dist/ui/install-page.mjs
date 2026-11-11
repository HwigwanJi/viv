import {createAppInstall,chromeInstallLink,installPlatform,manualInstallGuide} from './app-install.mjs';
const dialog=document.querySelector('#detail-dialog'),status=document.querySelector('[data-install-status]');
const guide=document.querySelector('[data-install-guide]'),copy=document.querySelector('[data-install-copy]'),address=document.querySelector('[data-install-address]');
document.querySelector('[data-install-steps]').innerHTML=manualInstallGuide(navigator);
const installUrl=location.protocol==='https:'?new URL('/install.html',location.origin).href:null;
if(installUrl){copy.hidden=false;address.querySelector('input').value=installUrl;}
copy.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(installUrl);status.textContent='설치 주소를 복사했습니다.';}
  catch{address.hidden=false;const field=address.querySelector('input');field.focus();field.select();status.textContent='선택한 주소를 복사하세요.';}
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
if(alreadyInstalled){
  guide.hidden=true;status.textContent='VIV 앱을 여는 중입니다.';
  location.replace(document.querySelector('[data-install-open]').href);
}
const chrome=!alreadyInstalled&&installPlatform(navigator)==='android'?chromeInstallLink(location.href):null;
if(chrome){const link=document.createElement('a');link.className='button';link.href=chrome;link.textContent='채팅 앱에서 열었다면 Chrome으로 이동';document.querySelector('[data-install-browser]').append(link);}
const apk=document.querySelector('[data-apk-download]');
if(chrome&&apk){
  fetch(apk.querySelector('a').href,{method:'HEAD'}).then(response=>{
    const type=response.headers.get('content-type')?.split(';')[0];
    if(response.ok&&['application/vnd.android.package-archive','application/octet-stream'].includes(type))apk.hidden=false;
  }).catch(()=>{});
}
