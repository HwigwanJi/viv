import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {optionalSessionStorage} from '../dist/ui/session-storage.mjs';
import {submitPaperFunding} from '../dist/ui/paper-funding-request.mjs';

const script = readFileSync(new URL('../dist/ui/viv-startup.js', import.meta.url), 'utf8');
const notificationWorker = readFileSync(new URL('../dist/notification-worker.js', import.meta.url), 'utf8');

test('VIV worker recovers unavailable app navigation and leaves other requests to the network', async () => {
  const listeners = {};
  const origin = 'http://localhost:4317';
  let reply = new Response('current app');
  runInNewContext(notificationWorker, {
    self: {location: {origin}, addEventListener: (name, listener) => { listeners[name] = listener; }},
    fetch: async () => {
      if (!reply) throw new TypeError('connection refused');
      return reply;
    },
    URL, Response
  });
  const navigate = (path, mode = 'navigate', method = 'GET') => {
    let response;
    listeners.fetch({
      request: {url: new URL(path, origin).href, mode, method},
      respondWith(value) { response = value; }
    });
    return response;
  };
  assert.equal(await navigate('/'), reply);
  for (const status of [401, 403, 404]) {
    reply = new Response('server response', {status});
    assert.equal(await navigate('/'), reply);
  }
  for (const status of [null, 502, 503, 504]) {
    reply = status ? new Response(null, {status}) : null;
    for (const path of ['/', '/index.html', '/install.html']) {
      const fallback = await navigate(path);
      assert.equal(fallback.status, 503);
      assert.equal(fallback.headers.get('Cache-Control'), 'no-store');
      assert.match(await fallback.text(), /VIV 서버에 연결할 수 없어요[^]*다시 연결/);
    }
  }
  assert.equal(navigate('/api/workspace'), undefined);
  assert.equal(navigate('/mcp'), undefined);
  assert.equal(navigate('/app.mjs'), undefined);
  assert.equal(navigate('https://example.test/'), undefined);
  assert.equal(navigate('/', 'cors'), undefined);
  assert.equal(navigate('/', 'navigate', 'POST'), undefined);
  assert.ok(listeners.push && listeners.notificationclick);
});

function setup(fetch, resources = []) {
  const events = {}, attributes = new Map(), status = {hidden: true}, message = {}, fileStatus = {hidden: true};
  const button = {
    isConnected: true,
    addEventListener: (_, callback) => { button.click = callback; },
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
  const recovery = {hidden: true, querySelector: selector => selector === 'button' ? button : selector === '[data-viv-failed-files]' ? fileStatus : message};
  const intro = {
    isConnected: true,
    querySelector: selector => selector === '.viv-intro-status' ? status : recovery,
  };
  let reloads = 0;
  const window = {
    performance: {getEntriesByType: () => resources},
    addEventListener: (name, callback) => { events[name] = callback; },
    setTimeout: (callback, delay) => { events[delay] = callback; return delay; },
    clearTimeout: delay => { delete events[delay]; },
  };
  const document = {querySelector: selector => selector === '.viv-intro' ? intro : null, getElementById: () => ({src: 'http://localhost/app.mjs'})};
  const location = {origin: 'http://localhost', pathname: '/', search: '?entry=install', reload: () => { reloads++; }};
  runInNewContext(script, {document, window, location, AbortController, fetch, URL});
  return {events, attributes, status, message, fileStatus, button, recovery, intro, reloads: () => reloads};
}

const asset = (contentType, status = 200) => new Response(null, {status, headers: {'content-type': contentType}});

test('VIV offers recovery when the entry module fails or startup stalls', () => {
  for (const trigger of ['module', 'timeout', 'completed']) {
    const {events, status, recovery, intro} = setup();
    assert.equal(status.hidden, false);
    events.error({target: {id: 'unrelated-image'}});
    assert.equal(recovery.hidden, true);
    if (trigger === 'completed') intro.isConnected = false;
    if (trigger === 'module') events.error({target: {id: 'viv-app-entry'}});
    else events[12000]();
    assert.equal(recovery.hidden, trigger === 'completed');
    if (trigger !== 'completed') {
      assert.equal(status.hidden, true);
    }
  }
});

test('VIV startup help is a visible HTML link before the script runs', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="viv-intro-status" role="status" hidden/);
  assert.match(html, /data-viv-boot-failure hidden[^]*?<\/div>\s*<noscript>[^<]+<\/noscript>\s*<a data-viv-recovery-link href="https:\/\//);
  assert.equal((html.match(/data-viv-recovery-link/g) || []).length, 1);
  const install = readFileSync(new URL('../dist/install.html', import.meta.url), 'utf8');
  for (const page of [html, install]) {
    assert.match(page, /data-viv-recovery-link href="https:\/\/github\.com\/HwigwanJi\/viv\/blob\/main\/docs\/agents\/operations\/self-host\.md#시작-오류가-반복될-때" referrerpolicy="no-referrer"/);
  }
});

test('VIV keeps the recovery screen until the same page and JavaScript respond', async () => {
  const queue = [
    asset('text/html', 503),
    asset('text/html; charset=utf-8'), asset('text/html'),
    asset('text/html'), asset('application/javascript; charset=utf-8'),
  ];
  const urls = [];
  const app = setup(async (url, options) => {
    urls.push(url);
    assert.equal(options.method, url.startsWith('/') ? 'HEAD' : 'GET');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    return queue.shift();
  });
  app.events[12000]();
  await app.button.click();
  assert.match(app.message.textContent, /VIV 서버/);
  assert.equal(app.reloads(), 0);
  assert.equal(app.attributes.has('aria-disabled'), false);
  await app.button.click();
  assert.match(app.message.textContent, /앱 파일/);
  assert.equal(app.reloads(), 0);
  assert.equal(app.recovery.hidden, false);
  await app.button.click();
  assert.equal(app.reloads(), 1);
  assert.deepEqual(urls, ['/?entry=install', '/?entry=install', 'http://localhost/app.mjs', '/?entry=install', 'http://localhost/app.mjs']);
});

test('VIV startup checks are bounded and duplicate retry presses send one request', async () => {
  let reads = 0;
  const app = setup((_, {signal}) => {
    reads++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  });
  app.events[12000]();
  const retry = app.button.click();
  await app.button.click();
  assert.equal(reads, 1);
  assert.equal(app.attributes.get('aria-disabled'), 'true');
  app.events[4000]();
  await retry;
  assert.equal(app.attributes.has('aria-disabled'), false);
  assert.equal(app.reloads(), 0);
  assert.match(app.message.textContent, /VIV 서버/);
});

test('VIV names an app file whose retry exceeds the time limit', async () => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const app = setup(async (_, {method, signal}) => {
    if (method === 'HEAD') return asset('text/html');
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
      markStarted();
    });
  });
  app.events[12000]();
  const retry = app.button.click();
  await started;
  app.events[4000]();
  await retry;
  assert.match(app.fileStatus.textContent, /dist\/app\.mjs \(응답 시간 초과\)/);
  assert.equal(app.reloads(), 0);
  assert.equal(app.attributes.has('aria-disabled'), false);
});

test('VIV retries failed same-origin script downloads before leaving recovery', async () => {
  const dependency = 'http://localhost/ui/studio-controller.mjs';
  const legacy = 'http://localhost/system/legacy.mjs';
  const wrongType = 'http://localhost/ui/shell.mjs';
  const entry = (name, fields) => ({name, initiatorType: 'script', ...fields});
  const resources = [
    entry(dependency, {responseStatus: 0}), entry(dependency, {responseStatus: 404}),
    entry(legacy, {decodedBodySize: 0}),
    entry(wrongType, {responseStatus: 200, contentType: 'text/html'}),
    entry('http://localhost/ui/cached.mjs', {decodedBodySize: 200, transferSize: 0}),
    entry('https://example.com/foreign.mjs', {responseStatus: 0}),
    entry('http://localhost/ui/request.mjs', {initiatorType: 'fetch', responseStatus: 0}),
  ];
  let unavailable = true;
  const gets = [];
  const app = setup(async (url, options) => {
    assert.equal(options.cache, 'no-store');
    if (options.method === 'HEAD') return asset('text/html');
    gets.push(url);
    if (unavailable && url === dependency) return asset('text/html');
    return new Response('export {};', {headers: {'content-type': 'application/javascript'}});
  }, resources);
  app.events.error({target: {id: 'viv-app-entry'}});
  await app.button.click();
  assert.equal(app.reloads(), 0);
  assert.match(app.message.textContent, /앱 파일/);
  assert.equal(app.attributes.has('aria-disabled'), false);
  assert.deepEqual(gets, ['http://localhost/app.mjs', dependency, legacy, wrongType]);
  unavailable = false;
  await app.button.click();
  assert.equal(app.reloads(), 1);
  assert.deepEqual(gets.slice(4), ['http://localhost/app.mjs', dependency, legacy, wrongType]);
});

test('VIV checks the workspace module when a browser reports only the entry error', async () => {
  const urls = [];
  const app = setup(async (url, {method}) => {
    urls.push([url, method]);
    return method === 'GET' && url.endsWith('/app.mjs') ? asset('text/html', 404) : asset(method === 'HEAD' ? 'text/html' : 'text/javascript');
  });
  app.events.error({target: {id: 'viv-app-entry'}});
  assert.equal(app.fileStatus.hidden, true);
  await app.button.click();
  assert.deepEqual(urls.slice(1), [['http://localhost/app.mjs', 'GET'], ['http://localhost/ui/studio-controller.mjs', 'GET']]);
  assert.equal(app.reloads(), 0);
  assert.match(app.message.textContent, /앱 파일/);
  assert.equal(app.fileStatus.textContent, '확인할 앱 파일 dist/app.mjs (HTTP 404 · 서버에서 파일을 찾을 수 없음)');
});

test('VIV identifies confirmed app requests without exposing URLs or querying unrelated scripts', async () => {
  const controller = 'http://localhost/ui/studio-controller.mjs?token=secret#private';
  const shell = 'http://localhost/ui/shell.mjs?token=secret';
  const requests = [];
  const app = setup(async (url, {method}) => {
    if (method === 'HEAD') return asset('text/html');
    requests.push(url);
    if (url === controller) throw new TypeError('network disconnected');
    if (url === shell) return asset('text/html', 404);
    return asset('text/javascript');
  }, [
    {name: controller, initiatorType: 'script', responseStatus: 404},
    {name: shell, initiatorType: 'script', decodedBodySize: 0},
    {name: 'https://outside.invalid/ui/foreign.mjs', initiatorType: 'script', responseStatus: 404},
    {name: 'http://localhost/api/private.mjs', initiatorType: 'script', responseStatus: 404},
  ]);
  app.events.error({target: {id: 'viv-app-entry'}});
  assert.equal(app.fileStatus.textContent, '확인할 앱 파일 dist/ui/studio-controller.mjs (HTTP 404 · 서버에서 파일을 찾을 수 없음)');
  await app.button.click();
  assert.equal(app.fileStatus.textContent, '확인할 앱 파일 dist/ui/studio-controller.mjs (파일 전송을 완료하지 못함)\ndist/ui/shell.mjs (HTTP 404 · 서버에서 파일을 찾을 수 없음)');
  assert.deepEqual(requests, ['http://localhost/app.mjs', controller, shell]);
  assert.equal(app.fileStatus.hidden, false);
  assert.equal(app.reloads(), 0);
});

test('VIV distinguishes HTML served for an app file from HTTP failures and transfer errors', async () => {
  for (const [response, detail] of [
    [asset('text/html; charset=utf-8'), 'HTML 응답 · 원래 PC 주소와 비교'],
    [asset('text/html', 503), 'HTTP 503 · 파일 요청 실패'],
    [asset('text/plain'), '응답 형식 오류 · JavaScript 필요'],
    [new Response(null, {status: 200}), '응답 형식 오류 · JavaScript 필요'],
    [null, '파일 전송을 완료하지 못함'],
  ]) {
    const app = setup(async (url, {method}) => {
      if (method === 'HEAD') return asset('text/html');
      if (!response) throw new TypeError('transport failed');
      return response;
    });
    app.events[12000]();
    await app.button.click();
    assert.equal(app.fileStatus.textContent, detail ? '확인할 앱 파일 dist/app.mjs (' + detail + ')' : '');
    assert.equal(app.fileStatus.hidden, !detail);
    assert.equal(app.reloads(), 0);
  }
});

test('install entry keeps its own page on failure and retains normal modified link actions', async () => {
  const attrs = new Map(), status = {}, help = {hidden: true};
  const link = {
    isConnected: true, href: 'http://localhost/#home?executionMode=paper', pathname: '/', search: '',
    addEventListener(_, fn) { this.click = fn; },
    getAttribute: name => attrs.get(name),
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name),
  };
  const urls = [], opened = [];
  const nodes = {'[data-install-open]': link, '[data-viv-open-status]': status, '[data-viv-open-help]': help};
  const document = {querySelector: selector => nodes[selector] ?? null};
  const window = {setTimeout: () => 1, clearTimeout() {}};
  const fetch = async url => {
    urls.push(url);
    return asset('text/html', urls.length === 1 ? 503 : 200);
  };
  runInNewContext(script, {document, window, location: {assign: url => opened.push(url)}, AbortController, fetch});
  let prevented = 0;
  const click = {button: 0, preventDefault: () => { prevented++; }};
  await link.click({...click, ctrlKey: true});
  assert.equal(prevented, 0);
  assert.equal(help.hidden, true);
  assert.deepEqual(urls, []);
  await link.click(click);
  assert.match(status.textContent, /VIV 서버/);
  assert.equal(help.hidden, false);
  assert.deepEqual(opened, []);
  await link.click(click);
  assert.deepEqual(urls, ['/', '/']);
  assert.deepEqual(opened, [link.href]);
});

test('optional session storage keeps the available store and handles a rejected getter', () => {
  const storage = {};
  assert.equal(optionalSessionStorage({sessionStorage: storage}), storage);
  assert.equal(optionalSessionStorage({}), null);
  assert.equal(optionalSessionStorage({
    get sessionStorage() { throw new DOMException('Storage blocked', 'SecurityError'); }
  }), null);
});

test('funding retries with the same envelope if the session storage getter is blocked', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new DOMException('Storage blocked', 'SecurityError'); }
  });
  try {
    const body = {idempotencyKey: 'same-request', expectedRevision: 7};
    const attempts = [];
    const receipt = await submitPaperFunding(async (path, envelope) => {
      attempts.push({path, envelope});
      if (attempts.length === 1) throw new TypeError('Connection lost');
      return {ok: true};
    }, '/api/workspace/accounts/budget', body);
    assert.deepEqual(receipt, {ok: true});
    assert.deepEqual(attempts, Array(2).fill({path: '/api/workspace/accounts/budget', envelope: body}));
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete globalThis.sessionStorage;
  }
});
