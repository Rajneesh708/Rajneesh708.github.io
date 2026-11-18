
  /* Scroll-reveal observer (page-level animation only). Tagline-height
     measurement is handled by global.js - no per-page tagline script. */
  var ro = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('vis');
        ro.unobserve(e.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -24px 0px' });
  document.querySelectorAll('.rev').forEach(function (el) { ro.observe(el); });
