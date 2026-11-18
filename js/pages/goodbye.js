
(function () {
  "use strict";

  // Auto-redirect countdown
  let secondsLeft = 8;
  const countdownEl = document.getElementById("gbCountdown");
  let redirected = false;
  const tick = setInterval(() => {
    secondsLeft -= 1;
    if (countdownEl) countdownEl.textContent = String(secondsLeft);
    if (secondsLeft <= 0) {
      clearInterval(tick);
      if (!redirected) {
        redirected = true;
        window.location.href = "https://meculs.com/";
      }
    }
  }, 1000);

  // Feedback submit &ndash; POSTs to a simple feedback endpoint via mailto.
  // Without a backend mail relay, the lightest option is to use a
  // form action that opens the user's mail client. For now we write
  // to localStorage as a holding place and direct user to mailto, so
  // the feedback isn't lost if no mail client is configured.
  const submitBtn = document.getElementById("gbSubmitBtn");
  const skipBtn   = document.getElementById("gbSkipBtn");
  const txt       = document.getElementById("gbFeedback");
  const msgEl     = document.getElementById("gbMsg");

  function showMsg(text, ok) {
    if (!msgEl) return;
    msgEl.hidden = false;
    msgEl.textContent = text;
    msgEl.className = "gb-feedback__msg" + (ok ? " gb-feedback__msg--ok" : "");
  }

  function pauseCountdown() {
    clearInterval(tick);
    const note = document.querySelector(".gb-redirect");
    if (note) note.style.display = "none";
  }

  // Pause auto-redirect when user starts typing
  txt.addEventListener("focus", pauseCountdown);

  submitBtn.addEventListener("click", () => {
    const value = (txt.value || "").trim();
    if (!value) {
      showMsg("Please write something or click Skip.", false);
      return;
    }
    pauseCountdown();
    submitBtn.disabled = true;
    skipBtn.disabled = true;
    txt.disabled = true;

    // Open user's mail client with pre-filled message to MECULS
    const subject = encodeURIComponent("Goodbye feedback");
    const body    = encodeURIComponent(value + "\n\n(Sent from MECULS goodbye page.)");
    const mailto  = "mailto:hello@meculs.com?subject=" + subject + "&body=" + body;

    // Try opening mail client. We can't detect success reliably, so we
    // optimistically thank the user and redirect after a moment.
    window.location.href = mailto;

    showMsg("Thank you. Your mail app should open shortly.", true);

    setTimeout(() => {
      if (!redirected) {
        redirected = true;
        window.location.href = "https://meculs.com/";
      }
    }, 4000);
  });

  skipBtn.addEventListener("click", () => {
    pauseCountdown();
    if (!redirected) {
      redirected = true;
      window.location.href = "https://meculs.com/";
    }
  });
})();
