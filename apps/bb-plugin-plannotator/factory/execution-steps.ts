import { hash } from "../workspace";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import type { TaskState, RunState } from "./model";
import { workerPrompt, reviewerPrompt } from "./execution-prompts";
export function executionSteps(bb: BbPluginApi, beads: BeadsClient) {
  const git = (run: RunState, root: string, args: string[]) =>
    beads.exec(run.hostId, root, "git", args);
  const saveTask = (
    run: RunState,
    id: string,
    task: TaskState,
    status?: string,
  ) => beads.write(run.hostId, run.root, id, task, status);
  const threadTitle = (
    id: string,
    task: TaskState,
    role: "worker" | "reviewer",
  ) => `Factory ${task.runId} ${id} ${role} ${task.epoch}-${task.attempts}`;
  async function findThread(
    id: string,
    task: TaskState,
    run: RunState,
    role: "worker" | "reviewer",
  ) {
    const prior = await bb.sdk.threads.list({
      projectId: run.projectId,
      originPluginId: "plannotator",
      includeHidden: true,
      limit: 200,
    });
    return prior.find((thread) => thread.title === threadTitle(id, task, role));
  }
  async function associatedThreads(id: string, task: TaskState, run: RunState) {
    const ids = new Set<string>();
    for (const role of ["worker", "reviewer"] as const) {
      const threadId =
        task[role === "worker" ? "workerId" : "reviewerId"] ??
        (await findThread(id, task, run, role))?.id;
      if (threadId) ids.add(threadId);
    }
    return [...ids];
  }
  async function spawn(
    id: string,
    task: TaskState,
    run: RunState,
    role: "worker" | "reviewer",
  ) {
    const pack = (await beads.get(run.hostId, run.root, id)).description;
    if (!pack || hash(pack) !== task.packHash)
      throw new Error(
        "The published task context pack changed. Reaccept Tasks before dispatching it.",
      );
    const title = threadTitle(id, task, role);
    const selection = role === "worker" ? run.worker : run.reviewer;
    // Reconcile completed spawn intents after a server restart before dispatching.
    let thread: { id: string } | undefined = await findThread(
      id,
      task,
      run,
      role,
    );
    if (!thread)
      thread = await bb.sdk.threads.spawn({
        projectId: run.projectId,
        environment: {
          type: "host",
          hostId: run.hostId,
          workspace: { type: "unmanaged", path: task.worktree },
        },
        ...selection,
        title,
        visibility: "visible",
        permissionMode: "auto",
        pluginMetadata: {
          factoryRunId: task.runId,
          beadId: id,
          role,
          attempt: task.attempts,
        },
        prompt:
          role === "worker"
            ? workerPrompt(id, task, run, pack)
            : reviewerPrompt(id, task, run, pack),
      });
    if (role === "worker") task.workerId = thread.id;
    else task.reviewerId = thread.id;
    await saveTask(run, id, task);
  }
  async function failed(
    id: string,
    task: TaskState,
    run: RunState,
    reason: string,
  ) {
    task.evidence.push(reason.slice(-16000));
    task.reviewerId = null;
    if (task.attempts >= 2) {
      task.stage = "blocked";
      await saveTask(run, id, task, "blocked");
      return;
    }
    task.attempts++;
    task.stage = "working";
    task.workerId = null;
    await saveTask(run, id, task);
    await spawn(id, task, run, "worker");
  }
  async function check(run: RunState, root: string) {
    const result = await beads.command(
      run.hostId,
      root,
      "check",
      [],
      run.command,
      600000,
    );
    return {
      ok: result.code === 0,
      evidence:
        `${run.command}\nExit ${result.code}\n${result.stdout}\n${result.stderr}`.slice(
          -16000,
        ),
    };
  }
  async function closeTask(id: string, task: TaskState, run: RunState) {
    await beads.json(run.hostId, run.root, [
      "close",
      id,
      "--actor",
      `factory:${task.runId}`,
      "--reason",
      "Integrated into the factory branch after checks and independent review",
    ]);
  }
  async function sourcesUnchanged(task: TaskState, run: RunState) {
    const paths = task.sources.map(source => source.path);
    const diff = await beads.command(run.hostId, task.worktree!, "git", [
      "diff",
      "--quiet",
      run.base,
      "--",
      ...paths,
      ".beads",
    ]);
    if (diff.code > 1) throw new Error(diff.stderr);
    return diff.code === 0;
  }
  async function advance(id: string, task: TaskState, run: RunState) {
    if (!task.worktree) throw new Error("The task worktree is missing.");
    if (task.stage === "working") {
      if (!task.workerId) {
        await spawn(id, task, run, "worker");
        return;
      }
      const thread = await bb.sdk.threads.get({ threadId: task.workerId });
      if (thread.status === "error")
        return failed(id, task, run, "Worker thread failed.");
      if (thread.status !== "idle" || thread.queuedMessageCount) return;
      const output = await bb.sdk.threads.output({ threadId: task.workerId });
      if (!output.output) return;
      task.evidence.push(output.output.slice(-12000));
      task.stage = "checking";
      await saveTask(run, id, task);
    }
    if (task.stage === "checking") {
      const result = await check(run, task.worktree);
      task.evidence.push(result.evidence);
      if (!result.ok) return failed(id, task, run, result.evidence);
      await git(run, task.worktree, ["add", "--all"]);
      if (!(await sourcesUnchanged(task, run)))
        return failed(
          id,
          task,
          run,
          "The task changed accepted spec documents or Beads files. Restore those changes; implement only the accepted task responsibilities.",
        );
      const staged = await beads.command(run.hostId, task.worktree, "git", [
        "diff",
        "--cached",
        "--quiet",
      ]);
      if (staged.code === 1)
        await git(run, task.worktree, [
          "commit",
          "-m",
          `${id}: verified task implementation`,
        ]);
      else if (staged.code !== 0) throw new Error(staged.stderr);
      task.commit = (
        await git(run, task.worktree, ["rev-parse", "HEAD"])
      ).trim();
      task.stage = "reviewing";
      await saveTask(run, id, task);
      await spawn(id, task, run, "reviewer");
      return;
    }
    if (task.stage === "reviewing") {
      if (!task.reviewerId) {
        await spawn(id, task, run, "reviewer");
        return;
      }
      const thread = await bb.sdk.threads.get({ threadId: task.reviewerId });
      if (thread.status === "error")
        return failed(id, task, run, "Reviewer thread failed.");
      if (thread.status !== "idle" || thread.queuedMessageCount) return;
      const output = (
        await bb.sdk.threads.output({ threadId: task.reviewerId })
      ).output;
      if (!output) return;
      task.evidence.push(output.slice(-16000));
      const clean = !(
        await git(run, task.worktree, ["status", "--porcelain"])
      ).trim();
      if (
        !clean ||
        (await git(run, task.worktree, ["rev-parse", "HEAD"])).trim() !==
          task.commit
      )
        return failed(
          id,
          task,
          run,
          "Reviewer changed the reviewed source. The result must be checked and independently reviewed again.",
        );
      if (output.trim().split("\n").at(-1)?.trim() !== "FACTORY_REVIEW: PASS")
        return failed(id, task, run, output);
      task.stage = "integrating";
      await saveTask(run, id, task);
    }
    if (task.stage === "integrating") {
      const pending = await beads.command(run.hostId, run.worktree, "git", [
        "rev-parse",
        "--verify",
        "MERGE_HEAD",
      ]);
      if (pending.code === 0)
        await git(run, run.worktree, ["merge", "--abort"]);
      const merge = await beads.command(run.hostId, run.worktree, "git", [
        "merge",
        "--no-ff",
        "--no-commit",
        task.commit!,
      ]);
      if (merge.code !== 0) {
        await beads.command(run.hostId, run.worktree, "git", [
          "merge",
          "--abort",
        ]);
        return failed(
          id,
          task,
          run,
          `Integration conflict. Integrate current factory branch ${run.branch} in this task's worktree, resolve the conflict within its responsibilities, and rerun checks.\n${merge.stderr}\n${merge.stdout}`,
        );
      }
      const result = await check(run, run.worktree);
      task.evidence.push(result.evidence);
      const unstaged = await beads.command(run.hostId, run.worktree, "git", [
        "diff",
        "--quiet",
      ]);
      if (!result.ok || unstaged.code !== 0) {
        await beads.command(run.hostId, run.worktree, "git", [
          "merge",
          "--abort",
        ]);
        return failed(
          id,
          task,
          run,
          `Integrated verification failed or changed tracked source.\n${result.evidence}`,
        );
      }
      const needsCommit = await beads.command(run.hostId, run.worktree, "git", [
        "rev-parse",
        "--verify",
        "MERGE_HEAD",
      ]);
      if (needsCommit.code === 0)
        await git(run, run.worktree, [
          "commit",
          "-m",
          `Integrate ${id} after checks and independent review`,
        ]);
      task.stage = "done";
      task.evidence.push(
        `Integrated ${(await git(run, run.worktree, ["rev-parse", "HEAD"])).trim()} into ${run.branch}`,
      );
      await saveTask(run, id, task);
    }
  }
  return { git, saveTask, advance, spawn, closeTask, associatedThreads };
}
