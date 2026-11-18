
  /* Scroll reveal - threshold:0 means any pixel entering viewport triggers.
     Negative rootMargin was causing elements near the bottom of the
     viewport to never trigger. Both removed so wide full-width blocks
     (like the quote band) fire reliably.
     Tagline height measurement is handled by global.js. */
  var ro = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('vis');
        ro.unobserve(e.target);
      }
    });
  }, { threshold: 0, rootMargin: '0px' });
  document.querySelectorAll('.rev').forEach(function(el) { ro.observe(el); });
