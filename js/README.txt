PAGE SCRIPTS  (18 Nov 2026)
===========================

The site has a strict Content-Security-Policy (see tools/csp-policy.txt). Browsers
therefore REFUSE to run JavaScript written directly inside an .html page:
  - no <script> ... code ... </script> blocks in pages
  - no onclick="..." / onload="..." / onerror="..." / onmouseover="..." attributes
A page that has them will look fine in the code but that code will silently not run
on the live site. tools/security_check.py (and the GitHub "Security Check") catches it.

Where page code lives now:
  js/pages/<page-name>.js   code used by one page (moved unchanged from that page)
                            <page-name>-2.js etc. if the page had more than one block
  js/shared/*.js            identical code that several pages use:
      blog.js               the 5 blog pages (share, subscribe, copy link ...)
      founders-reveal.js    about-rajneesh-jain, about-sneha-hasrajani, the-founders
      auth-turnstile.js     login, register
      reveal-1/2/3.js       scroll-reveal animation shared by groups of service pages
  js/img-fallback.js        hides an image (and shows a text fallback) if it fails to load;
                            use <img ... data-fallback="hide | next-inline | #elementId">

To change a page's behaviour: edit its file in js/pages/ (or js/shared/ - remember
that one is used by several pages). To add code to a page: create a .js file and add
<script src="js/pages/<page-name>.js"></script> where the code should run.

404.html uses paths starting with "/" (e.g. /js/pages/404.js) because GitHub shows
it at deeper addresses such as /p/<name>, where a relative path would break.

To allow a new outside service (a new script, font, image host or API):
  1. edit tools/csp-policy.txt
  2. run:  python3 tools/security_check.py --apply
  3. test the page in a browser and check the Console for "Content Security Policy" errors.
