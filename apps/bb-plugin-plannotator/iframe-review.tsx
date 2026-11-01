import { useEffect, useRef, useState } from "react";
import { useComposer, useRealtime, useBbNavigate, experimental_ProviderModelPicker as ModelPicker, type ExperimentalProviderModelPickerValue } from "@get-bb/plugin-sdk/app";
import { roleSchema } from "./factory/model";
import { folderPath } from "./contracts";
import { CHANNEL } from "./contracts";

export function IframeReview({ threadId, path }: { threadId: string; path?: string }) {
  const composer = useComposer(), navigate = useBbNavigate();
  const [picker, setPicker] = useState<{ id: string; value: ExperimentalProviderModelPickerValue; environmentId?: string } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const [url] = useState(() => {
    const value = new URL("/api/v1/plugins/plannotator/http/isolated", location.origin);
    if (value.hostname === "127.0.0.1") value.hostname = "localhost";
    else if (value.hostname === "localhost") value.hostname = "127.0.0.1";
    else return null;
    value.searchParams.set("parentOrigin", location.origin);
    value.searchParams.set("thread", threadId);
    if (path) value.searchParams.set("path", path);
    value.hash = nonce;
    return value.href;
  });
  const frameOrigin = url ? new URL(url).origin : null;
  const sendTheme = () => {
    if (!frameOrigin) return;
    const style = getComputedStyle(document.documentElement);
    const names = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring", "radius", "font-sans", "font-mono"];
    const tokens = Object.fromEntries(names.map(name => [`--${name}`, style.getPropertyValue(`--${name}`).trim()]));
    frame.current?.contentWindow?.postMessage({ type: "plannotator-theme", nonce, tokens, dark: document.documentElement.classList.contains("dark") }, frameOrigin);
  };
  useEffect(() => {
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, [frameOrigin, nonce]);
  useRealtime(CHANNEL, value => {
    if (value && typeof value === "object" && !Array.isArray(value) && "threadId" in value && value.threadId === threadId)
      frame.current?.contentWindow?.postMessage({ type: "plannotator-refresh", nonce }, frameOrigin!);
  });
  useEffect(() => {
    const respond = (id: string, value?: unknown, error?: string) => frame.current?.contentWindow?.postMessage({ type: "plannotator-response", nonce, id, value, error }, frameOrigin!);
    const listener = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== frameOrigin || event.source !== frame.current?.contentWindow || data?.type !== "plannotator-request" ||
          data.nonce !== nonce || data.threadId !== threadId || typeof data.id !== "string") return;
      try {
        if (data.action === "insert-draft") {
          if (typeof data.text !== "string" || data.text.length > 131072) throw new Error("Invalid feedback.");
          if (composer.scope.kind !== "thread" || composer.scope.threadId !== threadId) throw new Error("Open this thread’s composer to add feedback.");
          composer.insert(data.text, { at: "end", block: true }); composer.focus(); respond(data.id);
        } else if (data.action === "open-thread") {
          if (typeof data.targetThreadId !== "string" || data.targetThreadId.length > 200) throw new Error("Invalid thread.");
          navigate.toThread(data.targetThreadId, { split: data.split === true }); respond(data.id);
        } else if (data.action === "open-file") {
          if (typeof data.environmentId !== "string" || data.environmentId.length > 200 || !folderPath.safeParse(data.path).success) throw new Error("Invalid file.");
          if (!navigate.experimental_openFilePreview({ target: { kind: "workspace", environmentId: data.environmentId, path: data.path }, location: null })) throw new Error("Could not open file.");
          respond(data.id);
        } else if (data.action === "pick-model") {
          const parsed = roleSchema.safeParse(data.value);
          if (!parsed.success || (data.environmentId !== undefined && typeof data.environmentId !== "string")) throw new Error("Invalid model selection.");
          setPicker({ id: data.id, value: parsed.data as ExperimentalProviderModelPickerValue, environmentId: data.environmentId });
        } else throw new Error("Unknown review action.");
      } catch (cause) { respond(data.id, undefined, cause instanceof Error ? cause.message : String(cause)); }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [composer, frameOrigin, nonce, threadId, navigate]);

  if (!url) return <div>Iframe isolation is available only on a local BB server during this experiment.</div>;
  return <div style={{ width: "100%", height: "100%", position: "relative" }}>
    <iframe ref={frame} title="Plannotator document review" src={url} onLoad={sendTheme} style={{ display: "block", width: "100%", height: "100%", border: 0 }} />
    {picker && <div role="dialog" aria-label="Choose factory model" style={{ position: "absolute", inset: 0, zIndex: 10, background: "var(--background)", padding: 16 }}>
      <ModelPicker value={picker.value} routing={picker.environmentId ? { kind: "environment", environmentId: picker.environmentId } : undefined} onChange={value => setPicker({ ...picker, value })} />
      <button onClick={() => { frame.current?.contentWindow?.postMessage({ type: "plannotator-response", nonce, id: picker.id, value: picker.value }, frameOrigin!); setPicker(null); }}>Done</button>
      <button onClick={() => { frame.current?.contentWindow?.postMessage({ type: "plannotator-response", nonce, id: picker.id, value: null }, frameOrigin!); setPicker(null); }}>Cancel</button>
    </div>}
  </div>;
}
