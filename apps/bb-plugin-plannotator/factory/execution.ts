import { runAuthority } from "./run-authority";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import type { Planning } from "./planning";
import {
  taskStateSchema,
  runStateSchema,
  type RunState,
  type TaskState,
  type Bead,
} from "./model";
import { workspace } from "../workspace";
import { executionSteps } from "./execution-steps";
import { runStart } from "./run-start";
export function execution(bb: BbPluginApi, beads: BeadsClient, plan: Planning) {
  type Location = { hostId: string; root: string };
  async function remember(location: Location) {
    const locations = ((await bb.storage.kv.get("factory-locations")) ??
      []) as Location[];
    if (
      !locations.some(
        (l) => l.hostId === location.hostId && l.root === location.root,
      )
    )
      await bb.storage.kv.set("factory-locations", [...locations, location]);
  }
  const steps = executionSteps(bb, beads);
  const authority = runAuthority(bb, beads);
  const { git, saveTask, advance, spawn, closeTask, associatedThreads } = steps;
  const saveRun = (id: string, run: RunState) =>
    beads.write(run.hostId, run.root, id, run);
  const start = runStart(bb, beads, plan, remember, steps);
  async function tickLocation(location: Location) {
    const all = await beads.list(location.hostId, location.root);
    for (const bead of all) {
      const parsed = runStateSchema.safeParse(bead.metadata?.bbFactory);
      if (!parsed.success || parsed.data.stage !== "running") continue;
      const run = parsed.data;
      await beads.locked(`${run.hostId}:${run.root}:execution`, async () => {
        const fresh = runStateSchema.parse(
          (await beads.get(run.hostId, run.root, bead.id)).metadata?.bbFactory,
        );
        if (fresh.stage !== "running") return;
        const tasks: { bead: Bead; state: TaskState }[] = [];
        for (const id of run.taskIds) {
          const b = await beads.get(run.hostId, run.root, id);
          tasks.push({
            bead: b,
            state: taskStateSchema.parse(b.metadata?.bbFactory),
          });
        }
        try {
          await authority.validate(run, tasks);
        } catch (cause) {
          run.stage = "paused";
          run.error = String(cause);
          await saveRun(bead.id, run);
          await authority.gates(run, true);
          return;
        }
        for (const task of tasks.filter(
          (t) => !["pending", "done", "blocked"].includes(t.state.stage),
        )) {
          try {
            await advance(task.bead.id, task.state, run);
          } catch (cause) {
            task.state.stage = "blocked";
            task.state.evidence.push(
              `Factory operation failed; work preserved: ${String(cause).slice(-12000)}`,
            );
            await saveTask(run, task.bead.id, task.state, "blocked");
          }
        }
        for (const task of tasks.filter(
          (t) => t.state.stage === "done" && t.bead.status !== "closed",
        ))
          await closeTask(task.bead.id, task.state, run);
        const latest = await Promise.all(
          run.taskIds.map((id) => beads.get(run.hostId, run.root, id)),
        );
        const states = latest.map((b) =>
          taskStateSchema.parse(b.metadata?.bbFactory),
        );
        const active = states.filter(
          (t) => !["pending", "done", "blocked"].includes(t.stage),
        ).length;
        const ready = await beads.json(run.hostId, run.root, [
          "ready",
          "--type",
          "task",
          "--label",
          "bb-factory",
          "--limit",
          "1000",
        ]);
        let slots = 2 - active;
        for (const b of latest) {
          const task = taskStateSchema.parse(b.metadata?.bbFactory);
          if (slots <= 0) break;
          if (
            task.stage !== "pending" ||
            !Array.isArray(ready) ||
            !ready.some((r: { id: string }) => r.id === b.id)
          )
            continue;
          const claim = await beads.command(run.hostId, run.root, "bd", [
            "update",
            b.id,
            "--if-status",
            "open",
            "--if-assignee",
            "",
            "--assignee",
            `factory:${bead.id}`,
            "--status",
            "in_progress",
            "--json",
          ]);
          if (claim.code !== 0) continue;
          slots--;
          try {
            task.base = (
              await git(run, run.worktree, ["rev-parse", "HEAD"])
            ).trim();
            task.branch = `factory-task/${task.runId}/${b.id}`;
            task.worktree = `${run.root}.factory/${task.runId}/${b.id}`;
            await git(run, run.root, [
              "worktree",
              "add",
              "-b",
              task.branch,
              task.worktree,
              task.base,
            ]);
            if (run.setupCommand) {
              const setup = await beads.command(
                run.hostId,
                task.worktree,
                "check",
                [],
                run.setupCommand,
                600000,
              );
              if (setup.code !== 0)
                throw new Error(
                  `Task setup failed: ${setup.stderr} ${setup.stdout}`,
                );
            }
            task.stage = "working";
            await saveTask(run, b.id, task);
            await spawn(b.id, task, run, "worker");
          } catch (cause) {
            task.stage = "blocked";
            task.evidence.push(String(cause));
            await saveTask(run, b.id, task, "blocked");
          }
        }
        const final = await Promise.all(
          run.taskIds.map((id) => beads.get(run.hostId, run.root, id)),
        );
        if (final.every((b) => b.status === "closed")) {
          run.stage = "complete";
          run.error = null;
          await beads.json(run.hostId, run.root, [
            "close",
            bead.id,
            "--reason",
            "Selected task set integrated and verified",
          ]);
          await saveRun(bead.id, run);
        } else if (
          !final.some(
            (b) =>
              !["pending", "done", "blocked"].includes(
                taskStateSchema.parse(b.metadata?.bbFactory).stage,
              ),
          ) &&
          !final.some(
            (b) =>
              taskStateSchema.parse(b.metadata?.bbFactory).stage ===
                "pending" &&
              Array.isArray(ready) &&
              ready.some((r: { id: string }) => r.id === b.id),
          )
        ) {
          run.stage = "blocked";
          run.error =
            "Remaining work is blocked. Inspect task evidence and prerequisites.";
          await saveRun(bead.id, run);
        }
        bb.realtime.publish("document-review", { threadId: run.threadId });
      });
    }
  }
  async function tick() {
    const locations = ((await bb.storage.kv.get("factory-locations")) ??
      []) as Location[];
    for (const location of locations)
      try {
        await tickLocation(location);
      } catch (cause) {
        bb.log.warn(
          `Factory refresh failed (${location.root}): ${String(cause)}`,
        );
      }
  }
  async function change(
    threadId: string,
    folder: string,
    runId: string,
    stage: "paused" | "running",
  ) {
    const source = await workspace(bb, threadId);
    return beads.locked(
      `${source.hostId}:${source.checkoutRoot}:execution`,
      async () => {
        const run = runStateSchema.parse(
          (await beads.get(source.hostId, source.checkoutRoot, runId)).metadata
            ?.bbFactory,
        );
        if (run.root !== source.checkoutRoot || run.threadId !== threadId)
          throw new Error(
            "This run belongs to another planning thread or checkout.",
          );
        if (run.stage === "complete")
          throw new Error("This run is already complete.");
        if (stage === "running") {
          const records = await authority.validate(run);
          if (records.some((t) => t.state.runId !== runId))
            throw new Error(
              "Run setup did not finish. Stop this run and reaccept Tasks to publish a fresh work set.",
            );
          await git(run, run.worktree, ["rev-parse", "HEAD"]);
          await authority.gates(run, false);
        }
        run.stage = stage;
        run.error = null;
        await saveRun(runId, run);
        if (stage === "paused") await authority.gates(run, true);
        await remember({ hostId: run.hostId, root: run.root });
        return plan.view(threadId, folder);
      },
    );
  }
  async function retry(
    threadId: string,
    folder: string,
    runId: string,
    beadId: string,
  ) {
    const source = await workspace(bb, threadId);
    return beads.locked(
      `${source.hostId}:${source.checkoutRoot}:execution`,
      async () => {
        const run = runStateSchema.parse(
          (await beads.get(source.hostId, source.checkoutRoot, runId)).metadata
            ?.bbFactory,
        );
        if (
          run.threadId !== threadId ||
          run.root !== source.checkoutRoot ||
          !run.taskIds.includes(beadId)
        )
          throw new Error("This task belongs to another run.");
        const bead = await beads.get(run.hostId, run.root, beadId),
          task = taskStateSchema.parse(bead.metadata?.bbFactory);
        if (task.stage !== "blocked" || !task.worktree)
          throw new Error(
            "Only a blocked task with a preserved worktree can be retried.",
          );
        for (const id of await associatedThreads(beadId, task, run))
          if (
            id &&
            !["idle", "error"].includes(
              (await bb.sdk.threads.get({ threadId: id })).status,
            )
          )
            throw new Error(
              "The previous agent is still running or needs attention. Resolve that thread before retrying.",
            );
        await authority.validate(run);
        await authority.gates(run, false);
        task.attempts = 0;
        task.epoch++;
        task.workerId = null;
        task.reviewerId = null;
        task.stage = "working";
        task.published = true;
        task.evidence.push("User requested a fresh correction budget.");
        await saveTask(run, beadId, task, "in_progress");
        run.stage = "running";
        run.error = null;
        await saveRun(runId, run);
        await remember({ hostId: run.hostId, root: run.root });
        return plan.view(threadId, folder);
      },
    );
  }
  async function stop(threadId: string, folder: string, runId: string) {
    const source = await workspace(bb, threadId);
    return beads.locked(
      `${source.hostId}:${source.checkoutRoot}:execution`,
      async () => {
        const run = runStateSchema.parse(
          (await beads.get(source.hostId, source.checkoutRoot, runId)).metadata
            ?.bbFactory,
        );
        if (run.threadId !== threadId || run.root !== source.checkoutRoot)
          throw new Error("This run belongs to another planning thread.");
        if (run.stage === "complete")
          throw new Error("This run is already complete.");
        run.stage = "blocked";
        run.error =
          "Stopped by user. Branches and worktrees are preserved. Reopen and accept Tasks to publish a fresh work set.";
        await saveRun(runId, run);
        await authority.gates(run, true);
        for (const id of run.taskIds) {
          const b = await beads.get(run.hostId, run.root, id),
            task = taskStateSchema.parse(b.metadata?.bbFactory);
          if (b.status === "closed") continue;
          for (const threadId of await associatedThreads(id, task, run))
            if (threadId) {
              const t = await bb.sdk.threads.get({ threadId });
              if (!["idle", "error"].includes(t.status))
                await bb.sdk.threads.stop({ threadId });
            }
          task.stage = "blocked";
          task.published = false;
          task.evidence.push("Run stopped by user; partial work preserved.");
          await saveTask(run, id, task, "blocked");
        }
        return plan.view(threadId, folder);
      },
    );
  }
  return { start, tick, change, remember, retry, stop };
}
