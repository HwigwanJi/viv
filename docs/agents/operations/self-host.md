# VIV 독립 설치

에이전트에게 다음과 같이 요청할 수 있다.

> 이 VIV 저장소를 새 폴더에 받아 Windows에 설치해 줘. 내 Tailscale과 AI 앱에 연결하고 휴대폰 설치 주소를 알려줘. VIV MCP까지 연결되면 VIV 시작하기로 진행해 줘.

## Windows 서버와 휴대폰

1. Git 저장소를 새 폴더에 clone하고 Node.js 24 LTS와 npm을 설치한다. Windows에서 Node 설치 후 새 PowerShell을 열고 저장소 루트로 이동한다.
2. 아래 명령을 실행한다. 잠금 파일의 의존성을 설치하고 로컬 서버용 빌드를 실행한다. 이 checkout의 `.runtime/self-host.sqlite`에 새 데이터를 저장한다. 로컬 앱만 먼저 확인하려면 `-Mobile`을 생략한다.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-self-host.ps1 -Mobile -CodexMcp
   ```

3. Tailscale이 없으면 설치한다. PC에서 사용자가 자기 계정으로 로그인하고, 필요한 경우 자기 tailnet에서 MagicDNS와 HTTPS 인증서를 활성화한다. VIV 로컬 서버는 루프백에서만 수신한다. 스크립트는 Tailscale Serve의 비공개 HTTPS 경로를 확인하고, 이미 다른 앱이 사용 중인 경로나 공개 Funnel 설정을 발견하면 중단한다. VIV는 해당 비공개 주소의 접속을 단일 소유자 세션으로 처리하므로, tailnet 접근 규칙에서 이 서버를 사용할 장치나 사용자 범위를 확인한다.
4. 같은 tailnet에 로그인한 휴대폰에서 결과의 `mobileInstallUrl`을 연다. Android는 Chrome에서 **웹앱으로 설치**, iPhone은 Safari의 **공유 → 홈 화면에 추가**를 사용한다. 설치한 아이콘에서 VIV를 열고 PC와 같은 작업 공간이 표시되는지 확인한다. 설치 스크립트가 검사한 HTTPS와 휴대폰에서 확인한 결과를 각각 남긴다.
5. PC 재시작이나 키 수정 뒤에는 해당 설치의 서버 프로세스를 종료한 상태에서 같은 명령에 `-StartOnly`를 추가한다. 포트 충돌 시 `-Port`로 변경할 수 있다. 이미 모바일 연결을 만든 설치의 포트를 바꾸려면 먼저 그 설치가 만든 Serve 경로를 확인해 제거한다. 오류 로그는 checkout의 `.runtime/self-host.stderr.log`에 있다.

명령 성공 시 로컬 앱, 서버 DB와 실행기 상태, 모바일 설치 페이지, 앱 매니페스트와 아이콘이 확인된다. `-Mobile` 사용 시 비공개 HTTPS에서도 같은 검사를 한다. 실행 중인 Windows PC가 앱 서버다. 최초 설치는 자동 주문 실행기가 꺼진 상태에서 시작한다.

Codex 외의 AI 클라이언트나 앱을 설치한 뒤 MCP만 연결하는 방법은 [VIV MCP 플레이북](viv-mcp-playbook.md)을 따릅니다.

## 자기 API 키와 계좌

| 필요한 기능 | 설치 후 설정 |
| --- | --- |
| 앱·퀀트 편집·연구 | 자체 SQLite를 사용한다. 설치 자체에는 공급자 키가 필요 없다. |
| AI/JEV | checkout의 로컬 `.env`에 자신의 `TYPESAFE_API_KEY`를 넣고 재시작한다. 설치 결과의 `configured-unverified`는 값이 설정됐다는 뜻이다. 유효성은 사용자가 시작한 실제 AI 과업 결과로 확인한다. |
| 거래소 계좌 | 거래소에서 앱 서버의 공인 발신 IP를 허용한 후 `.env`의 `BROKER_NETWORK_READY=true`와 필요한 경우 `BROKER_EGRESS_IP`를 설정한다. VIV 설정에서 자기 거래소 키로 연결하고 먼저 잔고 조회를 확인한다. Tailscale 주소는 거래소가 보는 공인 발신 IP와 별개다. |
| KIS 읽기 시세 | 사용하는 경우 자신의 `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCESS_TOKEN`을 로컬 환경에 설정한다. |

첫 실행에서 `.env`가 없으면 설치별 `BROKER_VAULT_KEY`를 파일에 생성한다. 이후 그 파일과 DB를 함께 개인 백업한다. 공유 저장소에는 앱 소스·잠금 파일·설치 스크립트를 올리고, 실제 `.env`·DB·계좌 기록·Tailscale 주소가 들어간 생성 파일·APK 서명 키는 개인 보관한다. 새 서버에서 실전 운용이 필요하면 별도로 관리형 실행 환경을 구성하고 앱에서 본인의 계좌·자금·한도를 승인한다.

별도 Android APK가 필요한 경우에는 [APK 빌드 가이드](../../../android/README.md)를 사용한다. Windows 설치 명령의 기본 휴대폰 경로는 같은 앱을 설치하는 웹앱이다.
