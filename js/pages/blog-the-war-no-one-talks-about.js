
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

    if (subscribeForm) {
      subscribeForm.addEventListener('submit', function (e) {
        e.preventDefault();

        var formData = {
          name:       document.getElementById('subscribeName')  ? document.getElementById('subscribeName').value  : '',
          email:      document.getElementById('subscribeEmail') ? document.getElementById('subscribeEmail').value : '',
          agreeTerms: document.getElementById('agreeTerms')     ? document.getElementById('agreeTerms').checked   : false
        };

        /*
        -- HOW TO CONNECT BREVO (your email platform) IN FUTURE ----
        You have a Brevo account. When ready, replace the console.log
        below with a Brevo API call or use Brevo's embedded form.
        Brevo documentation: https://developers.brevo.com

        fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': 'YOUR_BREVO_API_KEY'
          },
          body: JSON.stringify({
            email: formData.email,
            attributes: { FIRSTNAME: formData.name },
            listIds: [YOUR_LIST_ID],
            updateEnabled: true
          })
        });
        ------------------------------------------------------------ */

        console.log('Subscribe (not yet connected to Brevo):', formData);
        showToast('Successfully subscribed to MECULS insights!');
        closeModal(subscribeModal);
        subscribeForm.reset();
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
      if (e.key ==='Escape') {
        if (emailModal     && emailModal.classList.contains('active'))     closeModal(emailModal);
        if (subscribeModal && subscribeModal.classList.contains('active')) closeModal(subscribeModal);
      }
    });

  }); /* end DOMContentLoaded */

})();

  