import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {validateMobileOrigin,privateMobileRouteStatus} from './preview-origin.mjs';
import {boundMcpUrl,selectSelfHostPort} from './self-host-binding.mjs';

const [target, client, requestedPort = '', recovery = ''] = process.argv.slice(2);
const mobileOnly = recovery === 'mobile-only';
const resume = recovery === 'resume';
const database = path.resolve('.runtime/self-host.sqlite');
const portFile = '.runtime/self-host-port';
const mobileConfig = '.runtime/mobile-access.json';
if (!['pc', 'mobile'].includes(target) || !['codex', 'claude', 'manual'].includes(client)
    || recovery && !(mobileOnly && target === 'mobile' || resume && target === 'pc' && client === 'manual' && !requestedPort)) {
  throw new Error('Invalid VIV installation options.');
}
if(['.runtime/server-host-config.json','.runtime/server-host-state.json','.runtime/investment.sqlite'].some(existsSync)){
  throw new Error('Use a separate checkout for self-host setup. An existing server was detected.');
}
function assertRestoredConfig() {
  if (statSync(database,{throwIfNoEntry:false})?.isFile() && !statSync('.env',{throwIfNoEntry:false})?.isFile()) {
    throw new Error(`이 VIV 데이터베이스를 열려면 원래 .env 파일이 필요합니다. 이 DB와 함께 사용하던 .env를 '${process.cwd()}'에 복원하세요. 새 폴더에서는 설치 명령을, 기존 설치에서는 다시 시작 명령을 실행하세요. 복원 안내는 docs/agents/operations/self-host.md에서 확인하세요.`);
  }
}
assertRestoredConfig();
const savedPort = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : null;
if (resume && (savedPort === null || !existsSync('.runtime/self-host-id') || !existsSync(database))) {
  throw new Error('Run the installer once from the original VIV folder with its original port before using --resume.');
}
let port = savedPort ?? (requestedPort || '4317');
if (!/^[1-9]\d{3,4}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || Number(port) === 4905) {
  throw new Error(savedPort === null ? 'Invalid VIV port.' : 'The saved VIV port is invalid. Check .runtime/self-host-port in the original VIV folder.');
}
if (savedPort !== null && requestedPort && requestedPort !== port) {
  throw new Error(`This VIV folder already uses port ${port}. Omit --port to use it. Use a separate checkout for another port.`);
}
let origin,mcpUrl;

function initializeFile(file, value) {
  try {
    writeFileSync(file, value, {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFileSync(file, 'utf8').trim();
}

function command(name, args, {show = false, timeout, env = process.env} = {}) {
  return spawnSync(name, args, {encoding: 'utf8', stdio: show ? ['inherit', 2, 2] : ['ignore', 'pipe', 'pipe'], timeout, env});
}

async function request(url, options) {
  return fetch(url, {redirect: 'error', signal: AbortSignal.timeout(5000), ...options});
}

async function verifyApp(base, setupId) {
  const page = await request(base + '/');
  if (!page.ok || page.headers.get('X-VIV-Setup') !== setupId) throw new Error('This address belongs to another service.');
  const status = await (await request(base + '/api/status')).json();
  if (status.storage !== 'server' || status.runners?.disabled !== true || status.runners?.live?.running !== false) {
    throw new Error('The server did not report an isolated setup session.');
  }
  const manifestResponse = await request(base + '/manifest.json');
  if (!manifestResponse.ok) throw new Error('VIV install manifest unavailable: /manifest.json. Restore this checkout’s install files and retry on port ' + port + '.');
  const manifest = await manifestResponse.json().catch(() => null);
  if (manifest?.display !== 'standalone' || manifest.scope !== '/' || !manifest.icons?.length) throw new Error('Mobile manifest verification failed.');
  for (const route of ['/install.html', ...manifest.icons.map(icon => icon.src)]) {
    if (!(await request(base + route)).ok) throw new Error('VIV install asset unavailable: ' + route + '. Restore this checkout’s install files and retry on port ' + port + '.');
  }
}

async function confirmInstallation(setupId) {
  await verifyApp(origin, setupId);
  if (initializeFile(portFile, port + '\n') !== port) {
    throw new Error('Another process set a different VIV port in this folder. Use the original installation port.');
  }
}

async function verifyMcp(setupId) {
  const rpc = async (method, params) => {
    const res = await request(mcpUrl, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
    });
    if (!res.ok || res.headers.get('X-VIV-Setup') !== setupId) throw new Error('MCP response does not belong to this VIV installation.');
    return (await res.json()).result;
  };
  if ((await rpc('initialize', {protocolVersion: '2025-11-25'}))?.serverInfo?.name !== 'viv'
      || !(await rpc('tools/list'))?.tools?.some(tool => tool.name === 'viv_onboarding')) {
    throw new Error('VIV MCP did not advertise onboarding.');
  }
}

function registerMcp() {
  if (client === 'manual') return {name:'viv',status:'endpoint-ready'};
  const codex = client === 'codex';
  function inspect(name) {
    const result=command(client,codex?['mcp','list','--json']:['mcp','get',name],{timeout:15000});
    if(result.error?.code==='ENOENT')throw new Error('Install the '+client+' CLI and rerun this command.');
    if(codex){
      if(result.status!==0)throw new Error('Could not read the Codex MCP configuration.');
      const entry=JSON.parse(result.stdout).find(value=>value.name===name);
      return entry?{url:entry.transport?.url,ready:entry.enabled!==false}:null;
    }
    if(result.status===1&&(result.stderr+result.stdout).includes('No MCP server named "'+name+'"'))return null;
    if(result.status!==0)throw new Error('Could not read the Claude Code MCP configuration.');
    return {url:result.stdout.match(/^\s*URL:\s*(\S+)\s*$/m)?.[1],ready:/^\s*Status:[^\p{L}\r\n]*Connected\s*$/mu.test(result.stdout)};
  }
  let name='viv',entry=inspect(name);
  if(entry&&entry.url!==mcpUrl){name='viv-'+port;entry=inspect(name);}
  if(entry&&entry.url!==mcpUrl){name='viv-'+port+'-'+new URL(mcpUrl).searchParams.get('installation').slice(0,8);entry=inspect(name);}
  if(!entry){
    const args=codex?['mcp','add',name,'--url',mcpUrl]:['mcp','add','--transport','http','--scope','user',name,mcpUrl];
    if(command(client,args,{show:true,timeout:15000}).status!==0)throw new Error('Could not register VIV MCP.');
    entry=inspect(name);
  }
  if(entry?.url!==mcpUrl)throw new Error(client+'의 '+name+' 이름이 다른 주소에 연결되어 있습니다. 앱의 MCP 주소를 다른 이름으로 등록하세요.');
  if(!entry.ready)throw new Error('Check the saved '+name+' MCP entry in '+client+'.');
  return {name,status:'registered'};
}

async function connectMobile(setupId) {
  const appCli = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  let cli = existsSync(appCli) ? appCli : 'tailscale';
  const tail = (args, options) => command(cli, args, {...options, env: {...process.env, TAILSCALE_BE_CLI: '1'}});
  let status = tail(['status', '--json'], {timeout: 10000});
  if (status.error?.code === 'ENOENT') {
    const install = command('brew', ['install', '--cask', 'tailscale-app'], {show: true});
    if (install.status !== 0 || !existsSync(appCli)) throw new Error('Install the Tailscale Mac app, sign in, and rerun.');
    cli = appCli;
    status = tail(['status', '--json'], {timeout: 10000});
  }
  const state = JSON.parse(status.stdout || '{}');
  if (state.BackendState !== 'Running') {
    if (cli === appCli) command('open', ['-a', 'Tailscale']);
    throw new Error('Sign in to Tailscale on the Mac, then run the mobile recovery command.');
  }
  const host = state.Self?.DNSName?.replace(/\.$/, '') ?? '';
  const mobileOrigin = validateMobileOrigin('https://' + host);
  const inspect = () => {
    const result = tail(['serve', 'status', '--json'], {timeout: 10000});
    if (result.status !== 0) throw new Error('Could not read Tailscale Serve configuration.');
    const route = privateMobileRouteStatus(JSON.parse(result.stdout), mobileOrigin, origin);
    if (route === 'public') throw new Error('Public Funnel is enabled on this Tailscale device.');
    if (route === 'conflict') throw new Error('Another service already uses the Tailscale HTTPS route.');
    return route === 'ready';
  };
  const serve = ['serve', '--bg', '--https=443', '--set-path=/', origin];
  const existing = inspect();
  const alreadyConfigured = existsSync(mobileConfig);
  if (JSON.parse(initializeFile(mobileConfig, JSON.stringify({origin: mobileOrigin}))).origin !== mobileOrigin) {
    throw new Error('The saved mobile address belongs to a different Tailscale device.');
  }
  let routeAdded = false;
  try {
    if (!existing) {
      if (tail(serve, {show: true, timeout: 45000}).status !== 0) {
        throw new Error('Tailscale Serve failed. Check MagicDNS and HTTPS in your tailnet.');
      }
      routeAdded = true;
    }
    if (!inspect()) throw new Error('Tailscale Serve did not report the VIV route.');
    await verifyApp(mobileOrigin, setupId);
    return mobileOrigin + '/install.html';
  } catch (error) {
    if (routeAdded) {
      try {
        if (inspect() && tail([...serve, 'off'], {timeout: 10000}).status !== 0) throw new Error('Could not remove VIV Serve route.');
      } catch { console.warn('Review the private route with tailscale serve status.'); }
    }
    if (!alreadyConfigured) unlinkSync(mobileConfig);
    throw error;
  }
}

if (mobileOnly && (!existsSync('.runtime/self-host-id') || !existsSync(database))) {
  throw new Error('Complete the PC installation in this folder before running mobile recovery.');
}
mkdirSync('.runtime', {recursive: true, mode: 0o700});
const setupId = initializeFile('.runtime/self-host-id', randomBytes(16).toString('hex'));
if (!/^[a-f0-9]{32}$/.test(setupId)) throw new Error('Invalid VIV installation ID.');
let serverPid = null;
const fixed=savedPort!==null||existsSync(database)||mobileOnly||resume;
const selection=await selectSelfHostPort(Number(port),setupId,!fixed&&!requestedPort);
if(selection.state==='occupied'){
  const who=selection.otherViv?'다른 VIV 설치':'다른 프로그램';
  if(fixed)throw new Error('원래 VIV 주소의 '+port+' 포트는 현재 '+who+'에서 사용 중입니다. 해당 프로그램을 확인한 뒤 이 폴더에서 --resume을 다시 실행하세요.');
  const alternative=selection.alternative?' 새 설치에는 --port '+selection.alternative+' 옵션을 사용할 수 있습니다.':' 새 설치에 쓸 다른 포트를 지정하세요.';
  throw new Error(port+' 포트는 현재 '+who+'에서 사용 중입니다.'+alternative);
}
port=String(selection.port);
origin='http://127.0.0.1:'+port;
mcpUrl=boundMcpUrl(port,setupId);
if(selection.previousPort)console.error('기본 포트 '+selection.previousPort+'를 사용 중이어서 새 VIV를 '+port+' 포트에 설치합니다.');
if(selection.state!=='existing'){
  if (!mobileOnly && !resume) {
    for (const args of [['ci', '--no-audit', '--no-fund'], ['run', 'build:local']]) {
      if (command('npm', args, {show: true}).status !== 0) throw new Error('VIV dependency installation or build failed.');
    }
  }
  assertRestoredConfig();
  initializeFile('.env', 'BROKER_VAULT_KEY=' + randomBytes(32).toString('hex') + '\n');
  const log = openSync('.runtime/self-host.log', 'a', 0o600);
  const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/preview.mjs', '--no-runners'], {
    detached: true, stdio: ['ignore', log, log],
    env: {...process.env, KEYNES_PREVIEW_PORT: port, KEYNES_PREVIEW_DB: database, VIV_SELF_HOST_ID: setupId},
  });
  closeSync(log);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && server.exitCode === null; attempt++) {
      const response = await request(origin + '/').catch(() => null);
      if (response) {
        await confirmInstallation(setupId);
        ready = true;
        break;
      }
      await delay(500);
    }
    if (!ready) throw new Error('VIV did not start. See .runtime/self-host.log.');
    serverPid = server.pid;
    server.unref();
  } catch (error) {
    server.kill();
    throw error;
  }
} else await confirmInstallation(setupId);

console.error('VIV PC: ' + origin);
let mcpStatus = mobileOnly ? 'not-requested' : 'needs-action', mcpName = null, mcpError = null, mobileInstallUrl = null, mobileError = null;
if (!mobileOnly) {
  try {
    await verifyMcp(setupId);
    ({name:mcpName,status:mcpStatus}=registerMcp());
  } catch (error) { mcpError = error.message; }
}
if (target === 'mobile') {
  try { mobileInstallUrl = await connectMobile(setupId); }
  catch (error) { mobileError = error.message; }
}
console.log(JSON.stringify({
  serverPid, desktopUrl: origin, desktopInstallUrl: origin + '/install.html', desktopStatus: serverPid ? 'started' : 'reused', mcpUrl, mcpName, mcpStatus, mcpError,
  restartCommand: 'bash scripts/install-viv-mac.sh --resume',
  mcpRetryCommand: mcpError ? ['bash scripts/install-viv-mac.sh --target pc --client', client, '--port', port].join(' ') : null,
  onboardingPrompt: mcpStatus==='registered'?(mcpName==='viv'?'VIV 시작하기':mcpName+' 도구로 VIV 시작하기'):null,
  onboardingTool: mcpStatus === 'registered' ? 'viv_onboarding' : null,
  mobileInstallUrl, mobileError,
  mobileRetryCommand: mobileError ? 'bash scripts/install-viv-mac.sh --mobile-only --port ' + port : null,
  mobileStatus: mobileError ? 'needs-action' : mobileInstallUrl ? 'phone-install-pending' : 'not-requested',
  liveRunner: 'disabled',
}));
