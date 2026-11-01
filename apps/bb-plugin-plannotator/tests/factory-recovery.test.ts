import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { factoryFixture, taskMarkdown } from "./factory-fixture";
import { defaultRoles } from "../factory/model";
import { execution } from "../factory/execution";
async function tasksDraft(
  f: Awaited<ReturnType<typeof factoryFixture>>,
  markdown = taskMarkdown,
) {
  await f.plan.initialize(f.threadId, f.folder, "requirements", false);
  await f.review("requirements.md");
  await f.assess();
  await f.accept("continue");
  await writeFile(
    join(f.root, f.folder, "design.md"),
    "# Design\n\n## Module\nPure modules implementing the accepted arithmetic behavior.\n",
  );
  await f.view();
  await f.review("design.md");
  await f.accept();
  await writeFile(join(f.root, f.folder, "tasks.md"), markdown);
  await f.view();
  await f.review("tasks.md");
}
const another = (key: string) =>
  taskMarkdown
    .slice(taskMarkdown.indexOf("## T1:"))
    .replaceAll("T1", key)
    .replaceAll("sum.mjs", `${key.toLowerCase()}.mjs`);
it("resumes a partial publication without duplicate tasks or premature readiness", async () => {
  const f = await factoryFixture();
  await tasksDraft(
    f,
    taskMarkdown.replace("### Dependencies\nNone", "### Dependencies\nT2") +
      "\n" +
      another("T2"),
  );
  f.faults.taskCreatesBeforeFailure = 1;
  await f.accept();
  let view = await f.view();
  expect(view.state?.mode).toBe("publishing");
  expect(view.tasks).toHaveLength(1);
  expect(view.tasks[0].state.published).toBe(false);
  expect(
    await f.beads.json("host-1", f.root, ["ready", "--type", "task"]),
  ).toEqual([]);
  const existing = view.tasks[0].bead.id;
  await f.accept();
  view = await f.view();
  expect(view.state?.mode, view.error ?? "").toBe("ready");
  expect(view.tasks).toHaveLength(2);
  expect(view.tasks.map((t) => t.bead.id)).toContain(existing);
  expect(
    view.state?.acceptances.filter((a) => a.phase === "tasks"),
  ).toHaveLength(1);
  await f.beads.exec("host-1", f.root, "bd", [
    "gate",
    "resolve",
    view.state!.authorizationId!,
  ]);
  const ready = await f.beads.json("host-1", f.root, [
    "ready",
    "--type",
    "task",
  ]);
  expect(ready.map((b: { id: string }) => b.id)).toEqual([
    view.tasks.find((t) => t.state.key === "T2")!.bead.id,
  ]);
}, 60000);
it("bounds parallel work and represents pause/resume through Beads readiness gates", async () => {
  const f = await factoryFixture();
  await tasksDraft(
    f,
    taskMarkdown + "\n" + another("T2") + "\n" + another("T3"),
  );
  await f.accept();
  f.git("add", ".");
  f.git("commit", "-qm", "Approved test plan");
  let view = await f.engine.start(
    f.threadId,
    f.folder,
    defaultRoles.worker,
    defaultRoles.reviewer,
    "node --test",
    "",
  );
  const id = view.runs[0].bead.id;
  // A newly constructed engine recovers running locations from durable storage.
  const recovered = execution(f.bb, f.beads, f.plan);
  await recovered.tick();
  expect(f.spawned).toHaveLength(2);
  const ready = await f.beads.json("host-1", f.root, [
    "ready",
    "--type",
    "task",
  ]);
  expect(ready).toHaveLength(1);
  await f.engine.change(f.threadId, f.folder, id, "paused");
  expect(
    await f.beads.json("host-1", f.root, ["ready", "--type", "task"]),
  ).toEqual([]);
  await f.engine.tick();
  expect(f.spawned).toHaveLength(2);
  expect(await f.bb.storage.kv.get("factory-locations")).toEqual([]);
  await f.engine.change(f.threadId, f.folder, id, "running");
  expect(await f.bb.storage.kv.get("factory-locations")).toEqual([{ hostId: "host-1", root: f.root }]);
  expect(
    await f.beads.json("host-1", f.root, ["ready", "--type", "task"]),
  ).toHaveLength(1);
  await writeFile(
    join(f.root, f.folder, "requirements.md"),
    "# Requirements\n\n## Sum\nA revised contract.\n",
  );
  await f.engine.tick();
  view = await f.view();
  expect(view.runs[0].state.stage).toBe("paused");
  expect(view.runs[0].state.error).toContain("Accepted source changed");
  expect(
    await f.beads.json("host-1", f.root, ["ready", "--type", "task"]),
  ).toEqual([]);
}, 60000);
it("blocks after two correction rounds and starts a fresh budget only on explicit retry", async () => {
  const f = await factoryFixture();
  await tasksDraft(f);
  await f.accept();
  f.git("add", ".");
  f.git("commit", "-qm", "Approved test plan");
  let view = await f.engine.start(
    f.threadId,
    f.folder,
    defaultRoles.worker,
    defaultRoles.reviewer,
    "node --test",
    "",
  );
  const runId = view.runs[0].bead.id;
  await f.engine.tick();
  for (let attempt = 0; attempt < 3; attempt++) {
    view = await f.view();
    const task = view.tasks[0];
    await writeFile(
      join(task.state.worktree!, "failure.test.mjs"),
      "throw new Error('Controlled verification failure');\n",
    );
    f.states.set(task.state.workerId!, "idle");
    f.outputs.set(
      task.state.workerId!,
      "Attempt finished; verification still fails.",
    );
    await f.engine.tick();
  }
  view = await f.view();
  expect(view.tasks[0].state.attempts).toBe(2);
  expect(view.tasks[0].state.stage).toBe("blocked");
  expect(view.runs[0].state.stage).toBe("blocked");
  expect(f.spawned).toHaveLength(3);
  const lastWorker = view.tasks[0].state.workerId!;
  f.states.set(lastWorker, "active");
  await f.beads.write("host-1", f.root, view.tasks[0].bead.id, {
    ...view.tasks[0].state,
    workerId: null,
  });
  await expect(
    f.engine.retry(f.threadId, f.folder, runId, view.tasks[0].bead.id),
  ).rejects.toThrow("previous agent is still running");
  expect(f.spawned).toHaveLength(3);
  f.states.set(lastWorker, "idle");
  await f.engine.retry(f.threadId, f.folder, runId, view.tasks[0].bead.id);
  await f.engine.tick();
  view = await f.view();
  expect(view.tasks[0].state.attempts).toBe(0);
  expect(view.tasks[0].state.epoch).toBe(1);
  expect(f.spawned).toHaveLength(4);
}, 90000);

it("rejects task-worktree changes to accepted specs before committing or reviewing", async () => {
  const f = await factoryFixture();
  await tasksDraft(f);
  await f.accept();
  f.git("add", ".");
  f.git("commit", "-qm", "Approved spec");
  await f.engine.start(
    f.threadId,
    f.folder,
    defaultRoles.worker,
    defaultRoles.reviewer,
    "node --test",
    "",
  );
  await f.engine.tick();
  const worker = f.spawned[0];
  await writeFile(
    join(worker.path, f.folder, "requirements.md"),
    "# Unauthorized spec rewrite\n",
  );
  f.states.set(worker.id, "idle");
  f.outputs.set(worker.id, "Done.");
  await f.engine.tick();
  const view = await f.view();
  expect(view.tasks[0].state.commit).toBeNull();
  expect(view.tasks[0].state.reviewerId).toBeNull();
  expect(view.tasks[0].state.attempts).toBe(1);
  expect(view.tasks[0].state.evidence.join("\n")).toContain(
    "changed accepted spec documents",
  );
  expect(f.spawned).toHaveLength(2);
  expect(f.spawned[1].title).toContain("worker");
}, 60000);
