
  (function () {
    var els = document.querySelectorAll('.ap-reveal');
    if (!('IntersectionObserver' in window) || !els.length) {
      els.forEach(function (el) { el.classList.add('is-vis'); });
    } else {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-vis');
            obs.unobserve(e.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
      els.forEach(function (el) { obs.observe(el); });
    }

    // Roman-numeral rail: pick the section whose top is closest to a fixed
    // anchor line at 35% of the viewport height, scanning on scroll/resize.
    // Hide the rail entirely when no data-rail-num section is in view (e.g.
    // when the reader is in the footer).
    var railWrap = document.querySelector('.ap-rail');
    var railNum = document.getElementById('apRailNum');
    if (railWrap && railNum) {
      var sections = Array.prototype.slice.call(document.querySelectorAll('[data-rail-num]'));
      if (sections.length) {
        var footer = document.querySelector('footer.global-footer');
        var ticking = false;
        function updateRail() {
          ticking = false;
          var vh = window.innerHeight;

          // Positive hide-signal: if the footer occupies the upper half of the
          // viewport, the reader is in the footer, not the page content.
          if (footer) {
            var fRect = footer.getBoundingClientRect();
            if (fRect.top < vh * 0.5) {
              railWrap.style.opacity = '0';
              railWrap.style.visibility = 'hidden';
              return;
            }
          }

          var anchorY = vh * 0.35;
          var current = null;
          var currentDist = Infinity;
          var anySectionMeaningfullyVisible = false;
          for (var i = 0; i < sections.length; i++) {
            var rect = sections[i].getBoundingClientRect();
            var visibleTop = Math.max(rect.top, 0);
            var visibleBottom = Math.min(rect.bottom, vh);
            var visibleHeight = visibleBottom - visibleTop;
            // Require at least 200px of the section to be inside the viewport
            // for it to count - prevents the rail from sticking on a section
            // when only a thin strip remains.
            if (visibleHeight > 200) {
              anySectionMeaningfullyVisible = true;
              if (rect.top <= anchorY) {
                var dist = anchorY - rect.top;
                if (dist < currentDist) {
                  currentDist = dist;
                  current = sections[i];
                }
              }
            }
          }
          if (!current && anySectionMeaningfullyVisible) {
            for (var j = 0; j < sections.length; j++) {
              var r2 = sections[j].getBoundingClientRect();
              var vTop = Math.max(r2.top, 0);
              var vBot = Math.min(r2.bottom, vh);
              if (vBot - vTop > 200) { current = sections[j]; break; }
            }
          }
          if (current) {
            railWrap.style.opacity = '1';
            railWrap.style.visibility = 'visible';
            var n = current.getAttribute('data-rail-num');
            var dark = current.getAttribute('data-rail-dark') === '1';
            if (railNum.textContent !== n) { railNum.textContent = n; }
            if (dark) { railNum.classList.add('is-on-dark'); }
            else      { railNum.classList.remove('is-on-dark'); }
          } else {
            railWrap.style.opacity = '0';
            railWrap.style.visibility = 'hidden';
          }
        }
        function onScroll() {
          if (!ticking) {
            window.requestAnimationFrame(updateRail);
            ticking = true;
          }
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        updateRail();
      }
    }
  })();
