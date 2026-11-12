# VIV 설치

사용자가 VIV 설치를 요청하면 [독립 설치 가이드](docs/agents/operations/self-host.md)와 [MCP 플레이북](docs/agents/operations/viv-mcp-playbook.md)을 읽습니다.

1. 환경 선택이 없으면 먼저 **1. PC / 2. PC와 모바일 / 0. 취소**를 묻습니다. 이미 선택했으면 그대로 진행합니다.
2. 운영체제에 맞는 설치 스크립트를 실행합니다.
   - Windows는 `scripts/install-viv.ps1`에 `-Target PC` 또는 `-Target PCMobile`을 전달합니다. Claude Code는 `-Client Claude`를 추가합니다.
   - Mac은 `bash scripts/install-viv-mac.sh`에 `--target pc` 또는 `--target mobile`을 전달합니다. Claude Code는 `--client claude`를 추가합니다.
   - 기본 MCP 클라이언트는 Codex입니다. 그 외 클라이언트는 각 스크립트의 `Manual` 옵션을 사용해 해당 클라이언트의 방식으로 연결합니다.
3. **VIV PC** 주소가 출력되면 앱을 바로 열 수 있게 안내합니다. 설치 결과에서 서버, MCP, 모바일 상태를 각각 확인합니다. 선택한 연결에 후속 조치가 필요하면 [연결 복구](docs/agents/operations/self-host.md#연결-복구)의 해당 단계만 안내합니다. 모바일 주소가 확인되면 실제 기기에서 여는 방법을 안내합니다.
4. MCP 연결이 확인되면 설치 결과의 `mcpName`에 해당하는 `viv_onboarding`을 호출해 튜토리얼을 시작합니다. 클라이언트가 설치한 MCP를 새 대화에서만 읽을 수 있다면 결과의 `onboardingPrompt`로 이어갑니다. PC 앱만 열린 경우에는 [첫 모의 실습](docs/agents/operations/viv-mcp-playbook.md#첫-모의-실습)을 바로 시작할 수 있습니다.

이미 설치한 앱이 열리지 않으면 원래 VIV 폴더에서 [서버 다시 시작](docs/agents/operations/self-host.md#서버-다시-시작)을 따릅니다. 같은 주소가 응답하고 기존 기록을 읽을 수 있는지 확인합니다. 설치 결과의 `endpoint-ready`는 서버의 MCP 응답 상태입니다. AI 연결은 해당 클라이언트에서 별도로 확인합니다.

새 폴더에 기존 기록을 복원했다면 [복원한 기록을 AI에서 열기](docs/agents/operations/self-host.md#새-폴더에-복원한-뒤-ai에서-기록-열기)를 따릅니다. 새 MCP 연결에서 저장된 판단을 조회하고 같은 기록 링크를 확인합니다.
