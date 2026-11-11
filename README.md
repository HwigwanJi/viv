# VIV · Vibe Investment

## Windows에서 Git으로 설치

GitHub에서 [VIV 저장소](https://github.com/HwigwanJi/viv)에 접근할 수 있어야 합니다. Git이 설치된 PowerShell에서 아래 한 줄을 실행하세요.

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

설치 결과에 `registered`가 나오면 Claude Code에서 **VIV 시작하기**를 입력합니다. 실행 중인 세션에서 도구가 보이지 않으면 새 세션에서 시작합니다.

## AI 에이전트로 설치

> https://github.com/HwigwanJi/viv 의 VIV를 이 컴퓨터에 설치해 줘. Windows인지 Mac인지 확인하고, 컴퓨터에서만 쓸지 모바일도 쓸지 먼저 물어봐. 저장소의 AGENTS.md에 따라 앱·서버·MCP를 연결한 뒤 VIV 튜토리얼을 시작해 줘.

[모바일 연결과 API 키 설정](docs/agents/operations/self-host.md) · [MCP와 튜토리얼](docs/agents/operations/viv-mcp-playbook.md)
