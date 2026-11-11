import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomBytes,X509Certificate,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {validateMobileOrigin} from './preview-origin.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),at=p=>path.join(root,p),read=p=>JSON.parse(fs.readFileSync(at(p),'utf8'));
const check=(v,message)=>{if(!v)throw Error(message);},write=(p,value)=>{fs.mkdirSync(path.dirname(at(p)),{recursive:true});fs.writeFileSync(at(p),value);};
const appVersion='1.0.2',apkName='viv-'+appVersion+'.apk';
export function androidAppConfig(web,origin,fingerprint){
 let url;try{url=new URL(validateMobileOrigin(origin));}catch{throw Error('PRIVATE_HTTPS_ORIGIN_REQUIRED');}
 const start=new URL(web.start_url,url);check(start.origin===url.origin,'SAME_ORIGIN_START_REQUIRED');
 const launcherIcon=web.icons.find(icon=>icon.sizes==='512x512'&&icon.purpose?.split(' ').includes('maskable'));
 check(launcherIcon?.src,'MASKABLE_LAUNCHER_ICON_REQUIRED');
 const iconUrl=new URL(launcherIcon.src,url).href;
 return {packageId:'kr.chungji.investment',host:url.host,name:web.name,launcherName:web.short_name,display:'standalone',themeColor:web.theme_color,navigationColor:web.background_color,backgroundColor:web.background_color,startUrl:start.pathname+start.search+start.hash,iconUrl,maskableIconUrl:iconUrl,enableNotifications:true,enableSiteSettingsShortcut:true,splashScreenFadeOutDuration:200,appVersion,appVersionCode:3,minSdkVersion:24,fallbackType:'customtabs',fullScopeUrl:url.href,webManifestUrl:new URL('/manifest.json',url).href,signingKey:{path:'../.runtime/android-signing/chungji.p12',alias:'chungji'},fingerprints:[{name:'Local release',value:fingerprint}],shortcuts:(web.shortcuts??[]).map(s=>({name:s.name,shortName:s.short_name,url:new URL(s.url,url).href,chosenIconUrl:new URL(s.icons[0].src,url).href})),generatorApp:'bubblewrap-1.27.0'};
}
export function vivAndroidLaunchManifest(manifest){
 const launcher='<activity android:name="LauncherActivity"';
 const splash='android:resource="@drawable/splash"';
 check(manifest.includes(launcher)&&manifest.includes(splash),'ANDROID_LAUNCH_TEMPLATE_CHANGED');
 return manifest.replace(launcher,launcher+'\n            android:theme="@style/VivLaunch"').replace(splash,'android:resource="@drawable/viv_launch_art"');
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
 const localAsset=url=>new URL(new URL(url).pathname,localOrigin).href;
 const generating=new TwaManifest(config);generating.iconUrl=generating.maskableIconUrl=localAsset(config.iconUrl);generating.webManifestUrl=undefined;
 for(const shortcut of generating.shortcuts)shortcut.chosenIconUrl=localAsset(shortcut.chosenIconUrl);
 await new TwaGenerator().createTwaProject(at(project),generating,new ConsoleLog('android'));
 const main=project+'/app/src/main';
 const manifest=main+'/AndroidManifest.xml';
 write(manifest,vivAndroidLaunchManifest(fs.readFileSync(at(manifest),'utf8')));
 const icon=main+'/res/mipmap-anydpi-v26/ic_launcher.xml';
 const adaptive=fs.readFileSync(at(icon),'utf8');
 check(adaptive.includes('@android:color/white'),'ANDROID_ICON_TEMPLATE_CHANGED');
 write(icon,adaptive.replace('@android:color/white','@color/backgroundColor'));
 write(main+'/res/drawable-xxxhdpi/viv_launch_art.png',fs.readFileSync(at('android/viv-splash.png')));
 const launchTheme='<resources><style name="VivLaunch" parent="@android:style/Theme.Translucent.NoTitleBar"><item name="android:windowBackground">@color/backgroundColor</item>';
 write(main+'/res/values/viv-launch.xml',launchTheme+'</style></resources>');
 write(main+'/res/values-v31/viv-launch.xml',launchTheme+'<item name="android:windowSplashScreenBackground">@color/backgroundColor</item><item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item></style></resources>');
 write(project+'/app/src/main/res/raw/web_app_manifest.json',fs.readFileSync(at('dist/manifest.json')));
 write(project+'/local.properties','sdk.dir='+sdk.replaceAll('\\','/')+'\n');
 write(project+'/build.gradle',fs.readFileSync(at(project+'/build.gradle'),'utf8').replaceAll('jcenter()','mavenCentral()'));
 write(project+'/gradle.properties','org.gradle.jvmargs=-Xmx768m\norg.gradle.daemon=false\norg.gradle.workers.max=2\nandroid.useAndroidX=true\n');
 const wrapper=at(project+'/gradle/wrapper/gradle-wrapper.properties'),checksum=await (await fetch('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256')).text();check(/^[a-f0-9]{64}$/.test(checksum.trim()),'GRADLE_CHECKSUM');
 fs.appendFileSync(wrapper,'\ndistributionSha256Sum='+checksum.trim()+'\n');
 fs.mkdirSync(at('.runtime/android-toolchain'),{recursive:true});
 const log=fs.openSync(at('.runtime/android-toolchain/build.log'),'w');
 try{await new Promise((resolve,reject)=>{const child=spawn(java,['-classpath',at(project+'/gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','--no-daemon','--max-workers=2',':app:assembleRelease'],{cwd:at(project),env:{...process.env,JAVA_HOME:jdk,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,GRADLE_USER_HOME:at('.runtime/android-toolchain/gradle-cache')},windowsHide:true,stdio:['ignore',log,log]});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('GRADLE_BUILD_FAILED: see .runtime/android-toolchain/build.log')));});}finally{fs.closeSync(log);}
 const unsigned=at(project+'/app/build/outputs/apk/release/app-release-unsigned.apk'),aligned=at('.runtime/android-toolchain/chungji-aligned.apk'),apk=at('.runtime/android-toolchain/'+apkName);
 execFileSync(path.join(tools,'zipalign.exe'),['-f','-p','4',unsigned,aligned],{windowsHide:true});
 const signer=['-jar',path.join(tools,'lib/apksigner.jar')];execFileSync(java,[...signer,'sign','--ks',keyFile,'--ks-key-alias','chungji','--ks-pass','env:CJI_ANDROID_KEY_PASSWORD','--key-pass','env:CJI_ANDROID_KEY_PASSWORD','--out',apk,aligned],{env,windowsHide:true});
 const signature=execFileSync(java,[...signer,'verify','--verbose','--print-certs',apk],{windowsHide:true,encoding:'utf8'});check(signature.toLowerCase().includes(fingerprint.replaceAll(':','').toLowerCase()),'APK_SIGNER_MISMATCH');
 execFileSync(path.join(tools,'zipalign.exe'),['-c','-p','4',apk],{windowsHide:true});
 const badging=execFileSync(path.join(tools,'aapt.exe'),['dump','badging',apk],{windowsHide:true,encoding:'utf8'});check(badging.includes("name='"+config.packageId+"'")&&badging.includes("versionName='"+config.appVersion+"'")&&badging.includes("launchable-activity: name='"+config.packageId+".LauncherActivity'")&&!badging.includes('application-debuggable'),'APK_PACKAGE_METADATA');
 const resources=execFileSync(path.join(tools,'aapt2.exe'),['dump','resources',apk],{windowsHide:true,encoding:'utf8'});
 const nativeLaunchAssets=['drawable/viv_launch_art','style/VivLaunch','mipmap/ic_launcher'];
 check(nativeLaunchAssets.every(name=>resources.includes(name)),'APK_LAUNCH_RESOURCES_MISSING');
 write('dist/.well-known/assetlinks.json',JSON.stringify(androidAssetLinks(config,fingerprint),null,2)+'\n');
 fs.mkdirSync(at('dist/downloads'),{recursive:true});fs.copyFileSync(apk,at('dist/downloads/'+apkName+'.tmp'));fs.renameSync(at('dist/downloads/'+apkName+'.tmp'),at('dist/downloads/'+apkName));
 fs.mkdirSync(at('deliverables'),{recursive:true});fs.copyFileSync(apk,at('deliverables/'+apkName));
 const report={builtAt:new Date().toISOString(),status:'SIGNED_APK_VERIFIED',packageId:config.packageId,version:config.appVersion,bytes:fs.statSync(apk).size,sha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),fingerprint,origin:'https://'+config.host,startUrl:config.startUrl,nativeLaunchAssets,notificationsDelegated:true,download:'https://'+config.host+'/downloads/'+apkName,assetLinks:'https://'+config.host+'/.well-known/assetlinks.json',signature,badging,physicalPhoneInstallVerified:false};
 write('artifacts/viv-android-release/build-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,bytes:report.bytes,download:report.download,sha256:report.sha256}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
