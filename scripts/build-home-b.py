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
        <span class="pill">AI marketing agent</span>
        <h1>Marketing, on autopilot.</h1>
        <p class="lead">
          CMO.XYZ is one agent that runs your marketing end to end. Not a chatbot
          you prompt. Not a stack of separate tools. Give it your domain and it
          builds and runs the strategy.
        </p>
        <div class="hero__cta">
          <a class="btn btn--lg" href="#start">Get started</a>
          <a class="btn btn--ghost btn--lg" href="#work">See it work</a>
        </div>
        <p class="hero__meta">Built on your data. Every move ties to what it knows.</p>
      </div>
      <div class="hero__visual">
        <div class="orb" aria-hidden="true"></div>
        <img src="/assets/mascot-hero.png" alt="The CMO.XYZ agent, waving"
             width="400" height="525" fetchpriority="high" decoding="async" />
      </div>
    </section>'''

new_hero = '''    <section class="hero hero--center">
      <div class="hero__text">
        <span class="pill">AI marketing agent</span>
        <h1>Marketing, on autopilot.</h1>
        <p class="lead">
          CMO.XYZ is one agent that runs your marketing end to end. Not a chatbot
          you prompt. Not a stack of separate tools. Give it your domain and it
          builds and runs the strategy.
        </p>
      </div>
      <div class="hero__visual">
        <div class="orb" aria-hidden="true"></div>
        <img src="/assets/mascot-hero.png" alt="The CMO.XYZ agent, waving"
             width="400" height="525" fetchpriority="high" decoding="async" />
      </div>
      <div class="hero__cta">
        <a class="btn btn--lg" href="#start">Get started</a>
        <a class="btn btn--ghost btn--lg" href="#work">See it work</a>
      </div>
      <p class="hero__meta">Built on your data. Every move ties to what it knows.</p>
    </section>'''

assert old_hero in src, "hero block not found; index.html hero markup changed"
src = src.replace(old_hero, new_hero)

(root / "home-b").mkdir(exist_ok=True)
(root / "home-b" / "index.html").write_text(src)
print("home-b/index.html generated")
