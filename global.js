/* ── Google Analytics 4 + cookie choice (Consent Mode, 15 Nov 2026) ──
   Measurement ID is public by design. Portal/login pages do not load
   global.js, so they are intentionally not tracked.
   - Until a visitor clicks "Accept all", analytics cookies stay OFF.
     Google only receives cookieless visit signals and estimates numbers.
   - "Essential only" or ignoring the banner = no analytics cookies.
   - The choice is remembered on this browser; footer "Cookie settings"
     link lets the visitor change it. */
(function () {
  var GA_ID = 'G-Y5SBSKZPCR';
  var KEY = 'meculs-cookie-choice';
  function getChoice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  var choice = getChoice();
  window.gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: choice === 'all' ? 'granted' : 'denied'
  });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);

  var css = '' +
    '.mc-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:760px;margin:0 auto;' +
    'background:#001428;color:#d8deea;border:1px solid rgba(212,175,55,0.45);border-radius:4px;' +
    'box-shadow:0 12px 40px rgba(0,0,0,0.35);padding:14px 18px;display:flex;gap:14px 20px;align-items:center;flex-wrap:wrap;' +
    'font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.mc-cookie p{margin:0;flex:1 1 320px}' +
    '.mc-cookie a{color:#d4af37}' +
    '.mc-cookie-btns{display:flex;gap:10px;flex-wrap:wrap}' +
    '.mc-cookie button{font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.04em;' +
    'padding:10px 16px;border-radius:2px;cursor:pointer;border:1px solid #d4af37}' +
    '.mc-cookie .mc-accept{background:#d4af37;color:#001428}' +
    '.mc-cookie .mc-essential{background:transparent;color:#d4af37}' +
    '.mc-cookie button:focus-visible{outline:2px solid #fff;outline-offset:2px}';

  function showBanner() {
    if (document.getElementById('mcCookie')) return;
    if (!document.getElementById('mcCookieCss')) {
      var st = document.createElement('style'); st.id = 'mcCookieCss'; st.textContent = css;
      document.head.appendChild(st);
    }
    var b = document.createElement('div');
    b.id = 'mcCookie'; b.className = 'mc-cookie';
    b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Cookie choice');
    b.innerHTML = '<p>We use essential cookies to run this site, and optional analytics cookies to understand ' +
      'which pages help visitors. <a href="privacy-policy.html">Privacy Policy</a></p>' +
      '<div class="mc-cookie-btns"><button type="button" class="mc-essential">Essential only</button>' +
      '<button type="button" class="mc-accept">Accept all</button></div>';
    document.body.appendChild(b);
    b.querySelector('.mc-accept').addEventListener('click', function () {
      setChoice('all');
      window.gtag('consent', 'update', { analytics_storage: 'granted' });
      b.remove();
    });
    b.querySelector('.mc-essential').addEventListener('click', function () {
      setChoice('essential');
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
      b.remove();
    });
  }
  window.meculsCookieSettings = showBanner;

  function onReady() {
    if (!getChoice()) showBanner();
    var legal = document.querySelector('.gf-legal');
    if (legal && !document.getElementById('mcCookieLink')) {
      var a = document.createElement('a');
      a.href = '#'; a.id = 'mcCookieLink'; a.textContent = 'Cookie settings';
      a.addEventListener('click', function (e) { e.preventDefault(); showBanner(); });
      legal.appendChild(a);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();

/* ═══════════════════════════════════════════════════════════════════
   MECULS - GLOBAL NAVIGATION JAVASCRIPT  v6
   File: global.js
   Place <script src="global.js"> just before </body> on every page.

   What changed vs v5:
   - Login icon is non-clickable. Hover or keyboard focus reveals
     the dropdown (CSS does this). Clicking the icon does nothing.
     Clicking either dropdown item (CV Portal - Login, CV Portal -
     Register) navigates to that page.

   What changed vs v4:
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

  /* ── Login icon (no click on icon - hover only opens dropdown) ─ */
  /* The login icon dropdown opens automatically on hover/focus via CSS.
     The icon itself is not clickable - only the dropdown items
     (CV Portal - Login, CV Portal - Register) are. Clicking the icon
     does nothing; mouse hover or keyboard focus reveals the menu. */
  var loginIcon = document.querySelector('.gh-login-icon');
  if (loginIcon) {
    /* Prevent the icon link from navigating - it's a visual handle only. */
    loginIcon.addEventListener('click', function (e) {
      e.preventDefault();
    });
    /* Remove href to make it truly non-navigable while keeping it focusable. */
    if (loginIcon.tagName === 'A') {
      loginIcon.setAttribute('role', 'button');
      loginIcon.setAttribute('aria-haspopup', 'true');
      loginIcon.removeAttribute('href');
      loginIcon.setAttribute('tabindex', '0');
    }
  }

})();
