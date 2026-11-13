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
          problem = '앱 파일을 불러올 수 없습니다. 설치한 컴퓨터에서 VIV 주소가 열리는지 확인한 뒤 다시 시도하세요.';
          status.textContent = 'VIV 앱 파일을 확인하는 중…';
          var targets = failedScripts().map(function (failure) { return failure.url; });
          // shortcut: check the workspace module when the browser omits failed URLs, extend if other boot dependencies need this fallback.
          if (moduleLoadFailed && targets.length === 0) targets.push(new URL('./ui/studio-controller.mjs', entryUrl).href);
          var urls = [...new Set([entryUrl, ...targets])];
          var scripts = await Promise.all(urls.map(function (url) { return scriptAvailable(url, options); }));
          ready = scripts.every(function (result) { return result === true; });
          showFailedFiles(fileStatus, urls.map(function (url, index) {
            return {url, issue: typeof scripts[index] === 'string' ? scripts[index] : ''};
          }));
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
  var loading = intro.querySelector('.viv-intro-status');
  var recovery = intro.querySelector('[data-viv-boot-failure]');
  var retry = recovery.querySelector('button');
  var status = recovery.querySelector('[data-viv-retry-status]');
  var fileStatus = recovery.querySelector('[data-viv-failed-files]');
  function showRecovery() {
    if (!intro.isConnected || !recovery.hidden) return;
    loading.hidden = true;
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
  loading.hidden = false;
}());
