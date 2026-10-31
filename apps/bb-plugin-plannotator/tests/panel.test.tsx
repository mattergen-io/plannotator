// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk/app";
import { AnnotationType } from "@plannotator/ui/types";
import { CHANNEL, rpcContract, documentSchema, annotationsSchema } from "../contracts";

vi.mock("@plannotator/ui/components/Viewer", () => ({ Viewer: ({ markdown, onAddAnnotation }: { markdown: string; onAddAnnotation: (value: unknown) => void }) => <div>{markdown}<button onClick={() => onAddAnnotation({ id: "note-1", blockId: "block-1", startOffset: 0, endOffset: 0, type: AnnotationType.GLOBAL_COMMENT, originalText: "", text: "Clarify acceptance criteria", createdA: 1, images: undefined, mentions: undefined })}>Add test comment</button></div> }));
vi.mock("@plannotator/ui/components/AnnotationPanel", () => ({ AnnotationPanel: () => null }));
vi.mock("@plannotator/ui/components/plan-diff/PlanDiffViewer", () => ({ PlanDiffViewer: () => null }));
const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);
function mount(composerThread = "thread-1") {
  const original = documentSchema.parse({ id: "a".repeat(64), threadId: "thread-1", path: "plan.md", hostId: "host-1", checkoutRoot: "/repo", environmentId: "environment-1",
    sha256: "b".repeat(64), currentSha256: "b".repeat(64), content: "# Plan for revision", annotations: [] as unknown[], revision: 0, baseline: null, approvedAt: null,
    versions: [{ sha256: "b".repeat(64), updatedAt: "2026-10-30", commentCount: 0, approvedAt: null }] });
  let document = original;
  let failSave = false;
  const prepare = vi.fn(({ revision }: { revision: number }) => { expect(revision).toBe(document.revision); return { text: "Generated document feedback" }; });
  const send = vi.fn(() => ({ status: "sent" as const, error: null }));
  const open = vi.fn(() => document);
  const slot = renderSlot<ExperimentalThreadActionTabProps, typeof rpcContract>(app.tabs[0]! as { component: React.ComponentType<ExperimentalThreadActionTabProps> }, { threadId: "thread-1", environment: { id: "environment-1" }, params: null }, {
    experimental_rpcContract: rpcContract, pluginId: "plannotator", context: { threadId: "thread-1" },
    composer: { text: "Existing prompt", attachmentCount: 2, scope: { kind: "thread", threadId: composerThread } },
    rpc: {
      session: () => ({ path: "plan.md", files: ["plan.md"], truncated: false }), open,
      save: ({ annotations }: { annotations: unknown[] }) => { if (failSave) throw new Error("Feedback changed in another panel"); document = { ...document, annotations: annotationsSchema.parse(annotations), revision: document.revision + 1 }; return { revision: document.revision }; },
      prepare, send, reviewed: () => ({ ok: true }),
    },
  });
  return { slot, prepare, send, open, failSaving: () => { failSave = true; }, replace: (content: string) => { document = { ...document, content, sha256: "c".repeat(64), currentSha256: "c".repeat(64), annotations: [], revision: 0, versions: [{ ...document.versions[0]!, sha256: "c".repeat(64), commentCount: 0 }] }; } };
}
describe("native composer and refresh", () => {
  it("saves pending comments before appending feedback and preserves the existing composer", async () => {
    const { slot, prepare, send } = mount();
    await waitFor(() => expect(slot.getByText("# Plan for revision")).toBeTruthy());
    fireEvent.click(slot.getByText("Add test comment"));
    fireEvent.click(slot.getByText("Add to chat"));
    await waitFor(() => expect(slot.inspection.composer.text).toContain("Generated document feedback"));
    expect(slot.inspection.composer.text).toContain("Existing prompt");
    expect(slot.inspection.composer.attachmentCount).toBe(2);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
    expect(send).not.toHaveBeenCalled();
  });
  it("refuses to insert into a different thread’s composer", async () => {
    const { slot } = mount("other-thread");
    await waitFor(() => expect(slot.getByText("Add test comment")).toBeTruthy());
    fireEvent.click(slot.getByText("Add test comment")); fireEvent.click(slot.getByText("Add to chat"));
    await waitFor(() => expect(slot.getByRole("alert").textContent).toContain("this thread’s composer"));
    expect(slot.inspection.composer.text).toBe("Existing prompt");
  });
  it("refreshes saved documents on the matching thread’s completion signal", async () => {
    const { slot, replace, open } = mount();
    await waitFor(() => expect(slot.getByText("# Plan for revision")).toBeTruthy());
    const calls = open.mock.calls.length;
    await slot.behavior.emitRealtime(CHANNEL, { threadId: "another-thread" });
    expect(open.mock.calls).toHaveLength(calls);
    replace("# Agent revised the document");
    await slot.behavior.emitRealtime(CHANNEL, { threadId: "thread-1" });
    await waitFor(() => expect(slot.getByText("# Agent revised the document")).toBeTruthy());
  });
  it("clears a previous version’s success notice after refresh", async () => {
    const { slot, replace } = mount();
    await waitFor(() => expect(slot.getByText("Add test comment")).toBeTruthy());
    fireEvent.click(slot.getByText("Add test comment")); fireEvent.click(slot.getByText("Add to chat"));
    await waitFor(() => expect(slot.getByText("Feedback added to your chat draft.")).toBeTruthy());
    replace("# A different document version");
    await slot.behavior.emitRealtime(CHANNEL, { threadId: "thread-1" });
    await waitFor(() => expect(slot.getByText("# A different document version")).toBeTruthy());
    expect(slot.queryByText("Feedback added to your chat draft.")).toBeNull();
  });
  it("lets the user explicitly discard a conflicted local draft and reload saved feedback", async () => {
    const { slot, failSaving } = mount();
    await waitFor(() => expect(slot.getByText("Add test comment")).toBeTruthy());
    failSaving(); fireEvent.click(slot.getByText("Add test comment")); fireEvent.click(slot.getByText("Add to chat"));
    await waitFor(() => expect(slot.getByRole("alert").textContent).toContain("another panel"));
    fireEvent.click(slot.getByText("Discard local edits and reload saved feedback"));
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(slot.getByText("Comments (0)")).toBeTruthy();
  });

});
