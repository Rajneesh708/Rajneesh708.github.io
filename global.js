/* ═══════════════════════════════════════════════════════════════════
   MECULS - GLOBAL NAVIGATION JAVASCRIPT  v5
   File: global.js
   Place <script src="global.js"> just before </body> on every page.

   What changed vs v4:
   - Login icon dropdown now opens on click (not hover). Click on
     icon toggles dropdown; click outside or Escape closes it.
     Click on either dropdown link navigates naturally.

   What changed vs v3:
   - Tagline-height measurement moved in here so no page has its own
     tagline JS. Every page gets --tagline-h set automatically.
   - Hamburger breakpoint aligned with global.css at 899px.
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

  /* ── Tagline height measurement ───────────────────────────────── */
  /* Sets --tagline-h so page content padding-top can clear the tagline.
     On mobile at 680px or below, the tagline is hidden, so --tagline-h
     collapses to 0. Every page inherits this automatically. */
  var taglineEl = document.getElementById('ghTaglineSub');
  function setTaglineHeight() {
    var h = (window.innerWidth <= 680 || !taglineEl) ? 0 : taglineEl.offsetHeight;
    document.documentElement.style.setProperty('--tagline-h', h + 'px');
  }
  setTaglineHeight();
  window.addEventListener('resize', setTaglineHeight, { passive: true });
  window.addEventListener('load', setTaglineHeight); /* re-measure after fonts load */

  /* ── Mobile hamburger toggle ──────────────────────────────────── */
  var toggle     = document.getElementById('ghToggle');
  var mobileMenu = document.getElementById('ghMobileMenu');

  function closeMobileMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('open');
    if (toggle) {
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    document.body.style.overflow = '';
  }

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function () {
      var isOpen = mobileMenu.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    /* Close on Escape */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        closeMobileMenu();
        toggle.focus();
      }
    });
  }

  /* ── Mobile sub-menu: tap parent to expand ────────────────────── */
  /* For each <li> that contains a .gh-mobile-sub, tapping the parent <a>
     should expand/collapse instead of navigating. A second tap on the
     same parent navigates (accessibility compromise). */
  document.querySelectorAll('.gh-mobile-nav > li').forEach(function (li) {
    var sub = li.querySelector('.gh-mobile-sub');
    if (!sub) return;
    var parentLink = li.querySelector(':scope > a');
    if (!parentLink) return;

    /* Inject expand arrow into parent link if not already there */
    if (!parentLink.querySelector('.gh-m-arrow')) {
      var arrow = document.createElement('span');
      arrow.className = 'gh-m-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      parentLink.appendChild(arrow);
    }

    parentLink.addEventListener('click', function (e) {
      if (!li.classList.contains('open')) {
        e.preventDefault();
        /* Close any other open sibling */
        li.parentElement.querySelectorAll(':scope > li.open').forEach(function (other) {
          if (other !== li) other.classList.remove('open');
        });
        li.classList.add('open');
      }
      /* If already open, let the link navigate normally */
    });
  });

  /* ── Close mobile menu when any sub-link is clicked ───────────── */
  if (mobileMenu) {
    mobileMenu.querySelectorAll('.gh-mobile-sub a, .gh-mobile-cta').forEach(function (link) {
      link.addEventListener('click', closeMobileMenu);
    });
  }

  /* ── Desktop dropdown: tap support for iPad / hybrid devices ──── */
  document.querySelectorAll('.gh-nav > li').forEach(function (li) {
    var dd = li.querySelector('.gh-dropdown');
    if (!dd) return;
    var parentLink = li.querySelector(':scope > a');
    if (!parentLink) return;

    parentLink.addEventListener('click', function (e) {
      /* Only intercept on touch / coarse pointers */
      var isCoarse = window.matchMedia && window.matchMedia('(hover: none)').matches;
      if (!isCoarse) return;
      if (!li.classList.contains('open')) {
        e.preventDefault();
        document.querySelectorAll('.gh-nav > li.open').forEach(function (other) {
          if (other !== li) other.classList.remove('open');
        });
        li.classList.add('open');
      }
    });
  });

  /* Click outside closes open desktop dropdowns */
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.gh-nav')) {
      document.querySelectorAll('.gh-nav > li.open').forEach(function (li) {
        li.classList.remove('open');
      });
    }
  });

  /* ── Active nav link ──────────────────────────────────────────── */
  var path = window.location.pathname;
  var currentPage = path.split('/').pop() || 'index.html';
  if (currentPage === '') currentPage = 'index.html';

  document.querySelectorAll('.gh-nav a, .gh-mobile-nav a, .gh-mobile-sub a').forEach(function (link) {
    var href = (link.getAttribute('href') || '').split('#')[0];
    if (!href) return;
    if (href === currentPage) {
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

  /* ── Login icon click-toggle ─────────────────────────────────── */
  /* The login icon dropdown opens on click (not hover) and closes
     when clicking outside or pressing Escape. Single click on the
     icon toggles the dropdown. Single click on either dropdown
     link follows the link naturally. */
  var loginWrap = document.querySelector('.gh-login-wrap');
  var loginIcon = document.querySelector('.gh-login-icon');

  if (loginWrap && loginIcon) {
    /* Stop the icon link from navigating immediately - we want
       the click to toggle the dropdown first. The dropdown items
       themselves are real links that DO navigate on click. */
    loginIcon.addEventListener('click', function (e) {
      e.preventDefault();
      var isOpen = loginWrap.classList.toggle('open');
      loginIcon.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    /* Click outside closes the dropdown. */
    document.addEventListener('click', function (e) {
      if (!loginWrap.contains(e.target)) {
        loginWrap.classList.remove('open');
        loginIcon.setAttribute('aria-expanded', 'false');
      }
    });

    /* Escape key closes the dropdown. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && loginWrap.classList.contains('open')) {
        loginWrap.classList.remove('open');
        loginIcon.setAttribute('aria-expanded', 'false');
        loginIcon.focus();
      }
    });
  }

})();
