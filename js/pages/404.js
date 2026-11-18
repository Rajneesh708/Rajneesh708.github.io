
  (function () {
    /* Match /p/<slug> where slug = letters/digits/dashes (1+ chars).
       Case-insensitive on the /p/ prefix; slug is lowercased before
       redirect to match how slugs are stored in the database. */
    var m = window.location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]*)\/?$/i);
    if (m && m[1]) {
      var slug = m[1].toLowerCase();
      /* replace() so the back button skips this 404 entry */
      window.location.replace("/p.html?slug=" + encodeURIComponent(slug));
    }
  })();
  