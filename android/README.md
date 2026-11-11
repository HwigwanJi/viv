# 청지 Android APK

기존 청지 HTTPS 앱을 여는 Google Trusted Web Activity 패키지다. 브라우저의 보안 갱신과 기존 알림함·Web Push·승인 화면을 함께 사용한다.

- 패키지: `kr.chungji.investment`, 버전 `1.0.0`, Android 7 이상
- 앱 주소: `.runtime/mobile-access.json`의 기존 비공개 HTTPS 주소
- APK 빌드를 게시한 경우 다운로드는 `/downloads/chungji-1.0.0.apk`다. 휴대폰 설치 안내는 `/install.html`에서 연다.
- 휴대폰에서 Tailscale과 Chrome을 준비하고 알림을 한 번 허용한다. PC 앱 서버도 켜져 있어야 한다.
- 승인 대기 알림의 `승인` 버튼은 기존 운용 승인 API를 한 번 호출해 확정한다. 알림 본문·`내용 보기`·바로가기는 해당 `notice` 화면을 연다. 서버의 알림 코드는 앱을 다시 열 때 갱신되므로 이 변경에 APK 재설치는 필요 없다.

## 빌드

`scripts/build-android-apk.mjs`는 정식 `dist/manifest.json`으로 Bubblewrap 1.27.0 프로젝트를 `.runtime/android-project/`에 생성하고 Gradle 빌드, 정렬, 릴리스 서명, 서명·패키지 검사를 수행한다. 검사 후 APK와 `.well-known/assetlinks.json`을 기존 앱 서버에 게시한다. 새 설치에서 빌드할 때는 서버를 먼저 실행하고 `KEYNES_PREVIEW_PORT`를 그 로컬 포트로 지정한다. 관리형 서버의 기본 포트는 4905다.

필요 도구는 `.runtime/android-tools`의 `@bubblewrap/cli@1.27.0`, JDK17, Android SDK36·build-tools35.0.0이다. 기존 설치를 쓸 때는 `JAVA_HOME`과 `ANDROID_HOME`을 지정한다. 프로젝트 기본 전용 도구 경로는 빌드 스크립트에 있다.

```powershell
npm.cmd install --prefix .runtime/android-tools --save-exact @bubblewrap/cli@1.27.0
node --test tests/android-apk.test.mjs tests/mobile-app.test.mjs
node scripts/build-android-apk.mjs
```

서명 키와 암호는 `.runtime/android-signing/`에 별도 보존한다. 앱 업데이트에도 같은 키를 사용하므로 이 폴더를 개인 백업에 포함한다. APK와 공개 소스에는 키·암호·계좌 인증정보를 넣지 않는다. 버전을 올릴 때는 빌드 설정과 다운로드 링크를 함께 갱신한다.

실제 빌드·서명·지원 버전과 APK SHA256은 `artifacts/cji-android-apk-20261027/build-verification.json`에 기록된다. 휴대폰 설치, 비공개 주소의 Digital Asset Links 확인과 푸시 수신은 해당 기기에서 확인한다. 브라우저의 주소 검증이 완료될 때까지는 브라우저 상단 표시가 나올 수 있다.

공식 구현 안내: https://developer.chrome.com/docs/android/trusted-web-activity/quick-start
