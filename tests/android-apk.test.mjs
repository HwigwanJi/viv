import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {androidAppConfig,androidAssetLinks,vivAndroidLaunchManifest} from '../scripts/build-android-apk.mjs';
const web=JSON.parse(fs.readFileSync('dist/manifest.json','utf8')),origin='https://chungji-test.example-tailnet.ts.net',fingerprint=Array(32).fill('AB').join(':');
test('APK uses canonical private app and notification shortcut without adding financial actions or embedded credentials',()=>{
 const c=androidAppConfig(web,origin,fingerprint);assert.equal(c.startUrl,web.start_url);assert.equal(c.enableNotifications,true);assert.equal(c.minSdkVersion,24);assert.equal(c.fallbackType,'customtabs');assert.equal(c.host,new URL(origin).host);assert.equal(c.shortcuts[0].url,origin+web.shortcuts[0].url);assert.equal(c.shortcuts[0].url.includes('notice=inbox'),true);
 assert.deepEqual(androidAssetLinks(c,fingerprint),[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:c.packageId,sha256_cert_fingerprints:[fingerprint]}}]);
 assert.doesNotMatch(JSON.stringify(c),/127\.0\.0\.1|localhost|access[_-]?key|secret|userConfirmedAt|activate|approve/i);
 assert.throws(()=>androidAppConfig(web,'http://app.test',fingerprint),/HTTPS/);assert.throws(()=>androidAppConfig({...web,start_url:'https://other.test/'},origin,fingerprint),/SAME_ORIGIN/);assert.throws(()=>androidAssetLinks(c,'invalid'),/CERTIFICATE/);
});
test('existing installation page offers the signed APK while retaining web installation',()=>{
 const html=fs.readFileSync('dist/install.html','utf8');assert.match(html,/href="\.\/downloads\/viv-1\.0\.2\.apk" download/);assert.match(html,/data-app-install/);assert.match(html,/Tailscale/);
});
test('Android uses dedicated VIV splash artwork and the current launcher icon',()=>{
 const config=androidAppConfig(web,origin,fingerprint);
 assert.equal(config.launcherName,'VIV');
 assert.equal(config.iconUrl,origin+'/viv-icon-512.png');
 assert.equal(config.appVersionCode,3);
 const manifest=vivAndroidLaunchManifest('<activity android:name="LauncherActivity"><meta-data android:resource="@drawable/splash"/></activity>');
 assert.match(manifest,/android:theme="@style\/VivLaunch"/);
 assert.match(manifest,/@drawable\/viv_launch_art/);
 assert.throws(()=>vivAndroidLaunchManifest('<manifest/>'),/ANDROID_LAUNCH_TEMPLATE_CHANGED/);
 const artwork=fs.readFileSync('android/viv-splash.png');
 assert.equal(artwork.readUInt32BE(16),1200);
 assert.equal(artwork.readUInt32BE(20),1200);
});
