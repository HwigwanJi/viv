import {executionModeOf} from './mind-companion.mjs';

const KEY = 'viv.workspace.location';
const modes = ['paper', 'live'];

export function isPaperWorkspace(route) {
  return route.page === 'calendar' ||
    (route.page === 'minds' && route.params.get('view') === 'simulations');
}

export function workspaceRoute(parseRoute, hash) {
  const route = parseRoute(hash);
  if (isPaperWorkspace(route) && executionModeOf(route) === 'live') route.params.set('executionMode', 'paper');
  return route;
}

export function workspaceModeLabel(mode) {
  const live = mode === 'live';
  const path = live ? '<path d="M12 4 3 20h18L12 4ZM12 10v4m0 3h.01"/>' : '<path d="M9 3h6m-5 0v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8"/>';
  return '<span class="viv-mode-label"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>'+ (live ? '실전 · 실제 자금' : '모의 · 가상 자금') + '</span>';
}

export function createWorkspaceLocations({window, parseRoute, defaultHash}) {
  const {location, history} = window;
  const last = new Map();
  let lastMode;
  let observedHash;

  function resumable(hash) {
    if (typeof hash !== 'string' || !/^#[a-z-]+(?:\?|$)/.test(hash)) return null;
    const route = parseRoute(hash);
    if (hash.split('?')[0] !== '#'+route.page || modes.includes(route.params.get('executionMode')) === false) return null;
    for (const key of ['notice', 'brokerSetup', 'portfolio', 'returnTo']) route.params.delete(key);
    return {mode: executionModeOf(route), hash: '#'+route.page+'?'+route.params};
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY));
    for (const mode of modes) {
      const target = resumable(saved?.[mode]);
      if (target?.mode === mode) last.set(mode, target.hash);
    }
    if (last.has(saved?.lastMode)) lastMode = saved.lastMode;
  } catch { /* Browsers can disable persistent storage. */ }

  function remember(route) {
    if (observedHash === location.hash) return;
    observedHash = location.hash;
    const params = new URLSearchParams(route.params);
    params.set('executionMode', executionModeOf(route));
    const target = resumable('#'+route.page+'?'+params);
    if (!target) return;
    last.set(target.mode, target.hash);
    lastMode = target.mode;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({lastMode, paper: last.get('paper'), live: last.get('live')}));
    } catch { /* This tab can still restore both modes from memory. */ }
  }

  function restoreOnLaunch() {
    if (!location.hash && !location.search) history.replaceState(history.state, '', last.get(lastMode) || defaultHash);
  }

  return {remember, restoreOnLaunch, forMode: mode => last.get(mode)};
}
