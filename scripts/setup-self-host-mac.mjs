import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {validateMobileOrigin,privateMobileRouteStatus} from './preview-origin.mjs';

const [target, client, port, recovery = ''] = process.argv.slice(2);
const mobileOnly = recovery === 'mobile-only';
if (!['pc', 'mobile'].includes(target) || !['codex', 'claude', 'manual'].includes(client)
    || recovery && (!mobileOnly || target !== 'mobile')
    || !/^\d{4,5}$/.test(port ?? '') || Number(port) < 1024 || Number(port) > 65535 || Number(port) === 4905) {
  throw new Error('Invalid VIV installation options.');
}
const origin = 'http://127.0.0.1:' + port;
const mcpUrl = origin + '/mcp';
const database = path.resolve('.runtime/self-host.sqlite');
const mobileConfig = '.runtime/mobile-access.json';

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

async function verifyMcp() {
  const rpc = async (method, params) => {
    const res = await request(mcpUrl, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
    });
    if (!res.ok) throw new Error('VIV MCP is unavailable.');
    return (await res.json()).result;
  };
  if ((await rpc('initialize', {protocolVersion: '2025-11-25'}))?.serverInfo?.name !== 'viv'
      || !(await rpc('tools/list'))?.tools?.some(tool => tool.name === 'viv_onboarding')) {
    throw new Error('VIV MCP did not advertise onboarding.');
  }
}

function registerMcp() {
  if (client === 'manual') return 'endpoint-ready';
  const inspect = () => command(client, client === 'codex' ? ['mcp', 'list', '--json'] : ['mcp', 'get', 'viv'], {timeout: 15000});
  const readCodex = result => {
    if (result.status !== 0) throw new Error('Could not read the Codex MCP configuration.');
    return JSON.parse(result.stdout).find(entry => entry.name === 'viv');
  };
  let result = inspect();
  if (result.error?.code === 'ENOENT') throw new Error(`Install the ${client} CLI and rerun this command.`);
  const missing = client === 'codex'
    ? !readCodex(result)
    : result.status === 1 && (result.stderr + result.stdout).includes('No MCP server named "viv"');
  if (missing) {
    const args = client === 'codex' ? ['mcp', 'add', 'viv', '--url', mcpUrl] : ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'viv', mcpUrl];
    if (command(client, args, {show: true, timeout: 15000}).status !== 0) throw new Error('Could not register VIV MCP.');
    result = inspect();
  }
  if (client === 'codex') {
    const entry = readCodex(result);
    if (entry?.transport?.url !== mcpUrl || entry.enabled === false) throw new Error('Check the existing viv MCP entry in Codex.');
  } else {
    const url = result.stdout?.match(/^\s*URL:\s*(\S+)\s*$/m)?.[1];
    if (result.status !== 0 || url !== mcpUrl) throw new Error('Check the existing viv MCP entry in Claude Code.');
    if (!/^\s*Status:[^\p{L}\r\n]*Connected\s*$/mu.test(result.stdout)) throw new Error('Claude Code could not connect to VIV MCP.');
  }
  return 'registered';
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
if (existsSync(database) && !existsSync('.env')) throw new Error('Restore the original .env before starting this VIV database.');
let serverPid = null;
const running = await request(origin + '/').catch(error => {
  if (error.cause?.code !== 'ECONNREFUSED') throw error;
  return null;
});
if (!running) {
  if (!mobileOnly) {
    for (const args of [['ci', '--no-audit', '--no-fund'], ['run', 'build:local']]) {
      if (command('npm', args, {show: true}).status !== 0) throw new Error('VIV dependency installation or build failed.');
    }
  }
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
        await verifyApp(origin, setupId);
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
} else await verifyApp(origin, setupId);

console.error('VIV PC: ' + origin);
let mcpStatus = mobileOnly ? 'not-requested' : 'needs-action', mcpError = null, mobileInstallUrl = null, mobileError = null;
if (!mobileOnly) {
  try {
    await verifyMcp();
    mcpStatus = registerMcp();
  } catch (error) { mcpError = error.message; }
}
if (target === 'mobile') {
  try { mobileInstallUrl = await connectMobile(setupId); }
  catch (error) { mobileError = error.message; }
}
console.log(JSON.stringify({
  serverPid, desktopUrl: origin, desktopInstallUrl: origin + '/install.html', desktopStatus: serverPid ? 'started' : 'reused', mcpUrl, mcpStatus, mcpError,
  mcpRetryCommand: mcpError ? ['bash scripts/install-viv-mac.sh --target pc --client', client, '--port', port].join(' ') : null,
  onboardingPrompt: mcpStatus === 'registered' ? 'VIV 시작하기' : null,
  onboardingTool: mcpStatus === 'registered' ? 'viv_onboarding' : null,
  mobileInstallUrl, mobileError,
  mobileRetryCommand: mobileError ? 'bash scripts/install-viv-mac.sh --mobile-only --port ' + port : null,
  mobileStatus: mobileError ? 'needs-action' : mobileInstallUrl ? 'phone-install-pending' : 'not-requested',
  liveRunner: 'disabled',
}));
