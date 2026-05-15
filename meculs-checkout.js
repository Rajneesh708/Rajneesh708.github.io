/* ============================================================
   MECULS — meculs-checkout.js
   ------------------------------------------------------------
   The front-end half of the secure payment flow. Drop this on
   any page that has "Pay" buttons.

   How a button uses it — give the button these attributes:
     <button class="js-pay"
             data-product="cv-upgrade"
             data-next="cv-upgrade-submit.html">Pay & submit CV</button>

   What happens on click:
     1. Calls /api/create-order on Vercel → gets a real Razorpay
        order for the correct, server-decided price.
     2. Opens Razorpay Checkout (the proper popup, on this page).
     3. Customer pays.
     4. Razorpay hands back order id + payment id + signature.
     5. Calls /api/verify-payment → server checks the signature
        and that money was truly captured → returns an access
        token.
     6. Sends the customer to the "next" page with that token.
        The submit page checks the token before showing its form.

   Requires, loaded BEFORE this file:
     <script src="config.js"></script>
     <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
   ============================================================ */

(function () {
  "use strict";

  /* MECULS_API_BASE comes from config.js — the address of your
     Vercel deployment, e.g. "https://meculs-payment.vercel.app".
     No trailing slash. */
  if (typeof MECULS_API_BASE === "undefined" || !MECULS_API_BASE) {
    console.error("meculs-checkout: MECULS_API_BASE is not set in config.js");
    return;
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.dataset._label = btn.textContent;
      btn.textContent = "Opening payment\u2026";
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.cursor = "not-allowed";
    } else {
      if (btn.dataset._label) btn.textContent = btn.dataset._label;
      btn.disabled = false;
      btn.style.opacity = "";
      btn.style.cursor = "";
    }
  }

  function fail(btn, message) {
    setBusy(btn, false);
    /* A plain, honest failure message. Keeps the customer informed
       and points them to a human if something is wrong. */
    alert(
      (message || "Payment could not be started.") +
      "\n\nIf this keeps happening, please email Jain.Rajneesh@meculs.com " +
      "and we will help you complete your order."
    );
  }

  async function startPayment(btn) {
    var product = btn.getAttribute("data-product");
    var nextPage = btn.getAttribute("data-next");

    if (!product || !nextPage) {
      console.error("meculs-checkout: button missing data-product or data-next", btn);
      fail(btn, "This payment button is not set up correctly.");
      return;
    }

    setBusy(btn, true);

    /* ---- Step 1: ask the server to create the order ---- */
    var orderInfo;
    try {
      var orderRes = await fetch(MECULS_API_BASE + "/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: product })
      });
      orderInfo = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderInfo.error || "create-order failed");
    } catch (err) {
      console.error("meculs-checkout: create-order error", err);
      fail(btn, "Could not start the payment.");
      return;
    }

    /* ---- Step 2: open Razorpay Checkout ---- */
    var options = {
      key:      orderInfo.key_id,
      amount:   orderInfo.amount,
      currency: orderInfo.currency,
      order_id: orderInfo.order_id,
      name:     "MECULS",
      description: orderInfo.label,

      /* ---- Step 3-5: Razorpay calls this when payment succeeds ---- */
      handler: async function (response) {
        /* Show the customer something is happening while we verify. */
        setBusy(btn, true);
        btn.textContent = "Verifying payment\u2026";

        try {
          var verifyRes = await fetch(MECULS_API_BASE + "/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature
            })
          });
          var verifyData = await verifyRes.json();

          if (!verifyRes.ok || !verifyData.verified) {
            throw new Error(verifyData.error || "verification failed");
          }

          /* ---- Step 6: go to the next page ----
             sessionStorage carries the access token (used by the
             gated submit pages). URL params carry the product +
             payment id (used by pay-success.html, which reads them
             via URLSearchParams). Both mechanisms in parallel —
             belt and braces. */
          try {
            sessionStorage.setItem("meculs_access_token", verifyData.access_token);
            sessionStorage.setItem("meculs_payment_id", verifyData.payment_id);
            sessionStorage.setItem("meculs_product", verifyData.product);
          } catch (e) {
            /* sessionStorage blocked — URL params will still work
               for pay-success; gated pages have a URL fallback too. */
          }
          /* Build the destination URL. If nextPage already has a
             query string, append with &; otherwise start with ?. */
          var sep = nextPage.indexOf("?") === -1 ? "?" : "&";
          var dest = nextPage + sep +
            "product=" + encodeURIComponent(verifyData.product) +
            "&razorpay_payment_id=" + encodeURIComponent(verifyData.payment_id) +
            "&razorpay_order_id=" + encodeURIComponent(response.razorpay_order_id);
          window.location.href = dest;
        } catch (err) {
          console.error("meculs-checkout: verify error", err);
          /* Payment likely DID go through but verification failed —
             this is important, so the message is specific. */
          setBusy(btn, false);
          alert(
            "Your payment may have gone through, but we could not " +
            "confirm it automatically.\n\nPlease do NOT pay again. " +
            "Email Jain.Rajneesh@meculs.com with your payment id:\n" +
            (response.razorpay_payment_id || "(not available)") +
            "\n\nand we will complete your order manually."
          );
        }
      },

      modal: {
        /* Customer closed the popup without paying — just reset. */
        ondismiss: function () {
          setBusy(btn, false);
        }
      },

      theme: { color: "#1c2128" }
    };

    try {
      var rzp = new Razorpay(options);
      rzp.on("payment.failed", function (resp) {
        console.warn("meculs-checkout: payment.failed", resp && resp.error);
        setBusy(btn, false);
        alert(
          "The payment did not go through" +
          (resp && resp.error && resp.error.description
            ? ": " + resp.error.description : ".") +
          "\n\nNo money has been deducted. You can try again."
        );
      });
      rzp.open();
    } catch (err) {
      console.error("meculs-checkout: could not open Razorpay", err);
      fail(btn, "Could not open the payment window.");
    }
  }

  /* Wire every .js-pay button on the page. */
  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll(".js-pay");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (e) {
        e.preventDefault();
        startPayment(e.currentTarget);
      });
    }
  });
})();
