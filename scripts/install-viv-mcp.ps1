#Requires -Version 5.1
[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4317,[switch]$ProbeOnly)
$ErrorActionPreference='Stop'
$url="http://127.0.0.1:$Port/mcp"
$request=@{jsonrpc='2.0';id=1;method='initialize';params=@{protocolVersion='2025-11-25';capabilities=@{};clientInfo=@{name='viv-installer';version='1'}}}
$init=Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($request | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 10
if($init.result.serverInfo.name -ne 'viv' -or $null -eq $init.result.capabilities.prompts){throw 'VIV MCP is unavailable. Start VIV and retry.'}
$request.method='tools/list'
$request.Remove('params')
$tools=Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($request | ConvertTo-Json -Compress) -TimeoutSec 10
if('viv_onboarding' -notin $tools.result.tools.name){throw 'VIV onboarding was not advertised.'}
if($ProbeOnly){
    [ordered]@{name='viv';url=$url;status='endpoint-ready'} | ConvertTo-Json
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
[ordered]@{name='viv';url=$url;status='registered';startMessage='VIV start'} | ConvertTo-Json
