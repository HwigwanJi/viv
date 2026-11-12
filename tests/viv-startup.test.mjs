import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script = readFileSync(new URL('../dist/ui/viv-startup.js', import.meta.url), 'utf8');

function setup(fetch, resources = []) {
  const events = {}, attributes = new Map(), status = {hidden: false}, message = {}, ring = {style: {}};
  const button = {
    isConnected: true,
    addEventListener: (_, callback) => { button.click = callback; },
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
  const recovery = {hidden: true, querySelector: selector => selector === 'button' ? button : message};
  const intro = {
    isConnected: true,
    querySelector: selector => selector === '.viv-intro-status' ? status : recovery,
    querySelectorAll: () => [ring],
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
  return {events, attributes, status, message, ring, button, recovery, intro, reloads: () => reloads};
}

const asset = (contentType, status = 200) => new Response(null, {status, headers: {'content-type': contentType}});

test('VIV offers recovery when the entry module fails or startup stalls', () => {
  for (const trigger of ['module', 'timeout', 'completed']) {
    const {events, status, ring, recovery, intro} = setup();
    events.error({target: {id: 'unrelated-image'}});
    assert.equal(recovery.hidden, true);
    if (trigger === 'completed') intro.isConnected = false;
    if (trigger === 'module') events.error({target: {id: 'viv-app-entry'}});
    else events[12000]();
    assert.equal(recovery.hidden, trigger === 'completed');
    if (trigger !== 'completed') {
      assert.equal(status.hidden, true);
      assert.equal(ring.style.animation, 'none');
    }
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
  await app.button.click();
  assert.deepEqual(urls.slice(1), [['http://localhost/app.mjs', 'GET'], ['http://localhost/ui/studio-controller.mjs', 'GET']]);
  assert.equal(app.reloads(), 0);
  assert.match(app.message.textContent, /앱 파일/);
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
