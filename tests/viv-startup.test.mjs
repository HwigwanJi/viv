import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script = readFileSync(new URL('../dist/ui/viv-startup.js', import.meta.url), 'utf8');

test('VIV offers reload when the entry module fails or startup stalls', () => {
  for (const trigger of ['module', 'timeout', 'completed']) {
    const events = {}, button = {}, status = {hidden: false}, ring = {style: {}};
    const recovery = {
      hidden: true,
      querySelector: () => ({addEventListener: (_, callback) => { button.click = callback; }}),
    };
    const intro = {
      isConnected: true,
      querySelector: selector => selector === '.viv-intro-status' ? status : recovery,
      querySelectorAll: () => [ring],
    };
    let reloaded = false;
    const window = {
      addEventListener: (name, callback) => { events[name] = callback; },
      setTimeout: callback => { events.timeout = callback; },
    };
    runInNewContext(script, {document: {querySelector: () => intro}, window, location: {reload: () => { reloaded = true; }}});
    events.error({target: {id: 'unrelated-image'}});
    assert.equal(recovery.hidden, true);
    if (trigger === 'completed') intro.isConnected = false;
    if (trigger === 'module') events.error({target: {id: 'viv-app-entry'}});
    else events.timeout();
    assert.equal(recovery.hidden, trigger === 'completed');
    if (trigger !== 'completed') {
      assert.equal(status.hidden, true);
      assert.equal(ring.style.animation, 'none');
      button.click();
      assert.equal(reloaded, true);
    }
  }
});
