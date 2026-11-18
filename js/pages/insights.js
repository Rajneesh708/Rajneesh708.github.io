
  // Defensive reveal animation
  (function () {
    var els = document.querySelectorAll('.ix-reveal');
    if (!els.length || !('IntersectionObserver' in window)) return;
    document.body.setAttribute('data-reveal-ready', '');
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-vis');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { obs.observe(el); });
    setTimeout(function () {
      els.forEach(function (el) { el.classList.add('is-vis'); });
    }, 8000);
  })();
