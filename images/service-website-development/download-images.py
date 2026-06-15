"""
MECULS — Download images for service-website-development.html
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
        "filename": "swd-hero.jpg",
        "url": "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1600&q=82&auto=format&fit=crop",
        "desc": "Hero — dark code terminal (Unsplash / Sai Kiran Anagani)"
    },
    {
        "filename": "swd-craft.jpg",
        "url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&q=82&auto=format&fit=crop",
        "desc": "Craft section — developer at work (Unsplash / Tyler Franta)"
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
