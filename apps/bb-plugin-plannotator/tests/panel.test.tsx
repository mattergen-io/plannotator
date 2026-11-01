// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadActionTabProps } from "@get-bb/plugin-sdk/app";
import { AnnotationType } from "@plannotator/ui/types";
import { CHANNEL, rpcContract, documentSchema, annotationsSchema, summarizeDocument } from "../contracts";

vi.mock("@plannotator/ui/components/Viewer", () => ({ Viewer: ({ markdown, documentChanges, onAddAnnotation }: { markdown: string; documentChanges?: { type: string }[]; onAddAnnotation: (value: unknown) => void }) => <div data-testid="document-viewer" data-changes={documentChanges?.map(block => block.type).join(",")}>{markdown}<button onClick={() => onAddAnnotation({ id: "note-1", blockId: "block-1", startOffset: 0, endOffset: 0, type: AnnotationType.GLOBAL_COMMENT, originalText: "", text: "Clarify acceptance criteria", createdA: 1, images: undefined, mentions: undefined })}>Add test comment</button></div> }));
vi.mock("@plannotator/ui/components/AnnotationPanel", () => ({ AnnotationPanel: () => null }));
const app = await loadPluginApp(() => import("../app"));
afterEach(cleanup);
function mount(composerThread = "thread-1", baseline: string | null = null, nested = false) {
  const original = documentSchema.parse({ id: "a".repeat(64), threadId: "thread-1", path: "plan.md", hostId: "host-1", checkoutRoot: "/repo", environmentId: "environment-1",
    sha256: "b".repeat(64), currentSha256: "b".repeat(64), content: "# Plan for revision", annotations: [] as unknown[], revision: 0, baseline, approvedAt: null,
    versions: [{ sha256: "b".repeat(64), updatedAt: "2026-10-30", commentCount: 0, approvedAt: null }] });
  let document = original;
  let other = { ...original, id: "d".repeat(64), path: "nested/design.md", sha256: "e".repeat(64), currentSha256: "e".repeat(64), content: "# Nested design", baseline: null as string | null };
  const find = (id: string) => id === document.id ? document : other;
  let selectedPath = "plan.md";
  let failSave = false;
  const prepare = vi.fn(({ id, revision }: { id: string; revision: number }) => { expect(revision).toBe(find(id).revision); return { text: "Generated document feedback" }; });
  const send = vi.fn(() => ({ status: "sent" as const, error: null }));
  const open = vi.fn(({ path }: { path: string }) => { selectedPath = path; return path === "plan.md" ? document : other; });
  const slot = renderSlot<ExperimentalThreadActionTabProps, typeof rpcContract>(app.tabs[0]! as { component: React.ComponentType<ExperimentalThreadActionTabProps> }, { threadId: "thread-1", environment: { id: "environment-1" }, params: null }, {
    experimental_rpcContract: rpcContract, pluginId: "plannotator", context: { threadId: "thread-1" },
    composer: { text: "Existing prompt", attachmentCount: 2, scope: { kind: "thread", threadId: composerThread } },
    rpc: {
      session: () => ({ folder: ".", path: "plan.md", folders: [".", "nested"], truncated: false }), open,
      specSet: () => ({ threadId: "thread-1", folder: ".", hostId: "host-1", checkoutRoot: "/repo", environmentId: "environment-1", selectedPath,
        files: [summarizeDocument(document), ...(nested ? [summarizeDocument(other)] : [])] }),
      save: ({ id, annotations }: { id: string; annotations: unknown[] }) => {
        if (failSave) throw new Error("Feedback changed in another panel");
        const next = { ...find(id), annotations: annotationsSchema.parse(annotations), revision: find(id).revision + 1 };
        if (id === document.id) document = next; else other = next;
        return { revision: next.revision };
      },
      prepare, send, reviewed: ({ id }: { id: string }) => { if (id === document.id) document = { ...document, baseline: document.content }; else other = { ...other, baseline: other.content }; return { ok: true }; },
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
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, set: { folder: ".", documents: [expect.objectContaining({ revision: 1 })] } }));
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

  it("automatically decorates the document, exposes removals, and clears changes after Reviewed", async () => {
    const { slot } = mount("thread-1", "# Old plan");
    await waitFor(() => expect(slot.getByTestId("document-viewer").dataset.changes).toContain("modified"));
    expect(slot.queryByRole("button", { name: "Changes since review" })).toBeNull();
    expect(slot.getByRole("region", { name: "Removed text since review" }).textContent).toContain("Old plan");
    // The same viewer still accepts annotations while comparison is active.
    fireEvent.click(slot.getByText("Add test comment"));
    await waitFor(() => expect(slot.getByText("Comments (1)")).toBeTruthy());
    fireEvent.click(slot.getByText("Reviewed"));
    await waitFor(() => expect(slot.getByText("No changes since review.")).toBeTruthy());
    expect(slot.getByTestId("document-viewer").dataset.changes).toBe("unchanged");
    expect(slot.queryByRole("region", { name: "Removed text since review" })).toBeNull();
    expect(slot.getByText("Comments (1)")).toBeTruthy();
  });
  it("marks first-time files pending without highlighting their document and keeps collapsed folder counts visible", async () => {
    const { slot } = mount("thread-1", null, true);
    await waitFor(() => expect(slot.getByText("# Plan for revision")).toBeTruthy());
    expect(slot.getByTestId("document-viewer").dataset.changes).toBeUndefined();
    expect(slot.getByRole("button", { name: /plan.md.*Needs review/ })).toBeTruthy();
    expect(slot.getByText("2 need review")).toBeTruthy();
    const summary = slot.getByText("nested").closest("summary")!;
    fireEvent.click(summary);
    expect(summary.parentElement!.hasAttribute("open")).toBe(false);
    expect(summary.textContent).toContain("1 needs review");
  });
  it("flushes comments when switching documents and bundles both while Reviewed affects only the current document", async () => {
    const { slot, prepare } = mount("thread-1", null, true);
    await waitFor(() => expect(slot.getByText("Add test comment")).toBeTruthy());
    fireEvent.click(slot.getByText("Add test comment"));
    fireEvent.click(slot.getByRole("button", { name: /design.md.*Needs review/ }));
    await waitFor(() => expect(slot.getByText("# Nested design")).toBeTruthy());
    fireEvent.click(slot.getByText("Add test comment")); fireEvent.click(slot.getByText("Add to chat"));
    await waitFor(() => expect(slot.inspection.composer.text).toContain("Generated document feedback"));
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ set: { folder: ".", documents: [
      expect.objectContaining({ id: "a".repeat(64), revision: 1 }), expect.objectContaining({ id: "d".repeat(64), revision: 1 }),
    ] } }));
    fireEvent.click(slot.getByText("Reviewed"));
    await waitFor(() => expect(slot.getByRole("button", { name: /design.md.*Reviewed.*1 comment/ })).toBeTruthy());
    expect(slot.getByRole("button", { name: /plan.md.*Needs review.*1 comment/ })).toBeTruthy();
  });
});
