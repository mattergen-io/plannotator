import { MermaidRendererUnavailableError, type DiagramTheme } from "@plannotator/ui/utils/diagram-render";
import { buildMermaidConfig, buildMermaidThemeVariables, readThemeTokens } from "@plannotator/ui/utils/mermaidTheme";
import source from "./mermaid-sandbox.generated.txt" with { type: "text" };

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let sequence = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve: (svg: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

function dispose(error?: Error) {
  clearTimeout(idleTimer);
  window.removeEventListener("message", onMessage);
  frame?.remove(); frame = null; ready = null;
  for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error ?? new Error("Mermaid renderer closed.")); }
  pending.clear();
}
function onMessage(event: MessageEvent) {
  if (event.source !== frame?.contentWindow || event.data?.type !== "mermaid-result") return;
  const item = pending.get(event.data.id);
  if (!item) return;
  pending.delete(event.data.id);
  clearTimeout(item.timeout);
  if (typeof event.data.svg === "string") item.resolve(event.data.svg);
  else item.reject(new Error(typeof event.data.error === "string" ? event.data.error : "Mermaid rendering failed."));
  if (!pending.size) idleTimer = setTimeout(() => dispose(), 30000);
}
function ensureFrame(): Promise<void> {
  if (ready) return ready;
  frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1400px;height:900px;visibility:hidden;pointer-events:none;border:0";
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"></head><body><script>${source.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  const current = frame;
  window.addEventListener("message", onMessage);
  ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { window.removeEventListener("message", onReady); const error = new MermaidRendererUnavailableError("Mermaid renderer did not start."); dispose(error); reject(error); }, 15000);
    function onReady(event: MessageEvent) {
      if (event.source !== current.contentWindow || event.data?.type !== "mermaid-ready") return;
      clearTimeout(timeout); window.removeEventListener("message", onReady); resolve();
    }
    window.addEventListener("message", onReady);
    document.body.appendChild(current);
  });
  return ready;
}
export async function renderMermaidInSandbox(renderId: string, diagram: string, theme: DiagramTheme): Promise<string> {
  clearTimeout(idleTimer);
  await ensureFrame();
  const id = ++sequence;
  const config = buildMermaidConfig(buildMermaidThemeVariables(readThemeTokens(), theme.mode, { shadowAmount: theme.shadowAmount }));
  const fontFamily = getComputedStyle(document.documentElement).fontFamily;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => dispose(new MermaidRendererUnavailableError("Mermaid rendering timed out.")), 30000);
    pending.set(id, { resolve, reject, timeout });
    try { frame!.contentWindow!.postMessage({ type: "render-mermaid", id, renderId, source: diagram, config, fontFamily }, "*"); }
    catch (error) { dispose(error instanceof Error ? error : new Error(String(error))); }
  });
}
