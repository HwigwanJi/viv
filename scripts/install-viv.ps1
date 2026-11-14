#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('PC','PCMobile')][string]$Target,
    [ValidateSet('Codex','Claude','Manual')][string]$Client = 'Codex',
    [ValidateRange(1024,65535)][int]$Port,
    [switch]$Resume,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
if ($OpenBrowser -and !$Resume) { throw 'Use -OpenBrowser with -Resume.' }
if ($Resume) {
    if ($PSBoundParameters.ContainsKey('Port') -or $PSBoundParameters.ContainsKey('Target') -or $PSBoundParameters.ContainsKey('Client')) {
        throw 'Use -Resume by itself to reopen this VIV installation.'
    }
    $result = & (Join-Path $PSScriptRoot 'setup-self-host.ps1') -Resume
    if ($OpenBrowser) {
        Start-Process -FilePath ($result | ConvertFrom-Json).desktopUrl
    } else {
        $result
    }
    return
}
if (!$Target) {
    Write-Host 'VIV를 어느 환경에서 사용하실 건가요?'
    Write-Host '1. PC'
    Write-Host '2. PC와 모바일 둘 다 (Tailscale 로그인 필요)'
    Write-Host '0. 취소'
    switch ((Read-Host '번호').Trim()) {
        '1' { $Target = 'PC' }
        '2' { $Target = 'PCMobile' }
        '0' { return }
        default { throw '1, 2 또는 0을 선택해 주세요.' }
    }
}

$options = @{ Mobile = ($Target -eq 'PCMobile'); Client = $Client; InstallRuntime = $true }
if ($PSBoundParameters.ContainsKey('Port')) { $options.Port = $Port }
$result = & (Join-Path $PSScriptRoot 'setup-self-host.ps1') @options
$result
