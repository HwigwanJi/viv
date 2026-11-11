# Run from a fresh Windows checkout. See docs/agents/operations/self-host.md.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Mobile,
    [switch]$StartOnly,
    [ValidateRange(1024, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
if ($Port -eq 4905) { throw 'Port 4905 is reserved for the managed trading host.' }
$project = Split-Path -Parent $PSScriptRoot
$localUrl = "http://127.0.0.1:$Port"
$server = $null
$configuredRoute = $false
$ready = $false
$configCreated = $false

function Test-App([string]$BaseUrl) {
    $status = Invoke-RestMethod "$BaseUrl/api/status" -TimeoutSec 5 -MaximumRedirection 0
    if ($status.storage -ne 'server' -or $status.runners.disabled -ne $true -or $status.runners.live.running -ne $false) {
        throw 'The server did not report an isolated setup session.'
    }
    $manifest = Invoke-RestMethod "$BaseUrl/manifest.json" -TimeoutSec 5 -MaximumRedirection 0
    if ($manifest.display -ne 'standalone' -or $manifest.scope -ne '/') { throw 'Mobile manifest verification failed.' }
    foreach ($route in @('/', '/install.html') + @($manifest.icons.src)) {
        $null = Invoke-WebRequest "$BaseUrl$route" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    }
    return $status
}

function Read-Serve {
    $raw = & $tailscale serve status --json
    if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve status unavailable.' }
    $serve = $raw | ConvertFrom-Json
    if ($serve.AllowFunnel.PSObject.Properties | Where-Object Value -eq $true) {
        throw 'Public Funnel is enabled on this device. Use a private Tailscale host for Chungji.'
    }
    $existing = $serve.Web.PSObject.Properties["${hostname}:443"].Value.Handlers.PSObject.Properties['/'].Value
    if ($existing -and $existing.Proxy -ne $localUrl) { throw 'Tailscale HTTPS already serves another application.' }
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
    $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch { throw "Local port $Port is busy. Stop the setup server or choose another port." }
    finally { $listener.Stop() }

    if (!$StartOnly) {
        $npm = (Get-Command npm.cmd).Source
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
        & $npm run build:local
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    }

    $runtime = Join-Path $project '.runtime'
    $null = New-Item -ItemType Directory -Path $runtime -Force
    if (!(Test-Path -LiteralPath '.env')) {
        if (Test-Path -LiteralPath (Join-Path $runtime 'self-host.sqlite')) {
            throw 'Restore the original .env for this checkout before restarting.'
        }
        & $node -e "const {writeFileSync}=require('node:fs'); const {randomBytes}=require('node:crypto'); writeFileSync('.env', 'BROKER_VAULT_KEY='+randomBytes(32).toString('hex')+'\n', {flag:'wx',mode:0o600})"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the local credential vault configuration.' }
    }
    $mobileConfig = Join-Path $runtime 'mobile-access.json'
    $mobileUrl = $null
    if ($Mobile) {
        $tailscale = (Get-Command tailscale.exe -ErrorAction SilentlyContinue).Source
        if (!$tailscale) {
            $tailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
            if (!(Test-Path -LiteralPath $tailscale)) {
                if (Get-Process -Name tailscaled -ErrorAction SilentlyContinue) {
                    throw 'An existing Tailscale is running outside the default installation. Add its CLI to PATH and retry.'
                }
                & winget.exe install --id Tailscale.Tailscale --exact --source winget
                if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $tailscale)) { throw 'Install Tailscale and retry.' }
            }
        }
        $state = (& $tailscale status --json) | ConvertFrom-Json
        if ($state.BackendState -ne 'Running') {
            & $tailscale up
            if ($LASTEXITCODE -ne 0) { throw 'Complete Tailscale sign-in and retry.' }
            $state = (& $tailscale status --json) | ConvertFrom-Json
        }
        $hostname = ([string]$state.Self.DNSName).TrimEnd('.')
        if ($state.BackendState -ne 'Running' -or $hostname -cnotmatch '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$') {
            throw 'Tailscale must be signed in with MagicDNS enabled.'
        }
        $mobileUrl = "https://$hostname"
        $null = Read-Serve
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
    } elseif (Test-Path -LiteralPath $mobileConfig) {
        throw 'This checkout has a mobile origin. Restart it with -Mobile to recheck private access.'
    }

    $arguments = @('--env-file-if-exists=.env', 'scripts/preview.mjs', '--no-runners')
    $savedPort = $env:KEYNES_PREVIEW_PORT
    $savedDb = $env:KEYNES_PREVIEW_DB
    try {
        $env:KEYNES_PREVIEW_PORT = "$Port"
        $env:KEYNES_PREVIEW_DB = Join-Path $runtime 'self-host.sqlite'
        $server = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtime 'self-host.stdout.log') -RedirectStandardError (Join-Path $runtime 'self-host.stderr.log')
    } finally {
        $env:KEYNES_PREVIEW_PORT = $savedPort
        $env:KEYNES_PREVIEW_DB = $savedDb
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { throw 'Server exited. See .runtime/self-host.stderr.log.' }
        try { $status = Test-App $localUrl; break } catch { $startupError = $_; Start-Sleep -Milliseconds 500 }
    }
    if (!$status) { throw $startupError }
    if ($server.HasExited) { throw 'The started server exited before verification completed.' }

    if ($Mobile) {
        if (!(Read-Serve)) {
            & $tailscale serve --bg --yes $localUrl | Out-Host
            if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Enable HTTPS in the tailnet settings if requested.' }
            $configuredRoute = $true
        }
        if (!(Read-Serve)) { throw 'Tailscale did not report the expected private route.' }
        $null = Test-App $mobileUrl
    }
    $ready = $true
    [ordered]@{
        serverPid = $server.Id
        desktopUrl = $localUrl
        mobileInstallUrl = if ($mobileUrl) { "$mobileUrl/install.html" } else { $null }
        liveRunner = 'disabled'
        aiKey = if ($status.jev.configured) { 'configured-unverified' } else { 'not-configured' }
    } | ConvertTo-Json
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
