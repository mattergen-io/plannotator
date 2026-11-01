import { useEffect, useRef, useState } from "react";
import { useComposer, useRealtime } from "@get-bb/plugin-sdk/app";
import { CHANNEL } from "./contracts";

export function IframeReview({ threadId, path }: { threadId: string; path?: string }) {
  const composer = useComposer();
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
    const listener = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== frameOrigin || event.source !== frame.current?.contentWindow || data?.type !== "plannotator-draft" ||
          data.nonce !== nonce || data.threadId !== threadId || typeof data.id !== "string" ||
          typeof data.text !== "string" || data.text.length > 131072) return;
      let error: string | undefined;
      try {
        if (composer.scope.kind !== "thread" || composer.scope.threadId !== threadId) throw new Error("Open this thread’s composer to add feedback.");
        composer.insert(data.text, { at: "end", block: true }); composer.focus();
      }
      catch (cause) { error = cause instanceof Error ? cause.message : "Could not reach the BB composer."; }
      frame.current?.contentWindow?.postMessage({ type: "plannotator-draft-result", nonce, id: data.id, ok: !error, error }, frameOrigin!);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [composer, frameOrigin, nonce, threadId]);
  if (!url) return <div>Iframe isolation is available only on a local BB server during this experiment.</div>;
  return <iframe ref={frame} title="Plannotator document review" src={url} onLoad={sendTheme} style={{ display: "block", width: "100%", height: "100%", border: 0 }} />;
}
