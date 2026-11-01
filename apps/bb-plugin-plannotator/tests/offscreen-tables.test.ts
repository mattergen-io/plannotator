// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOffscreenTables } from "../use-offscreen-tables";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves measured table heights, updates them after resizing, and cleans up", () => {
  vi.useFakeTimers();
  vi.stubGlobal("CSS", { supports: () => true });
  let notify!: (entries: { contentRect: { width: number } }[]) => void;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
  const viewport = document.createElement("div");
  viewport.innerHTML = '<article><div data-block-id="one"><table><tr><td>Content</td></tr></table></div><p data-block-id="two">Text</p></article>';
  const block = viewport.querySelector<HTMLElement>('[data-block-id="one"]')!;
  let height = 200;
  vi.spyOn(block, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
  const view = renderHook(() => useOffscreenTables(viewport, "version"));
  expect(block.style.contentVisibility).toBe("auto");
  expect(block.style.containIntrinsicSize).toBe("auto 200px");
  expect(viewport.querySelector<HTMLElement>("p")!.style.contentVisibility).toBe("");
  act(() => { notify([{ contentRect: { width: 800 } }]); height = 280; notify([{ contentRect: { width: 500 } }]); vi.advanceTimersByTime(150); });
  expect(block.style.containIntrinsicSize).toBe("auto 280px");
  view.unmount();
  expect(block.style.contentVisibility).toBe("");
  expect(block.style.containIntrinsicSize).toBe("");
});
