import assert from 'node:assert/strict';
import test from 'node:test';
import {parseStudioRoute} from '../dist/ui/studio-controller.mjs';
import {createWorkspaceLocations,workspaceRoute} from '../dist/ui/workspace-mode.mjs';

const defaultHash = '#minds?profileId=all&executionMode=paper&view=overview';
const parseWorkspaceRoute = hash => workspaceRoute(parseStudioRoute, hash);
function page(hash='', storage=new Map(), search='') {
  const location = {hash, search};
  const window = {
    location,
    history: {replaceState(_state, _title, hash) { location.hash = hash; }},
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
  };
  return {location, ...createWorkspaceLocations({window, parseRoute: parseWorkspaceRoute, defaultHash})};
}

test('resumes the last mode and remembers each mode without reopening a workflow', () => {
  const storage = new Map();
  const first = page('', storage);
  first.restoreOnLaunch();
  assert.equal(first.location.hash, defaultHash);
  first.location.hash = '#calendar?month=2026-11&date=2026-11-15&executionMode=live';
  first.remember(parseWorkspaceRoute(first.location.hash));
  assert.match(first.forMode('paper'), /^#calendar\?.*executionMode=paper/);
  assert.equal(first.forMode('live'), undefined);

  first.location.hash = '#home?executionMode=live&showcase=performance&portfolio=review&notice=inbox';
  first.remember(parseWorkspaceRoute(first.location.hash));
  const second = page('', storage);
  second.restoreOnLaunch();
  assert.equal(second.location.hash, '#home?executionMode=live&showcase=performance');
  assert.match(second.forMode('paper'), /date=2026-11-15/);

  const explicit = page('#trade?executionMode=paper', storage);
  explicit.restoreOnLaunch();
  assert.equal(explicit.location.hash, '#trade?executionMode=paper');
  const namedInstall = page('', storage, '?installation=123');
  namedInstall.restoreOnLaunch();
  assert.equal(namedInstall.location.hash, '');
  assert.equal(parseWorkspaceRoute('#minds?view=simulations&executionMode=live').params.get('executionMode'), 'paper');
});
