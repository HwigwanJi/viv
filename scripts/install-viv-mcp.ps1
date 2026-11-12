#Requires -Version 5.1
[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port,[switch]$ProbeOnly,[ValidateSet('Codex','Claude','Manual')][string]$Client='Codex')
$ErrorActionPreference='Stop'

$runtime=Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime'
$portFile=Join-Path $runtime 'self-host-port'
$idFile=Join-Path $runtime 'self-host-id'
if(!(Test-Path -LiteralPath $portFile) -or !(Test-Path -LiteralPath $idFile) -or !(Test-Path -LiteralPath (Join-Path $runtime 'self-host.sqlite'))){
    throw '원래 VIV 설치 폴더에서 이 명령을 실행하세요. 새 폴더라면 먼저 VIV를 설치하세요.'
}
$savedPort=(Get-Content -LiteralPath $portFile -Raw).Trim()
$setupId=(Get-Content -LiteralPath $idFile -Raw).Trim()
if($savedPort -notmatch '^[1-9][0-9]{3,4}$' -or [int]$savedPort -lt 1024 -or [int]$savedPort -gt 65535 -or [int]$savedPort -eq 4905 -or $setupId -cnotmatch '^[a-f0-9]{32}$'){
    throw '원래 설치 폴더에 저장된 VIV 포트와 설치 ID를 확인하세요.'
}
if($PSBoundParameters.ContainsKey('Port') -and $Port -ne [int]$savedPort){
    throw "이 VIV 폴더는 $savedPort 포트에 연결되어 있습니다. -Port 없이 다시 실행하세요."
}
$Port=[int]$savedPort
$origin="http://127.0.0.1:$Port"
$url="$origin/mcp?installation=$setupId"
try{$page=Invoke-WebRequest "$origin/" -Method Head -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 5}
catch{throw "VIV 주소 $origin 에 연결할 수 없습니다. 원래 설치 폴더에서 -Resume을 실행한 뒤 다시 시도하세요."}
if([string]$page.Headers['X-VIV-Setup'] -cne $setupId){
    throw "$Port 포트가 이 폴더의 VIV를 가리키지 않습니다. 원래 설치 주소를 복구한 뒤 다시 실행하세요."
}

function Invoke-VivRpc([string]$Method,$Params){
    $request=@{jsonrpc='2.0';id=1;method=$Method}
    if($Params){$request.params=$Params}
    $response=Invoke-WebRequest $url -Method Post -UseBasicParsing -MaximumRedirection 0 -ContentType 'application/json' -Body ($request | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 10
    if([string]$response.Headers['X-VIV-Setup'] -cne $setupId){throw 'MCP 응답이 다른 VIV 설치에서 왔습니다. 원래 설치에서 다시 실행하세요.'}
    return ($response.Content | ConvertFrom-Json).result
}
$init=Invoke-VivRpc 'initialize' @{protocolVersion='2025-11-25';capabilities=@{};clientInfo=@{name='viv-installer';version='1'}}
if($init.serverInfo.name -ne 'viv' -or $null -eq $init.capabilities.prompts){throw 'VIV MCP is unavailable. Start VIV and retry.'}
$tools=Invoke-VivRpc 'tools/list'
if('viv_onboarding' -notin $tools.tools.name){throw 'VIV onboarding was not advertised.'}
if($ProbeOnly -or $Client -eq 'Manual'){
    [ordered]@{name='viv';url=$url;status='endpoint-ready'} | ConvertTo-Json
    return
}

$name='viv'
if($Client -eq 'Claude'){
    $claude=(Get-Command claude.exe,claude.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if(!$claude){throw 'Claude Code CLI is unavailable. Install Claude Code, then rerun with -Client Claude.'}
    function Read-VivClaude([string]$Name){
        $details=& {
            $ErrorActionPreference='Continue'
            & $claude mcp get $Name 2>&1 | Out-String
        }
        if($LASTEXITCODE -eq 0){return $details}
        if($details -like "*No MCP server named `"$Name`"*"){return $null}
        throw 'Could not read the Claude Code MCP configuration.'
    }
    $urlPattern='(?m)^\s*URL:\s*'+[regex]::Escape($url)+'[ \t]*\r?$'
    $details=Read-VivClaude $name
    if($details -and $details -notmatch $urlPattern){$name="viv-$Port";$details=Read-VivClaude $name}
    if($details -and $details -notmatch $urlPattern){$name="viv-$Port-$($setupId.Substring(0,8))";$details=Read-VivClaude $name}
    if(!$details){
        $null=& $claude mcp add --transport http --scope user $name $url
        if($LASTEXITCODE -ne 0){throw 'Could not register VIV MCP in Claude Code.'}
        $details=Read-VivClaude $name
    }
    if($details -notmatch $urlPattern){throw "Claude Code의 $name 이름이 다른 주소에 연결되어 있습니다. 앱의 MCP 주소를 다른 이름으로 등록하세요."}
    if($details -notmatch '(?m)^\s*Status:[^\p{L}\r\n]*Connected[ \t]*\r?$'){
        throw "Claude Code could not connect to VIV MCP. Check claude mcp get $name and rerun."
    }
}else{
    $codex=(Get-Command codex.exe -ErrorAction SilentlyContinue).Source
    if(!$codex){throw 'Codex CLI is unavailable. Register this MCP URL in your AI client.'}
    $registered=& $codex mcp list --json
    if($LASTEXITCODE -ne 0){throw 'Could not read the Codex MCP configuration.'}
    $entries=$registered | Out-String | ConvertFrom-Json
    $existing=$entries | Where-Object name -eq $name
    if($existing -and $existing.transport.url -ne $url){$name="viv-$Port";$existing=$entries | Where-Object name -eq $name}
    if($existing -and $existing.transport.url -ne $url){$name="viv-$Port-$($setupId.Substring(0,8))";$existing=$entries | Where-Object name -eq $name}
    if($existing){
        if($existing.transport.url -ne $url){throw "Codex의 $name 이름이 다른 주소에 연결되어 있습니다. 앱의 MCP 주소를 다른 이름으로 등록하세요."}
        if($existing.enabled -eq $false){throw "$name MCP is disabled in Codex. Enable it there and rerun this command."}
    }else{
        & $codex mcp add $name --url $url | Out-Host
        if($LASTEXITCODE -ne 0){throw 'Could not register VIV MCP.'}
    }
    $verified=& $codex mcp get $name --json
    if($LASTEXITCODE -ne 0 -or ($verified | ConvertFrom-Json).transport.url -ne $url){throw 'Could not verify the saved VIV MCP configuration.'}
}
$message=if($name -eq 'viv'){'VIV 시작하기'}else{"$name 도구로 VIV 시작하기"}
[ordered]@{name=$name;url=$url;status='registered';startMessage=$message} | ConvertTo-Json
