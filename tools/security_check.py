#!/usr/bin/env python3
"""
MECULS website security check  (added 18 Nov 2026)

Keeps the site's Content-Security-Policy (CSP) correct. It checks every page:
  1. has exactly one CSP <meta>, identical to tools/csp-policy.txt, placed right after <meta charset>
  2. has no inline <script> code   (code must live in .js files - see js/README.txt)
  3. has no inline event attributes (onclick=, onload=, onerror=, ...)
  4. loads outside scripts only from the hosts allowed in the policy
  5. never loads the Supabase library from a CDN (it lives in vendor/)
and checks every .js file for inline event attributes inside HTML strings.

Usage (from the github.io folder):
  python3 tools/security_check.py           check only; exit code 1 if anything is wrong
  python3 tools/security_check.py --apply   rewrite the CSP <meta> on every page from
                                            tools/csp-policy.txt (use after editing the policy)
"""
import glob, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.chdir(ROOT)

SKIP_PAGES = ('CANONICAL-', 'email_template_')   # templates / email HTML, not web pages
POLICY = ' '.join(open(os.path.join(HERE, 'csp-policy.txt'), encoding='utf-8').read().split())
META = f'<meta http-equiv="Content-Security-Policy" content="{POLICY}">'

def script_hosts(policy):
    m = re.search(r"script-src ([^;]+)", policy)
    return [t for t in m.group(1).split() if t.startswith('https://')]

ALLOWED = script_hosts(POLICY)

def host_allowed(url):
    """True if a script URL is allowed by a script-src entry, using CSP's rules:
    https://*.example.com  -> any subdomain of example.com
    https://host           -> any path on that host
    https://host/path      -> that exact path (or anything under it if it ends with /)"""
    m = re.match(r'https://([^/?#]+)([^?#]*)', url)
    if not m:
        return False
    host, path = m.group(1), m.group(2) or '/'
    for a in ALLOWED:
        am = re.match(r'https://([^/]+)(/.*)?$', a)
        ahost, apath = am.group(1), am.group(2)
        if ahost.startswith('*.'):
            if not host.endswith(ahost[1:]):
                continue
        elif host != ahost:
            continue
        if apath is None or apath == '/' or path == apath or (apath.endswith('/') and path.startswith(apath)):
            return True
    return False

pages = sorted(f for f in glob.glob('*.html') if not f.startswith(SKIP_PAGES))
problems = []

if '--apply' in sys.argv:
    for f in pages:
        s = open(f, encoding='utf-8', newline='').read()
        new = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', META, s, count=1)
        if new != s:
            open(f, 'w', encoding='utf-8', newline='').write(new)
            print('updated', f)

for f in pages:
    s = open(f, encoding='utf-8').read()
    metas = re.findall(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', s)
    if len(metas) != 1:
        problems.append(f'{f}: has {len(metas)} CSP meta tags (needs exactly 1)')
    elif metas[0] != META:
        problems.append(f'{f}: CSP differs from tools/csp-policy.txt (run with --apply)')
    else:
        head = s.split(META)[0]
        if re.search(r'<script|<link[^>]+stylesheet', head, re.I):
            problems.append(f'{f}: CSP meta must come before any script or stylesheet')
    for body in re.findall(r'<script>(.*?)</script>', s, re.S):
        if body.strip():
            problems.append(f'{f}: inline <script> code found - move it into a .js file')
    for a, body in re.findall(r'<script\s([^>]*)>(.*?)</script>', s, re.S):
        if 'src=' not in a and body.strip() and 'application/ld+json' not in a and 'application/json' not in a:
            problems.append(f'{f}: inline <script {a.strip()}> code found - move it into a .js file')
    for m in re.findall(r'\s(on[a-z]+)="', s):
        problems.append(f'{f}: inline event attribute {m}="..." - use addEventListener in a .js file')
    if re.search(r'href="javascript:', s):
        problems.append(f'{f}: javascript: link found')
    for src in re.findall(r'<script[^>]+src="(https?://[^"]+)"', s):
        if not host_allowed(src):
            problems.append(f'{f}: outside script not allowed by the policy: {src}')
    if 'cdn.jsdelivr.net' in s:
        problems.append(f'{f}: loads from cdn.jsdelivr.net - use the copy in vendor/')

for f in sorted(glob.glob('*.js') + glob.glob('js/**/*.js', recursive=True)):
    s = open(f, encoding='utf-8', errors='ignore').read()
    code = re.sub(r'/\*.*?\*/', '', s, flags=re.S)          # ignore block comments
    code = re.sub(r'^\s*//.*$', '', code, flags=re.M)        # ignore line comments
    for m in re.finditer(r'\bon(click|load|error|input|change|submit|mouseover|mouseout|keyup|keydown|focus|blur)=\\?["\']', code):
        problems.append(f'{f}: inline event attribute on{m.group(1)}= inside HTML string')
    if re.search(r"['\"]https://cdn\.jsdelivr\.net", code):
        problems.append(f'{f}: loads from cdn.jsdelivr.net - use the copy in vendor/')

if problems:
    print('SECURITY CHECK FAILED - %d problem(s):' % len(problems))
    for p in problems:
        print('  -', p)
    sys.exit(1)
print(f'Security check passed: {len(pages)} pages, policy OK, no inline code.')
