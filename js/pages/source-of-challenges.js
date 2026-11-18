
  (function () {
    'use strict';

    // Tab switching
    var tabs = document.querySelectorAll('.soc-tab');
    var panels = document.querySelectorAll('.soc-panel');

    function activateTab(idx) {
      tabs.forEach(function (t, i) {
        var on = i === idx;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p, i) {
        var on = i === idx;
        p.classList.toggle('is-active', on);
        if (on) { p.removeAttribute('hidden'); } else { p.setAttribute('hidden', ''); }
      });
    }

    tabs.forEach(function (tab, idx) {
      tab.addEventListener('click', function () { activateTab(idx); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          var next = (idx + 1) % tabs.length;
          tabs[next].focus();
          activateTab(next);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          var prev = (idx - 1 + tabs.length) % tabs.length;
          tabs[prev].focus();
          activateTab(prev);
        }
      });
    });

    // Reveal on scroll
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('vis');
            obs.unobserve(e.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -50px 0px' });

      document.querySelectorAll('.rev').forEach(function (el) { obs.observe(el); });
    } else {
      document.querySelectorAll('.rev').forEach(function (el) { el.classList.add('vis'); });
    }
  })();
