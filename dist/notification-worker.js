self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data||typeof data.id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(data.id))return;
 const url=new URL(data.url,self.location.origin);
 if(url.origin!==self.location.origin||url.pathname!=='/'||!url.hash.startsWith('#minds?'))return;
 const ready=data.approvalReady===true;
 event.waitUntil(self.registration.showNotification(ready?String(data.title).slice(0,200):'VIV · 확인할 요청이 있습니다',{body:ready?String(data.body).slice(0,2000):'앱에서 대상과 변경 내용을 확인하세요.',icon:'/app-icon-192.png',badge:'/app-icon-192.png',tag:'cji-'+data.id,actions:ready?[{action:'approve',title:'승인'},{action:'open',title:'내용 보기'}]:[],data:{id:data.id,url:url.href,approvalReady:ready}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url??'/',self.location.origin);
 if(url.origin!==self.location.origin||url.pathname!=='/'||!url.hash.startsWith('#minds?'))return;
 event.waitUntil((async()=>{
  if(event.action==='approve'&&event.notification.data?.approvalReady===true){
   const id=event.notification.data.id;if(typeof id!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(id))return;
   try{const response=await fetch('/api/app-notifications/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}),result=await response.json(),pending=result.status==='PROCESSING',ok=response.ok&&result.ok===true&&['APPROVED','PROCESSING'].includes(result.status);
    await self.registration.showNotification(ok?(pending?'VIV · 승인 처리 중':'VIV · 승인 완료'):'VIV · 승인 확인 필요',{body:ok?(pending?'처리가 끝나면 앱에서 결과를 확인하세요.':result.runtimeStatus==='DISABLED'?'승인을 저장했습니다. 실행 서버는 중지 상태입니다.':'승인을 반영했습니다. 앱에서 운용 상태를 확인하세요.'):result.message??'앱에서 요청 상태를 확인하세요.',icon:'/app-icon-192.png',tag:'cji-'+id,data:{id,url:url.href,approvalReady:false}});
   }catch{await self.registration.showNotification('VIV · 승인 결과 확인 필요',{body:'연결이 끊겼습니다. 앱에서 처리 결과를 확인하세요.',tag:'cji-'+id,data:{id,url:url.href,approvalReady:false}});}return;
  }
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),existing=windows.find(w=>new URL(w.url).origin===url.origin);if(existing){await existing.navigate(url.href);await existing.focus();}else await self.clients.openWindow(url.href);
 })());
});
