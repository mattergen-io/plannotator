import { useEffect, useMemo, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { isolatedRpc } from "./isolated-rpc";
import { ReviewPlatformContext, type ReviewPlatform } from "./review-platform";
import type { factoryContract } from "./factory/contracts";
import type { Role } from "./factory/model";

export function IframePlatform({ threadId, nonce, parentOrigin, children }: { threadId: string; nonce: string; parentOrigin: string; children: React.ReactNode }) {
  const platform = useMemo(() => {
    const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const listeners = new Set<() => void>();
    function request(action: string, data: object = {}) {
      const id = crypto.randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("BB did not respond.")); }, action === "pick-model" ? 300000 : 15000);
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ type: "plannotator-request", nonce, threadId, id, action, ...data }, parentOrigin);
      });
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.nonce !== nonce) return;
      if (event.data.type === "plannotator-refresh") listeners.forEach(listener => listener());
      if (event.data.type !== "plannotator-response") return;
      const entry = pending.get(event.data.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(event.data.id);
      if (event.data.error) entry.reject(new Error(String(event.data.error))); else entry.resolve(event.data.value);
    };
    function ModelPicker({ value, onChange, disabled, environmentId }: { value: Role; onChange(value: Role): void; disabled?: boolean; environmentId?: string }) {
      const [error, setError] = useState("");
      return <span><button type="button" disabled={disabled} onClick={() => void request("pick-model", { value, environmentId }).then(result => { if (result) onChange(result as Role); }).catch(cause => setError(String(cause)))}>{value.providerId} · {value.model} · {value.reasoningLevel}</button>{error && <span role="alert">{error}</span>}</span>;
    }
    const value: ReviewPlatform = {
      reviewRpc: isolatedRpc, factoryRpc: isolatedRpc as unknown as PluginRpcClient<typeof factoryContract>,
      insertDraft: text => request("insert-draft", { text }).then(() => {}),
      openThread: (id, split) => { void request("open-thread", { targetThreadId: id, split }).catch(console.error); },
      openFile: (environmentId, path) => { void request("open-file", { environmentId, path }).catch(console.error); },
      ModelPicker, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    return { value, receive, close: () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Review closed.")); } pending.clear(); } };
  }, [threadId, nonce, parentOrigin]);
  useEffect(() => { window.addEventListener("message", platform.receive); return () => { window.removeEventListener("message", platform.receive); platform.close(); }; }, [platform]);
  return <ReviewPlatformContext.Provider value={platform.value}>{children}</ReviewPlatformContext.Provider>;
}
