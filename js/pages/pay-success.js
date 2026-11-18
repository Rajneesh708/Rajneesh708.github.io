
/* ─────────────────────────────────────────────────────────────
   pay-success.html
   Reads URL parameters to know which product was paid for,
   and shows the right next-step instruction + button.

   Expected URL parameters from Razorpay redirect:
     ?product=cv-upgrade
     &razorpay_payment_id=...
     &razorpay_order_id=...

   This page now handles ONLY form-flow products (cv-upgrade and
   personality-profiling). Cal.com booking products (coaching +
   wellness) are routed through book.html instead, where a server-
   side token gate releases the Cal.com URL only to verified payers.

   See KNOWN-ISSUES.md (HIGH-1) for the security reasoning.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* Only the two FORM-flow products live here. The 10 Cal.com
     URLs that used to be in this file have been moved server-side
     into /api/redeem-booking-token, where they are only released
     after a signed booking-token from /api/verify-payment is
     redeemed. The browser never sees a Cal.com URL until the
     moment the redirect happens. */
  const PRODUCTS = {
    "cv-upgrade": {
      name: "CV Upgrade — ₹199",
      next: "Submit your CV link so we can begin your rewrite. " +
            "You'll receive your upgraded CV by email within 24 working hours.",
      cta: "Submit my CV",
      ctaUrl: "cv-upgrade-submit.html"
    },
    "personality-profiling": {
      name: "Personality Profiling — ₹9,999",
      next: "Submit the CV or LinkedIn URL of the person you want profiled. " +
            "Your written profile will be emailed within 1 working day.",
      cta: "Submit profile details",
      ctaUrl: "personality-profiling-submit.html"
    }
  };

  function getParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  }

  const productCode = getParam("product");
  const paymentId   = getParam("razorpay_payment_id");
  const orderId     = getParam("razorpay_order_id");

  const product = PRODUCTS[productCode];
  const productNameEl = document.getElementById("productName");
  const orderRefEl    = document.getElementById("orderRef");
  const nextTextEl    = document.getElementById("nextStepText");
  const ctaEl         = document.getElementById("nextStepCta");

  if (product) {
    // Scenario 1: known product → show per-product message
    productNameEl.textContent = product.name;
    nextTextEl.textContent    = product.next;
    ctaEl.textContent         = product.cta;
    ctaEl.href                = product.ctaUrl;
    ctaEl.style.display       = "inline-block";
  } else if (paymentId || orderId) {
    // Scenario 2: payment evidence present but product unknown.
    // Customer DID pay — show honest message and a pre-filled email to Rajneesh.
    productNameEl.textContent = "Your MECULS order";
    nextTextEl.textContent =
      "Your payment was received but we couldn't identify the product. " +
      "Please email Rajneesh with your payment ID (shown above) and the right link will follow within 24 hours.";
    const subject = "Help with my MECULS payment";
    const body = "Hi Rajneesh,\n\nI've just paid via Razorpay but the next step didn't load.\n"
               + (paymentId ? ("Payment ID: " + paymentId + "\n") : "")
               + (orderId   ? ("Order ID: "   + orderId   + "\n") : "")
               + "\nPlease send me the right next link.\n\nThanks.";
    ctaEl.textContent   = "Email Rajneesh";
    ctaEl.href          = "mailto:Jain.Rajneesh@meculs.com"
                        + "?subject=" + encodeURIComponent(subject)
                        + "&body="    + encodeURIComponent(body);
    ctaEl.style.display = "inline-block";
  } else {
    // Scenario 3: no product, no payment → page was reached directly (no real
    // Razorpay redirect). Send the visitor to the homepage. No misleading
    // "thank you" text is shown to anyone who did not actually pay.
    window.location.replace("index.html");
    return;
  }

  if (paymentId || orderId) {
    let ref = "";
    if (paymentId) ref += "Payment ID: " + paymentId;
    if (paymentId && orderId) ref += " · ";
    if (orderId) ref += "Order: " + orderId;
    orderRefEl.textContent = ref;
  }
})();
