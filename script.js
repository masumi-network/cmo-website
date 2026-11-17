document.querySelectorAll("[data-cta]").forEach((el) => {
  const isForm = el.tagName === "FORM";
  el.addEventListener(isForm ? "submit" : "click", () => {
    if (typeof gtag !== "function") return;
    gtag("event", "cta_click", {
      cta_location: el.dataset.cta,
      link_url: isForm ? el.action : el.href,
    });
  });
});
