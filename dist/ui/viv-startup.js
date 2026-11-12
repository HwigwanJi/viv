(function () {
  if (window.isSecureContext && navigator.serviceWorker) {
    navigator.serviceWorker.register('/notification-worker.js').catch(function () {});
  }

  var javascriptType = /^(?:text|application)\/javascript\b/i;
  var appScriptPath = /^\/(?:(?:agent|domain|engine|system|trading|ui|vendor)\/[a-z0-9._/-]+|app|knowledge|store|strategy-view|notification-worker)\.m?js$/i;
  var moduleLoadFailed = false;

  function failedScripts(confirmedOnly) {
    var resources = window.performance?.getEntriesByType?.('resource') || [];
    return [...new Set(resources.filter(function (entry) {
      if (entry.initiatorType !== 'script') return false;
      var url = new URL(entry.name);
      if (url.origin !== location.origin || !/\.m?js$/i.test(url.pathname)) return false;
      var confirmed = entry.responseStatus >= 400 || (entry.contentType && !javascriptType.test(entry.contentType));
      return confirmed || (!confirmedOnly && (entry.responseStatus === 0 ||
        (entry.responseStatus === undefined && entry.decodedBodySize === 0)));
    }).map(function (entry) { return entry.name; }))];
  }

  function showFailedFiles(status, urls) {
    if (!status) return;
    var paths = new Set();
    for (var url of urls) {
      var file = new URL(url);
      if (file.origin === location.origin && appScriptPath.test(file.pathname)) paths.add('dist' + file.pathname);
    }
    status.textContent = paths.size ? '확인할 앱 파일 ' + [...paths].join(', ') : '';
    status.hidden = !paths.size;
  }

  async function scriptAvailable(url, options) {
    try {
      var response = await fetch(url, {...options, method: 'GET'});
      if (!response.ok || !javascriptType.test(response.headers.get('content-type'))) return false;
      await response.arrayBuffer();
      return true;
    } catch {
      return null;
    }
  }

  async function confirmAndOpen(control, status, pageUrl, entryUrl, open, fileStatus) {
    if (control.getAttribute('aria-disabled') === 'true') return;
    control.setAttribute('aria-disabled', 'true');
    status.textContent = 'VIV 서버에 연결할 수 있는지 확인 중…';
    showFailedFiles(fileStatus, []);
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 4000);
    var options = {method: 'HEAD', cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: controller.signal};
    var problem = 'VIV 서버에 연결할 수 없습니다. 설치한 컴퓨터에서 서버를 켠 뒤 다시 시도하세요.';
    try {
      var page = await fetch(pageUrl, options);
      if (page.ok && /^text\/html\b/i.test(page.headers.get('content-type'))) {
        var ready = true;
        if (entryUrl) {
          problem = '앱 파일을 불러올 수 없습니다. VIV 서버의 파일을 확인한 뒤 다시 시도하세요.';
          status.textContent = 'VIV 앱 파일을 확인하는 중…';
          var targets = failedScripts();
          // shortcut: check the workspace module when the browser omits failed URLs, extend if other boot dependencies need this fallback.
          if (moduleLoadFailed && targets.length === 0) targets.push(new URL('./ui/studio-controller.mjs', entryUrl).href);
          var urls = [...new Set([entryUrl, ...targets])];
          var scripts = await Promise.all(urls.map(function (url) { return scriptAvailable(url, options); }));
          ready = scripts.every(Boolean);
          showFailedFiles(fileStatus, urls.filter(function (_, index) { return scripts[index] === false; }));
        }
        if (ready) {
          if (control.isConnected) open();
          return;
        }
      }
    } catch {
      // A timeout or network failure leaves the current screen open.
    } finally {
      window.clearTimeout(timeout);
    }
    status.textContent = problem;
    control.removeAttribute('aria-disabled');
    return false;
  }

  var installLink = document.querySelector('[data-install-open]');
  if (installLink) {
    var installHelp = document.querySelector('[data-viv-open-help]');
    installLink.addEventListener('click', async function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      var result = await confirmAndOpen(installLink, document.querySelector('[data-viv-open-status]'), installLink.pathname + installLink.search, null, function () {
        location.assign(installLink.href);
      });
      if (result === false && installHelp) installHelp.hidden = false;
    });
  }

  var intro = document.querySelector('.viv-intro');
  if (!intro) return;
  var recovery = intro.querySelector('[data-viv-boot-failure]');
  var retry = recovery.querySelector('button');
  var status = recovery.querySelector('[data-viv-retry-status]');
  var fileStatus = recovery.querySelector('[data-viv-failed-files]');
  function showRecovery() {
    if (!intro.isConnected || !recovery.hidden) return;
    intro.querySelector('.viv-intro-status').hidden = true;
    var rings = intro.querySelectorAll('.viv-intro-orbit i');
    for (var i = 0; i < rings.length; i++) rings[i].style.animation = 'none';
    showFailedFiles(fileStatus, failedScripts(true));
    recovery.hidden = false;
  }
  retry.addEventListener('click', function () {
    return confirmAndOpen(retry, status, location.pathname + location.search, document.getElementById('viv-app-entry').src, function () {
      location.reload();
    }, fileStatus);
  });
  window.addEventListener('error', function (event) {
    if (event.target?.id === 'viv-app-entry') moduleLoadFailed = true;
    if (event.target === window || moduleLoadFailed) showRecovery();
  }, true);
  window.addEventListener('unhandledrejection', showRecovery);
  window.setTimeout(showRecovery, 12000);
}());
