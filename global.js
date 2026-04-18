/* ═══════════════════════════════════════════════════════════════════
   MECULS — GLOBAL NAVIGATION JAVASCRIPT  v2
   File: global.js
   Place <script src="global.js"> just before </body> on every page.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Header shrink on scroll ──────────────────────────────────── */
  var header = document.querySelector('.global-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });
  }

  /* ── Mobile hamburger toggle ──────────────────────────────────── */
  var toggle     = document.getElementById('ghToggle');
  var mobileMenu = document.getElementById('ghMobileMenu');

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function () {
      var isOpen = mobileMenu.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    /* Close on link click */
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    /* Close on Escape */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        mobileMenu.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        toggle.focus();
      }
    });
  }

  /* ── Active nav link ──────────────────────────────────────────── */
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.gh-nav a, .gh-mobile-nav a').forEach(function (link) {
    var href = (link.getAttribute('href') || '').split('#')[0];
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ── Logo image fallback ──────────────────────────────────────── */
  document.querySelectorAll('.gh-logo img, .gf-logo img').forEach(function (img) {
    img.addEventListener('error', function () {
      this.style.display = 'none';
      var fb = this.nextElementSibling;
      if (fb) fb.style.display = 'block';
    });
  });

})();
