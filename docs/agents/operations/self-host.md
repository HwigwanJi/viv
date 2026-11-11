# VIV 독립 설치

에이전트에게 다음과 같이 요청할 수 있다.

> 이 저장소의 VIV를 Windows에 원샷으로 설치해 줘. 사용할 환경을 먼저 물어보고, 내 선택에 맞춰 앱·서버·MCP를 설치하고 확인해 줘.

## Windows 서버와 휴대폰

1. 에이전트는 **“VIV를 어느 환경에서 사용하실 건가요? 1. PC / 2. PC와 모바일 둘 다 / 0. 취소”**라고 한 번 묻는다. 사용자 메시지에 환경이 명확하면 그 선택을 바로 사용한다. 번호와 자연어를 모두 받아들이고 취소하면 설치를 시작하지 않는다.
2. 접근 가능한 Git 저장소를 새 Windows 폴더에 clone한다. 아래 명령을 실행하면 선택 메뉴가 나온다. 에이전트는 답을 받은 뒤 `-Target PC` 또는 `-Target PCMobile`을 전달한다. Windows의 Node.js 24 이상과 npm을 확인하고, 필요하면 WinGet으로 Node.js LTS를 설치한다. 잠금 파일로 앱을 빌드하고 이 checkout의 `.runtime/self-host.sqlite`에서 서버를 실행한다. Codex에서 진행할 때는 MCP를 등록하고, 다른 AI 앱에서는 `-Client Manual`로 실행해 해당 클라이언트에 지원되는 연결 방법을 사용한다.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-viv.ps1
   ```

3. 모바일을 선택한 경우에만 Tailscale을 준비한다. PC에서 사용자가 자기 계정으로 로그인하고, 필요한 경우 자기 tailnet에서 MagicDNS와 HTTPS 인증서를 활성화한다. VIV 서버는 루프백에서 수신한다. 다른 앱이 사용하는 경로나 공개 Funnel 설정이 있으면 PC 앱과 MCP를 쓸 수 있게 두고 모바일에 필요한 조치를 알려준다. VIV는 비공개 주소의 접속을 단일 소유자 세션으로 처리하므로 tailnet에서 접근 가능한 장치와 사용자 범위를 확인한다.
4. 같은 tailnet에 로그인한 휴대폰에서 결과의 `mobileInstallUrl`을 연다. Android는 Chrome에서 **웹앱으로 설치**, iPhone은 Safari의 **공유 → 홈 화면에 추가**를 사용한다. 설치한 아이콘에서 VIV를 열고 PC와 같은 작업 공간이 표시되는지 확인한다. 설치 스크립트가 검사한 HTTPS와 휴대폰에서 확인한 결과를 각각 남긴다.
5. 모바일 로그인이나 MCP 등록 후속 조치가 필요하면 같은 환경과 포트로 설치 명령을 다시 실행한다. 가동 중인 같은 checkout의 서버는 재사용한다. PC 재시작 후에 빌드를 생략하고 다시 실행할 때는 `scripts/setup-self-host.ps1 -StartOnly`에 기존 포트와 필요한 `-Mobile`·`-CodexMcp`를 전달한다. 오류 로그는 checkout의 `.runtime/self-host.stderr.log`에 있다.

결과에는 PC 앱 주소와 MCP 등록 상태가 나온다. 모바일 HTTPS 검증을 통과하면 휴대폰 설치 주소와 `phone-install-pending`이 나온다. 실제 휴대폰 설치 완료는 사용자가 홈 화면에서 VIV를 연 뒤 확인한다. 실행 중인 Windows PC가 앱 서버다. 최초 설치는 자동 주문 실행기가 꺼진 상태에서 시작한다.

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
