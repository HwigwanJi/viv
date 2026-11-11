# VIV 설치

사용자가 VIV 설치를 요청하면 [독립 설치 가이드](docs/agents/operations/self-host.md)와 [MCP 플레이북](docs/agents/operations/viv-mcp-playbook.md)을 읽습니다.

1. 환경 선택이 없으면 먼저 **1. PC / 2. PC와 모바일 / 0. 취소**를 묻습니다. 이미 선택했으면 그대로 진행합니다.
2. 이 checkout의 `scripts/install-viv.ps1`를 실행합니다. PC는 `-Target PC`, 모바일도 사용하면 `-Target PCMobile`을 전달합니다. Codex에서는 기본 클라이언트를, 그 외에서는 `-Client Manual`을 사용하고 해당 클라이언트의 방식으로 MCP를 연결합니다.
3. 설치 결과의 앱 주소, 서버, MCP 연결 상태를 확인합니다. 모바일을 선택한 경우 결과의 휴대폰 설치 주소를 안내하고 실제 기기에서 확인합니다.
4. MCP 연결이 확인되면 `viv_onboarding`을 호출해 튜토리얼을 시작합니다. 클라이언트가 설치한 MCP를 새 대화에서만 읽을 수 있다면 **VIV 시작하기**로 이어갑니다.
