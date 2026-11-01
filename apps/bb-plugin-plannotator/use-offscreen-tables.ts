import { useEffect } from "react";

/** Preserve table geometry while the browser skips work on tables outside the viewport. */
export function useOffscreenTables(viewport: HTMLElement | null, documentVersion: unknown) {
  useEffect(() => {
    if (!viewport || !documentVersion || typeof CSS === "undefined" || !CSS.supports?.("content-visibility", "auto")) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let width: number | undefined;
    let tables: HTMLElement[] = [];
    const clear = () => {
      for (const table of tables) {
        table.style.removeProperty("content-visibility");
        table.style.removeProperty("contain-intrinsic-size");
      }
    };
    const measure = () => {
      clear();
      tables = Array.from(viewport.querySelectorAll<HTMLElement>("article > [data-block-id]"))
        .filter(block => block.querySelector("table") !== null);
      // Read all geometry before writing containment styles to avoid layout thrashing.
      const heights = tables.map(table => table.getBoundingClientRect().height);
      tables.forEach((table, index) => {
        if (heights[index] <= 0) return;
        table.style.containIntrinsicSize = `auto ${heights[index]}px`;
        table.style.contentVisibility = "auto";
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) return;
      if (width !== undefined) {
        clearTimeout(timer);
        timer = setTimeout(measure, 150);
      }
      width = next;
    });
    observer?.observe(viewport);
    return () => { clearTimeout(timer); observer?.disconnect(); clear(); };
  }, [viewport, documentVersion]);
}
