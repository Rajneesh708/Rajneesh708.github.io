
/* -------------------------------------------------------------------
   MECULS &ndash; BLOG ARTICLE JAVASCRIPT
   File: blog-article.js

   ? This ONE file powers EVERY blog article on the MECULS website.
   ? Every blog HTML file links to this file. No other JS needed.
   ? When you add a new article in future, do NOT create a new JS file.
     Just copy any existing blog HTML, replace the content, save.
     This file already handles everything.

   FEATURES IN THIS FILE:
   1. Email Share Modal
   2. Subscribe Modal
   3. Copy Link button
   4. Save Article button (remembers across sessions)
   5. Social share buttons (Facebook, X/Twitter, LinkedIn)
   6. Keyboard accessibility (Escape closes modals)
   7. Toast notification (confirmation messages)
------------------------------------------------------------------- */

(function () {
  'use strict';

  /* -- Wait for DOM ----------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {

    /* -- Element references ------------------------------------- */
    var emailModal         = document.getElementById('emailModal');
    var subscribeModal     = document.getElementById('subscribeModal');
    var emailShareBtn      = document.getElementById('emailShareBtn');
    var subscribeBtn       = document.getElementById('subscribeBtn');
    var closeEmailModal    = document.getElementById('closeEmailModal');
    var closeSubscribeModal= document.getElementById('closeSubscribeModal');
    var emailShareForm     = document.getElementById('emailShareForm');
    var subscribeForm      = document.getElementById('subscribeForm');
    var copyLinkBtn        = document.getElementById('copyLinkBtn');
    var saveBtn            = document.getElementById('saveBtn');
    var successToast       = document.getElementById('successToast');
    var toastMessage       = document.getElementById('toastMessage');

    /* -- Toast -------------------------------------------------- */
    function showToast(message) {
      if (!successToast || !toastMessage) return;
      toastMessage.textContent = message;
      successToast.classList.add('active');
      setTimeout(function () {
        successToast.classList.remove('active');
      }, 3000);
    }

    /* -- Modal open/close --------------------------------------- */
    function openModal(modal) {
      if (!modal) return;
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeModal(modal) {
      if (!modal) return;
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }

    /* -- Email Share Modal -------------------------------------- */
    if (emailShareBtn) {
      /* Opens the visitor's own email app with the article link filled in (15 Nov 2026).
         The old pop-up form never sent anything. */
      emailShareBtn.addEventListener('click', function () {
        var t = document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : document.title;
        var subject = encodeURIComponent('Worth reading: ' + t);
        var body = encodeURIComponent('I thought you might find this article from MECULS valuable:\n\n' + t + '\n' + window.location.href);
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
      });
    }

    if (closeEmailModal) {
      closeEmailModal.addEventListener('click', function () {
        closeModal(emailModal);
      });
    }

    if (emailModal) {
      emailModal.addEventListener('click', function (e) {
        if (e.target === emailModal) closeModal(emailModal);
      });
    }

    if (emailShareForm) {
      emailShareForm.addEventListener('submit', function (e) {
        e.preventDefault();

        var articleTitle = document.querySelector('.article-main-title');
        var formData = {
          senderName:     document.getElementById('senderName')    ? document.getElementById('senderName').value    : '',
          senderEmail:    document.getElementById('senderEmail')   ? document.getElementById('senderEmail').value   : '',
          recipientEmail: document.getElementById('recipientEmail')? document.getElementById('recipientEmail').value: '',
          personalMessage:document.getElementById('personalMessage')? document.getElementById('personalMessage').value: '',
          articleTitle:   articleTitle ? articleTitle.textContent : '',
          articleUrl:     window.location.href
        };

        /*
        -- HOW TO CONNECT EMAIL SENDING IN FUTURE ------------------
        When you have a backend server (e.g. through Brevo or similar),
        replace the console.log below with a fetch() call like this:

        fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        }).then(function(res) {
          if (res.ok) {
            showToast('Article shared successfully!');
            closeModal(emailModal);
            emailShareForm.reset();
          }
        });

        Until then, the form shows a confirmation but does not
        actually send an email. The feature is ready &ndash; just needs
        the server endpoint connected.
        ------------------------------------------------------------ */

        console.log('Email share (not yet connected to server):', formData);
        showToast('Article shared successfully!');
        closeModal(emailModal);
        emailShareForm.reset();
      });
    }

    /* -- Subscribe Modal ---------------------------------------- */
    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', function () {
        openModal(subscribeModal);
      });
    }

    if (closeSubscribeModal) {
      closeSubscribeModal.addEventListener('click', function () {
        closeModal(subscribeModal);
      });
    }

    if (subscribeModal) {
      subscribeModal.addEventListener('click', function (e) {
        if (e.target === subscribeModal) closeModal(subscribeModal);
      });
    }

    /* -- Subscribe: real saving (18 Nov 2026) -------------------
       Saves the visitor to the Supabase table "newsletter_subscribers"
       (columns: name, email, source_page). To see subscribers:
       Supabase > Table Editor > newsletter_subscribers.
       Spam check: Cloudflare Turnstile, checked by our Vercel server
       (MECULS_API_BASE + /api/verify-turnstile) - same as the
       corporate enquiry form. Needs config.js and Turnstile's api.js
       on the page. Nobody can read the list from the browser
       (only insert is allowed - see newsletter_subscribers.sql).
       ------------------------------------------------------------ */
    var SUBSCRIBE_TURNSTILE_SITEKEY = '0x4AAAAAADQhXVRIIusl9YwX'; /* same key as corporate-enquiry.html */
    var subscribeWidgetId = null;
    var subscribeRenderTries = 0;

    function renderSubscribeTurnstile() {
      var box = document.getElementById('subscribeTurnstile');
      if (!box || subscribeWidgetId !== null) return;
      if (typeof turnstile === 'undefined' || !turnstile.render) {
        /* Turnstile script still loading - try again for up to ~15 s */
        if (subscribeRenderTries++ < 50) setTimeout(renderSubscribeTurnstile, 300);
        return;
      }
      subscribeWidgetId = turnstile.render(box, {
        sitekey: SUBSCRIBE_TURNSTILE_SITEKEY,
        theme: 'light'
      });
    }

    function setSubscribeStatus(message) {
      var el = document.getElementById('subscribeStatus');
      if (!el) return;
      el.textContent = message || '';
      el.hidden = !message;
    }

    function resetSubscribeTurnstile() {
      try {
        if (typeof turnstile !== 'undefined' && subscribeWidgetId !== null) turnstile.reset(subscribeWidgetId);
      } catch (err) { /* widget not ready - nothing to reset */ }
    }

    if (subscribeBtn) {
      subscribeBtn.addEventListener('click', renderSubscribeTurnstile);
    }

    if (subscribeForm) {
      subscribeForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        setSubscribeStatus('');

        var nameEl  = document.getElementById('subscribeName');
        var emailEl = document.getElementById('subscribeEmail');
        var agreeEl = document.getElementById('agreeTerms');
        var name  = nameEl  ? nameEl.value.trim() : '';
        var email = emailEl ? emailEl.value.trim().toLowerCase() : '';

        if (agreeEl && !agreeEl.checked) {
          setSubscribeStatus('Please tick the box to agree.');
          return;
        }

        var token = '';
        try {
          if (typeof turnstile !== 'undefined' && subscribeWidgetId !== null) {
            token = turnstile.getResponse(subscribeWidgetId) || '';
          }
        } catch (err) { token = ''; }
        if (!token) {
          setSubscribeStatus('Please wait for the security check above the button to finish, then try again.');
          renderSubscribeTurnstile();
          return;
        }

        var submitBtn = subscribeForm.querySelector('button[type="submit"]');
        var submitText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Subscribing...'; }

        try {
          /* 1. Our server asks Cloudflare whether this is a real person */
          var verifyRes = await fetch(MECULS_API_BASE + '/api/verify-turnstile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnstile_token: token })
          });
          var verifyData = {};
          try { verifyData = await verifyRes.json(); } catch (err) { verifyData = {}; }
          if (!verifyRes.ok || !verifyData.ok) {
            setSubscribeStatus('The security check did not pass. Please try again.');
            return;
          }

          /* 2. Save the subscriber */
          var saveRes = await fetch(SUPABASE_URL + '/rest/v1/newsletter_subscribers', {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              name: name.slice(0, 100),
              email: email,
              source_page: window.location.pathname
            })
          });

          if (saveRes.status === 201 || saveRes.status === 204) {
            showToast('Thank you - you are subscribed to MECULS insights.');
          } else if (saveRes.status === 409) {
            /* Email is already on the list (unique email rule) */
            showToast('You are already subscribed - thank you.');
          } else {
            console.error('Subscribe failed:', saveRes.status, await saveRes.text());
            setSubscribeStatus('Sorry, that did not go through. Please check your email address and try again.');
            return;
          }
          closeModal(subscribeModal);
          subscribeForm.reset();
        } catch (err) {
          console.error('Subscribe error:', err);
          setSubscribeStatus('Sorry, we could not connect. Please check your internet and try again.');
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitText; }
          resetSubscribeTurnstile();
        }
      });
    }

    /* -- Copy Link ---------------------------------------------- */
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', function () {
        var url = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            showToast('Link copied to clipboard!');
          }).catch(function () {
            fallbackCopy(url);
          });
        } else {
          fallbackCopy(url);
        }
      });
    }

    function fallbackCopy(text) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        showToast('Link copied to clipboard!');
      } catch (err) {
        showToast('Could not copy link &ndash; please copy the URL manually.');
      }
      document.body.removeChild(textarea);
    }

    /* -- Save Article ------------------------------------------- */
    var isSaved = false;

    if (saveBtn) {
      /* Check saved state on load */
      try {
        var savedArticles = JSON.parse(localStorage.getItem('meculs_saved_articles') || '[]');
        var currentUrl = window.location.href;
        if (savedArticles.some(function (a) { return a.url === currentUrl; })) {
          isSaved = true;
          updateSaveButton(true);
        }
      } catch (e) { /* localStorage not available */ }

      saveBtn.addEventListener('click', function () {
        isSaved = !isSaved;
        updateSaveButton(isSaved);

        try {
          var saved = JSON.parse(localStorage.getItem('meculs_saved_articles') || '[]');
          var url   = window.location.href;
          var title = document.querySelector('.article-main-title');

          if (isSaved) {
            saved.push({
              url:     url,
              title:   title ? title.textContent : '',
              savedAt: new Date().toISOString()
            });
            showToast('Article saved!');
          } else {
            saved = saved.filter(function (a) { return a.url !== url; });
            showToast('Article removed from saved.');
          }
          localStorage.setItem('meculs_saved_articles', JSON.stringify(saved));
        } catch (e) { /* localStorage not available */ }
      });
    }

    function updateSaveButton(saved) {
      if (!saveBtn) return;
      var svgPath = saveBtn.querySelector('svg path');
      var label   = saveBtn.querySelector('span');
      if (svgPath) svgPath.setAttribute('fill', saved ? '#d4af37' : 'none');
      if (label)   label.textContent = saved ? 'Saved' : 'Save';
    }

    /* -- Social Share Buttons ----------------------------------- */
    var articleTitle = document.querySelector('.article-main-title');
    var pageTitle    = articleTitle ? encodeURIComponent(articleTitle.textContent.trim()) : '';
    var pageUrl      = encodeURIComponent(window.location.href);

    /* Facebook */
    document.querySelectorAll('[data-share="facebook"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + pageUrl, '_blank', 'width=600,height=400');
      });
    });

    /* X (Twitter) */
    document.querySelectorAll('[data-share="twitter"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.open('https://twitter.com/intent/tweet?text=' + pageTitle + '&url=' + pageUrl, '_blank', 'width=600,height=400');
      });
    });

    /* LinkedIn */
    document.querySelectorAll('[data-share="linkedin"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + pageUrl, '_blank', 'width=600,height=400');
      });
    });

    /* WhatsApp */
    document.querySelectorAll('[data-share="whatsapp"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.open('https://wa.me/?text=' + pageTitle + '%20' + pageUrl, '_blank');
      });
    });

    /* -- Keyboard: Escape closes any open modal ----------------- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (emailModal     && emailModal.classList.contains('active'))     closeModal(emailModal);
        if (subscribeModal && subscribeModal.classList.contains('active')) closeModal(subscribeModal);
      }
    });

  }); /* end DOMContentLoaded */

})();

  