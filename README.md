# VIV · Vibe Investment

VIV는 투자 전략을 구성하고 모의 예산으로 검토하는 앱입니다. Codex나 Claude Code를 연결하면 대화에서 모의계좌를 만들고, 판단과 조사 결과를 앱에서 열어볼 수 있습니다. 설치하고 보관한 BTC 시세로 첫 백테스트를 실행하기까지 금융기관·JEV API 키가 필요 없습니다.

[PC 앱을 먼저 열기](#pc-앱을-먼저-열기) · [서버 다시 시작](docs/agents/operations/self-host.md#서버-다시-시작) · [연결 복구](docs/agents/operations/self-host.md#연결-복구) · [첫 모의 실습](docs/agents/operations/viv-mcp-playbook.md#첫-모의-실습) · [계좌 연결과 잔고 확인](docs/agents/operations/self-host.md#계좌-연결과-잔고-확인)

## Windows에서 Git으로 설치

Git이 설치된 PowerShell에서 아래 한 줄을 실행하세요. 공개 저장소 복제는 GitHub 로그인 없이 할 수 있습니다.

```powershell
git clone https://github.com/HwigwanJi/viv.git viv; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\viv\scripts\install-viv.ps1 }
```

PC 또는 PC와 모바일을 선택하면 설치 스크립트가 Node.js·npm을 확인하고, 로컬 앱 서버를 실행해 Codex MCP를 연결합니다. Claude Code에서는 `-Client Claude`를, 다른 AI 클라이언트에서는 `-Client Manual`을 추가하세요. 이미 복제했다면 VIV 폴더에서 `scripts/install-viv.ps1`을 실행하세요.

## Mac에서 Git으로 설치

Git이 설치된 Mac 터미널에서 아래 한 줄을 실행하세요. Node.js가 없으면 VIV가 자체 설치 폴더에 준비합니다.

```bash
git clone https://github.com/HwigwanJi/viv.git viv && bash viv/scripts/install-viv-mac.sh
```

Claude Code를 쓰면 위 명령 끝에 `--client claude`를 붙이세요. Mac만 쓸지 모바일도 쓸지 고르면 VIV가 앱·서버를 준비하고 MCP를 등록합니다. `registered`가 나오면 AI에서 **VIV 시작하기**를 입력하세요.

## Windows에서 Claude Code로 설치

Claude Code가 설치된 Windows에서 아래 한 줄을 실행합니다. 이미 복제했다면 해당 폴더에서 설치 스크립트에 `-Client Claude`를 전달하세요.

```powershell
git clone https://github.com/HwigwanJi/viv.git viv; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\viv\scripts\install-viv.ps1 -Client Claude }
```

## PC 앱을 먼저 열기

터미널에 **VIV PC** 주소가 나오면 브라우저에서 엽니다. 설치 화면을 열었다면 **VIV 열기**를 누르세요. 모의 홈에서 **첫 백테스트 실습**을 고르면 앱에서 바로 연습할 수 있습니다. [첫 모의 실습](docs/agents/operations/viv-mcp-playbook.md#첫-모의-실습)

설치 결과를 닫았다면 PC 앱의 **설정 → 서비스 연결**에서 **AI 연결·복구 (MCP)** 또는 **휴대폰 연결·설치**를 열어 이어가세요. [터미널에서 연결 복구](docs/agents/operations/self-host.md#연결-복구)

컴퓨터 재부팅 후 기존 앱 주소가 열리지 않으면 설치했던 VIV 폴더에서 [서버 다시 시작](docs/agents/operations/self-host.md#서버-다시-시작) 명령을 실행하세요. 같은 주소에서 저장한 기록을 이어 볼 수 있습니다.

`mcpStatus`가 `registered`면 Codex 또는 Claude Code에 **VIV 시작하기**를 입력하세요. 현재 대화에 도구가 보이지 않으면 새 대화에서 입력하세요.

## AI 에이전트로 설치

> https://github.com/HwigwanJi/viv 의 VIV를 이 컴퓨터에 설치해 줘. Windows인지 Mac인지 확인하고, 컴퓨터에서만 쓸지 모바일도 쓸지 먼저 물어봐. 저장소의 AGENTS.md에 따라 앱·서버·MCP를 연결한 뒤 VIV 튜토리얼을 시작해 줘.

[설치와 API 키 설정](docs/agents/operations/self-host.md) · [MCP와 튜토리얼](docs/agents/operations/viv-mcp-playbook.md)

## 앱에서 할 수 있는 일

| 하려는 일 | 앱에서 찾는 곳 |
| --- | --- |
| 종목 시세와 차트 보기 | **마켓**에서 종목을 선택합니다. |
| 기본 프리셋으로 새 마인드 만들기 | **모의 → 마인드 → 마인드 추가 → 시작 전략**에서 기본 프리셋을 고릅니다. [기본 프리셋으로 시작하기](docs/agents/operations/viv-mcp-playbook.md#기본-프리셋으로-시작하기) |
| 전략을 구성하거나 판단 기록 보기 | **화면 찾기**에서 마인드 이름과 작업을 함께 검색하세요. 예를 들어 **국면 추세 전략**, **국면 추세 백테스트**를 입력하면 해당 마인드 화면으로 이동할 수 있습니다. 전체 모의 판단은 **마인드 → 전체 기록**에서 찾습니다. |
| 과거 시세로 전략을 실행하고 결과 다시 보기 | [첫 모의 실습](docs/agents/operations/viv-mcp-playbook.md#첫-모의-실습)을 따라 실행하고 모의 **홈**의 **최근 완료 실험**에서 같은 결과를 엽니다. 다른 실험은 **전체 시뮬레이션**에서 찾습니다. |
| AI가 저장한 조사 자료 다시 열기 | AI가 준 결과 링크를 열거나 **자료 → 투자 자료**에서 찾습니다. |
| 모의 예산이나 연결 계좌의 잔고 확인 | 상단에서 **모의** 또는 **실전**을 선택하고 **작업 공간 메뉴 → 설정 → 계좌·자금**을 엽니다. |
| 전략 노드와 호출 경로 검색 | **설정 → 기능 목록**에서 이름이나 API 경로를 검색합니다. |

## 개발 검사

`npm run check`로 개발 검사를 실행합니다. Rust와 Cargo가 있는 환경에서는 `npm run check:rust`로 모듈 구문, HTML 진입점, UI 문구, 기능 레지스트리 검사를 실행할 수 있습니다. 각 모듈의 구문 판정에는 설치된 Node.js를 사용하고, Rust가 모듈 검사 작업을 병렬로 처리합니다. VIV 설치와 실행에는 Rust가 필요 없습니다.
