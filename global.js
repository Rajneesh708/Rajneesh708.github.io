/* ═══════════════════════════════════════════════════════════════════
   MECULS — GLOBAL NAVIGATION JAVASCRIPT
   File: global.js
   Include this on EVERY page of the MECULS website.
   Place the <script src="global.js"> just before </body> on every page.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Header shrink on scroll ──────────────────────────────────── */
  var header = document.querySelector('.global-header');
  if (header) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 60) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  /* ── Mobile hamburger toggle ──────────────────────────────────── */
  var toggle    = document.getElementById('ghToggle');
  var mobileMenu = document.getElementById('ghMobileMenu');

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function () {
      var isOpen = mobileMenu.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    /* Close mobile menu when a link is clicked */
    mobileMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    /* Close on Escape key */
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

  /* ── Mark active nav link ─────────────────────────────────────── */
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.gh-nav > li > a, .gh-mobile-nav > li > a').forEach(function (link) {
    var linkPage = link.getAttribute('href') || '';
    if (linkPage === currentPage || (currentPage === '' && linkPage === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ── Logo image error fallback ────────────────────────────────── */
  var logoImg = document.querySelector('.gh-logo img');
  if (logoImg) {
    logoImg.addEventListener('error', function () {
      this.style.display = 'none';
      var fallback = document.querySelector('.gh-logo-text');
      if (fallback) fallback.style.display = 'block';
    });
  }

})();
