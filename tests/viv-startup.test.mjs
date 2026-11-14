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
  const origin = 'https://viv-fixture.example.ts.net';
  let reply = new Response('current app'), timeout, expire;
  runInNewContext(notificationWorker, {
    self: {location: {origin}, addEventListener: (name, listener) => { listeners[name] = listener; }},
    fetch: async (_, {signal}) => {
      if (reply === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
      if (reply === 'body-hang') return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<title>VIV</title>'));
          signal.addEventListener('abort', () => controller.error(signal.reason), {once:true});
        }
      }), {headers:{'Content-Type':'text/html'}});
      if (!reply) throw new TypeError('connection refused');
      return reply;
    },
    URL, Response, AbortController, setTimeout(callback, ms) { expire = callback; timeout = ms; return 1; }, clearTimeout() {}
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
  assert.equal(timeout, 8000);
  reply = 'hang';
  const pending = navigate('/');
  expire();
  assert.match(await (await pending).text(), /설치한 컴퓨터에서 VIV PC 주소가 열리는지 확인하세요/);
  reply = 'body-hang';
  const partial = navigate('/install.html');
  await Promise.resolve();
  expire();
  assert.match(await (await partial).text(), /다시 연결/);
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
      const content = await fallback.text();
      assert.match(content, /VIV 서버에 연결할 수 없어요[^]*다시 연결/);
      assert.match(content, status ? /연결 경로가 VIV 서버에 닿지 않습니다/ : /인터넷 연결을 확인하세요/);
      assert.match(content, /VIV PC 주소가 열리면 휴대폰 연결을 복구하세요/);
      assert.match(content, /target="_blank" rel="noopener noreferrer">모바일 연결 복구 안내 \(새 탭\)<\/a>/);
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

test('worker reconnect keeps the current address until VIV storage responds', async () => {
  const listeners = {};
  runInNewContext(notificationWorker, {
    self: {location: {origin: 'http://localhost'}, addEventListener: (name, listener) => { listeners[name] = listener; }},
    fetch: async () => new Response(null, {status: 503}),
    URL, Response, AbortController, setTimeout, clearTimeout
  });
  let pending;
  listeners.fetch({request:{url:'http://localhost/?source=ai',mode:'navigate',method:'GET'},respondWith:r=>{pending=r;}});
  const html = await (await pending).text();
  const status = {};
  let reconnect, reloads = 0, disabled;
  const button = {
    addEventListener: (_, fn) => { reconnect = fn; },
    getAttribute: () => disabled,
    setAttribute: (_, value) => { disabled = value; },
    removeAttribute: () => { disabled = undefined; }
  };
  let health = new Response(null, {status:503});
  runInNewContext(html.match(/<script>([^]*?)<\/script>/)[1], {
    document:{querySelector:selector=>selector==='button'?button:status},
    location:{pathname:'/',search:'?source=ai',reload(){reloads++;}},
    fetch: async (url, options) => {
      assert.equal(options.cache,'no-store');
      if(url==='/api/status'){
        assert.equal(options.redirect,'manual');
        return health;
      }
      assert.equal(url,'/?source=ai');
      return new Response('<script id="viv-app-entry"></script>',{headers:{'Content-Type':'text/html'}});
    },
    AbortController, setTimeout, clearTimeout
  });
  await reconnect();
  assert.match(status.textContent,/서버가 아직 준비 중/);
  health = Response.json({storage:'other'});
  await reconnect();
  assert.match(status.textContent,/다른 서비스나 설치 주소/);
  assert.equal(reloads,0);
  health = Response.json({storage:'server'});
  await reconnect();
  assert.equal(reloads,1);
});

function setup(fetch, resources = [], {install = false} = {}) {
  const events = {}, attributes = new Map(), status = {hidden: true}, message = {}, fileStatus = {hidden: true};
  const button = {
    isConnected: true,
    addEventListener: (_, callback) => { button.click = callback; },
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
  const recovery = {hidden: true, dataset: {}, querySelector: selector => selector === 'button' ? button : selector === '[data-viv-failed-files]' ? fileStatus : message};
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
  const document = {
    querySelector: selector => install ? (selector === '[data-viv-install-failure]' ? recovery : null) : (selector === '.viv-intro' ? intro : null),
    getElementById: () => ({src: 'http://localhost'+(install ? '/ui/install-page.mjs' : '/app.mjs')}),
  };
  const location = {origin: 'http://localhost', pathname: install ? '/install.html' : '/', search: '?entry=install', reload: () => { reloads++; }};
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

test('install module failure keeps recovery on the same URL until its script responds', async () => {
  const requests = [];
  let unavailable = true, correctPage = true;
  const app = setup(async (url, {method}) => {
    requests.push([url, method]);
    if (url.startsWith('/install.html')) return new Response(correctPage ? '<script id="viv-install-entry" src="./ui/install-page.mjs"></script>' : '<h1>Sign in</h1>', {headers:{'content-type':'text/html'}});
    return unavailable ? asset('text/html', 404) : asset('text/javascript');
  }, [], {install: true});
  app.events.error({target: {id: 'unrelated-image'}});
  assert.equal(app.recovery.hidden, true);
  app.events.error({target: {id: 'viv-install-entry'}});
  assert.equal(app.recovery.hidden, false);
  await app.button.click();
  assert.match(app.fileStatus.textContent, /dist\/ui\/install-page.mjs \(HTTP 404/);
  assert.equal(app.reloads(), 0);
  unavailable = false;
  correctPage = false;
  await app.button.click();
  assert.equal(app.reloads(), 0);
  assert.match(app.message.textContent, /VIV 설치 화면을 확인할 수 없습니다/);
  correctPage = true;
  await app.button.click();
  assert.equal(app.reloads(), 1);
  assert.deepEqual(requests, [
    ['/install.html?entry=install', 'GET'], ['http://localhost/ui/install-page.mjs', 'GET'],
    ['/install.html?entry=install', 'GET'],
    ['/install.html?entry=install', 'GET'], ['http://localhost/ui/install-page.mjs', 'GET'],
  ]);
  const ready = setup(undefined, [], {install: true});
  ready.recovery.dataset.ready = 'true';
  ready.events[12000]();
  assert.equal(ready.recovery.hidden, true);
});

test('VIV startup help is a visible HTML link before the script runs', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="viv-intro-status" role="status" hidden/);
  assert.match(html, /data-viv-boot-failure hidden[^]*?<\/div>\s*<noscript>[^<]+<\/noscript>\s*<a data-viv-recovery-link href="https:\/\//);
  assert.equal((html.match(/data-viv-recovery-link/g) || []).length, 1);
  const install = readFileSync(new URL('../dist/install.html', import.meta.url), 'utf8');
  assert.match(install, /<p class="spaced"><a data-viv-recovery-link[^>]+target="_blank" rel="noopener noreferrer">VIV 연결·시작 문제 해결 \(새 탭\)<\/a><\/p>/);
  assert.equal((install.match(/data-viv-recovery-link/g) || []).length, 1);
  for (const page of [html, install]) {
    assert.match(page, /data-viv-recovery-link href="https:\/\/github\.com\/HwigwanJi\/viv\/blob\/main\/docs\/agents\/operations\/self-host\.md#시작-오류가-반복될-때" target="_blank" rel="noopener noreferrer"/);
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
  assert.match(app.message.textContent, /연결 경로가 VIV 서버에 닿지 않습니다/);
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
  const attrs = new Map(), status = {};
  const link = {
    isConnected: true, href: 'http://localhost/#home?executionMode=paper', pathname: '/', search: '',
    addEventListener(_, fn) { this.click = fn; },
    getAttribute: name => attrs.get(name),
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name),
  };
  const urls = [], opened = [];
  const failures = [];
  link.dispatchEvent = event => failures.push(event.type);
  const nodes = {'[data-install-open]': link, '[data-viv-open-status]': status};
  const document = {querySelector: selector => nodes[selector] ?? null};
  let expire;
  const window = {setTimeout: callback => { expire = callback; return 1; }, clearTimeout() {}};
  const vivPage = () => new Response('<script type="module" src="./app.mjs" id="viv-app-entry"></script>', {headers: {'content-type': 'text/html'}});
  const replies = [
    null,
    vivPage(), null,
    asset('text/html', 502),
    asset('text/html', 403),
    new Response('<h1>Sign in</h1>', {headers: {'content-type': 'text/html'}}),
    vivPage(), asset('text/html'),
    vivPage(), Response.json({storage: 'other'}),
    vivPage(), Response.json({storage: 'server'}),
  ];
  const fetch = async (url, options) => {
    urls.push([url, options.method]);
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, url === '/api/status' ? 'manual' : 'error');
    assert.equal(options.cache, 'no-store');
    const reply = replies.shift();
    if (reply === null) {
      expire();
      throw options.signal.reason;
    }
    return reply;
  };
  runInNewContext(script, {document, window, location: {assign: url => opened.push(url)}, AbortController, Event, fetch});
  let prevented = 0;
  const click = {button: 0, preventDefault: () => { prevented++; }};
  await link.click({...click, ctrlKey: true});
  assert.equal(prevented, 0);
  assert.deepEqual(urls, []);
  for (const expected of [/VIV 앱 화면 응답 시간이 초과됐습니다/, /VIV 서버 상태 확인 시간이 초과됐습니다/, /VIV 앱 화면을 불러오지 못했습니다/, /접근이 거부되었습니다/, /VIV 서버 응답을 확인할 수 없습니다/, /다른 웹페이지가 응답했습니다/, /VIV 서버 상태 응답을 확인할 수 없습니다/]) {
    await link.click(click);
    assert.match(status.textContent, expected);
    assert.equal(attrs.has('aria-disabled'), false);
    assert.deepEqual(opened, []);
  }
  await link.click(click);
  assert.deepEqual(urls, [
    ['/', 'GET'], ['/', 'GET'], ['/api/status', 'GET'],
    ['/', 'GET'], ['/', 'GET'], ['/', 'GET'],
    ['/', 'GET'], ['/api/status', 'GET'],
    ['/', 'GET'], ['/api/status', 'GET'],
    ['/', 'GET'], ['/api/status', 'GET'],
  ]);
  assert.deepEqual(opened, [link.href]);
  assert.equal(attrs.has('aria-disabled'), false);
  assert.equal(status.textContent, '');
  assert.deepEqual(failures, Array(7).fill('viv:open-failed'));
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
