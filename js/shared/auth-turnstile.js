
  (function () {
    var w = document.getElementById("turnstileWidget");
    if (w && typeof TURNSTILE_SITE_KEY !== "undefined") {
      w.setAttribute("data-sitekey", TURNSTILE_SITE_KEY);
    }
  })();
