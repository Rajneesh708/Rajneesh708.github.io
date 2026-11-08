"""
MECULS — Download images for website-enquiry.html
Run this script once from any Python 3 environment.
It downloads 2 free Unsplash images and saves them to this folder.

Usage:
  python download-images.py

Requires: Python 3 standard library only (urllib is built-in).
"""

import urllib.request
import os

FOLDER = os.path.dirname(os.path.abspath(__file__))

IMAGES = [
    {
        "filename": "we-hero.jpg",
        "url": "https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=1600&q=82&auto=format&fit=crop",
        "desc": "Hero — hand sketching a website wireframe (Unsplash)"
    },
    {
        "filename": "we-form.jpg",
        "url": "https://images.unsplash.com/photo-1600132806608-231446b2e7af?w=700&h=1100&q=82&auto=format&fit=crop",
        "desc": "Form rail — wireframe plan sheet from above (Unsplash)"
    },
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

for img in IMAGES:
    dest = os.path.join(FOLDER, img["filename"])
    print(f"Downloading: {img['desc']}")
    req = urllib.request.Request(img["url"], headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        with open(dest, "wb") as f:
            f.write(data)
        size_kb = len(data) // 1024
        print(f"  Saved: {img['filename']} ({size_kb} KB)")
    except Exception as e:
        print(f"  FAILED: {e}")

print("\nDone. Refresh the page in your browser to see the images.")
