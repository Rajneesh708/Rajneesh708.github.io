
  (function () {
    var btn = document.getElementById('optionalToggle');
    var panel = document.getElementById('optionalPanel');
    if (!btn || !panel) return;
    btn.addEventListener('click', function () {
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('span:first-child').textContent =
        open ? 'Hide optional preferences' : 'Show optional preferences';
    });
  })();
