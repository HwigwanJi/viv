# Run from a fresh Windows checkout. See docs/agents/operations/self-host.md.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Mobile,
    [switch]$CodexMcp,
    [switch]$StartOnly,
    [ValidateRange(1024, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
if ($Port -eq 4905) { throw 'Port 4905 is reserved for the managed trading host.' }
$project = Split-Path -Parent $PSScriptRoot
$localUrl = "http://127.0.0.1:$Port"
$server = $null
$serverPid = $null
$configuredRoute = $false
$ready = $false
$configCreated = $false
$mobileError = $null
$mcpError = $null
$mcpRegistration = $null

function Test-App([string]$BaseUrl) {
    $identity = Invoke-WebRequest "$BaseUrl/" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    if ([string]$identity.Headers['X-VIV-Setup'] -ne $setupId) { throw 'The response belongs to a different VIV installation.' }
    $status = Invoke-RestMethod "$BaseUrl/api/status" -TimeoutSec 5 -MaximumRedirection 0
    if ($status.storage -ne 'server' -or $status.runners.disabled -ne $true -or $status.runners.live.running -ne $false) {
        throw 'The server did not report an isolated setup session.'
    }
    $manifest = Invoke-RestMethod "$BaseUrl/manifest.json" -TimeoutSec 5 -MaximumRedirection 0
    if ($manifest.display -ne 'standalone' -or $manifest.scope -ne '/') { throw 'Mobile manifest verification failed.' }
    foreach ($route in @('/install.html') + @($manifest.icons.src)) {
        $null = Invoke-WebRequest "$BaseUrl$route" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
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
    $existing = $serve.Web.PSObject.Properties["${hostname}:443"].Value.Handlers.PSObject.Properties['/'].Value
    if ($existing -and ([string]$existing.Proxy).TrimEnd('/') -ne $localUrl) { throw 'Tailscale HTTPS already serves another application.' }
    if ($serve.TCP.PSObject.Properties['443'].Value -and !$serve.TCP.PSObject.Properties['443'].Value.HTTPS) {
        throw 'Tailscale port 443 already has a different handler.'
    }
    return $existing
}

Push-Location -LiteralPath $project
try {
    foreach ($file in @('.runtime/server-host-config.json', '.runtime/server-host-state.json', '.runtime/investment.sqlite')) {
        if (Test-Path -LiteralPath $file) { throw 'Use a separate checkout for self-host setup. An existing server was detected.' }
    }
    $node = (Get-Command node.exe).Source
    & $node --disable-warning=ExperimentalWarning -e "require('node:sqlite'); if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 24 LTS with npm and retry.' }
    $runtime = Join-Path $project '.runtime'
    $null = New-Item -ItemType Directory -Path $runtime -Force
    $idFile = Join-Path $runtime 'self-host-id'
    if (!(Test-Path -LiteralPath $idFile)) {
        $stream = [IO.File]::Open($idFile, 'CreateNew', 'Write')
        try {
            $bytes = [Text.Encoding]::ASCII.GetBytes([guid]::NewGuid().ToString('N'))
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    }
    $setupId = (Get-Content -LiteralPath $idFile -Raw).Trim()
    if ($setupId -cnotmatch '^[a-f0-9]{32}$') { throw 'The local VIV installation ID is invalid.' }
    $status = $null
    $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch {
        try { $status = Test-App $localUrl }
        catch { throw "Local port $Port belongs to another service. Choose another port with -Port." }
    } finally { $listener.Stop() }

    if (!$StartOnly -and !$status) {
        $npm = (Get-Command npm.cmd).Source
        & $npm ci --no-audit --no-fund | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
        & $npm run build:local | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    }

    if (!(Test-Path -LiteralPath '.env')) {
        if (Test-Path -LiteralPath (Join-Path $runtime 'self-host.sqlite')) {
            throw 'Restore the original .env for this checkout before restarting.'
        }
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
            $env:KEYNES_PREVIEW_DB = Join-Path $runtime 'self-host.sqlite'
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

    $ready = $true
    try {
        $mcpRegistration = & (Join-Path $PSScriptRoot 'install-viv-mcp.ps1') -Port $Port -ProbeOnly:(!$CodexMcp) | ConvertFrom-Json
    } catch { $mcpError = $_.Exception.Message }
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
                if ($LASTEXITCODE -ne 0) { throw 'Complete Tailscale sign-in and rerun this command.' }
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
                & $tailscale serve --bg $localUrl | Out-Host
                if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Enable HTTPS in the tailnet settings if requested.' }
                $configuredRoute = $true
            }
            if (!(Read-Serve)) { throw 'Tailscale did not report the expected private route.' }
            $null = Test-App $mobileUrl
        } catch {
            $mobileError = $_.Exception.Message
            if ($configuredRoute) {
                try { if (Read-Serve) { & $tailscale serve --https=443 off | Out-Null } }
                catch { Write-Warning 'Review the private route with tailscale serve status.' }
            }
            if ($configCreated) { Remove-Item -LiteralPath $mobileConfig -ErrorAction Continue }
            $mobileUrl = $null
        }
    }
    [ordered]@{
        serverPid = $serverPid
        desktopUrl = $localUrl
        mobileInstallUrl = if ($mobileUrl) { "$mobileUrl/install.html" } else { $null }
        mobileStatus = if ($mobileError) { 'needs-action' } elseif ($mobileUrl) { 'phone-install-pending' } else { 'not-requested' }
        mobileError = $mobileError
        existingMobileConfig = Test-Path -LiteralPath $mobileConfig
        mcpUrl = "$localUrl/mcp"
        mcpStatus = if ($mcpRegistration) { $mcpRegistration.status } else { 'needs-action' }
        mcpError = $mcpError
        onboardingTool = if ($mcpRegistration.status -eq 'registered') { 'viv_onboarding' } else { $null }
        liveRunner = 'disabled'
        aiKey = if ($status.jev.configured) { 'configured-unverified' } else { 'not-configured' }
    } | ConvertTo-Json -Compress
} finally {
    if (!$ready) {
        if ($configuredRoute) {
            try { if (Read-Serve) { & $tailscale serve --https=443 off | Out-Null } }
            catch { Write-Warning 'Review the failed route with tailscale serve status.' }
        }
        if ($server -and !$server.HasExited) { Stop-Process -InputObject $server }
        if ($configCreated) { Remove-Item -LiteralPath $mobileConfig }
    }
    Pop-Location
}
