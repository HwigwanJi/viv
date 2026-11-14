self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const {request}=event;
 if(request.method!=='GET'||request.mode!=='navigate')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||!['/','/index.html','/install.html'].includes(url.pathname))return;
 event.respondWith((async()=>{
  let gatewayUnavailable=false;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(request,{signal:controller.signal});
   if(![502,503,504].includes(response.status)){
    if(response.ok&&/^text\/html\b/i.test(response.headers.get('Content-Type')||'')){
     // A successful header alone does not finish navigation if the HTML body stalls.
     await response.clone().arrayBuffer();
    }
    return response;
   }
   gatewayUnavailable=true;
  }catch{
   gatewayUnavailable=controller.signal.aborted;
  }finally{clearTimeout(timeout);}
  const privateOrigin=/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname);
  return new Response(connectionHelp(gatewayUnavailable,privateOrigin),{status:503,headers:{
   'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
   'Content-Security-Policy':"default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
   'Referrer-Policy':'no-referrer'
  }});
 })());
});

// The worker carries just the public help page, with no runtime cache.
const connectionHelp=(gatewayUnavailable,privateOrigin)=>`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101416">
  <title>VIV 연결 복구</title>
  <style>
    :root{color-scheme:dark}
    body{margin:0;background:#101416;color:#f4f6f7;font:1rem/1.6 system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}
    main{box-sizing:border-box;max-width:36rem;margin:auto;padding:clamp(1.25rem,6vw,3rem)}
    h1{font-size:1.6rem;line-height:1.35}
    button{padding:.65rem 1rem;border:0;border-radius:.6rem;background:#dafa66;color:#161c13;font:inherit;font-weight:650;cursor:pointer}
    a{color:#dafa66}
    :focus-visible{outline:2px solid #dafa66;outline-offset:4px}
    details{margin:1.25rem 0}
    summary{cursor:pointer}
    code{display:block;margin:.25rem 0 .8rem;overflow-wrap:anywhere}
  </style>
</head>
<body>
  <main>
    <p><strong>VIV</strong></p>
    <h1>VIV 서버에 연결할 수 없어요</h1>
    <p role="status" id="connection-status">${gatewayUnavailable?'연결 경로가 VIV 서버에 닿지 않습니다. 설치한 컴퓨터에서 VIV PC 주소가 열리는지 확인하세요.':'인터넷 연결을 확인하세요. 휴대폰에서 열었다면 설치한 컴퓨터와 같은 Tailscale 네트워크에 연결되어 있는지도 확인하세요.'}</p>
    <button type="button">다시 연결</button>
    ${privateOrigin?`<p>설치한 컴퓨터에서 VIV PC 주소가 열리면 휴대폰 연결을 복구하세요. PC에서도 열리지 않으면 아래에서 서버 다시 시작 방법을 확인하세요.</p>
    <a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#모바일만-복구하기" target="_blank" rel="noopener noreferrer">모바일 연결 복구 안내 (새 탭)</a>`:''}
    <details>
      <summary>서버 다시 시작</summary>
      <p>원래 VIV 설치 폴더에서 운영체제에 맞는 명령을 실행하세요.</p>
      <strong>Windows</strong>
      <code>powershell.exe -NoProfile -ExecutionPolicy Bypass -File .&#92;scripts&#92;install-viv.ps1 -Resume</code>
      <strong>Mac</strong>
      <code>bash scripts/install-viv-mac.sh --resume</code>
    </details>
    <a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#서버-다시-시작" target="_blank" rel="noopener noreferrer">서버 다시 시작 안내 (새 탭)</a>
  </main>
  <script>
  const retry = document.querySelector('button');
  const status = document.querySelector('#connection-status');
  retry.addEventListener('click', async () => {
    if (retry.getAttribute('aria-disabled') === 'true') return;
    retry.setAttribute('aria-disabled', 'true');
    status.textContent = 'VIV 연결을 확인하고 있어요…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const page = await fetch(location.pathname + location.search, {
        cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: controller.signal
      });
      if (page.status === 401 || page.status === 403) {
        status.textContent = ${privateOrigin?"'접근이 거부됐어요. 휴대폰의 Tailscale 로그인과 접속 권한을 확인하세요.'":"'접근이 거부됐어요. 현재 주소의 접속 권한을 확인하세요.'"};
        return;
      }
      if (page.ok) {
        const entry = location.pathname === '/install.html' ? 'viv-install-entry' : 'viv-app-entry';
        if (/^text\\/html\\b/i.test(page.headers.get('Content-Type') || '') &&
            (await page.text()).includes('id="' + entry + '"')) {
          location.reload();
          return;
        }
        status.textContent = '이 주소에서 VIV 화면을 확인할 수 없어요. PC에서 확인한 VIV 설치 주소와 비교하세요.';
        return;
      }
      status.textContent = '아직 VIV 서버에 연결할 수 없어요. 설치한 컴퓨터에서 VIV PC 주소를 확인하세요.';
    } catch {
      status.textContent = navigator.onLine === false
        ? '휴대폰이 오프라인이에요. 네트워크에 연결한 뒤 다시 시도하세요.'
        : '아직 VIV 서버에 연결할 수 없어요. 설치한 컴퓨터에서 VIV PC 주소를 확인하세요.';
    } finally {
      clearTimeout(timeout);
      retry.removeAttribute('aria-disabled');
    }
  });
  </script>
</body>
</html>`;

self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data||typeof data.id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(data.id))return;
 const url=new URL(data.url,self.location.origin);
 if(url.origin!==self.location.origin||url.pathname!=='/'||!url.hash.startsWith('#minds?'))return;
 const ready=data.approvalReady===true;
 event.waitUntil(self.registration.showNotification(ready?String(data.title).slice(0,200):'VIV · 확인할 요청이 있습니다',{body:ready?String(data.body).slice(0,2000):'앱에서 대상과 변경 내용을 확인하세요.',icon:'/viv-icon-192.png',badge:'/viv-icon-192.png',tag:'cji-'+data.id,actions:ready?[{action:'approve',title:'승인'},{action:'open',title:'내용 보기'}]:[],data:{id:data.id,url:url.href,approvalReady:ready}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url??'/',self.location.origin);
 if(url.origin!==self.location.origin||url.pathname!=='/'||!url.hash.startsWith('#minds?'))return;
 event.waitUntil((async()=>{
  if(event.action==='approve'&&event.notification.data?.approvalReady===true){
   const id=event.notification.data.id;if(typeof id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(id))return;
   try{const response=await fetch('/api/app-notifications/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}),result=await response.json(),pending=result.status==='PROCESSING',ok=response.ok&&result.ok===true&&['APPROVED','PROCESSING'].includes(result.status);
    await self.registration.showNotification(ok?(pending?'VIV · 승인 처리 중':'VIV · 승인 완료'):'VIV · 승인 확인 필요',{body:ok?(pending?'처리가 끝나면 앱에서 결과를 확인하세요.':result.runtimeStatus==='DISABLED'?'승인을 저장했습니다. 실행 서버는 중지 상태입니다.':'승인을 반영했습니다. 앱에서 운용 상태를 확인하세요.'):result.message??'앱에서 요청 상태를 확인하세요.',icon:'/viv-icon-192.png',tag:'cji-'+id,data:{id,url:url.href,approvalReady:false}});
   }catch{await self.registration.showNotification('VIV · 승인 결과 확인 필요',{body:'연결이 끊겼습니다. 앱에서 처리 결과를 확인하세요.',tag:'cji-'+id,data:{id,url:url.href,approvalReady:false}});}return;
  }
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),existing=windows.find(w=>new URL(w.url).origin===url.origin);if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);
 })());
});
