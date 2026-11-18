
  /* Scroll reveal (page-level animation only)
     Tagline height measurement is handled by global.js. */
  var ro = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('vis');
        ro.unobserve(e.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -28px 0px' });
  document.querySelectorAll('.rev').forEach(function(el) { ro.observe(el); });
