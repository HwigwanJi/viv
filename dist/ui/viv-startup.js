(function () {
  async function confirmAndOpen(control, status, pageUrl, entryUrl, open) {
    if (control.getAttribute('aria-disabled') === 'true') return;
    control.setAttribute('aria-disabled', 'true');
    status.textContent = 'VIV 서버에 연결할 수 있는지 확인 중…';
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 4000);
    var options = {method: 'HEAD', cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: controller.signal};
    var problem = 'VIV 서버에 연결할 수 없습니다. 설치한 컴퓨터에서 서버를 켠 뒤 다시 시도하세요.';
    try {
      var page = await fetch(pageUrl, options);
      if (page.ok && /^text\/html\b/i.test(page.headers.get('content-type'))) {
        var ready = true;
        if (entryUrl) {
          problem = '앱 파일을 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
          var entry = await fetch(entryUrl, options);
          ready = entry.ok && /^(?:text|application)\/javascript\b/i.test(entry.headers.get('content-type'));
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
  }

  var installLink = document.querySelector('[data-install-open]');
  if (installLink) {
    installLink.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      return confirmAndOpen(installLink, document.querySelector('[data-viv-open-status]'), installLink.pathname + installLink.search, null, function () {
        location.assign(installLink.href);
      });
    });
  }

  var intro = document.querySelector('.viv-intro');
  if (!intro) return;
  var recovery = intro.querySelector('[data-viv-boot-failure]');
  var retry = recovery.querySelector('button');
  var status = recovery.querySelector('[data-viv-retry-status]');
  function showRecovery() {
    if (!intro.isConnected || !recovery.hidden) return;
    intro.querySelector('.viv-intro-status').hidden = true;
    var rings = intro.querySelectorAll('.viv-intro-orbit i');
    for (var i = 0; i < rings.length; i++) rings[i].style.animation = 'none';
    recovery.hidden = false;
  }
  retry.addEventListener('click', function () {
    return confirmAndOpen(retry, status, location.pathname + location.search, document.getElementById('viv-app-entry').src, function () {
      location.reload();
    });
  });
  window.addEventListener('error', function (event) {
    if (event.target === window || (event.target && event.target.id === 'viv-app-entry')) showRecovery();
  }, true);
  window.addEventListener('unhandledrejection', showRecovery);
  window.setTimeout(showRecovery, 12000);
}());
