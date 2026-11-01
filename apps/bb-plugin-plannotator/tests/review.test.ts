import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { rpcContract, type ReviewDocument } from "../contracts";
import { targetOf } from "../contracts";

import { setup, annotation, disposeAfter } from "./review-fixture";

async function addComment(harness: Awaited<ReturnType<typeof setup>>["harness"], doc: ReviewDocument) {
  const saved = await harness.behavior.callRpc("save", { ...targetOf(doc), annotations: [annotation()] }) as { revision: number };
  return { ...doc, revision: saved.revision };
}
describe("versioned BB document review", () => {
  it("confines file reads before calling the host", async () => {
    const { harness } = await setup();
    for (const path of ["../secret.md", "/secret.md", "C:\\secret.md", ".git/config.md", "plan.txt"]) {
      await expect(harness.behavior.callRpc("open", { threadId: "thread-1", path })).rejects.toThrow();
    }
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
  });
  it("retains comments on their original version after edits and plugin reload", async () => {
    const { harness, state, open } = await setup();
    const first = await open(); await addComment(harness, first);
    await writeFile(join(state.root, "plan.md"), "# Revised plan\n\nAcceptance criteria included.\n");
    const fresh = await harness.lifecycle.reload(plugin);
    disposeAfter(() => fresh.harness.lifecycle.dispose());
    const latest = rpcContract.open.output.parse(await fresh.harness.behavior.callRpc("open", { threadId: "thread-1", path: "plan.md" }));
    const earlier = rpcContract.open.output.parse(await fresh.harness.behavior.callRpc("open", { threadId: "thread-1", path: "plan.md", sha256: first.sha256 }));
    expect(latest.annotations).toEqual([]);
    expect(earlier.annotations[0]?.text).toBe("Add explicit acceptance criteria.");
    expect(earlier.content).toBe(first.content);
    expect(earlier.currentSha256).toBe(latest.sha256);
  });
  it("rejects stale feedback edits instead of overwriting another panel", async () => {
    const { harness, open } = await setup(); const first = await open();
    await addComment(harness, first);
    await expect(addComment(harness, first)).rejects.toThrow(/another panel/);
    expect((await open()).annotations).toHaveLength(1);
  });
  it("rejects changed files and moved checkouts before sending", async () => {
    const { harness, state, open } = await setup(); const first = await addComment(harness, await open());
    await writeFile(join(state.root, "plan.md"), "# Changed\n");
    await expect(harness.behavior.callRpc("send", { ...targetOf(first), action: "feedback" })).rejects.toThrow(/changed on disk/);
    const moved = await mkdtemp(join(tmpdir(), "bb-review-moved-"));
    disposeAfter(() => rm(moved, { recursive: true, force: true }));
    await writeFile(join(moved, "plan.md"), first.content); state.root = moved;
    await expect(harness.behavior.callRpc("send", { ...targetOf(first), action: "approve" })).rejects.toThrow(/another working folder/);
    expect(state.sent).toHaveLength(0);
  });
  it("does not let another thread send an existing review", async () => {
    const { harness, open } = await setup(); const doc = await open();
    await expect(harness.behavior.callRpc("send", { ...targetOf(doc), threadId: "thread-2", action: "approve" })).rejects.toThrow(/does not belong/);
  });
  it("formats real annotation feedback and queues it without granting implementation", async () => {
    const { harness, state, open } = await setup(); const doc = await addComment(harness, await open());
    await harness.behavior.callRpc("send", { ...targetOf(doc), action: "feedback" });
    expect(state.sent[0]).toContain(doc.sha256); expect(state.sent[0]).toContain("Add explicit acceptance criteria.");
    expect(state.sent[0]).toContain("do not implement code");
    expect(harness.inspection.sdk.callsTo("threads.send")[0]).toMatchObject([{ mode: "queue-if-active", threadId: "thread-1" }]);
  });
  it("resets the reviewed baseline silently and approves only the current hash", async () => {
    const { harness, state, open } = await setup(); const first = await open();
    await harness.behavior.callRpc("reviewed", targetOf(first));
    expect((await open()).baseline).toBe(first.content); expect(state.sent).toHaveLength(0);
    await harness.behavior.callRpc("send", { ...targetOf(first), action: "approve" });
    await harness.behavior.callRpc("send", { ...targetOf(first), action: "approve" });
    expect(state.sent).toHaveLength(1); expect(state.sent[0]).toContain("wait for the user");
    expect((await open()).approvedAt).toBeTruthy();
    await writeFile(join(state.root, "plan.md"), "# New version\n"); expect((await open()).approvedAt).toBeNull();
  });
  it("reconciles a lost send response without duplicating the message", async () => {
    const { harness, state, open } = await setup(); const doc = await open(); state.failSend = true;
    const pending = await harness.behavior.callRpc("send", { ...targetOf(doc), action: "approve" });
    expect(pending).toMatchObject({ status: "uncertain" });
    state.failSend = false;
    expect(await harness.behavior.callRpc("send", { ...targetOf(doc), action: "approve" })).toMatchObject({ status: "sent" });
    expect(state.sent).toHaveLength(1);
  });
  it("publishes refresh signals only for the completed or failed thread", async () => {
    const { harness } = await setup();
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thread-1" }), lastAssistantText: "Done" });
    expect(harness.realtimeSignals).toContainEqual({ channel: "document-review", payload: { threadId: "thread-1" } });
  });
});
