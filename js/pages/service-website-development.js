
(function () {
  'use strict';
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.rev').forEach(function (el) { el.classList.add('vis'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('vis');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.10 });
  document.querySelectorAll('.rev').forEach(function (el) { io.observe(el); });
}());
