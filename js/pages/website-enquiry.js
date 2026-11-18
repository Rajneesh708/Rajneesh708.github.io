
/* ════════════════════════════════════════════════════════════
   website-enquiry.html — Form handler
   Submits to: public.paid_submissions (form_type: web_enquiry)
   Requires: config.js with SUPABASE_URL + SUPABASE_ANON_KEY
   RLS: run website_enquiry_rls.sql in Supabase dashboard first
════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var loadedAt = Date.now();
  var form     = document.getElementById('weEnquiryForm');
  var btnEl    = document.getElementById('weSubmitBtn');
  var statusEl = document.getElementById('weStatus');

  if (!form) return;

  /* ── Character counter ────────────────────────────────── */
  var briefEl    = document.getElementById('weBrief');
  var countEl    = document.getElementById('weBriefCount');
  var BRIEF_MAX  = 2500;

  if (briefEl && countEl) {
    briefEl.addEventListener('input', function () {
      var len = briefEl.value.length;
      countEl.textContent = len + ' / ' + BRIEF_MAX;
      countEl.className = 'we-char-count' +
        (len >= BRIEF_MAX ? ' over' : len >= BRIEF_MAX * 0.85 ? ' near' : '');
    });
  }

  /* ── URL normaliser ───────────────────────────────────── */
  function normaliseUrl(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    /* Already has a scheme */
    if (/^https?:\/\//i.test(raw)) return raw;
    /* Assume https:// — if server responds with a redirect, that
       is expected and handled transparently by the browser */
    return 'https://' + raw;
  }

  /* ── Validation helpers ───────────────────────────────── */
  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('visible'); }
  }
  function clearErr(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }
  function setInputState(id, invalid) {
    var el = document.getElementById(id);
    if (el) {
      if (invalid) el.classList.add('we-invalid');
      else         el.classList.remove('we-invalid');
    }
  }

  /* ── Status message ───────────────────────────────────── */
  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'we-status we-status--' + type;
  }
  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'we-status';
  }

  /* ── Submit handler ───────────────────────────────────── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearStatus();

    /* Honeypot check */
    var hp = form.elements['website_url_field'];
    if (hp && hp.value) return;

    /* Timestamp check — must be at least 3 seconds since page load */
    if (Date.now() - loadedAt < 3000) return;

    /* Turnstile token */
    var turnstileToken = '';
    try {
      if (typeof turnstile !== 'undefined' && turnstile.getResponse) {
        turnstileToken = turnstile.getResponse() || '';
      }
    } catch (_) { turnstileToken = ''; }
    if (!turnstileToken) {
      setStatus('Please complete the security verification above.', 'error');
      return;
    }

    /* Field validation */
    var valid = true;

    var name  = (form.elements['name']  || {}).value || '';
    var email = (form.elements['email'] || {}).value || '';
    var brief = (form.elements['brief'] || {}).value || '';

    clearErr('weNameErr');  setInputState('weName',  false);
    clearErr('weEmailErr'); setInputState('weEmail', false);
    clearErr('weBriefErr'); setInputState('weBrief', false);

    if (!name.trim()) {
      showErr('weNameErr', 'Please enter your name.');
      setInputState('weName', true);
      valid = false;
    }
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRx.test(email.trim())) {
      showErr('weEmailErr', 'Please enter a valid email address.');
      setInputState('weEmail', true);
      valid = false;
    }
    if (brief.trim().length < 20) {
      showErr('weBriefErr', 'Please add a brief description of your project (at least 20 characters).');
      setInputState('weBrief', true);
      valid = false;
    }
    if (!valid) return;

    /* Normalise the current site URL */
    var rawSite    = ((form.elements['current_site'] || {}).value || '').trim();
    var normSite   = normaliseUrl(rawSite);

    /* Build the submission payload */
    var payload = {
      form_type:           'web_enquiry',
      razorpay_payment_id: null,
      name:                name.trim(),
      email:               email.trim().toLowerCase(),
      phone:               ((form.elements['phone']        || {}).value || '').trim() || null,
      location:            ((form.elements['location']     || {}).value || '').trim() || null,
      organisation:        ((form.elements['organisation'] || {}).value || '').trim() || null,
      current_site:        normSite || null,
      site_size:           ((form.elements['site_size']    || {}).value || '').trim() || null,
      brief:               brief.trim(),
      timeline:            ((form.elements['timeline']     || {}).value || '').trim() || null,
      referral:            ((form.elements['referral']     || {}).value || '').trim() || null,
      cf_turnstile_token:  turnstileToken
    };

    btnEl.disabled = true;
    btnEl.textContent = 'Submitting…';

    /* Insert into Supabase */
    function doInsert(client) {
      client
        .from('paid_submissions')
        .insert([payload])
        .then(function (res) {
          if (res.error) {
            console.error('Supabase error:', res.error);
            setStatus(
              'Something went wrong. Please try again or email Jain.Rajneesh@meculs.com directly.',
              'error'
            );
            btnEl.disabled = false;
            btnEl.textContent = 'Submit Enquiry';
            try { if (typeof turnstile !== 'undefined') turnstile.reset(); } catch (_) {}
          } else {
            setStatus(
              'Your enquiry has been received. A personal reply follows within two working days.',
              'ok'
            );
            form.reset();
            if (countEl) countEl.textContent = '0 / ' + BRIEF_MAX;
            btnEl.disabled = true;
            btnEl.textContent = 'Enquiry Submitted';
          }
        });
    }

    if (window._supabaseClient) {
      doInsert(window._supabaseClient);
    } else {
      var s1 = document.createElement('script');
      s1.src = 'vendor/supabase-js-2.119.0.js';
      s1.onload = function () {
        var s2 = document.createElement('script');
        s2.src = 'config.js';
        s2.onload = function () {
          var client = window.supabase.createClient(
            window.SUPABASE_URL,
            window.SUPABASE_ANON_KEY
          );
          window._supabaseClient = client;
          doInsert(client);
        };
        s2.onerror = function () {
          setStatus('Configuration error. Please contact Jain.Rajneesh@meculs.com.', 'error');
          btnEl.disabled = false;
          btnEl.textContent = 'Submit Enquiry';
        };
        document.head.appendChild(s2);
      };
      s1.onerror = function () {
        setStatus('Network error. Please try again or email directly.', 'error');
        btnEl.disabled = false;
        btnEl.textContent = 'Submit Enquiry';
      };
      document.head.appendChild(s1);
    }
  });

  /* ── Scroll reveal ────────────────────────────────────── */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); }
    });
  }, { threshold: 0.06 });
  document.querySelectorAll('.rev').forEach(function (el) { io.observe(el); });

})();
