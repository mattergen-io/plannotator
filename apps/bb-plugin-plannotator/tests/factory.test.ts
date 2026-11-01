import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { factoryFixture, taskMarkdown } from "./factory-fixture";
import { defaultRoles } from "../factory/model";
import { parseTasks, contextPack } from "../factory/tasks";

async function publish(f: Awaited<ReturnType<typeof factoryFixture>>) {
  await f.plan.initialize(f.threadId, f.folder, "requirements", false);
  await f.review("requirements.md");
  await f.assess();
  await f.accept("continue");
  await writeFile(
    join(f.root, f.folder, "design.md"),
    "# Design\n\n## Module\nExport sum(a,b) from sum.mjs using numeric addition.\n",
  );
  await f.view();
  await f.review("design.md");
  await f.accept();
  await writeFile(join(f.root, f.folder, "tasks.md"), taskMarkdown);
  await f.view();
  await f.review("tasks.md");
  await f.accept();
  const published = await f.view();
  expect(published.state?.error).toBeNull();
  f.git("add", ".");
  f.git("commit", "-qm", "Accepted spec fixture");
  return published;
}
describe("Beads-backed planning and execution", () => {
  it("checks exact reviews, publishes gated packs, runs actual checks and merges reviewed work", async () => {
    const f = await factoryFixture();
    const initial = await f.plan.initialize(
      f.threadId,
      f.folder,
      "requirements",
      false,
    );
    await expect(f.accept("continue")).rejects.toThrow("Review every");
    await f.review("requirements.md");
    await f.assess();
    await f.accept("continue");
    expect((await f.view()).state?.phase).toBe("design");
    expect(f.sent.join("\n")).toContain("draft design");
    await writeFile(
      join(f.root, f.folder, "design.md"),
      "# Design\n\n## Module\nExport sum(a,b) from sum.mjs using numeric addition.\n",
    );
    await f.view();
    await f.review("design.md");
    await f.accept();
    await writeFile(join(f.root, f.folder, "tasks.md"), taskMarkdown);
    await f.view();
    await f.review("tasks.md");
    await f.accept();
    let view = await f.view();
    expect(view.state?.error).toBeNull();
    expect(view.state?.mode).toBe("ready");
    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].pack).toContain("Return the sum of two numbers.");
    const ready = await f.beads.json("host-1", f.root, [
      "ready",
      "--type",
      "task",
    ]);
    expect(ready).toEqual([]);
    f.git("add", ".");
    f.git("commit", "-qm", "Accepted spec");
    const original = f.git("rev-parse", "HEAD");
    const started = await f.engine.start(
      f.threadId,
      f.folder,
      defaultRoles.worker,
      defaultRoles.reviewer,
      "node --test",
      "",
    );
    expect(started.runs[0]?.state.error).toBeNull();
    await f.engine.tick();
    const afterTick = await f.view();
    expect(
      f.spawned,
      JSON.stringify({
        runs: afterTick.runs,
        tasks: afterTick.tasks.map((t) => ({
          stage: t.state.stage,
          evidence: t.state.evidence,
        })),
        logs: f.harness.logEntries,
      }),
    ).toHaveLength(1);
    expect(f.spawned[0].model).toBe("gpt-6.1-terra");
    await writeFile(
      join(f.spawned[0].path, "sum.mjs"),
      "export const sum=(a,b)=>a+b;\n",
    );
    await writeFile(
      join(f.spawned[0].path, "sum.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {sum} from './sum.mjs';test('sum',()=>{assert.equal(sum(2,3),5);assert.equal(sum(-2,3),1)});\n",
    );
    f.states.set(f.spawned[0].id, "idle");
    f.outputs.set(f.spawned[0].id, "Implemented and checked.");
    await f.engine.tick();
    expect(f.spawned).toHaveLength(2);
    expect(f.spawned[1].model).toBe("gpt-6.1-sol");
    expect(f.spawned[1].reasoningLevel).toBe("xhigh");
    f.states.set(f.spawned[1].id, "idle");
    f.outputs.set(
      f.spawned[1].id,
      "Reviewed implementation and tests.\nFACTORY_REVIEW: PASS",
    );
    f.faults.taskCloseFailure = true;
    await f.engine.tick();
    view = await f.view();
    expect(view.tasks[0].state.stage).toBe("done");
    expect(view.tasks[0].bead.status).not.toBe("closed");
    expect(view.runs[0].state.stage).toBe("running");
    await f.engine.tick();
    view = await f.view();
    expect(
      view.tasks[0].bead.status,
      view.tasks[0].state.evidence.join("\n"),
    ).toBe("closed");
    expect(view.runs[0].state.stage).toBe("complete");
    expect(f.git("rev-parse", "HEAD")).toBe(original);
    expect(f.git("show", `${view.runs[0].state.branch}:sum.mjs`)).toContain(
      "a+b",
    );
    expect(view.tasks[0].state.evidence.join("\n")).toContain("Exit 0");
    expect(initial.state?.revision).toBe(0);
  }, 60000);
  it("reopens an edited accepted phase and invalidates unpublished execution", async () => {
    const f = await factoryFixture();
    await publish(f);
    await writeFile(
      join(f.root, f.folder, "requirements.md"),
      "# Requirements\n\n## Sum\nReturn an integer sum.\n",
    );
    const view = await f.view();
    expect(view.state?.phase).toBe("requirements");
    expect(view.state?.mode).toBe("draft");
    expect(view.state?.sizing).toBeNull();
    expect(view.state?.acceptances).toHaveLength(3);
    expect(view.tasks[0].state.published).toBe(false);
  }, 60000);
  it("rejects task cycles and missing accepted source references", () => {
    const tasks = parseTasks(taskMarkdown);
    expect(tasks[0].responsibilities).toContain("Own sum.mjs");
    expect(() =>
      parseTasks(
        taskMarkdown.replace("### Dependencies\nNone", "### Dependencies\nT1"),
      ),
    ).toThrow("cycle");
    expect(() => contextPack(tasks[0], [])).toThrow("one accepted document");
  });
});

it("includes inherited accepted Requirements even when a task only cites its leaf", () => {
  const task = parseTasks(taskMarkdown)[0];
  const requirement = {
    path: ".kiro/specs/demo/requirements.md",
    sha256: "leaf",
    content: "# Requirements\n## Sum\nSum numbers.\n",
  };
  const design = {
    path: ".kiro/specs/demo/design.md",
    sha256: "design",
    content: "# Design\n## Module\nPure module.\n",
  };
  const parent = {
    path: ".kiro/specs/parent/requirements.md",
    sha256: "parent",
    content: "# Parent\nPreserve shared access boundaries.\n",
  };
  const pack = contextPack(task, [requirement, design, parent], [parent]);
  expect(pack.text).toContain("Preserve shared access boundaries");
  expect(pack.sources.map((source) => source.path)).toContain(parent.path);
});
