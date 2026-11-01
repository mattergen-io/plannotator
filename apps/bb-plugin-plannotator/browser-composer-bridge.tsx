import { useEffect, useRef } from "react";
import { useComposers, useRealtime, type ExperimentalPluginBrowserToolbarActionProps } from "@get-bb/plugin-sdk/app";
import { CHANNEL } from "./contracts";

function target(url: string, threadId: string): string | null {
  try {
    const page = new URL(url);
    const nonce = page.hash.slice(1);
    return page.origin === location.origin && page.pathname === "/api/v1/plugins/plannotator/http/isolated" &&
      page.searchParams.get("thread") === threadId && /^[a-f0-9-]{36}$/i.test(nonce) ? nonce : null;
  } catch { return null; }
}

export function BrowserComposerBridge({ threadId, url, experimental_page: page }: ExperimentalPluginBrowserToolbarActionProps) {
  const composers = useComposers(), current = useRef(composers);
  current.current = composers;
  const nonce = target(url, threadId);
  useRealtime(CHANNEL, value => {
    if (!page || !nonce || !value || typeof value !== "object" || Array.isArray(value) || !("threadId" in value) || value.threadId !== threadId) return;
    void page.evaluate(`window.postMessage(${JSON.stringify({ type: "plannotator-refresh", nonce })}, location.origin)`, { world: "main" }).catch(() => {});
  });
  useEffect(() => {
    if (!page || !nonce) return;
    const seen = new Set<string>();
    const unsubscribe = page.onMessage(data => {
      if (!data || typeof data !== "object" || Array.isArray(data) || data.type !== "plannotator-bridge" || data.nonce !== nonce || data.threadId !== threadId ||
          typeof data.id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.id) || typeof data.text !== "string" || data.text.length > 131072 || seen.has(data.id)) return;
      seen.add(data.id);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      const matches = current.current.filter(composer => composer.scope.kind === "thread" && composer.scope.threadId === threadId);
      let error: string | undefined;
      try {
        if (matches.length !== 1) throw new Error("Open exactly one composer for this thread to add feedback.");
        matches[0].insert(data.text, { at: "end", block: true });
        matches[0].focus();
      } catch (e) { error = e instanceof Error ? e.message : "Could not reach the BB composer."; }
      const result = { type: "plannotator-draft-result", nonce, id: data.id, ok: !error, error };
      void page.evaluate(`window.postMessage(${JSON.stringify(result)}, location.origin)`, { world: "main" }).catch(() => {});
    });
    const install = `(() => {
      const key = "__plannotatorComposerBridge";
      if (globalThis[key]) window.removeEventListener("message", globalThis[key]);
      const nonce = ${JSON.stringify(nonce)}, threadId = ${JSON.stringify(threadId)};
      const listener = e => {
        if (e.source !== window || e.origin !== location.origin || e.data?.type !== "plannotator-draft" || e.data?.nonce !== nonce || e.data?.threadId !== threadId) return;
        bb.postMessage({ type: "plannotator-bridge", nonce, threadId, id: e.data.id, text: e.data.text });
      };
      globalThis[key] = listener; window.addEventListener("message", listener); return true;
    })()`;
    // Navigation can replace the page after the toolbar receives its URL.
    // Retry briefly while the new document loads; do not poll indefinitely.
    const installBridge = () => void page.evaluate(install, { world: "isolated" }).catch(() => {});
    installBridge();
    const retries = [500, 1500, 4000].map(delay => setTimeout(installBridge, delay));
    return () => { unsubscribe(); retries.forEach(clearTimeout); };
  }, [page, nonce, threadId]);
  return null;
}
