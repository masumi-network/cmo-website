#!/usr/bin/env python3
"""Generate home-b/index.html from index.html.

home-b is the same page as the main index with two differences:
  1) asset/script paths are absolute (it is served from /home-b/)
  2) the hero uses the centered variant (.hero--center): text + waitlist
     centered, with the mascot below.

Run this after editing index.html so the variant stays in sync:
    python3 scripts/build-home-b.py
"""
import re
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "index.html").read_text()

# 1) absolute paths so the page works when served from /home-b/
src = re.sub(r'"(styles\.css|script\.js)"', r'"/\1"', src)
src = src.replace('"assets/', '"/assets/').replace('"vendor/', '"/vendor/')

# 2) centered hero variant (just add the modifier class)
assert '<section class="hero">' in src, "hero section not found in index.html"
src = src.replace('<section class="hero">', '<section class="hero hero--center">', 1)

(root / "home-b").mkdir(exist_ok=True)
(root / "home-b" / "index.html").write_text(src)
print("home-b/index.html generated")
