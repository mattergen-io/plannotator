import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import plugin from "../server";
import { feedbackSelection, rpcContract, targetOf } from "../contracts";
import { annotation, disposeAfter, setup } from "./review-fixture";

async function fixture() {
  const host = await setup(), folder = ".kiro/specs/framework";
  for (const [path, content] of Object.entries({
    "requirements.md": "# Requirements\n\nDescribe the result.\n", "a1/design.md": "# Design\n\nDescribe the approach.\n", "a1/evidence.md": "# Evidence\n\nKeep this evidence unchanged.\n", "notes.json": "{}",
  })) {
    await mkdir(join(host.state.root, folder, path, ".."), { recursive: true }); await writeFile(join(host.state.root, folder, path), content);
  }
  const set = async () => rpcContract.specSet.output.parse(await host.harness.behavior.callRpc("specSet", { threadId: "thread-1", folder }));
  const open = async (path: string) => rpcContract.open.output.parse(await host.harness.behavior.callRpc("open", { threadId: "thread-1", path: `${folder}/${path}` }));
  const comment = async (path: string, text: string) => {
    const document = await open(path); const note = { ...annotation(), text };
    const saved = await host.harness.behavior.callRpc("save", { ...targetOf(document), annotations: [note] }) as { revision: number };
    return { ...document, annotations: [note], revision: saved.revision };
  };
  return { ...host, folder, set, openDocument: open, comment };
}
it("discovers nested sets, keeps new documents unhighlighted, and tracks exact per-document review state", async () => {
  const { harness, state, folder, set, openDocument } = await fixture();
  const session = rpcContract.session.output.parse(await harness.behavior.callRpc("session", { threadId: "thread-1" }));
  expect(session.specs).toEqual([{ folder, parent: null, name: "framework" }]);
  await mkdir(join(state.root, folder, "empty"));
  let collection = await set();
  expect(collection.entries).toContainEqual({ path: `${folder}/notes.json`, kind: "file" });
  expect(collection.entries).toContainEqual({ path: `${folder}/empty`, kind: "directory" });
  expect(collection.files.map(file => file.path)).toEqual([`${folder}/a1/design.md`, `${folder}/a1/evidence.md`, `${folder}/requirements.md`]);
  expect(collection.files.every(file => file.status === "unreviewed")).toBe(true);
  const first = await openDocument("requirements.md"); expect(first.baseline).toBeNull();
  await harness.behavior.callRpc("reviewed", targetOf(first));
  const design = await openDocument("a1/design.md"); await harness.behavior.callRpc("reviewed", targetOf(design));
  await writeFile(join(state.root, folder, "a1/design.md"), "# Revised design\n");
  collection = await set(); expect(collection.files.map(file => [file.path, file.status])).toEqual([
    [`${folder}/a1/design.md`, "changed"], [`${folder}/a1/evidence.md`, "unreviewed"], [`${folder}/requirements.md`, "reviewed"],
  ]);
});
it("restores the chosen set and document after reload", async () => {
  const { harness, folder, set, openDocument } = await fixture(); await set(); await openDocument("a1/design.md");
  const fresh = await harness.lifecycle.reload(plugin); disposeAfter(() => fresh.harness.lifecycle.dispose());
  const session = rpcContract.session.output.parse(await fresh.harness.behavior.callRpc("session", { threadId: "thread-1" }));
  expect(session).toMatchObject({ folder, path: `${folder}/a1/design.md` });
});
it("combines saved current-version comments, queues once, and keeps approval individual", async () => {
  const { harness, state, set, folder, comment, openDocument } = await fixture();
  const requirements = await comment("requirements.md", "Specify the expected outcome.");
  const design = await comment("a1/design.md", "Explain how the design meets the outcome.");
  const selection = feedbackSelection(await set());
  const input = { ...targetOf(requirements), action: "feedback", set: selection };
  const { text } = rpcContract.prepare.output.parse(await harness.behavior.callRpc("prepare", input));
  for (const value of [requirements.path, requirements.sha256, design.path, design.sha256, "Specify the expected outcome.", "Explain how the design meets the outcome.", "do not implement code"]) expect(text).toContain(value);
  expect(text).not.toContain(`${folder}/a1/evidence.md`);
  await harness.behavior.callRpc("send", input); await harness.behavior.callRpc("send", input);
  expect(state.sent).toHaveLength(1);
  expect(harness.inspection.sdk.callsTo("threads.send")[0]).toMatchObject([{ threadId: "thread-1", mode: "queue-if-active" }]);
  await expect(harness.behavior.callRpc("send", { ...input, action: "approve" })).rejects.toThrow(/only.*displayed document/);
  await harness.behavior.callRpc("send", { ...targetOf(requirements), action: "approve" });
  expect((await openDocument("requirements.md")).approvedAt).toBeTruthy();
  expect((await openDocument("a1/design.md")).baseline).toBeNull();
});
it("rejects stale unopened files, feedback revisions, added/removed files, and forged set membership before sending", async () => {
  const { harness, state, folder, set, comment } = await fixture();
  const current = await comment("requirements.md", "Clarify the outcome.");
  await comment("a1/design.md", "Clarify the approach.");
  const stale = feedbackSelection(await set());
  await writeFile(join(state.root, folder, "a1/design.md"), "# Changed while unopened\n");
  const send = (selection: typeof stale) => harness.behavior.callRpc("send", { ...targetOf(current), action: "feedback", set: selection });
  await expect(send(stale)).rejects.toThrow(/changed.*Refresh/);
  const beforeSave = feedbackSelection(await set()); await comment("a1/design.md", "New concurrent comment.");
  await expect(send(beforeSave)).rejects.toThrow(/changed.*Refresh/);
  const beforeAdd = feedbackSelection(await set()); await writeFile(join(state.root, folder, "new.md"), "# New\n");
  await expect(send(beforeAdd)).rejects.toThrow(/changed.*Refresh/);
  const beforeRemove = feedbackSelection(await set()); await rm(join(state.root, folder, "new.md"));
  await expect(send(beforeRemove)).rejects.toThrow(/changed.*Refresh/);
  const valid = feedbackSelection(await set());
  await expect(send({ ...valid, documents: valid.documents.slice(0, 1) })).rejects.toThrow(/changed.*Refresh/);
  await expect(send({ ...valid, documents: valid.documents.map(document => ({ ...document, threadId: "other-thread" })) })).rejects.toThrow(/changed.*Refresh/);
  expect(state.sent).toHaveLength(0);
});
it("preserves old comments in history and excludes them from combined current feedback", async () => {
  const { harness, state, folder, set, comment } = await fixture();
  const old = await comment("a1/design.md", "Obsolete feedback must stay with its version.");
  await writeFile(join(state.root, folder, "a1/design.md"), "# Updated design\n");
  const current = await comment("requirements.md", "Only this current feedback.");
  const selection = feedbackSelection(await set());
  const { text } = rpcContract.prepare.output.parse(await harness.behavior.callRpc("prepare", { ...targetOf(current), action: "feedback", set: selection }));
  expect(text).toContain("Only this current feedback."); expect(text).not.toContain("Obsolete feedback");
  const history = rpcContract.open.output.parse(await harness.behavior.callRpc("open", { threadId: "thread-1", path: old.path, sha256: old.sha256 }));
  expect(history.annotations[0].text).toContain("Obsolete feedback");
});
it("shows unavailable documents, refuses incomplete feedback, and bounds set inventory", async () => {
  const { harness, state, folder, set, comment } = await fixture();
  const current = await comment("requirements.md", "Clarify.");
  await writeFile(join(state.root, folder, "bad.md"), "\0not UTF-8 Markdown");
  const collection = await set(); expect(collection.files.find(file => file.path.endsWith("bad.md"))).toMatchObject({ status: "unavailable", error: expect.stringContaining("UTF-8") });
  await expect(harness.behavior.callRpc("prepare", { ...targetOf(current), action: "feedback", set: feedbackSelection(collection) })).rejects.toThrow(/could not be checked/);
  state.listingTruncated = true; await expect(set()).rejects.toThrow(/inventory is incomplete/);
  for (const input of ["../private", "/private", ".git", "C:\\private"]) await expect(harness.behavior.callRpc("specSet", { threadId: "thread-1", folder: input })).rejects.toThrow();
});
it("reconciles uncertain combined delivery without duplicating it", async () => {
  const { harness, state, set, comment } = await fixture(); const current = await comment("requirements.md", "Clarify.");
  const input = { ...targetOf(current), action: "feedback", set: feedbackSelection(await set()) };
  state.failSend = true; expect(await harness.behavior.callRpc("send", input)).toMatchObject({ status: "uncertain" });
  state.failSend = false; expect(await harness.behavior.callRpc("send", input)).toMatchObject({ status: "sent" });
  expect(state.sent).toHaveLength(1);
});

it("rejects oversized collections before reading their document bodies", async () => {
  const { harness, state, folder, set } = await fixture();
  await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(join(state.root, folder, `extra-${index}.md`), "# Extra\n")));
  await expect(set()).rejects.toThrow(/up to 200 Markdown documents/);
  expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
});

it("builds Graze’s requirements-only hierarchy and omits README-only ancestors", async () => {
  const { harness, state } = await setup();
  const base = ".kiro/specs/graze-framework";
  const folders = [base, `${base}/blocks/01`, ...[1,2,3,4].map(number => `${base}/blocks/01/a${number}`), ...["02","03","04"].map(number => `${base}/blocks/${number}`)];
  for (const folder of folders) { await mkdir(join(state.root, folder), { recursive: true }); await writeFile(join(state.root, folder, "requirements.md"), "# Requirements\n"); }
  await writeFile(join(state.root, base, "blocks/README.md"), "# Blocks\n");
  const session = rpcContract.session.output.parse(await harness.behavior.callRpc("session", { threadId: "thread-1" }));
  expect(session.specs).toHaveLength(9);
  expect(session.specs.find(spec => spec.folder === base)).toMatchObject({ parent: null, name: "graze-framework" });
  for (const spec of session.specs.filter(spec => spec.folder !== base)) {
    expect(spec.parent).toBe(/\/a[1-4]$/.test(spec.folder) ? `${base}/blocks/01` : base);
  }
  expect(session.specs.some(spec => spec.folder === `${base}/blocks`)).toBe(false);
});
it("reparents discovered specs when an intermediate folder gains its own requirements", async () => {
  const { harness, state } = await setup();
  await mkdir(join(state.root, "spec/blocks/01/a1"), { recursive: true });
  for (const folder of ["spec", "spec/blocks/01/a1"]) await writeFile(join(state.root, folder, "requirements.md"), "# Requirements\n");
  const session = async () => rpcContract.session.output.parse(await harness.behavior.callRpc("session", { threadId: "thread-1" }));
  expect((await session()).specs.find(spec => spec.name === "a1")?.parent).toBe("spec");
  await writeFile(join(state.root, "spec/blocks/01/requirements.md"), "# Requirements\n");
  expect((await session()).specs.find(spec => spec.name === "a1")?.parent).toBe("spec/blocks/01");
});
