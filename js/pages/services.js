
  /* Reveal-on-scroll for .rev elements */
  (function () {
    var reveal = document.querySelectorAll('.rev');
    if (!('IntersectionObserver' in window)) {
      reveal.forEach(function (el) { el.classList.add('vis'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('vis');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    reveal.forEach(function (el) { io.observe(el); });
  })();
