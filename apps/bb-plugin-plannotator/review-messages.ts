import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { exportAnnotations, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser";
import type { Annotation } from "@plannotator/ui/types";
import { feedbackSelection, type ReviewTarget, type SetFeedback } from "./contracts";
import { hash, readDocument } from "./workspace";
import type { ReviewStore } from "./review-store";
import type { SpecSets } from "./spec-sets";

const ordered = (selection: SetFeedback) => [...selection.documents].sort((a, b) => a.id.localeCompare(b.id));
export function reviewMessages(bb: BbPluginApi, store: ReviewStore, sets: SpecSets) {
  const inFlight = new Map<string, Promise<{ status: "sent" | "uncertain"; error: string | null }>>();
  async function current(target: ReviewTarget) {
    const saved = store.requireVersion(target);
    const live = await readDocument(bb, target.threadId, saved.source.path);
    if (live.id !== target.id) throw new Error("This thread moved to another working folder. Refresh before reviewing or sending feedback.");
    if (live.sha256 !== target.sha256) throw new Error("The document changed on disk. Refresh and review the latest version before sending.");
    store.requireVersion(target); return saved;
  }
  function feedback(target: ReviewTarget) {
    const { source, version } = store.requireVersion(target);
    const annotations = JSON.parse(version.annotations) as Annotation[];
    if (!annotations.length) return null;
    return `Review feedback for ${JSON.stringify(source.path)} at SHA-256 ${target.sha256}.\n\n${exportAnnotations(parseMarkdownToBlocks(version.content), annotations, [], "Document feedback", "document")}`;
  }
  async function prepare(target: ReviewTarget, action: "feedback" | "approve", selection?: SetFeedback) {
    const { source } = await current(target);
    if (action === "approve") {
      if (selection) throw new Error("Approval applies only to the displayed document, not a spec set.");
      return { text: `The user approved ${JSON.stringify(source.path)} at SHA-256 ${target.sha256}. This approval applies only to those document contents. Acknowledge the approval and wait for the user’s next request. It does not authorize implementation or another stage.` };
    }
    let text: string;
    if (selection) {
      const set = await sets.read(target.threadId, selection.folder);
      if (set.files.some(file => file.error)) throw new Error("Some spec documents could not be checked. Resolve their errors before sending combined feedback.");
      const live = feedbackSelection(set);
      if (!selection.documents.some(document => document.id === target.id) || JSON.stringify(ordered(live)) !== JSON.stringify(ordered(selection)))
        throw new Error("The spec set, document contents, or feedback changed. Refresh the set before sending combined feedback.");
      const sections = ordered(selection).map(feedback).filter((section): section is string => section !== null);
      if (!sections.length) throw new Error("Add at least one comment or suggested deletion in this spec set first.");
      text = `Combined review feedback for spec set ${JSON.stringify(set.folder)}.\n\n${sections.join("\n\n---\n\n")}\n\nRevise the documents to address their feedback using your normal file tools. Check each document’s current contents before editing and consider related comments together. Keep changes within this spec set unless the user requests otherwise. Stay within document revision; do not implement code or advance another stage unless the user requests it.`;
    } else {
      const section = feedback(target);
      if (!section) throw new Error("Add at least one comment or suggested deletion first.");
      text = `${section}\n\nRevise this document to address the feedback using your normal file tools. Check its current contents before editing. Stay within document revision; do not implement code or advance another stage unless the user requests it.`;
    }
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error("Combined feedback exceeds 128 KiB. Select a smaller spec set.");
    return { text };
  }
  async function deliver(target: ReviewTarget, action: "feedback" | "approve", resend = false, selection?: SetFeedback) {
    const { text } = await prepare(target, action, selection);
    const key = selection ? `set:${target.threadId}:${hash(JSON.stringify([selection.folder, ordered(selection)]))}:feedback`
      : `${target.id}:${target.sha256}:${action === "approve" ? "approval" : target.revision}:${action}`;
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
  return { current, prepare, deliver };
}
