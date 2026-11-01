// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { MermaidRendererUnavailableError, renderDiagram, setMermaidRenderOverride } from "@plannotator/ui/utils/diagram-render";
import { renderMermaidInSandbox } from "../mermaid-sandbox";

const theme = { colorTheme: "plannotator", mode: "dark" as const };
afterEach(() => { setMermaidRenderOverride(null); vi.useRealTimers(); });

it("uses a sandboxed document, ignores unrelated messages and releases the renderer when idle", async () => {
  vi.useFakeTimers();
  const diagram = "sequenceDiagram\nA->>B: private text";
  const result = renderMermaidInSandbox("diagram-test", diagram, theme);
  const frame = document.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).not.toContain(diagram);
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "mermaid-ready" } }));
  await Promise.resolve();
  expect(send).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "mermaid-ready" } }));
  await Promise.resolve();
  const request = send.mock.calls[0]![0] as { id: number; source: string };
  expect(request.source).toBe(diagram);
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "mermaid-result", id: request.id, svg: "wrong" } }));
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "mermaid-result", id: request.id, svg: "<svg/>" } }));
  await expect(result).resolves.toBe("<svg/>");
  vi.advanceTimersByTime(30000);
  expect(document.querySelector("iframe")).toBeNull();
});

it("sanitizes SVG returned by the host renderer before mounting", async () => {
  setMermaidRenderOverride(async () => '<svg xmlns="http://www.w3.org/2000/svg" id="test"><script>alert(1)</script><g onclick="alert(2)"></g></svg>');
  const result = await renderDiagram("mermaid", "test", "graph LR; A-->B", theme);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.svgNode.querySelector("script")).toBeNull();
  expect(result.svgNode.querySelector("g")?.hasAttribute("onclick")).toBe(false);
});

it("offers retry when the isolated renderer cannot start", async () => {
  setMermaidRenderOverride(async () => { throw new MermaidRendererUnavailableError("Renderer unavailable"); });
  const result = await renderDiagram("mermaid", "test", "graph LR; A-->B", theme);
  expect(result).toMatchObject({ ok: false, runtimeUnavailable: true, message: "Renderer unavailable" });
});
