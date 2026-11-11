# Chung & Ji Investment — Windows self-host

[독립 설치 및 Tailscale 모바일 연결](docs/agents/operations/self-host.md)

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-self-host.ps1 -Mobile
```

Requires Node.js 24 and npm. For a local-only installation, omit `-Mobile`.
