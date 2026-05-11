# =============================================================================
# MECULS canonical fix - run from the GITHUB.IO folder
# =============================================================================
# What this does, in order:
#   1. Backs up every .html file to a folder named _backup_canonical_YYYYMMDD
#   2. Rewrites the canonical tag on every page to non-www version pointing to itself
#   3. Replaces ALL https://www.meculs.com occurrences with https://meculs.com
#      (this fixes the og:url, twitter URLs, JSON-LD, etc.)
#   4. Leaves internal <a href> links untouched because they're already non-www
#
# Run in PowerShell from inside the GITHUB.IO folder:
#   PS> .\fix-canonical.ps1
#
# After it runs, replace your sitemap.xml and robots.txt with the new ones,
# commit, push, then go to Search Console -> Sitemaps -> resubmit sitemap.xml
# and use URL Inspection -> Request Indexing on the homepage.
# =============================================================================

$ErrorActionPreference = "Stop"
$folder = Get-Location
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $folder "_backup_canonical_$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null

Write-Host ""
Write-Host "Backup folder: $backup" -ForegroundColor Cyan
Write-Host ""

$files = Get-ChildItem -Path $folder -Filter *.html -File
$total = $files.Count
$changed = 0

foreach ($file in $files) {
    Copy-Item $file.FullName -Destination (Join-Path $backup $file.Name)

    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $original = $content

    # ---- Fix 1: replace www.meculs.com with meculs.com everywhere ----
    # This covers canonical, og:url, twitter:url, JSON-LD, scripts, etc.
    $content = $content -replace 'https://www\.meculs\.com', 'https://meculs.com'
    $content = $content -replace 'http://www\.meculs\.com',  'https://meculs.com'
    $content = $content -replace 'http://meculs\.com',       'https://meculs.com'

    # ---- Fix 2: ensure a canonical tag exists and points to THIS page ----
    # The canonical for each page must be the page's own non-www URL.
    $pageUrl = "https://meculs.com/" + $file.Name
    if ($file.Name -eq "index.html") { $pageUrl = "https://meculs.com/" }

    if ($content -match '<link\s+rel="canonical"[^>]*>') {
        $content = $content -replace '<link\s+rel="canonical"[^>]*>', "<link rel=`"canonical`" href=`"$pageUrl`">"
    } else {
        # No canonical found - inject one right after <head>
        $content = $content -replace '(<head[^>]*>)', "`$1`n  <link rel=`"canonical`" href=`"$pageUrl`">"
    }

    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -Encoding UTF8 -NoNewline
        $changed++
        Write-Host "FIXED:  $($file.Name)" -ForegroundColor Green
    } else {
        Write-Host "OK:     $($file.Name)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host "Done. $changed of $total HTML files updated." -ForegroundColor Yellow
Write-Host "Backups saved in: $backup" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "NEXT STEPS:"
Write-Host "  1. Replace sitemap.xml with the new version (non-www URLs)"
Write-Host "  2. Replace robots.txt with the new version"
Write-Host "  3. git add -A; git commit -m 'fix: unify on non-www canonical'; git push"
Write-Host "  4. Wait 5 minutes for GitHub Pages to deploy"
Write-Host "  5. In Search Console: Sitemaps -> remove old, resubmit sitemap.xml"
Write-Host "  6. URL Inspection -> paste homepage -> Request Indexing"
Write-Host ""
