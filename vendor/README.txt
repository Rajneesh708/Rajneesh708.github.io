VENDOR FILES - third-party code kept inside the website (not loaded from outside sites)
=====================================================================================

supabase-js-2.119.0.js
  What:     Supabase JavaScript library (login + database) - the browser "UMD" build.
  Version:  2.119.0 (exact; never changes by itself)
  Source:   official npm package @supabase/supabase-js@2.119.0, file dist/umd/supabase.js
            (the same file cdn.jsdelivr.net served for "supabase-js@2" on 18 Nov 2026)
  Licence:  MIT
  SHA-256:  a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce
  Added:    18 Nov 2026 - replaces https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 on 27 pages.
  Why:      a library loaded from an outside site can be swapped by attackers (the Nov 2026
            Optimizely attack hit 178 companies this way). A fixed copy here cannot change silently.

HOW TO UPDATE (only when there is a reason - security fix or a needed feature):
  1. Ask Claude to download the new version from npm and check it.
  2. Save it here as supabase-js-<version>.js and change the <script src> on all pages that use it.
  3. Update this file (version + SHA-256) and the Content-Security-Policy is unaffected (same site).
  4. Test login, registration and the CV Portal before pushing.
