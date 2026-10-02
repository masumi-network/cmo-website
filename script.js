// CMO.XYZ — interactions + motion.
// Mobile nav, Lenis smooth scroll, and GSAP/ScrollTrigger entrance
// animations. Signature touch: the mascot (which IS a cursor) tracks the
// real pointer. All motion is guarded by prefers-reduced-motion, and the
// site is fully usable if the animation libraries fail to load.
// Nothing hardcodes an agent name (per DESIGN.md).

// ---- 3D mascot: dismiss poster on load + respect reduced motion ----
(function () {
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("model-viewer").forEach(function (mv) {
    if (reduced) mv.removeAttribute("auto-rotate");
    // As soon as the 3D is ready, reveal it so the poster image never lingers.
    var reveal = function () { try { mv.dismissPoster(); } catch (e) {} };
    if (mv.loaded) reveal();
    else mv.addEventListener("load", reveal, { once: true });
  });
})();

// ---- Waitlist capture (self-contained) ----
// Set window.WAITLIST_ENDPOINT (or data-endpoint on the form) to POST emails
// to a real backend (Formspree/Vercel/etc.). With no endpoint it validates
// and shows a success state only (demo); it does not deliver anywhere.
(function () {
  var forms = [].slice.call(document.querySelectorAll("[data-waitlist]"));
  if (!forms.length) return;
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  forms.forEach(function (form) {
    var input = form.querySelector('input[type="email"]');
    var msg = form.parentNode.querySelector("[data-waitlist-msg]");
    function setMsg(text, kind) {
      if (!msg) return;
      msg.textContent = text;
      msg.classList.remove("is-ok", "is-err");
      if (kind) msg.classList.add(kind);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (input.value || "").trim();
      if (!re.test(email)) {
        input.setAttribute("aria-invalid", "true");
        setMsg("Please enter a valid email.", "is-err");
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      var endpoint = form.getAttribute("data-endpoint") || window.WAITLIST_ENDPOINT;
      function ok() {
        form.reset();
        setMsg("You're on the list. We'll be in touch.", "is-ok");
      }
      if (!endpoint) { ok(); return; } // demo mode, no backend wired
      setMsg("Adding you...", null);
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) { if (r.ok) ok(); else setMsg("Something went wrong. Try again.", "is-err"); })
        .catch(function () { setMsg("Something went wrong. Try again.", "is-err"); });
    });
  });
})();

// ---- Theme toggle (self-contained; independent of the animation libs) ----
(function () {
  var root = document.documentElement;
  var toggles = [].slice.call(document.querySelectorAll("[data-theme-toggle]"));

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function sync() {
    var t = currentTheme();
    toggles.forEach(function (b) {
      b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
      b.setAttribute("aria-pressed", String(t === "dark"));
      var label = b.querySelector(".theme-toggle__label");
      if (label) label.textContent = t === "dark" ? "Dark" : "Light";
    });
    // Keep the browser UI bar color in step with the active theme.
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", t === "dark" ? "#0a0b0e" : "#f4f6f7");
  }
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
    sync();
  }
  toggles.forEach(function (b) {
    b.addEventListener("click", function () {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  });
  // Keep following the system live until the visitor makes a manual choice.
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      var saved;
      try { saved = localStorage.getItem("theme"); } catch (_) {}
      if (!saved) { root.setAttribute("data-theme", e.matches ? "dark" : "light"); sync(); }
    });
  }
  sync();
})();

(function () {
  "use strict";
  var root = document.documentElement;

  // ---- Mobile nav ----
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav__toggle");
  if (nav && toggle) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  var reduced =
    window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // No-animation path: guarantee everything is visible, then stop.
  if (reduced || !window.gsap) {
    root.classList.remove("has-anim");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // ---- Smooth scroll (Lenis) driven by the GSAP ticker ----
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // Smooth in-page navigation.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (nav) nav.classList.remove("is-open");
      if (lenis) lenis.scrollTo(target, { offset: -70 });
      else target.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ---- Intro: hold the splash until the 3D mascot is ready, then reveal
  //      the hero with the 3D already showing (never the flat image). ----
  var loaderEl = document.getElementById("loader");
  var model = document.querySelector(".hero__visual model-viewer");
  var visual = document.querySelector(".hero__visual");

  function startMascotMotion() {
    gsap.to(".hero .orb", { scale: 1.08, opacity: 0.85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true });
    if (!model) return;

    // Gentle vertical float (idle bob) on top of the baked animation.
    gsap.to(model, { y: 10, duration: 2.8, ease: "sine.inOut", repeat: -1, yoyo: true });

    // Subtle pointer-follow for depth; baked clips lead the motion.
    model.removeAttribute("auto-rotate");
    model.removeAttribute("camera-controls");
    model.setAttribute("interpolation-decay", "0");
    var fine = matchMedia("(pointer:fine)").matches;
    var tTheta = 0, tPhi = 82, cTheta = 0, cPhi = 82, start = performance.now();
    if (fine) {
      window.addEventListener("pointermove", function (e) {
        var dx = e.clientX / window.innerWidth - 0.5;
        var dy = e.clientY / window.innerHeight - 0.5;
        tTheta = dx * 28; tPhi = 82 - dy * 10;
      });
    }
    (function loop(now) {
      var idle = Math.sin((now - start) / 1700) * 5;
      cTheta += (tTheta + idle - cTheta) * 0.06;
      cPhi += (tPhi - cPhi) * 0.06;
      model.setAttribute("camera-orbit", cTheta.toFixed(2) + "deg " + cPhi.toFixed(2) + "deg 115%");
      requestAnimationFrame(loop);
    })(performance.now());

    setupClips();
  }

  // Play baked clips: wave "Hello" once, then loop "Idle"; "Hop" on hover.
  function setupClips() {
    if (!model) return;
    var go = function () {
      var clips = model.availableAnimations || [];
      if (!clips.length) return;
      var has = function (n) { return clips.indexOf(n) !== -1; };
      var toIdle = function () { if (has("Idle")) { model.animationName = "Idle"; model.play(); } };
      var once = function (name, then) {
        model.animationName = name;
        model.play({ repetitions: 1 });
        var fin = function () { model.removeEventListener("finished", fin); then(); };
        model.addEventListener("finished", fin);
      };
      if (has("Hello")) once("Hello", toIdle); else toIdle();
      var busy = false;
      model.addEventListener("mouseenter", function () {
        if (busy || !has("Hop")) return;
        busy = true;
        once("Hop", function () { busy = false; toIdle(); });
      });
    };
    if (model.loaded) go(); else model.addEventListener("load", go, { once: true });
  }

  function revealHero() {
    var tl = gsap
      .timeline({ defaults: { ease: "power3.out", duration: 0.9 } })
      .from(".nav", { y: -18, autoAlpha: 0, duration: 0.7 })
      .from(".hero .pill", { y: 18, autoAlpha: 0, duration: 0.6 }, "-=0.2")
      .from(".hero h1", { y: 30, autoAlpha: 0 }, "-=0.35")
      .from(".hero .lead", { y: 22, autoAlpha: 0 }, "-=0.6")
      .from(".hero .waitlist", { y: 20, autoAlpha: 0 }, "-=0.65")
      .from(".hero__meta", { y: 16, autoAlpha: 0 }, "-=0.7");
    if (model)
      tl.from(model, { scale: 0.6, y: 60, rotationZ: -8, autoAlpha: 0, duration: 1.1, ease: "back.out(1.6)" }, "-=1.1");
    tl.add(startMascotMotion, "-=0.3");
  }

  var introDone = false;
  function finishIntro() {
    if (introDone) return;
    introDone = true;
    root.classList.remove("has-anim");
    if (visual) gsap.set(visual, { clearProps: "opacity,visibility" });
    if (loaderEl) gsap.to(loaderEl, { autoAlpha: 0, duration: 0.45, onComplete: function () { loaderEl.style.display = "none"; } });
    revealHero();
  }

  var introRan = false;
  function runIntro() {
    if (introRan) return;
    introRan = true;
    if (!model || model.loaded) { finishIntro(); return; }
    var done = false;
    model.addEventListener("load", function () { if (done) return; done = true; finishIntro(); }, { once: true });
    // Safety: if the model is slow, reveal anyway (it will pop in when ready).
    setTimeout(function () { if (done) return; done = true; finishIntro(); }, 3500);
  }

  // Hold a short minimum splash, then run once the page is loaded.
  var introStart = Date.now();
  function kickIntro() { setTimeout(runIntro, Math.max(0, 500 - (Date.now() - introStart))); }
  if (document.readyState === "complete") kickIntro();
  else window.addEventListener("load", kickIntro);
  setTimeout(finishIntro, 6000); // absolute safety: never hang the splash

  // ---- Cursor companion: the mascot trails the real pointer ----
  var pet = document.querySelector(".cursor-pet");
  if (pet && matchMedia("(pointer:fine)").matches) {
    gsap.set(pet, { xPercent: -50, yPercent: -50 });
    var petX = gsap.quickTo(pet, "x", { duration: 0.5, ease: "power3.out" });
    var petY = gsap.quickTo(pet, "y", { duration: 0.5, ease: "power3.out" });
    var petR = gsap.quickTo(pet, "rotation", { duration: 0.4, ease: "power2.out" });
    var prevX = null, shown = false;
    window.addEventListener("pointermove", function (e) {
      petX(e.clientX);
      petY(e.clientY);
      if (prevX !== null) {
        var lean = (e.clientX - prevX) * 1.4;
        petR(Math.max(-20, Math.min(20, lean)));
      }
      prevX = e.clientX;
      if (!shown) {
        shown = true;
        gsap.to(pet, { autoAlpha: 1, duration: 0.4 });
      }
    });
    // Grow when hovering interactive things.
    document.querySelectorAll("a, button, .avatars li, .feat").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        gsap.to(pet, { scale: 1.6, duration: 0.3, ease: "back.out(2)" });
      });
      el.addEventListener("mouseleave", function () {
        gsap.to(pet, { scale: 1, duration: 0.3, ease: "power2.out" });
      });
    });
  }

  // ---- Section heads ----
  gsap.utils.toArray(".section__head").forEach(function (el) {
    gsap.from(el.children, {
      y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 82%" },
    });
  });

  // ---- Channels ----
  gsap.from(".channels-sec__label", {
    y: 10, autoAlpha: 0, duration: 0.6,
    scrollTrigger: { trigger: ".channels-sec", start: "top 88%" },
  });
  gsap.from(".channel", {
    y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.06, ease: "power3.out",
    scrollTrigger: { trigger: ".channels-sec", start: "top 86%" },
  });

  // ---- Chat mockup: messages arrive in sequence ----
  gsap
    .timeline({ scrollTrigger: { trigger: ".chat", start: "top 74%" } })
    .from(".chat", { y: 34, autoAlpha: 0, duration: 0.8, ease: "power3.out" })
    .from(".chat__input", { y: 12, autoAlpha: 0, duration: 0.5 }, "-=0.3");

  // ---- Statement ----
  gsap.from(".statement .eyebrow, .statement__grid > *", {
    y: 24, autoAlpha: 0, duration: 0.8, stagger: 0.08, ease: "power3.out",
    scrollTrigger: { trigger: ".statement", start: "top 85%" },
  });

  // ---- Capabilities tabs reveal ----
  gsap.from(".tabs__list .tab", {
    y: 18, autoAlpha: 0, duration: 0.6, stagger: 0.07, ease: "power3.out",
    scrollTrigger: { trigger: ".tabs", start: "top 84%" },
  });
  gsap.from(".tabs__panels", {
    y: 24, autoAlpha: 0, duration: 0.8, ease: "power3.out",
    scrollTrigger: { trigger: ".tabs", start: "top 84%" },
  });

  // ---- Steps ----
  gsap.from(".step", {
    y: 28, autoAlpha: 0, duration: 0.7, stagger: 0.14, ease: "power3.out",
    scrollTrigger: { trigger: ".steps", start: "top 82%" },
  });
  gsap.from(".step__icon", {
    scale: 0.6, autoAlpha: 0, duration: 0.5, stagger: 0.14, ease: "back.out(2)",
    scrollTrigger: { trigger: ".steps", start: "top 82%" },
  });

  // ---- Your agent ----
  gsap.from(".split__text > *", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".section--split", start: "top 80%" },
  });
  gsap.from(".avatars li", {
    y: 22, scale: 0.9, autoAlpha: 0, duration: 0.6, stagger: 0.08, ease: "back.out(1.5)",
    scrollTrigger: { trigger: ".avatars", start: "top 85%" },
  });

  // ---- Who ----
  gsap.from(".who > div", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".who", start: "top 84%" },
  });

  // ---- CTA ----
  gsap.from(".cta__art", {
    scale: 0.8, autoAlpha: 0, duration: 0.8, ease: "back.out(1.5)",
    scrollTrigger: { trigger: ".cta", start: "top 80%" },
  });
  gsap.from(".cta h2, .cta p, .cta .btn", {
    y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.1,
    scrollTrigger: { trigger: ".cta", start: "top 78%" },
  });
  gsap.to(".cta .orb--sm", { scale: 1.1, opacity: 0.85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true });

  // Recalculate once fonts and images have settled.
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();

// ---- Loading splash fallback (reduced motion or no GSAP): simple fade ----
(function () {
  var loader = document.getElementById("loader");
  if (!loader) return;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && window.gsap) return; // the animated intro (in the main block) handles it
  var start = Date.now();
  function done() {
    loader.classList.add("is-done");
    setTimeout(function () { loader.style.display = "none"; }, 600);
  }
  if (document.readyState === "complete") setTimeout(done, 400);
  else window.addEventListener("load", function () { setTimeout(done, Math.max(0, 700 - (Date.now() - start))); });
  setTimeout(done, 4000);
})();

// ---- Chat player: live-texting feel, the mascot "solving" ----
(function () {
  var body = document.querySelector("[data-chat]");
  if (!body) return;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return; // leave static for reduced motion
  if (!window.gsap) return; // needs GSAP for smooth playback
  var msgs = [].slice.call(body.querySelectorAll(".msg"));
  gsap.set(msgs, { display: "none" });
  var played = false;

  function typingBubble(src) {
    var w = document.createElement("div");
    w.className = "msg msg--agent msg--typing";
    w.innerHTML = '<img src="' + src + '" alt="" /><p class="typing"><span></span><span></span><span></span></p>';
    return w;
  }
  function reveal(el) {
    body.appendChild(el);
    gsap.fromTo(el, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" });
  }
  function play() {
    if (played) return;
    played = true;
    var i = 0;
    (function step() {
      if (i >= msgs.length) return;
      var m = msgs[i];
      if (m.classList.contains("msg--agent")) {
        var img = m.querySelector("img");
        var t = typingBubble(img ? img.getAttribute("src") : "");
        reveal(t);
        gsap.delayedCall(parseInt(m.getAttribute("data-typing") || "1200", 10) / 1000, function () {
          gsap.to(t, {
            autoAlpha: 0, duration: 0.25,
            onComplete: function () {
              if (t.parentNode) t.parentNode.removeChild(t);
              m.style.display = "";
              reveal(m);
              i++;
              gsap.delayedCall(0.5, step);
            },
          });
        });
      } else {
        m.style.display = "";
        reveal(m);
        i++;
        gsap.delayedCall(0.75, step);
      }
    })();
  }
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) play(); });
  }, { threshold: 0.35 }).observe(body);
})();

// ---- Capabilities tabs (self-contained; works even without GSAP) ----
(function () {
  var root = document.querySelector(".tabs");
  if (!root) return;
  var tabs = [].slice.call(root.querySelectorAll(".tab"));
  var panels = [].slice.call(root.querySelectorAll(".panel"));
  if (!tabs.length) return;

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DURATION = 5200;
  var current = 0, timer = null, barTween = null;

  function resetBars() {
    if (barTween) { barTween.kill(); barTween = null; }
    tabs.forEach(function (t) {
      var b = t.querySelector(".tab__bar");
      if (!b) return;
      if (window.gsap) gsap.set(b, { scaleX: 0 });
      else b.style.transform = "scaleX(0)";
    });
  }

  function runBar() {
    if (reduced || !window.gsap) return;
    var bar = tabs[current].querySelector(".tab__bar");
    if (bar) barTween = gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: DURATION / 1000, ease: "none" });
  }

  function activate(i) {
    current = i;
    tabs.forEach(function (t, idx) {
      var on = idx === i;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (p, idx) {
      var on = idx === i;
      p.classList.toggle("is-active", on);
      p.hidden = !on;
    });
    resetBars();
  }

  function next() { activate((current + 1) % tabs.length); runBar(); }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (barTween) barTween.pause();
  }
  function start() {
    if (reduced) return;
    stop();
    runBar();
    timer = setInterval(next, DURATION);
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { activate(i); start(); });
    t.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowDown" || k === "ArrowRight") {
        e.preventDefault(); activate((i + 1) % tabs.length); tabs[current].focus(); start();
      } else if (k === "ArrowUp" || k === "ArrowLeft") {
        e.preventDefault(); activate((i - 1 + tabs.length) % tabs.length); tabs[current].focus(); start();
      }
    });
  });

  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);

  activate(0);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
    }, { threshold: 0.3 }).observe(root);
  } else {
    start();
  }
})();
