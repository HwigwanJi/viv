#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('PC','PCMobile')][string]$Target,
    [ValidateSet('Codex','Manual')][string]$Client = 'Codex',
    [ValidateRange(1024,65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
if (!$Target) {
    Write-Host 'VIV를 어느 환경에서 사용하실 건가요?'
    Write-Host '1. PC'
    Write-Host '2. PC와 모바일 둘 다'
    Write-Host '0. 취소'
    switch ((Read-Host '번호').Trim()) {
        '1' { $Target = 'PC' }
        '2' { $Target = 'PCMobile' }
        '0' { return }
        default { throw '1, 2 또는 0을 선택해 주세요.' }
    }
}

function Test-VivNode {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (!$node -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) { return $false }
    & $node.Source --disable-warning=ExperimentalWarning -e "require('node:sqlite');if(Number(process.versions.node.split('.')[0])<24)process.exit(1)" 2>$null
    return $LASTEXITCODE -eq 0
}

if (!(Test-VivNode)) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (!$winget) { throw 'Node.js 24 이상과 npm이 필요합니다. 설치한 뒤 이 명령을 다시 실행하세요.' }
    Write-Host 'VIV 서버에 필요한 Node.js LTS를 설치합니다.'
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 설치가 완료되지 않았습니다. 설치 오류를 해결한 뒤 다시 실행하세요.' }
    $standardNode = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path -LiteralPath (Join-Path $standardNode 'node.exe')) { $env:Path = "$standardNode;$env:Path" }
    if (!(Test-VivNode)) { throw '새 PowerShell에서 VIV 설치 명령을 다시 실행하세요.' }
}

$result = & (Join-Path $PSScriptRoot 'setup-self-host.ps1') -Port $Port -Mobile:($Target -eq 'PCMobile') -CodexMcp:($Client -eq 'Codex')
$result
