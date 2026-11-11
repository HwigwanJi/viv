import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateMobileOrigin,privateMobileRouteStatus,verifyMobileInstallAddress,previewRequestOrigin} from '../scripts/preview-origin.mjs';
import {handleAPI} from '../server/api.mjs';
import {createAppInstall,chromeInstallLink,installPlatform,manualInstallGuide} from '../dist/ui/app-install.mjs';
import {versionAssetBundle} from '../scripts/asset-versioning.mjs';

const origin='https://chungji-test.example-tailnet.ts.net';
const incoming=(host,address='127.0.0.1')=>({headers:{host},socket:{remoteAddress:address}});
test('only the configured private HTTPS host and loopback proxy qualify; arbitrary forwarded hosts stay rejected',()=>{
  assert.equal(validateMobileOrigin(origin),origin);
  for(const value of ['https://foreign.test','http://a.b.ts.net','https://a.b.ts.net:8443','https://a.b.ts.net/path','https://a.b.ts.net/','https://user@a.b.ts.net'])assert.throws(()=>validateMobileOrigin(value));
  for(const host of ['localhost:4905','127.0.0.1:4905','[::1]:4905'])assert.equal(previewRequestOrigin(incoming(host),4905),`http://${host}`);
  assert.equal(previewRequestOrigin(incoming(new URL(origin).host),4905,origin),origin);
  assert.throws(()=>previewRequestOrigin(incoming(new URL(origin).host),4905));
  assert.throws(()=>previewRequestOrigin(incoming(new URL(origin).host,'192.168.1.10'),4905,origin));
  const attacker=incoming('attacker.test');attacker.headers['x-forwarded-host']=new URL(origin).host;attacker.headers['x-forwarded-proto']='https';
  assert.throws(()=>previewRequestOrigin(attacker,4905,origin));
});

test('desktop and Mac setup recognize only the expected private Serve route',()=>{
  const local='http://127.0.0.1:4317',host=new URL(origin).host+':443';
  const config={Web:{[host]:{Handlers:{'/':{Proxy:local+'/'}}}},TCP:{443:{HTTPS:true}}};
  assert.equal(privateMobileRouteStatus(config,origin,local),'ready');
  assert.equal(privateMobileRouteStatus({...config,AllowFunnel:{[host]:true}},origin,local),'public');
  assert.equal(privateMobileRouteStatus(config,origin,'http://127.0.0.1:1234'),'conflict');
  assert.equal(privateMobileRouteStatus({TCP:{443:{TCPForward:'127.0.0.1:4317'}}},origin,local),'conflict');
  assert.equal(privateMobileRouteStatus({},origin,local),'missing');
});

test('desktop handoff exposes an HTTPS address only after matching its installation',async()=>{
  const identity='expected-setup';
  const verify=async (url,options)=>{
    assert.equal(url,origin+'/install.html');
    assert.equal(options.method,'HEAD');
    assert.equal(options.redirect,'error');
    return new Response(null,{headers:{'X-VIV-Setup':identity}});
  };
  assert.deepEqual(await verifyMobileInstallAddress(origin,identity,verify),{status:'ready',url:origin+'/install.html'});
  for(const upstream of [
    async()=>new Response(null,{headers:{'X-VIV-Setup':'another-setup'}}),
    async()=>new Response(null,{status:404,headers:{'X-VIV-Setup':identity}}),
    async()=>{throw Error('network');},
  ])assert.deepEqual(await verifyMobileInstallAddress(origin,identity,upstream),{status:'unreachable'});
  for(const url of ['https://other.test','',null]){
    let fetched=false;
    const result=await verifyMobileInstallAddress(url,identity,async()=>{fetched=true;});
    assert.deepEqual(result,{status:'unreachable'});
    assert.equal(fetched,false);
  }
});

test('private same-origin requests reach the existing handler while foreign Origin and cross-site headers fail',async()=>{
  const base=previewRequestOrigin(incoming(new URL(origin).host),4905,origin);
  for(const [requestOrigin,site,status] of [[origin,'same-origin',410],['https://foreign.test','same-origin',403],[origin,'cross-site',403]]){
    const result=await handleAPI(new Request(base+'/api/jev',{method:'POST',headers:{Origin:requestOrigin,'Sec-Fetch-Site':site,'oai-authenticated-user-id':'local-preview-owner'}}));
    assert.equal(result.status,status);
    assert.equal((await result.json()).code,status===403?'ORIGIN':'CANONICAL_ENDPOINT_REQUIRED');
  }
});

function installFixture({standalone=false,apple=false,pathname='/'}={}){
  const events=new Map(),button={},nativeButton={dataset:{appInstallNative:''}},dialogs=[],errors=[],notices=[];
  const window={location:{href:origin+pathname+'?private=value#mind',pathname},matchMedia:()=>({matches:standalone}),document:{querySelectorAll:()=>[button,nativeButton]},addEventListener:(key,handler)=>events.set(key,handler)};
  const app=createAppInstall({window,navigator:{userAgent:apple?'iPhone':'Android'},open:(...args)=>dialogs.push(args),onError:value=>errors.push(value),onInstalled:()=>notices.push('installed'),onDismissed:()=>notices.push('dismissed')});
  return {app,events,button,nativeButton,dialogs,errors,notices};
}
test('native installation uses the user gesture once, blocks duplicate clicks, and removes the installed action',async()=>{
  const f=installFixture();let calls=0,choice,prevented=false;
  f.events.get('beforeinstallprompt')({preventDefault(){prevented=true;},prompt:async()=>{calls++;},userChoice:new Promise(resolve=>choice=resolve)});
  assert.equal(prevented,true);const first=f.app.install();await f.app.install();assert.equal(calls,1);assert.equal(f.button.disabled,true);
  choice({outcome:'accepted'});await first;assert.equal(f.button.disabled,false);
  f.events.get('appinstalled')();assert.equal(f.app.button(),'');assert.equal(f.button.hidden,true);assert.deepEqual(f.notices,['installed']);
});
test('install fallback explains each phone menu and standalone apps omit installation; prompt failures recover',async()=>{
  for(const apple of [false,true]){const f=installFixture({apple});await f.app.install();assert.match(f.dialogs[0][1],apple?/Safari/:/Chrome/);assert.match(f.dialogs[0][1],/Tailscale/);}
  const installed=installFixture({standalone:true});assert.equal(installed.app.button(),'');await installed.app.install();assert.equal(installed.dialogs.length,0);
  const f=installFixture();f.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{throw Error('cancelled');}});await f.app.install();assert.deepEqual(f.errors,['cancelled']);assert.equal(f.button.disabled,false);await f.app.install();assert.equal(f.dialogs.length,1);
});

test('a delayed native prompt becomes actionable inside the already open help dialog',async()=>{
  const f=installFixture();await f.app.install();assert.match(f.dialogs[0][2],/data-app-install-native/);assert.equal(f.nativeButton.hidden,true);let called=false;
  f.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>called=true,userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(f.nativeButton.hidden,false);await f.app.install();assert.equal(called,true);assert.equal(f.nativeButton.hidden,true);
});
test('the install page waits for a native prompt and Android Chrome links preserve only this origin',async()=>{
  const link=chromeInstallLink(origin+'/?private=secret#position');assert.match(link,/^intent:\/\/chungji-test\.example-tailnet\.ts\.net\/install\.html#Intent;scheme=https;package=com\.android\.chrome;/);assert.doesNotMatch(link,/secret|position/);
  for(const href of ['http://example.test','javascript:alert(1)','https://user:password@example.test']){try{assert.equal(chromeInstallLink(href),null);}catch(error){assert(error instanceof TypeError);}}
  const page=await readFile('dist/install.html','utf8');assert.match(page,/<button[^>]+data-app-install-native hidden>웹앱으로 설치<\/button>/);assert.match(page,/rel="manifest"/);assert.match(page,/install-page\.mjs/);
  assert.match(page,/<a[^>]+data-install-open href="\/#home\?executionMode=paper">VIV 열기<\/a>/);
});

test('manual install uses the device menu, avoids a loop on the install page and recovers after dismissal',async()=>{
  const ipad={userAgent:'Macintosh AppleWebKit',platform:'MacIntel',maxTouchPoints:5};
  assert.equal(installPlatform(ipad),'apple');
  assert.match(manualInstallGuide(ipad),/웹 앱으로 열기/);
  assert.equal(installPlatform({userAgent:'Desktop',platform:'MacIntel',maxTouchPoints:0}),'desktop');
  const f=installFixture({apple:true,pathname:'/install.html'});
  await f.app.install();
  assert.doesNotMatch(f.dialogs[0][1],/href="\/install.html"/);
  f.events.get('beforeinstallprompt')({preventDefault(){},prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});
  await f.app.install();
  assert.deepEqual(f.notices,['dismissed']);
  assert.equal(f.nativeButton.hidden,true);
});

test('manifest launches the shared app with correctly sized PNG icons and the embedded build preserves binary bytes',async()=>{
  const html=await readFile('dist/index.html','utf8'),manifest=JSON.parse(await readFile('dist/manifest.json','utf8'));
  assert.match(html,/rel="manifest" href="\.\/manifest.json"/);assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
  assert.equal(new URL(manifest.start_url,'https://app.test').origin,'https://app.test');
  const assets={};
  for(const icon of manifest.icons){const bytes=await readFile('dist'+icon.src),size=Number(icon.sizes.split('x')[0]);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assets[icon.src]={type:'image/png',encoding:'base64',body:bytes.toString('base64')};}
  const built=await versionAssetBundle(assets);for(const [name,asset]of Object.entries(built.assets))assert.deepEqual(Buffer.from(asset.body,'base64'),await readFile('dist'+name));
  assert.doesNotMatch(await readFile('dist/ui/app-install.mjs','utf8'),/serviceWorker\.register|caches\.open/);
});
