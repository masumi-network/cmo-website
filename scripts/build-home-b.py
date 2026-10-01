#!/usr/bin/env python3
"""Generate home-b/index.html from index.html.

home-b is the same page as the main index with two differences:
  1) asset/script paths are absolute (it is served from /home-b/)
  2) the hero is the centered variant (mascot below the headline + paragraph)

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

# 2) centered hero variant
old_hero = '''    <section class="hero">
      <div class="hero__text">
        <span class="pill">Meet Cuso, your AI CMO</span>
        <h1>Marketing, on autopilot.</h1>
        <p class="lead">
          Cuso is the only marketing hire you need. He learns your brand, builds
          the strategy, and runs it end to end. Social, ads, SEO, and newsletter,
          in one system.
        </p>
        <form class="waitlist" id="waitlist" data-waitlist novalidate>
          <input class="waitlist__input" type="email" name="email" required
                 placeholder="Enter your email" aria-label="Email address" />
          <button class="btn btn--lg" type="submit">Join the waitlist</button>
        </form>
        <p class="waitlist__msg" data-waitlist-msg role="status" aria-live="polite"></p>
        <p class="hero__meta">Be first in line when Cuso opens up.</p>
      </div>
      <div class="hero__visual">
        <div class="orb" aria-hidden="true"></div>
        <img src="/assets/mascot-hero.png" alt="The CMO.XYZ agent, waving"
             width="400" height="525" fetchpriority="high" decoding="async" />
      </div>
    </section>'''

new_hero = '''    <section class="hero hero--center">
      <div class="hero__text">
        <span class="pill">Meet Cuso, your AI CMO</span>
        <h1>Marketing, on autopilot.</h1>
        <p class="lead">
          Cuso is the only marketing hire you need. He learns your brand, builds
          the strategy, and runs it end to end. Social, ads, SEO, and newsletter,
          in one system.
        </p>
      </div>
      <div class="hero__visual">
        <div class="orb" aria-hidden="true"></div>
        <img src="/assets/mascot-hero.png" alt="The CMO.XYZ agent, waving"
             width="400" height="525" fetchpriority="high" decoding="async" />
      </div>
      <form class="waitlist waitlist--center" id="waitlist" data-waitlist novalidate>
        <input class="waitlist__input" type="email" name="email" required
               placeholder="Enter your email" aria-label="Email address" />
        <button class="btn btn--lg" type="submit">Join the waitlist</button>
      </form>
      <p class="waitlist__msg" data-waitlist-msg role="status" aria-live="polite"></p>
      <p class="hero__meta">Be first in line when Cuso opens up.</p>
    </section>'''

assert old_hero in src, "hero block not found; index.html hero markup changed"
src = src.replace(old_hero, new_hero)

(root / "home-b").mkdir(exist_ok=True)
(root / "home-b" / "index.html").write_text(src)
print("home-b/index.html generated")
