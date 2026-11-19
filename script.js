const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function trackCtas() {
  document.querySelectorAll("[data-cta]").forEach((el) => {
    el.addEventListener("click", () => {
      if (typeof gtag !== "function") return;
      gtag("event", "cta_click", { cta_location: el.dataset.cta, link_url: el.href });
    });
  });
}

function revealOnScroll() {
  const items = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("anim");
  const seen = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  items.forEach((item) => seen.observe(item));
}

const SPRING = "cubic-bezier(0.3, 1.4, 0.5, 1)";
const MOVES = {
  hop: [
    [
      { transform: "translateY(0) scale(1, 1)" },
      { transform: "translateY(0) scale(1.05, 0.93)", offset: 0.18 },
      { transform: "translateY(-9%) scale(0.97, 1.05)", offset: 0.5 },
      { transform: "translateY(0) scale(1.04, 0.95)", offset: 0.82 },
      { transform: "translateY(0) scale(1, 1)" },
    ],
    { duration: 620, easing: "ease-out" },
  ],
  wave: [
    [
      { transform: "rotate(0)" },
      { transform: "rotate(-9deg)", offset: 0.2 },
      { transform: "rotate(7deg)", offset: 0.45 },
      { transform: "rotate(-5deg)", offset: 0.7 },
      { transform: "rotate(0)" },
    ],
    { duration: 900, easing: "ease-in-out" },
  ],
  spin: [
    [{ transform: "rotateY(0) scale(1)" }, { transform: "rotateY(180deg) scale(1.08)" }, { transform: "rotateY(360deg) scale(1)" }],
    { duration: 800, easing: SPRING },
  ],
};

function bringCusoToLife() {
  const cuso = document.querySelector("[data-cuso]");
  if (!cuso || reducedMotion || !cuso.animate) return;
  const body = cuso.querySelector("img");
  let current = null;
  let onScreen = true;

  const play = (name) => {
    if (current) current.cancel();
    current = body.animate(...MOVES[name]);
    current.onfinish = current.oncancel = () => (current = null);
  };

  cuso.classList.add("is-alive");
  cuso.addEventListener("click", () => play("spin"));
  new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting)).observe(cuso);

  setTimeout(() => play("wave"), 500);
  const idle = () => {
    if (onScreen && !document.hidden && !current) play(Math.random() < 0.6 ? "hop" : "wave");
    setTimeout(idle, 4000 + Math.random() * 3000);
  };
  setTimeout(idle, 5000);
}

// The footer toggle cycles System, Light, Dark. System clears the saved choice.
function themeToggle() {
  const root = document.documentElement;
  const button = document.querySelector("[data-theme-toggle]");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const NEXT = { system: "light", light: "dark", dark: "system" };
  const LABEL = { system: "System", light: "Light", dark: "Dark" };
  let choice = "system";
  try { choice = localStorage.getItem("theme") || "system"; } catch {}
  if (!LABEL[choice]) choice = "system";
  const show = () => {
    const theme = choice === "system" ? (system.matches ? "dark" : "light") : choice;
    root.dataset.theme = theme;
    button.textContent = `Theme: ${LABEL[choice]}`;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0c0c0c" : "#ffffff";
  };
  button.addEventListener("click", () => {
    choice = NEXT[choice];
    try {
      if (choice === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", choice);
    } catch {}
    show();
  });
  system.addEventListener("change", show);
  show();
}

trackCtas();
themeToggle();
revealOnScroll();
bringCusoToLife();
