
  /* ─────────────────────────────────────────────────────────────
     book.html — read the booking_token from the URL, send it to
     the Vercel server, redirect to the Cal.com URL the server
     returns. If anything goes wrong, show a useful error with a
     pre-filled email link.
     ───────────────────────────────────────────────────────────── */
  (function () {
    "use strict";

    /* MECULS_API_BASE is set in config.js (loaded just below).
       It points to your Vercel deployment, e.g.
       https://meculs-payment.vercel.app — no trailing slash. */
    var eyebrow  = document.getElementById("bookEyebrow");
    var headline = document.getElementById("bookHeadline");
    var message  = document.getElementById("bookMessage");
    var spinner  = document.getElementById("bookSpinner");
    var cta      = document.getElementById("bookCta");
    var card     = document.getElementById("bookCard");

    function showError(headlineText, messageText, paymentIdHint) {
      card.classList.add("is-error");
      eyebrow.textContent = "Something went wrong";
      headline.textContent = headlineText;
      message.textContent = messageText;
      spinner.style.display = "none";

      /* A pre-filled email so the customer can reach Rajneesh
         fast, with the payment id and product attached if we
         have them. */
      var subject = "Help with my MECULS payment";
      var body = "Hi Rajneesh,\n\nI just paid for a MECULS session, but " +
                 "the booking page would not open.\n";
      if (paymentIdHint) body += "Payment ID: " + paymentIdHint + "\n";
      body += "\nPlease send me a fresh link to book.\n\nThanks.";

      cta.textContent = "Email Rajneesh";
      cta.href = "mailto:Jain.Rajneesh@meculs.com"
               + "?subject=" + encodeURIComponent(subject)
               + "&body="    + encodeURIComponent(body);
      cta.style.display = "inline-flex";
    }

    /* Read the token from URL params. */
    var params = new URLSearchParams(window.location.search);
    var token  = params.get("token");
    var paymentIdHint = params.get("razorpay_payment_id") || "";

    if (!token) {
      /* Someone hit /book.html directly. Send them home — there is
         nothing for them to see here. */
      window.location.replace("index.html");
      return;
    }

    if (typeof MECULS_API_BASE === "undefined" || !MECULS_API_BASE) {
      showError(
        "Booking system is not configured",
        "The booking link could not be opened due to a configuration issue. " +
        "Please email Rajneesh and we will send a fresh link.",
        paymentIdHint
      );
      return;
    }

    /* Send the token to the Vercel server. The server checks the
       signature, the expiry, and looks up the Cal.com URL from
       its server-side map. */
    fetch(MECULS_API_BASE + "/api/redeem-booking-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_token: token })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.ok && data.cal_url) {
        /* Success. Redirect the customer to Cal.com. We use
           replace() so the back button does not return them
           to this page (which would just redirect them again). */
        message.textContent = "Taking you to the calendar now.";
        window.location.replace(data.cal_url);
        return;
      }

      /* Server returned a structured error. Translate it into
         honest customer-facing copy. */
      var reason = (data && data.reason) || "unknown";
      var customerMessage;
      if (reason === "expired") {
        customerMessage =
          "Your booking link has expired. This usually happens if " +
          "more than 30 minutes have passed since you paid. Your " +
          "payment is fine — please email Rajneesh with your " +
          "payment ID and we will send you a fresh booking link.";
      } else if (reason === "bad_signature" || reason === "bad_format" || reason === "bad_payload") {
        customerMessage =
          "We could not verify your booking link. Please email " +
          "Rajneesh with your payment ID and we will send you a " +
          "fresh, working link.";
      } else if (reason === "no_token") {
        customerMessage =
          "No booking link was provided. Please email Rajneesh " +
          "with your payment ID and we will send you the right link.";
      } else {
        customerMessage =
          "Something went wrong opening your booking. Please email " +
          "Rajneesh with your payment ID and we will sort it out.";
      }
      showError("Booking link could not be opened", customerMessage, paymentIdHint);
    })
    .catch(function (err) {
      console.error("book.html: redeem call failed", err);
      showError(
        "Could not reach our server",
        "Your payment is fine, but we could not open the booking page. " +
        "Please email Rajneesh with your payment ID and we will send " +
        "you a fresh link.",
        paymentIdHint
      );
    });
  })();
  