// CMO.XYZ — interactions + motion.
// Mobile nav, Lenis smooth scroll, and GSAP/ScrollTrigger entrance
// animations. Signature touch: the mascot (which IS a cursor) tracks the
// real pointer. All motion is guarded by prefers-reduced-motion, and the
// site is fully usable if the animation libraries fail to load.
// Nothing hardcodes an agent name (per DESIGN.md).

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

  // Hand the hero start-states to GSAP (stops the CSS pre-hide).
  root.classList.remove("has-anim");

  // ---- Hero entrance ----
  gsap
    .timeline({ defaults: { ease: "power3.out", duration: 0.9 } })
    .from(".nav", { y: -18, autoAlpha: 0, duration: 0.7 })
    .from(".hero .pill", { y: 18, autoAlpha: 0, duration: 0.6 }, "-=0.2")
    .from(".hero h1", { y: 30, autoAlpha: 0 }, "-=0.35")
    .from(".hero .lead", { y: 22, autoAlpha: 0 }, "-=0.6")
    .from(".hero__cta", { y: 20, autoAlpha: 0 }, "-=0.65")
    .from(".hero__meta", { y: 16, autoAlpha: 0 }, "-=0.7")
    .from(".hero__visual", { scale: 0.9, autoAlpha: 0, duration: 1.1, ease: "power2.out" }, "-=0.95");

  // ---- Mascot: idle float, glow pulse, pointer tracking ----
  var mascot = document.querySelector(".hero__visual img");
  var visual = document.querySelector(".hero__visual");
  if (mascot) {
    gsap.to(mascot, { y: 14, duration: 2.6, ease: "sine.inOut", repeat: -1, yoyo: true });
  }
  gsap.to(".hero .orb", { scale: 1.08, opacity: 0.85, duration: 3.2, ease: "sine.inOut", repeat: -1, yoyo: true });

  if (visual && matchMedia("(pointer:fine)").matches) {
    var qx = gsap.quickTo(visual, "x", { duration: 0.6, ease: "power2.out" });
    var qy = gsap.quickTo(visual, "y", { duration: 0.6, ease: "power2.out" });
    var qr = gsap.quickTo(visual, "rotation", { duration: 0.6, ease: "power2.out" });
    window.addEventListener("pointermove", function (e) {
      var dx = e.clientX / window.innerWidth - 0.5;
      var dy = e.clientY / window.innerHeight - 0.5;
      qx(dx * 26); qy(dy * 20); qr(dx * 3);
    });
  }

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

  // ---- Tool strip ----
  gsap.from(".strip__label", {
    x: -12, autoAlpha: 0, duration: 0.6,
    scrollTrigger: { trigger: ".strip", start: "top 90%" },
  });
  gsap.from(".strip li", {
    y: 14, autoAlpha: 0, duration: 0.6, stagger: 0.06,
    scrollTrigger: { trigger: ".strip", start: "top 90%" },
  });

  // ---- Chat mockup: messages arrive in sequence ----
  gsap
    .timeline({ scrollTrigger: { trigger: ".chat", start: "top 74%" } })
    .from(".chat", { y: 34, autoAlpha: 0, duration: 0.8, ease: "power3.out" })
    .from(".chat .msg", { y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.4, ease: "power2.out" }, "-=0.2")
    .from(".chat__input", { y: 12, autoAlpha: 0, duration: 0.5 }, "-=0.05");

  // ---- Capability cards (batched stagger) ----
  ScrollTrigger.batch(".feat", {
    start: "top 86%",
    onEnter: function (batch) {
      gsap.from(batch, {
        y: 28, autoAlpha: 0, duration: 0.7, stagger: 0.09, ease: "power3.out", overwrite: true,
      });
    },
  });

  // ---- Steps ----
  gsap.from(".steps li", {
    y: 26, autoAlpha: 0, duration: 0.7, stagger: 0.12, ease: "power3.out",
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
