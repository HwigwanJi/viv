(function () {
  if (window.isSecureContext && navigator.serviceWorker) {
    navigator.serviceWorker.register('/notification-worker.js').catch(function () {});
  }

  var javascriptType = /^(?:text|application)\/javascript\b/i;
  var appScriptPath = /^\/(?:(?:agent|domain|engine|system|trading|ui|vendor)\/[a-z0-9._/-]+|app|knowledge|store|strategy-view|notification-worker)\.m?js$/i;
  var moduleLoadFailed = false;

  function scriptIssue(status, type) {
    if (status === 404) return 'HTTP 404 · 서버에서 파일을 찾을 수 없음';
    if (Number.isInteger(status) && status >= 400 && status < 600) return 'HTTP ' + status + ' · 파일 요청 실패';
    if (/^text\/html(?:\s*;|\s*$)/i.test(type)) return 'HTML 응답 · 원래 PC 주소와 비교';
    if (type && !javascriptType.test(type)) return '응답 형식 오류 · JavaScript 필요';
    return '';
  }

  function failedScripts(confirmedOnly) {
    var resources = window.performance?.getEntriesByType?.('resource') || [];
    return resources.flatMap(function (entry) {
      if (entry.initiatorType !== 'script') return [];
      var url = new URL(entry.name);
      if (url.origin !== location.origin || !appScriptPath.test(url.pathname)) return [];
      var issue = scriptIssue(entry.responseStatus, entry.contentType);
      var unconfirmed = entry.responseStatus === 0 ||
        (entry.responseStatus === undefined && entry.decodedBodySize === 0);
      return issue || (!confirmedOnly && unconfirmed) ? [{url: entry.name, issue}] : [];
    });
  }

  function showFailedFiles(status, failures) {
    if (!status) return;
    var paths = new Map();
    for (var {url, issue} of failures) {
      var file = new URL(url);
      if (issue && file.origin === location.origin && appScriptPath.test(file.pathname)) paths.set('dist' + file.pathname, issue);
    }
    status.textContent = paths.size ? '확인할 앱 파일 ' + [...paths].map(function ([path, issue]) {
      return path + ' (' + issue + ')';
    }).join('\n') : '';
    status.hidden = !paths.size;
  }

  async function scriptAvailable(url, options) {
    try {
      var response = await fetch(url, {...options, method: 'GET'});
      var type = response.headers.get('content-type');
      if (!response.ok || !javascriptType.test(type)) return scriptIssue(response.status, type) || '응답 형식 오류 · JavaScript 필요';
      await response.arrayBuffer();
      return true;
    } catch {
      return options.signal.aborted ? '응답 시간 초과' : '파일 전송을 완료하지 못함';
    }
  }

  function connectionIssue(status) {
    if (status === 401 || status === 403) return '이 주소에 대한 접근이 거부되었습니다. 휴대폰에서 PC와 같은 Tailscale 네트워크에 로그인했는지 확인하세요.';
    if (status === 502 || status === 503 || status === 504) return '연결 경로가 VIV 서버에 닿지 않습니다. 설치한 컴퓨터에서 VIV PC 주소가 열리는지 확인하세요.';
    return '';
  }

  async function confirmAndOpen(control, status, pageUrl, entryUrl, open, fileStatus, fallbackUrl, installEntry) {
    if (control.getAttribute('aria-disabled') === 'true') return;
    control.setAttribute('aria-disabled', 'true');
    status.textContent = 'VIV 서버에 연결할 수 있는지 확인 중…';
    showFailedFiles(fileStatus, []);
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 4000);
    var options = {method: 'HEAD', cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: controller.signal};
    var problem = 'VIV 서버에 연결할 수 없습니다. 설치한 컴퓨터에서 서버를 켠 뒤 다시 시도하세요.';
    try {
      var page = await fetch(pageUrl, entryUrl && !installEntry ? options : {...options, method: 'GET'});
      problem = connectionIssue(page.status) || problem;
      if (page.ok && /^text\/html\b/i.test(page.headers.get('content-type'))) {
        var ready = true;
        if (installEntry && !/<script\b[^>]*\bid=["']viv-install-entry["']/i.test(await page.text())) {
          problem = '이 주소에서 VIV 설치 화면을 확인할 수 없습니다. 설치할 때 받은 주소를 확인하세요.';
          ready = false;
        } else if (entryUrl) {
          problem = '앱 파일을 불러올 수 없습니다. 설치한 컴퓨터에서 VIV 주소가 열리는지 확인한 뒤 다시 시도하세요.';
          status.textContent = 'VIV 앱 파일을 확인하는 중…';
          var targets = failedScripts().map(function (failure) { return failure.url; });
          // shortcut: check the workspace module when the browser omits failed URLs, extend if other boot dependencies need this fallback.
          if (fallbackUrl && targets.length === 0) targets.push(fallbackUrl);
          var urls = [...new Set([entryUrl, ...targets])];
          var scripts = await Promise.all(urls.map(function (url) { return scriptAvailable(url, options); }));
          ready = scripts.every(function (result) { return result === true; });
          showFailedFiles(fileStatus, urls.map(function (url, index) {
            return {url, issue: typeof scripts[index] === 'string' ? scripts[index] : ''};
          }));
        } else {
          problem = '이 주소에서 VIV 서버 응답을 확인할 수 없습니다. 설치할 때 받은 VIV 주소인지 확인하세요.';
          ready = /<script\b[^>]*\bid=["']viv-app-entry["']/i.test(await page.text());
          if (ready) {
            var health = await fetch('/api/status', {...options, method: 'GET'});
            problem = connectionIssue(health.status) || problem;
            ready = health.ok && /^application\/json\b/i.test(health.headers.get('content-type')) &&
              (await health.json())?.storage === 'server';
          }
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
      if (result === false) {
        if (installHelp) installHelp.hidden = false;
        installLink.dispatchEvent(new Event('viv:open-failed'));
      }
    });
  }

  var intro = document.querySelector('.viv-intro');
  var installRecovery = document.querySelector('[data-viv-install-failure]');
  if (!intro && !installRecovery) return;
  var loading = intro?.querySelector('.viv-intro-status');
  var recovery = installRecovery || intro.querySelector('[data-viv-boot-failure]');
  var entryId = installRecovery ? 'viv-install-entry' : 'viv-app-entry';
  var retry = recovery.querySelector('button');
  var status = recovery.querySelector('[data-viv-retry-status]');
  var fileStatus = recovery.querySelector('[data-viv-failed-files]');
  function showRecovery() {
    if ((intro && !intro.isConnected) || (installRecovery && installRecovery.dataset.ready) || !recovery.hidden) return;
    if (loading) loading.hidden = true;
    showFailedFiles(fileStatus, failedScripts(true));
    recovery.hidden = false;
  }
  retry.addEventListener('click', function () {
    var entryUrl = document.getElementById(entryId).src;
    var fallbackUrl = !installRecovery && moduleLoadFailed ? new URL('./ui/studio-controller.mjs', entryUrl).href : null;
    return confirmAndOpen(retry, status, location.pathname + location.search, entryUrl, function () {
      if (!installRecovery?.dataset.ready) location.reload();
    }, fileStatus, fallbackUrl, Boolean(installRecovery));
  });
  window.addEventListener('error', function (event) {
    if (event.target?.id === entryId) moduleLoadFailed = true;
    if (event.target === window || moduleLoadFailed) showRecovery();
  }, true);
  window.addEventListener('unhandledrejection', showRecovery);
  window.setTimeout(showRecovery, 12000);
  if (loading) loading.hidden = false;
}());
