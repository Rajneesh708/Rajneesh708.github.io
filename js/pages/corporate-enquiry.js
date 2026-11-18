
/* ─────────────────────────────────────────────────────────────
   corporate-enquiry.html - Corporate Enquiry submission.

   THREE LAYERS OF SPAM PROTECTION:
     1. Honeypot field (hp_website) - bots auto-fill it; humans don't see it.
     2. Timestamp check (hp_ts) - submissions in <3 seconds are bots.
     3. Cloudflare Turnstile - browser solves a Cloudflare challenge;
        server verifies the token via /api/verify-turnstile.

   On valid submit, writes a row to public.paid_submissions in Supabase.
     form_type           = "corporate_enquiry"
     customer_email      = work email
     razorpay_payment_id = null
     payload             = all other corporate fields, as JSON

   On success: hides the form, reveals the success panel.
   On failure: shows the inline error, re-enables the button.
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  /* Create Supabase client (URL + anon key come from config.js) */
  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var form      = document.getElementById('bookingForm');
  var success   = document.getElementById('bookingSuccess');
  var submitBtn = document.getElementById('bookingSubmit');
  var errorEl   = document.getElementById('bookingError');
  var hpTs      = document.getElementById('hp_ts');

  /* Record the page-load timestamp. Used by the timestamp check
     in the submit handler to reject instant-submit bots. */
  if (hpTs) hpTs.value = String(Date.now());

  if (form && success && submitBtn) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      if (errorEl) errorEl.classList.remove('is-visible');

      /* Collect all fields by name */
      var fd = new FormData(form);
      var get = function (k) { return (fd.get(k) || '').toString().trim(); };

      /* ──── LAYER 1: HONEYPOT ────
         If the hidden field has any value, it was filled by a bot.
         Silently rejected — neutral redirect, don't show success so
         the bot can't tell whether it succeeded. */
      var hpValue = get('hp_website');
      if (hpValue) {
        console.warn('Honeypot triggered — silently rejecting bot');
        window.location.href = '/';
        return;
      }

      /* ──── LAYER 2: TIMESTAMP ────
         If form submitted in less than 3 seconds since page load,
         it is a bot (no human reads + fills a 9-field form that fast). */
      var loadedAt = parseInt(get('hp_ts'), 10) || 0;
      var elapsed = Date.now() - loadedAt;
      if (elapsed < 3000) {
        console.warn('Timestamp check failed (' + elapsed + 'ms) — rejecting');
        window.location.href = '/';
        return;
      }

      /* ──── LAYER 3: CLOUDFLARE TURNSTILE ────
         Read the token the widget produced and verify it with our server. */
      var turnstileToken = '';
      try {
        if (typeof turnstile !== 'undefined' && turnstile.getResponse) {
          turnstileToken = turnstile.getResponse();
        }
      } catch (e) {
        turnstileToken = '';
      }

      if (!turnstileToken) {
        if (errorEl) {
          errorEl.textContent = 'Please complete the security check above before sending.';
          errorEl.classList.add('is-visible');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Enquiry →';
        return;
      }

      /* Ask our server to verify the Turnstile token with Cloudflare. */
      try {
        var verifyRes = await fetch(MECULS_API_BASE + '/api/verify-turnstile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnstile_token: turnstileToken })
        });
        var verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.ok) {
          throw new Error(verifyData.reason || 'verify_failed');
        }
      } catch (verifyErr) {
        console.error('Turnstile verification failed:', verifyErr);
        if (errorEl) {
          errorEl.textContent = 'Security check failed. Please refresh the page and try again, ' +
                                'or write directly to Jain.Rajneesh@meculs.com.';
          errorEl.classList.add('is-visible');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Enquiry →';
        /* Reset the widget so the user can try again. */
        try { if (typeof turnstile !== 'undefined') turnstile.reset(); } catch (e) {}
        return;
      }

      /* ──── ALL CHECKS PASSED — WRITE TO SUPABASE ──── */
      var email = get('email');

      try {
        var result = await sb
          .from('paid_submissions')
          .insert({
            form_type: 'corporate_enquiry',
            customer_email: email,
            razorpay_payment_id: null,
            payload: {
              name:         get('name'),
              organisation: get('organisation'),
              role:         get('role'),
              phone:        get('phone'),
              location:     get('location'),
              service:      get('service'),
              mode:         get('mode'),
              context:      get('context'),
              referral:     get('referral')
            }
          });

        if (result.error) throw result.error;

        /* Saved cleanly - hide form, show success */
        form.style.display = 'none';
        success.classList.add('show');
        success.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (err) {
        console.error('Corporate enquiry submission failed:', err);
        if (errorEl) {
          errorEl.textContent = 'Something went wrong sending your enquiry. Please try again, ' +
                                'or write directly to Jain.Rajneesh@meculs.com.';
          errorEl.classList.add('is-visible');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Enquiry →';
      }
    });
  }

  /* Character counter for the "What is the engagement for?" textarea */
  var ctx = document.getElementById('f-context');
  var ctxCount = document.getElementById('contextCount');
  if (ctx && ctxCount) {
    var MAX = 2000;
    var update = function () {
      var len = ctx.value.length;
      ctxCount.textContent = len.toLocaleString('en-IN') + ' / ' + MAX.toLocaleString('en-IN');
      ctxCount.classList.toggle('is-near', len >= MAX * 0.9 && len < MAX);
      ctxCount.classList.toggle('is-full', len >= MAX);
    };
    ctx.addEventListener('input', update);
    update();
  }
})();
