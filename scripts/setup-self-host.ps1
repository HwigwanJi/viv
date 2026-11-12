# Run from a fresh Windows checkout. See docs/agents/operations/self-host.md.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Mobile,
    [switch]$CodexMcp,
    [ValidateSet('Codex','Claude','Manual')][string]$Client = 'Manual',
    [switch]$StartOnly,
    [switch]$MobileOnly,
    [switch]$Resume,
    [switch]$InstallRuntime,
    [ValidateRange(1024, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
if ($CodexMcp -and !$PSBoundParameters.ContainsKey('Client')) { $Client = 'Codex' }
if ($MobileOnly) { $Mobile = $true; $StartOnly = $true }
$project = Split-Path -Parent $PSScriptRoot
$server = $null
$serverPid = $null
$configuredRoute = $false
$ready = $false
$configCreated = $false
$mobileError = $null
$mcpError = $null
$mcpRegistration = $null

function Assert-RestoredConfig {
    if ((Test-Path -LiteralPath $database -PathType Leaf) -and !(Test-Path -LiteralPath '.env' -PathType Leaf)) {
        throw "이 VIV 데이터베이스를 열려면 원래 .env 파일이 필요합니다. 이 DB와 함께 사용하던 .env를 '$project'에 복원하세요. 새 폴더에서는 설치 명령을, 기존 설치에서는 다시 시작 명령을 실행하세요. 복원 안내는 docs/agents/operations/self-host.md에서 확인하세요."
    }
}

function Test-VivNode {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (!$node -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) { return $false }
    & $node.Source --disable-warning=ExperimentalWarning -e "require('node:sqlite');if(Number(process.versions.node.split('.')[0])<24)process.exit(1)" 2>$null
    return $LASTEXITCODE -eq 0
}

function Test-App([string]$BaseUrl) {
    $identity = Invoke-WebRequest "$BaseUrl/" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    if ([string]$identity.Headers['X-VIV-Setup'] -ne $setupId) { throw 'The response belongs to a different VIV installation.' }
    $status = Invoke-RestMethod "$BaseUrl/api/status" -TimeoutSec 5 -MaximumRedirection 0
    if ($status.storage -ne 'server' -or $status.runners.disabled -ne $true -or $status.runners.live.running -ne $false) {
        throw 'The server did not report an isolated setup session.'
    }
    try { $manifest = Invoke-RestMethod "$BaseUrl/manifest.json" -TimeoutSec 5 -MaximumRedirection 0 }
    catch { throw "VIV install manifest unavailable: /manifest.json. Restore this checkout's install files and retry on port $Port." }
    if ($manifest.display -ne 'standalone' -or $manifest.scope -ne '/' -or !$manifest.icons) { throw 'Mobile manifest verification failed.' }
    foreach ($route in @('/install.html') + @($manifest.icons.src)) {
        try { $null = Invoke-WebRequest "$BaseUrl$route" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 }
        catch { throw "VIV install asset unavailable: $route. Restore this checkout's install files and retry on port $Port." }
    }
    return $status
}

function Read-Serve {
    $raw = & $tailscale serve status --json
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve status unavailable.' }
    $serve = $raw | ConvertFrom-Json
    if ($serve.AllowFunnel.PSObject.Properties | Where-Object Value -eq $true) {
        throw 'Public Funnel is enabled on this device. Use a private Tailscale host for VIV.'
    }
    $web = if ($serve.Web) { $serve.Web.PSObject.Properties["${hostname}:443"].Value }
    $existing = if ($web.Handlers) { $web.Handlers.PSObject.Properties['/'].Value }
    if ($existing -and ([string]$existing.Proxy).TrimEnd('/') -ne $localUrl) { throw 'Tailscale HTTPS already serves another application.' }
    $tcp = if ($serve.TCP) { $serve.TCP.PSObject.Properties['443'].Value }
    if ($tcp -and !$tcp.HTTPS) {
        throw 'Tailscale port 443 already has a different handler.'
    }
    return $existing
}

Push-Location -LiteralPath $project
try {
    foreach ($file in @('.runtime/server-host-config.json', '.runtime/server-host-state.json', '.runtime/investment.sqlite')) {
        if (Test-Path -LiteralPath $file) { throw 'Use a separate checkout for self-host setup. An existing server was detected.' }
    }
    $runtime = Join-Path $project '.runtime'
    $idFile = Join-Path $runtime 'self-host-id'
    $database = Join-Path $runtime 'self-host.sqlite'
    $portFile = Join-Path $runtime 'self-host-port'
    Assert-RestoredConfig
    if ($Resume) {
        if (!(Test-Path -LiteralPath $portFile) -or !(Test-Path -LiteralPath $idFile) -or !(Test-Path -LiteralPath $database)) {
            throw 'Run the installer once from the original VIV folder with its original port before using -Resume. See the server restart guide in README.md.'
        }
        $Mobile = $false
        $MobileOnly = $false
        $StartOnly = $true
        $Client = 'Manual'
    }
    if (Test-Path -LiteralPath $portFile) {
        $storedPort = (Get-Content -LiteralPath $portFile -Raw).Trim()
        if ($storedPort -notmatch '^[1-9][0-9]{3,4}$' -or [int]$storedPort -lt 1024 -or [int]$storedPort -gt 65535 -or [int]$storedPort -eq 4905) {
            throw 'The saved VIV port is invalid. Check .runtime/self-host-port in the original VIV folder.'
        }
        if ($PSBoundParameters.ContainsKey('Port') -and $Port -ne [int]$storedPort) {
            throw "This VIV folder already uses port $storedPort. Omit -Port to use it. Use a separate checkout for another port."
        }
        $Port = [int]$storedPort
    }
    if ($Port -eq 4905) { throw 'Port 4905 is reserved for the managed trading host.' }
    $localUrl = "http://127.0.0.1:$Port"
    if ($InstallRuntime -and !(Test-VivNode)) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (!$winget) { throw 'Node.js 24 이상과 npm이 필요합니다. 설치한 뒤 이 명령을 다시 실행하세요.' }
        Write-Host 'VIV 서버에 필요한 Node.js LTS를 설치합니다.'
        & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Node.js 설치가 완료되지 않았습니다. 설치 오류를 해결한 뒤 다시 실행하세요.' }
        $standardNode = Join-Path $env:ProgramFiles 'nodejs'
        if (Test-Path -LiteralPath (Join-Path $standardNode 'node.exe')) { $env:Path = "$standardNode;$env:Path" }
        if (!(Test-VivNode)) { throw '새 PowerShell에서 VIV 설치 명령을 다시 실행하세요.' }
    }
    $node = (Get-Command node.exe).Source
    & $node --disable-warning=ExperimentalWarning -e "require('node:sqlite'); if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 24 LTS with npm and retry.' }
    if ($MobileOnly -and (!(Test-Path -LiteralPath $idFile) -or !(Test-Path -LiteralPath $database))) {
        throw 'Complete the PC installation in this folder before running mobile recovery.'
    }
    $null = New-Item -ItemType Directory -Path $runtime -Force
    if (!(Test-Path -LiteralPath $idFile)) {
        $stream = [IO.File]::Open($idFile, 'CreateNew', 'Write')
        try {
            $bytes = [Text.Encoding]::ASCII.GetBytes([guid]::NewGuid().ToString('N'))
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    }
    $setupId = (Get-Content -LiteralPath $idFile -Raw).Trim()
    if ($setupId -cnotmatch '^[a-f0-9]{32}$') { throw 'The local VIV installation ID is invalid.' }
    $fallback = if (!$PSBoundParameters.ContainsKey('Port') -and !(Test-Path -LiteralPath $portFile) -and !(Test-Path -LiteralPath $database) -and !$StartOnly) { 'fallback' } else { 'fixed' }
    $selection = & $node (Join-Path $PSScriptRoot 'self-host-binding.mjs') $Port $setupId $fallback | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or !$selection) { throw 'Could not verify the local VIV port.' }
    if ($selection.state -eq 'occupied') {
        $who = if ($selection.otherViv) { '다른 VIV 설치' } else { '다른 프로그램' }
        if ((Test-Path -LiteralPath $portFile) -or (Test-Path -LiteralPath $database) -or $StartOnly) {
            throw "원래 VIV 주소의 $Port 포트는 현재 ${who}에서 사용 중입니다. 해당 프로그램을 확인한 뒤 이 폴더에서 -Resume을 다시 실행하세요."
        }
        $alternative = if ($selection.alternative) { " 새 설치에는 -Port $($selection.alternative) 옵션을 사용할 수 있습니다." } else { ' 새 설치에 쓸 다른 포트를 지정하세요.' }
        throw "$Port 포트는 현재 ${who}에서 사용 중입니다.$alternative"
    }
    $Port = [int]$selection.port
    $localUrl = "http://127.0.0.1:$Port"
    if ($selection.previousPort) { Write-Host "기본 포트 $($selection.previousPort)를 사용 중이어서 새 VIV를 $Port 포트에 설치합니다." }
    $status = if ($selection.state -eq 'existing') { Test-App $localUrl } else { $null }

    if (!$StartOnly -and !$status) {
        $npm = (Get-Command npm.cmd).Source
        & $npm ci --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
        & $npm run build:local | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    }

    if (!(Test-Path -LiteralPath '.env')) {
        Assert-RestoredConfig
        & $node -e "const {writeFileSync}=require('node:fs'); const {randomBytes}=require('node:crypto'); writeFileSync('.env', 'BROKER_VAULT_KEY='+randomBytes(32).toString('hex')+'\n', {flag:'wx',mode:0o600})"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the local credential vault configuration.' }
    }
    $mobileConfig = Join-Path $runtime 'mobile-access.json'
    $mobileUrl = $null

    if (!$status) {
        $arguments = @('--env-file-if-exists=.env', 'scripts/preview.mjs', '--no-runners')
        $savedPort = $env:KEYNES_PREVIEW_PORT
        $savedDb = $env:KEYNES_PREVIEW_DB
        $savedSetupId = $env:VIV_SELF_HOST_ID
        try {
            $env:KEYNES_PREVIEW_PORT = "$Port"
            $env:KEYNES_PREVIEW_DB = $database
            $env:VIV_SELF_HOST_ID = $setupId
            $server = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $runtime 'self-host.stdout.log') -RedirectStandardError (Join-Path $runtime 'self-host.stderr.log')
        } finally {
            $env:KEYNES_PREVIEW_PORT = $savedPort
            $env:KEYNES_PREVIEW_DB = $savedDb
            $env:VIV_SELF_HOST_ID = $savedSetupId
        }
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if ($server.HasExited) { throw 'Server exited. See .runtime/self-host.stderr.log.' }
            try { $status = Test-App $localUrl; break } catch { $startupError = $_; Start-Sleep -Milliseconds 500 }
        }
        if (!$status) { throw $startupError }
        if ($server.HasExited) { throw 'The started server exited before verification completed.' }
        $serverPid = $server.Id
    }

    if (!(Test-Path -LiteralPath $portFile)) {
        $stream = [IO.File]::Open($portFile, 'CreateNew', 'Write')
        try {
            $bytes = [Text.Encoding]::ASCII.GetBytes("$Port`n")
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    }
    if ((Get-Content -LiteralPath $portFile -Raw).Trim() -cne "$Port") {
        throw 'Another process set a different VIV port in this folder. Use the original installation port.'
    }
    $ready = $true
    Write-Host "VIV PC: $localUrl"
    if (!$MobileOnly) {
        try {
            $mcpRegistration = & (Join-Path $PSScriptRoot 'install-viv-mcp.ps1') -Port $Port -Client $Client | ConvertFrom-Json
        } catch { $mcpError = $_.Exception.Message }
    }
    if ($Mobile) {
        try {
            $tailscale = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
            if (!$tailscale) {
                $tailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
                if (!(Test-Path -LiteralPath $tailscale)) {
                    if (Get-Process -Name tailscaled -ErrorAction SilentlyContinue) {
                        throw 'An existing Tailscale is running outside the default installation. Add its CLI to PATH and retry.'
                    }
                    & winget.exe install --id Tailscale.Tailscale --exact --source winget | Out-Host
                    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $tailscale)) { throw 'Install Tailscale and retry.' }
                }
            }
            $state = (& $tailscale status --json) | ConvertFrom-Json
            if ($state.BackendState -ne 'Running') {
                & $tailscale up --timeout=30s | Out-Host
                if ($LASTEXITCODE -ne 0) { throw 'Complete Tailscale sign-in, then run the mobile recovery command.' }
                $state = (& $tailscale status --json) | ConvertFrom-Json
            }
            $hostname = ([string]$state.Self.DNSName).TrimEnd('.')
            if ($state.BackendState -ne 'Running' -or $hostname -cnotmatch '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$') {
                throw 'Tailscale must be signed in with MagicDNS enabled.'
            }
            $mobileUrl = "https://$hostname"
            $existingRoute = Read-Serve
            if (Test-Path -LiteralPath $mobileConfig) {
                if ((Get-Content -LiteralPath $mobileConfig -Raw | ConvertFrom-Json).origin -cne $mobileUrl) {
                    throw 'The saved mobile origin belongs to a different Tailscale device.'
                }
            } else {
                $stream = [IO.File]::Open($mobileConfig, 'CreateNew', 'Write')
                try {
                    $configCreated = $true
                    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ origin = $mobileUrl } | ConvertTo-Json -Compress))
                    $stream.Write($bytes, 0, $bytes.Length)
                } finally { $stream.Dispose() }
            }
            if (!$existingRoute) {
                & $tailscale serve --bg --https=443 --set-path=/ $localUrl | Out-Host
                if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Enable HTTPS in the tailnet settings if requested.' }
                $configuredRoute = $true
            }
            if (!(Read-Serve)) { throw 'Tailscale did not report the expected private route.' }
            $null = Test-App $mobileUrl
        } catch {
            $mobileError = $_.Exception.Message
            if ($configuredRoute) {
                try { if (Read-Serve) { & $tailscale serve --bg --https=443 --set-path=/ $localUrl off | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not remove VIV Serve route.' } } }
                catch { Write-Warning 'Review the private route with tailscale serve status.' }
            }
            if ($configCreated) { Remove-Item -LiteralPath $mobileConfig -ErrorAction Continue }
            $mobileUrl = $null
        }
    }
    [ordered]@{
        serverPid = $serverPid
        desktopUrl = $localUrl
        desktopInstallUrl = "$localUrl/install.html"
        desktopStatus = if ($serverPid) { 'started' } else { 'reused' }
        restartCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-viv.ps1 -Resume'
        mobileInstallUrl = if ($mobileUrl) { "$mobileUrl/install.html" } else { $null }
        mobileStatus = if ($mobileError) { 'needs-action' } elseif ($mobileUrl) { 'phone-install-pending' } else { 'not-requested' }
        mobileError = $mobileError
        mobileRetryCommand = if ($mobileError) { "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-self-host.ps1 -MobileOnly -Port $Port" } else { $null }
        existingMobileConfig = Test-Path -LiteralPath $mobileConfig
        mcpUrl = "$localUrl/mcp?installation=$setupId"
        mcpName = $mcpRegistration.name
        mcpStatus = if ($MobileOnly) { 'not-requested' } elseif ($mcpRegistration) { $mcpRegistration.status } else { 'needs-action' }
        mcpError = $mcpError
        mcpRetryCommand = if ($mcpError) { "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-viv-mcp.ps1 -Client $Client -Port $Port" } else { $null }
        onboardingPrompt = if ($mcpRegistration.status -eq 'registered') { $mcpRegistration.startMessage } else { $null }
        onboardingTool = if ($mcpRegistration.status -eq 'registered') { 'viv_onboarding' } else { $null }
        liveRunner = 'disabled'
        aiKey = if ($status.jev.configured) { 'configured-unverified' } else { 'not-configured' }
    } | ConvertTo-Json -Compress
} finally {
    if (!$ready) {
        if ($configuredRoute) {
            try { if (Read-Serve) { & $tailscale serve --bg --https=443 --set-path=/ $localUrl off | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not remove VIV Serve route.' } } }
            catch { Write-Warning 'Review the failed route with tailscale serve status.' }
        }
        if ($server -and !$server.HasExited) { Stop-Process -InputObject $server }
        if ($configCreated) { Remove-Item -LiteralPath $mobileConfig }
    }
    Pop-Location
}
