import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { exportAnnotations, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser";
import type { Annotation } from "@plannotator/ui/types";
import { CHANNEL, rpcContract, type ReviewTarget } from "./contracts";
import { reviewStore } from "./review-store";
import { readDocument, workspace } from "./workspace";

export default function plugin(bb: BbPluginApi) {
  const store = reviewStore(bb);
  const inFlight = new Map<string, Promise<{ status: "sent" | "uncertain"; error: string | null }>>();
  async function current(target: ReviewTarget) {
    const saved = store.requireVersion(target);
    const live = await readDocument(bb, target.threadId, saved.source.path);
    if (live.id !== target.id) throw new Error("This thread moved to another working folder. Refresh before reviewing or sending feedback.");
    if (live.sha256 !== target.sha256) throw new Error("The document changed on disk. Refresh and review the latest version before sending.");
    store.requireVersion(target);
    return saved;
  }
  async function prepare(target: ReviewTarget, action: "feedback" | "approve") {
    const { source, version } = await current(target);
    const location = `${JSON.stringify(source.path)} at SHA-256 ${target.sha256}`;
    if (action === "approve") return { text: `The user approved ${location}. This approval applies only to those document contents. Acknowledge the approval and wait for the user’s next request. It does not authorize implementation or another stage.` };
    const annotations = JSON.parse(version.annotations) as Annotation[];
    if (!annotations.length) throw new Error("Add at least one comment or suggested deletion first.");
    const feedback = exportAnnotations(parseMarkdownToBlocks(version.content), annotations, [], "Document feedback", "document");
    return { text: `Review feedback for ${location}.\n\n${feedback}\n\nRevise this document to address the feedback using your normal file tools. Check its current contents before editing. Stay within document revision; do not implement code or advance another stage unless the user requests it.` };
  }
  async function deliver(target: ReviewTarget, action: "feedback" | "approve", resend = false) {
    const { text } = await prepare(target, action);
    const key = `${target.id}:${target.sha256}:${action === "approve" ? "approval" : target.revision}:${action}`;
    const running = inFlight.get(key); if (running) return running;
    const task = (async () => {
      let delivery = store.delivery(key);
      if (delivery?.status === "sent") return { status: "sent" as const, error: null };
      if (delivery?.status === "uncertain") {
        const history = await bb.sdk.threads.promptHistory({ threadId: target.threadId });
        if (JSON.stringify(history).includes(delivery.id)) {
          store.putDelivery(key, { ...delivery, status: "sent", error: null });
          return { status: "sent" as const, error: null };
        }
        if (!resend) return { status: "uncertain" as const, error: "Delivery could not be confirmed. Check the conversation before choosing Resend." };
      }
      delivery ??= { id: randomUUID(), threadId: target.threadId, text, status: "pending", error: null };
      store.putDelivery(key, { ...delivery, status: "uncertain" });
      if (action === "approve") store.reviewed(target, true);
      try {
        await bb.sdk.threads.send({ threadId: target.threadId, mode: "queue-if-active", input: [{ type: "text", text: `${delivery.text}\n\n[Plannotator review ${delivery.id}]`, mentions: [] }] });
        store.putDelivery(key, { ...delivery, status: "sent", error: null });
        return { status: "sent" as const, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.putDelivery(key, { ...delivery, status: "uncertain", error: message });
        return { status: "uncertain" as const, error: `Review saved; delivery is uncertain: ${message}` };
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task); return task;
  }
  bb.rpc.register(rpcContract, {
    async session({ threadId }) {
      const source = await workspace(bb, threadId);
      const result = await bb.sdk.files.listPaths({ hostId: source.hostId, path: source.checkoutRoot, includeFiles: true, includeDirectories: false, includeHidden: true, limit: 5000 });
      const path = await bb.storage.kv.get(`selected:${threadId}`);
      return { path: typeof path === "string" ? path : null, files: result.paths.filter(p => /\.(md|markdown)$/i.test(p.path)).map(p => p.path), truncated: result.truncated };
    },
    async open({ threadId, path, sha256 }) {
      const source = await readDocument(bb, threadId, path);
      store.capture(source);
      await bb.storage.kv.set(`selected:${threadId}`, source.path);
      return store.view(source, sha256);
    },
    async save({ annotations, ...target }) { return store.save(target, annotations); },
    async prepare({ action, ...target }) { return prepare(target, action); },
    async send({ action, resend, ...target }) { return deliver(target, action, resend); },
    async reviewed(target) { await current(target); store.reviewed(target); return { ok: true as const }; },
  });
  for (const event of ["thread.idle", "thread.failed"] as const) bb.events.on(event, ({ thread }) => {
    bb.realtime.publish(CHANNEL, { threadId: thread.id });
  });
}
