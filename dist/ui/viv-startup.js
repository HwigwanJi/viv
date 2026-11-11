(function () {
  var intro = document.querySelector('.viv-intro');
  if (!intro) return;
  var recovery = intro.querySelector('[data-viv-boot-failure]');
  function showRecovery() {
    if (!intro.isConnected || !recovery.hidden) return;
    intro.querySelector('.viv-intro-status').hidden = true;
    var rings = intro.querySelectorAll('.viv-intro-orbit i');
    for (var i = 0; i < rings.length; i++) rings[i].style.animation = 'none';
    recovery.hidden = false;
  }
  recovery.querySelector('button').addEventListener('click', function () { location.reload(); });
  window.addEventListener('error', function (event) {
    if (event.target === window || (event.target && event.target.id === 'viv-app-entry')) showRecovery();
  }, true);
  window.addEventListener('unhandledrejection', showRecovery);
  window.setTimeout(showRecovery, 12000);
}());
