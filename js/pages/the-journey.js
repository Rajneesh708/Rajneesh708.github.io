
  var ro = new IntersectionObserver(function(e) {
    e.forEach(function(x) {
      if (x.isIntersecting) { x.target.classList.add('vis'); ro.unobserve(x.target); }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -32px 0px' });
  document.querySelectorAll('.rev').forEach(function(el) { ro.observe(el); });
