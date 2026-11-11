import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomBytes,X509Certificate,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {validateMobileOrigin} from './preview-origin.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),at=p=>path.join(root,p),read=p=>JSON.parse(fs.readFileSync(at(p),'utf8'));
const check=(v,message)=>{if(!v)throw Error(message);},write=(p,value)=>{fs.mkdirSync(path.dirname(at(p)),{recursive:true});fs.writeFileSync(at(p),value);};
export function androidAppConfig(web,origin,fingerprint){
 let url;try{url=new URL(validateMobileOrigin(origin));}catch{throw Error('PRIVATE_HTTPS_ORIGIN_REQUIRED');}
 const start=new URL(web.start_url,url);check(start.origin===url.origin,'SAME_ORIGIN_START_REQUIRED');
 return {packageId:'kr.chungji.investment',host:url.host,name:web.name,launcherName:web.short_name,display:'standalone',themeColor:web.theme_color,navigationColor:web.background_color,backgroundColor:web.background_color,startUrl:start.pathname+start.search+start.hash,iconUrl:new URL('/app-icon-512.png',url).href,maskableIconUrl:new URL('/app-icon-512.png',url).href,enableNotifications:true,enableSiteSettingsShortcut:true,splashScreenFadeOutDuration:200,appVersion:'1.0.1',appVersionCode:2,minSdkVersion:24,fallbackType:'customtabs',fullScopeUrl:url.href,webManifestUrl:new URL('/manifest.json',url).href,signingKey:{path:'../.runtime/android-signing/chungji.p12',alias:'chungji'},fingerprints:[{name:'Local release',value:fingerprint}],shortcuts:(web.shortcuts??[]).map(s=>({name:s.name,shortName:s.short_name,url:new URL(s.url,url).href,chosenIconUrl:new URL('/app-icon-192.png',url).href})),generatorApp:'bubblewrap-1.27.0'};
}
export function androidAssetLinks(config,fingerprint){
 check(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint),'CERTIFICATE_SHA256_REQUIRED');
 return [{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:config.packageId,sha256_cert_fingerprints:[fingerprint]}}];
}
async function main(){
 const jdk=process.env.JAVA_HOME??at('.runtime/android-toolchain/jdk/jdk-17.0.21.0.2+1'),sdk=process.env.ANDROID_HOME??at('.runtime/android-toolchain/sdk'),java=path.join(jdk,'bin/java.exe'),keytool=path.join(jdk,'bin/keytool.exe'),tools=path.join(sdk,'build-tools/35.0.0');
 for(const f of [java,keytool,path.join(tools,'zipalign.exe'),path.join(tools,'lib/apksigner.jar')])check(fs.existsSync(f),'BUILD_TOOL_MISSING: '+f);
 const signing=at('.runtime/android-signing'),keyFile=path.join(signing,'chungji.p12'),passwordFile=path.join(signing,'password.txt');fs.mkdirSync(signing,{recursive:true});
 if(!fs.existsSync(passwordFile)){check(!fs.existsSync(keyFile),'EXISTING_SIGNING_PASSWORD_REQUIRED');fs.writeFileSync(passwordFile,randomBytes(36).toString('base64url'),{flag:'wx',mode:0o600});}
 const env={...process.env,JAVA_HOME:jdk,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,CJI_ANDROID_KEY_PASSWORD:fs.readFileSync(passwordFile,'utf8').trim()},keyArgs=['-keystore',keyFile,'-storepass:env','CJI_ANDROID_KEY_PASSWORD','-alias','chungji'];
 if(!fs.existsSync(keyFile))execFileSync(keytool,['-genkeypair',...keyArgs,'-keypass:env','CJI_ANDROID_KEY_PASSWORD','-storetype','PKCS12','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=VIV Personal App'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const certificate=execFileSync(keytool,['-exportcert',...keyArgs],{env,windowsHide:true}),fingerprint=new X509Certificate(certificate).fingerprint256;
 const config=androidAppConfig(read('dist/manifest.json'),read('.runtime/mobile-access.json').origin,fingerprint),require=createRequire(import.meta.url),{TwaManifest,TwaGenerator,ConsoleLog}=require(at('.runtime/android-tools/node_modules/@bubblewrap/core'));
 const project='.runtime/android-project';
 config.signingKey.path='../android-signing/chungji.p12';
 const canonical=new TwaManifest(config);check(!canonical.validate(),canonical.validate());write(project+'/twa-manifest.json',JSON.stringify(config,null,2)+'\n');
 // Only build-time asset fetches use loopback; the installed app always opens private HTTPS.
 const localPort=Number(process.env.KEYNES_PREVIEW_PORT??4905);check(Number.isInteger(localPort)&&localPort>=1024&&localPort<=65535,'INVALID_LOCAL_APP_PORT');
 const localOrigin='http://127.0.0.1:'+localPort;
 const generating=new TwaManifest(config);generating.iconUrl=generating.maskableIconUrl=localOrigin+'/app-icon-512.png';generating.webManifestUrl=undefined;
 for(const shortcut of generating.shortcuts)shortcut.chosenIconUrl=localOrigin+'/app-icon-192.png';
 await new TwaGenerator().createTwaProject(at(project),generating,new ConsoleLog('android'));
 write(project+'/app/src/main/res/raw/web_app_manifest.json',fs.readFileSync(at('dist/manifest.json')));
 write(project+'/local.properties','sdk.dir='+sdk.replaceAll('\\','/')+'\n');
 write(project+'/build.gradle',fs.readFileSync(at(project+'/build.gradle'),'utf8').replaceAll('jcenter()','mavenCentral()'));
 write(project+'/gradle.properties','org.gradle.jvmargs=-Xmx768m\norg.gradle.daemon=false\norg.gradle.workers.max=2\nandroid.useAndroidX=true\n');
 const wrapper=at(project+'/gradle/wrapper/gradle-wrapper.properties'),checksum=await (await fetch('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256')).text();check(/^[a-f0-9]{64}$/.test(checksum.trim()),'GRADLE_CHECKSUM');
 fs.appendFileSync(wrapper,'\ndistributionSha256Sum='+checksum.trim()+'\n');
 fs.mkdirSync(at('.runtime/android-toolchain'),{recursive:true});
 const log=fs.openSync(at('.runtime/android-toolchain/build.log'),'w');
 try{await new Promise((resolve,reject)=>{const child=spawn(java,['-classpath',at(project+'/gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','--no-daemon','--max-workers=2',':app:assembleRelease'],{cwd:at(project),env:{...process.env,JAVA_HOME:jdk,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,GRADLE_USER_HOME:at('.runtime/android-toolchain/gradle-cache')},windowsHide:true,stdio:['ignore',log,log]});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('GRADLE_BUILD_FAILED: see .runtime/android-toolchain/build.log')));});}finally{fs.closeSync(log);}
 const unsigned=at(project+'/app/build/outputs/apk/release/app-release-unsigned.apk'),aligned=at('.runtime/android-toolchain/chungji-aligned.apk'),apk=at('.runtime/android-toolchain/viv-1.0.1.apk');
 execFileSync(path.join(tools,'zipalign.exe'),['-f','-p','4',unsigned,aligned],{windowsHide:true});
 const signer=['-jar',path.join(tools,'lib/apksigner.jar')];execFileSync(java,[...signer,'sign','--ks',keyFile,'--ks-key-alias','chungji','--ks-pass','env:CJI_ANDROID_KEY_PASSWORD','--key-pass','env:CJI_ANDROID_KEY_PASSWORD','--out',apk,aligned],{env,windowsHide:true});
 const signature=execFileSync(java,[...signer,'verify','--verbose','--print-certs',apk],{windowsHide:true,encoding:'utf8'});check(signature.toLowerCase().includes(fingerprint.replaceAll(':','').toLowerCase()),'APK_SIGNER_MISMATCH');
 execFileSync(path.join(tools,'zipalign.exe'),['-c','-p','4',apk],{windowsHide:true});
 const badging=execFileSync(path.join(tools,'aapt.exe'),['dump','badging',apk],{windowsHide:true,encoding:'utf8'});check(badging.includes("name='"+config.packageId+"'")&&badging.includes("versionName='"+config.appVersion+"'")&&badging.includes("launchable-activity: name='"+config.packageId+".LauncherActivity'")&&!badging.includes('application-debuggable'),'APK_PACKAGE_METADATA');
 write('dist/.well-known/assetlinks.json',JSON.stringify(androidAssetLinks(config,fingerprint),null,2)+'\n');
 fs.mkdirSync(at('dist/downloads'),{recursive:true});fs.copyFileSync(apk,at('dist/downloads/viv-1.0.1.apk.tmp'));fs.renameSync(at('dist/downloads/viv-1.0.1.apk.tmp'),at('dist/downloads/viv-1.0.1.apk'));
 fs.mkdirSync(at('deliverables'),{recursive:true});fs.copyFileSync(apk,at('deliverables/viv-1.0.1.apk'));
 const report={builtAt:new Date().toISOString(),status:'SIGNED_APK_VERIFIED',packageId:config.packageId,version:config.appVersion,bytes:fs.statSync(apk).size,sha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),fingerprint,origin:'https://'+config.host,startUrl:config.startUrl,notificationsDelegated:true,download:'https://'+config.host+'/downloads/viv-1.0.1.apk',assetLinks:'https://'+config.host+'/.well-known/assetlinks.json',signature,badging,physicalPhoneInstallVerified:false};
 write('artifacts/cji-android-apk-20261027/build-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,bytes:report.bytes,download:report.download,sha256:report.sha256}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
