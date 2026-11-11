# VIV · Vibe Investment

VIV는 투자 전략을 구성하고 모의 예산으로 검토하는 앱입니다. Codex나 Claude Code를 연결하면 대화에서 모의계좌를 만들고, 판단과 조사 결과를 앱에서 열어볼 수 있습니다. 설치와 첫 모의 브리핑에는 금융기관·JEV API 키가 필요 없습니다.

[설치 결과 확인](docs/agents/operations/self-host.md#설치-결과-읽기) · [첫 모의 브리핑](docs/agents/operations/viv-mcp-playbook.md#첫-모의-브리핑) · [계좌 연결과 잔고 확인](docs/agents/operations/self-host.md#계좌-연결과-잔고-확인)

## Windows에서 Git으로 설치

Git이 설치된 PowerShell에서 아래 한 줄을 실행하세요. 공개 저장소 복제는 GitHub 로그인 없이 할 수 있습니다.

```powershell
git clone https://github.com/HwigwanJi/viv.git viv; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\viv\scripts\install-viv.ps1 }
```

PC 또는 PC와 모바일을 선택하면 설치 스크립트가 Node.js·npm을 확인하고, 로컬 앱 서버를 실행해 Codex MCP를 연결합니다. Claude Code에서는 `-Client Claude`를, 다른 AI 클라이언트에서는 `-Client Manual`을 추가하세요. 이미 받은 checkout은 그 폴더의 `scripts/install-viv.ps1`로 다시 실행합니다.

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

설치 결과의 `desktopUrl`을 열어 VIV 화면을 확인하세요. `mcpStatus`가 `registered`면 Codex 또는 Claude Code에 **VIV 시작하기**를 입력하세요. 현재 대화에 도구가 보이지 않으면 새 대화에서 입력하세요.

## AI 에이전트로 설치

> https://github.com/HwigwanJi/viv 의 VIV를 이 컴퓨터에 설치해 줘. Windows인지 Mac인지 확인하고, 컴퓨터에서만 쓸지 모바일도 쓸지 먼저 물어봐. 저장소의 AGENTS.md에 따라 앱·서버·MCP를 연결한 뒤 VIV 튜토리얼을 시작해 줘.

[모바일 연결과 API 키 설정](docs/agents/operations/self-host.md) · [MCP와 튜토리얼](docs/agents/operations/viv-mcp-playbook.md)

## 앱에서 할 수 있는 일

| 하려는 일 | 앱에서 찾는 곳 |
| --- | --- |
| 종목 시세와 차트 보기 | **마켓**에서 종목을 선택합니다. |
| 전략을 구성하거나 판단 기록 보기 | **마인드**에서 원하는 마인드를 연 뒤 **전략** 또는 **기록** 탭을 선택합니다. |
| AI가 저장한 조사 자료 다시 열기 | AI가 준 결과 링크를 열거나 **자료 → 투자 자료**에서 찾습니다. |
| 모의 예산이나 연결 계좌의 잔고 확인 | 상단에서 **모의** 또는 **실전**을 선택하고 **작업 공간 메뉴 → 설정 → 계좌·자금**을 엽니다. |
| 전략 노드와 호출 경로 검색 | **설정 → 기능 목록**에서 이름이나 API 경로를 검색합니다. |

## 개발 검사

`npm run check`로 개발 검사를 실행합니다. Rust와 Cargo가 있는 환경에서는 `npm run check:rust`로 모듈 구문, HTML 진입점, UI 문구, 기능 레지스트리 검사를 실행할 수 있습니다. 각 모듈의 구문 판정에는 설치된 Node.js를 사용하고, Rust가 모듈 검사 작업을 병렬로 처리합니다. VIV 설치와 실행에는 Rust가 필요 없습니다.
