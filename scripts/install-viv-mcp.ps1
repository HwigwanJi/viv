#Requires -Version 5.1
[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4317,[switch]$ProbeOnly,[ValidateSet('Codex','Claude','Manual')][string]$Client='Codex')
$ErrorActionPreference='Stop'
$url="http://127.0.0.1:$Port/mcp"
$request=@{jsonrpc='2.0';id=1;method='initialize';params=@{protocolVersion='2025-11-25';capabilities=@{};clientInfo=@{name='viv-installer';version='1'}}}
$init=Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($request | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 10
if($init.result.serverInfo.name -ne 'viv' -or $null -eq $init.result.capabilities.prompts){throw 'VIV MCP is unavailable. Start VIV and retry.'}
$request.method='tools/list'
$request.Remove('params')
$tools=Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($request | ConvertTo-Json -Compress) -TimeoutSec 10
if('viv_onboarding' -notin $tools.result.tools.name){throw 'VIV onboarding was not advertised.'}
if($ProbeOnly -or $Client -eq 'Manual'){
    [ordered]@{name='viv';url=$url;status='endpoint-ready'} | ConvertTo-Json
    return
}
if($Client -eq 'Claude'){
    $claude=(Get-Command claude.exe,claude.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if(!$claude){throw 'Claude Code CLI is unavailable. Install Claude Code, then rerun with -Client Claude.'}
    $details=& {
        $ErrorActionPreference='Continue'
        & $claude mcp get viv 2>&1 | Out-String
    }
    if($LASTEXITCODE -ne 0){
        if($details -notmatch 'No MCP server named "viv"'){throw 'Could not read the Claude Code MCP configuration.'}
        $null=& $claude mcp add --transport http --scope user viv $url
        if($LASTEXITCODE -ne 0){throw 'Could not register VIV MCP in Claude Code.'}
        $details=(& $claude mcp get viv | Out-String)
        if($LASTEXITCODE -ne 0){throw 'Could not verify the saved Claude Code MCP configuration.'}
    }
    if($details -notmatch ('(?m)^\s*URL:\s*'+[regex]::Escape($url)+'[ \t]*\r?$')){
        throw 'A different MCP server is already registered as viv in Claude Code.'
    }
    if($details -notmatch '(?m)^\s*Status:[^\p{L}\r\n]*Connected[ \t]*\r?$'){
        throw 'Claude Code could not connect to VIV MCP. Check claude mcp get viv and rerun.'
    }
    [ordered]@{name='viv';url=$url;status='registered';startMessage='VIV 시작하기'} | ConvertTo-Json
    return
}
$codex=(Get-Command codex.exe -ErrorAction SilentlyContinue).Source
if(!$codex){throw 'Codex CLI is unavailable. Register this MCP URL in your AI client.'}
$registered=& $codex mcp list --json
if($LASTEXITCODE -ne 0){throw 'Could not read the Codex MCP configuration.'}
$entries=$registered | Out-String | ConvertFrom-Json
$existing=$entries | Where-Object name -eq 'viv'
if($existing){
    if($existing.transport.url -ne $url){throw 'A different MCP server is already registered as viv.'}
    if($existing.enabled -eq $false){throw 'VIV MCP is disabled in Codex. Enable it there and rerun this command.'}
}else{
    & $codex mcp add viv --url $url | Out-Host
    if($LASTEXITCODE -ne 0){throw 'Could not register VIV MCP.'}
}
$verified=& $codex mcp get viv --json
if($LASTEXITCODE -ne 0 -or ($verified | ConvertFrom-Json).transport.url -ne $url){throw 'Could not verify the saved VIV MCP configuration.'}
[ordered]@{name='viv';url=$url;status='registered';startMessage='VIV 시작하기'} | ConvertTo-Json
