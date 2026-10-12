// Each chapter is one section, SECTION_VH viewports tall (the last is one).

export const SECTION_VH = 1.6;

/** Measured, not computed: sections are in svh, and innerHeight changes as phone browser bars show and hide. */
export const sectionHeight = () => document.querySelector<HTMLElement>("main > section")?.offsetHeight || window.innerHeight * SECTION_VH;

export function goToChapter(index: number) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: index * sectionHeight(), behavior: reduce ? "auto" : "smooth" });
}
