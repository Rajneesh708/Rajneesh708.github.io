/* ─────────────────────────────────────────────────────────────
   js/img-fallback.js  (18 Nov 2026)
   Replaces the old inline onerror="..." attributes on images, which a
   strict Content-Security-Policy does not allow.

   If an <img data-fallback="..."> fails to load, the image is hidden and:
     data-fallback="hide"         nothing else happens
     data-fallback="next-inline"  the next element is shown (display:inline)
     data-fallback="#someId"      the element with that id is shown (display:block)

   Loaded in <head>, so it is listening before any image starts loading.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function applyFallback(img) {
    var rule = img.getAttribute('data-fallback');
    if (!rule || img.getAttribute('data-fallback-done')) return;
    img.setAttribute('data-fallback-done', '1');
    img.style.display = 'none';
    if (rule === 'next-inline') {
      var next = img.nextElementSibling;
      if (next) next.style.display = 'inline';
    } else if (rule.charAt(0) === '#') {
      var target = document.getElementById(rule.slice(1));
      if (target) target.style.display = 'block';
    }
  }

  /* Image errors do not bubble, so listen in the capture phase. */
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute('data-fallback')) applyFallback(el);
  }, true);

  /* Safety net: an image that already failed before this ran. */
  function sweep() {
    var imgs = document.querySelectorAll('img[data-fallback]');
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.complete && im.naturalWidth === 0 && im.getAttribute('src')) applyFallback(im);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
})();
