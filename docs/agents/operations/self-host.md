# VIV 독립 설치

에이전트에게 다음과 같이 요청할 수 있다.

> 이 저장소의 VIV를 Windows에 원샷으로 설치해 줘. 사용할 환경을 먼저 물어보고, 내 선택에 맞춰 앱·서버·MCP를 설치하고 확인해 줘.

## Windows 서버와 휴대폰

1. 에이전트는 **“VIV를 어느 환경에서 사용하실 건가요? 1. PC / 2. PC와 모바일 둘 다 / 0. 취소”**라고 한 번 묻는다. 사용자 메시지에 환경이 명확하면 그 선택을 바로 사용한다. 번호와 자연어를 모두 받아들이고 취소하면 설치를 시작하지 않는다.
2. 접근 가능한 Git 저장소를 새 Windows 폴더에 clone한다. 아래 명령을 실행하면 선택 메뉴가 나온다. 에이전트는 답을 받은 뒤 `-Target PC` 또는 `-Target PCMobile`을 전달한다. Windows의 Node.js 24 이상과 npm을 확인하고, 필요하면 WinGet으로 Node.js LTS를 설치한다. 잠금 파일로 앱을 빌드하고 이 checkout의 `.runtime/self-host.sqlite`에서 서버를 실행한다. Codex는 기본값으로 MCP를 등록한다. Claude Code는 `-Client Claude`를 전달한다. 다른 AI 앱에서는 `-Client Manual`로 실행해 해당 클라이언트에 지원되는 연결 방법을 사용한다.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-viv.ps1
   ```

3. 모바일을 선택한 경우에만 Tailscale을 준비한다. PC에서 사용자가 자기 계정으로 로그인하고, 필요한 경우 자기 tailnet에서 MagicDNS와 HTTPS 인증서를 활성화한다. 인증서를 발급하면 장치의 전체 도메인 이름이 공개 인증서 로그에 남을 수 있다. 앱 접근은 tailnet 규칙을 따른다. 다른 앱이 사용하는 경로나 공개 Funnel 설정이 있으면 PC 앱과 MCP를 쓸 수 있게 두고 모바일에 필요한 조치를 알려준다. VIV는 비공개 주소의 접속을 단일 소유자 세션으로 처리하므로 tailnet에서 접근 가능한 장치와 사용자 범위를 확인한다. [Tailscale HTTPS 안내](https://tailscale.com/docs/how-to/set-up-https-certificates)
4. 같은 tailnet에 로그인한 휴대폰에서 결과의 `mobileInstallUrl`을 연다. Android에서는 **웹앱으로 설치** 버튼이 보이면 누른다. 버튼이 없으면 Chrome의 **더보기 → 설치** 또는 **홈 화면에 추가**를 사용한다. iPhone은 Safari의 **공유 → 홈 화면에 추가**를 사용하고 **웹 앱으로 열기**가 보이면 켠다. 홈 화면 아이콘에서 VIV를 열어 PC와 같은 작업 공간인지 확인한다.
5. 모바일 로그인이나 MCP 등록 후속 조치가 필요하면 같은 환경과 포트로 설치 명령을 다시 실행한다. 가동 중인 같은 checkout의 서버는 재사용한다. PC 재시작 후에 빌드를 생략하고 다시 실행할 때는 `scripts/setup-self-host.ps1 -StartOnly`에 기존 포트와 필요한 `-Mobile`과 `-Client Codex` 또는 `-Client Claude`를 전달한다. 오류 로그는 checkout의 `.runtime/self-host.stderr.log`에 있다.

Codex 외의 AI 클라이언트나 앱을 설치한 뒤 MCP만 연결하는 방법은 [VIV MCP 플레이북](viv-mcp-playbook.md)을 따릅니다.

## Mac 서버와 휴대폰

저장소를 복제한 뒤 `bash scripts/install-viv-mac.sh`를 실행합니다. 에이전트는 환경을 먼저 물어보고 `--target pc` 또는 `--target mobile`을 전달합니다. 기본 MCP 클라이언트는 Codex입니다. Claude Code는 `--client claude`, 기타 클라이언트는 `--client manual`을 사용합니다.

설치 스크립트는 필요한 경우 Apple Silicon 또는 Intel용 Node.js 24를 받아 해시를 검증한 뒤 VIV 폴더 안에 설치합니다. Mac 재시작 뒤에는 같은 명령을 다시 실행합니다. 서버 오류는 `.runtime/self-host.log`에서 확인합니다.

모바일을 선택하면 기존 Tailscale을 사용하거나 Homebrew를 통해 설치합니다. macOS VPN 승인과 Tailscale 로그인은 사용자가 진행합니다. Homebrew가 없는 Mac에서 Tailscale이 필요하면 공식 앱을 설치한 뒤 같은 VIV 명령을 다시 실행합니다. 비공개 HTTPS 연결이 확인되면 `mobileInstallUrl`을 같은 tailnet에 로그인한 휴대폰에서 엽니다. [Tailscale Mac 설치](https://tailscale.com/docs/install/mac)

## 설치 결과 읽기

Windows와 Mac 모두 터미널에 앱·MCP·모바일 상태를 표시합니다. 재시도 명령은 VIV 폴더에서 실행하세요.

| 결과 | 다음 행동 |
| --- | --- |
| `desktopStatus: started` 또는 `reused` | `desktopUrl`을 열어 VIV 화면을 확인하세요. `started`는 새 서버를 시작한 경우이고 `reused`는 실행 중인 서버를 그대로 쓰는 경우입니다. |
| `mcpStatus: registered` | AI 대화에 `onboardingPrompt`에 표시된 **VIV 시작하기**를 입력하세요. [첫 모의 브리핑](viv-mcp-playbook.md#첫-모의-브리핑)으로 이어갑니다. |
| `mcpStatus: endpoint-ready` | VIV의 MCP 서버가 응답합니다. 수동 연결을 선택했다면 AI 클라이언트에 `mcpUrl`을 등록하세요. |
| `mobileStatus: phone-install-pending` | 비공개 HTTPS 검증을 마쳤습니다. 휴대폰에서 `mobileInstallUrl`을 열고 홈 화면 아이콘에서 VIV가 열리는지 확인하세요. |
| `mobileStatus: not-requested` | PC 전용으로 설치했습니다. `desktopUrl`을 사용하세요. |
| `needs-action` | 해당 단계의 `mcpError` 또는 `mobileError`를 확인한 뒤 `mcpRetryCommand` 또는 `mobileRetryCommand`로 이어가세요. 그동안 PC 앱은 `desktopUrl`에서 열 수 있습니다. |

## 서버 다시 시작

VIV 서버는 설치한 컴퓨터에서 실행됩니다. `.env`를 바꾼 경우 VIV 서버를 종료하고 같은 설치 옵션과 포트로 다시 시작해야 새 값이 적용됩니다. 최초 실행 결과의 `serverPid`를 확인하세요. 재실행 결과가 `reused`이면 `serverPid`는 비어 있습니다. 최초 PID가 없으면 Windows의 `Get-NetTCPConnection -LocalPort 4317 -State Listen` 또는 Mac의 `lsof -nP -iTCP:4317 -sTCP:LISTEN`으로 설치 포트의 프로세스를 찾을 수 있습니다. 종료 전에 그 프로세스가 이 VIV 폴더에서 실행한 서버인지 확인하세요.

서버를 종료한 뒤 Windows에서는 VIV 폴더에서 아래 명령을 실행하세요. 다른 클라이언트나 포트를 사용했다면 `-Client`와 `-Port`에 기존 값을 넣고, 모바일도 사용 중이면 `-Mobile`을 추가하세요. Mac에서는 기존 `bash scripts/install-viv-mac.sh` 명령을 다시 실행하세요.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-self-host.ps1 -StartOnly -Client Codex
```

VIV의 MCP 등록만 제거하려면 Codex에서 `codex mcp remove viv`, Claude Code에서 `claude mcp remove viv --scope user`를 실행하세요.

## 자기 API 키와 계좌

| 필요한 기능 | 설치 후 설정 |
| --- | --- |
| 앱·퀀트 편집·연구 | 자체 SQLite를 사용한다. 설치 자체에는 공급자 키가 필요 없다. |
| AI/JEV | checkout의 로컬 `.env`에 자신의 `TYPESAFE_API_KEY`를 넣고 재시작한다. 설치 결과의 `configured-unverified`는 값이 설정됐다는 뜻이다. 유효성은 사용자가 시작한 실제 AI 과업 결과로 확인한다. |
| 업비트·토스증권 계좌 | [계좌 연결과 잔고 확인](#계좌-연결과-잔고-확인)을 따릅니다. |
| KIS 읽기 시세 | 사용하는 경우 자신의 `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCESS_TOKEN`을 로컬 환경에 설정한다. |

첫 실행에서 `.env`가 없으면 설치별 `BROKER_VAULT_KEY`를 파일에 생성한다. 이후 그 파일과 DB를 함께 개인 백업한다. 공유 저장소에는 앱 소스·잠금 파일·설치 스크립트를 올리고, 실제 `.env`·DB·계좌 기록·Tailscale 주소가 들어간 생성 파일·APK 서명 키는 개인 보관한다. 새 서버에서 실전 운용이 필요하면 별도로 관리형 실행 환경을 구성하고 앱에서 본인의 계좌·자금·한도를 승인한다.

## 계좌 연결과 잔고 확인

1. VIV 상단에서 **실전**을 선택하고 **작업 공간 메뉴 → 설정 → 계좌·자금**으로 이동하세요. AI의 연결 안내에서 같은 화면을 열 수도 있습니다. 금융기관 카드에서 **계좌 연결**을 누르세요.
2. **서버 허용 IP 준비 필요**가 나오면 연결 창의 발급 안내를 열어 PC 웹에서 키를 발급하고, 금융기관에 VIV 서버의 공인 발신 IPv4를 등록하세요. 업비트 잔고 조회 권한은 **자산조회**입니다. Tailscale 주소는 휴대폰으로 VIV에 접속할 때 사용합니다. [업비트 공식 권한 안내](https://docs.upbit.com/kr/docs/api-setup)
3. VIV 폴더의 `.env`에 `BROKER_NETWORK_READY=true`를 설정하세요. 앱에 공인 발신 IP를 표시하려면 같은 파일에 `BROKER_EGRESS_IP`도 설정하세요. [서버를 다시 시작](#서버-다시-시작)한 뒤 **준비 상태 다시 확인**을 누르세요.
4. VIV 연결 창에 업비트의 **Access Key·Secret Key** 또는 토스증권의 **Client ID·Client Secret**을 입력하고 **연결하고 잔고 조회**를 누르세요. 키는 이 창에만 입력하세요.
5. 금융기관 카드에 조회 시각과 잔고가 표시되면 연결과 조회를 확인한 것입니다. 허용 IP 또는 권한 오류가 나오면 금융기관 설정을 확인하고 같은 창에서 다시 시도하세요. 연결 정보만 저장됐다면 카드의 **잔고 새로고침**을 누르세요. 계좌 연결의 범위는 잔고 조회입니다.

별도 Android APK가 필요한 경우에는 [APK 빌드 가이드](../../../android/README.md)를 사용한다. Windows 설치 명령의 기본 휴대폰 경로는 같은 앱을 설치하는 웹앱이다.
