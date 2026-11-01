import { runAuthority } from "./run-authority";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import type { Planning } from "./planning";
import {
  runStateSchema,
  taskStateSchema,
  specStateSchema,
  now,
  type Role,
  type RunState,
} from "./model";
import { hash, workspace } from "../workspace";
import { insideFolder } from "../contracts";
import type { executionSteps } from "./execution-steps";
export function runStart(
  bb: BbPluginApi,
  beads: BeadsClient,
  plan: Planning,
  remember: (location: { hostId: string; root: string }) => Promise<void>,
  steps: ReturnType<typeof executionSteps>,
) {
  const { git, saveTask } = steps;
  const authority = runAuthority(bb, beads);
  const saveRun = (id: string, run: RunState) =>
    beads.write(run.hostId, run.root, id, run);
  async function validateRole(role: Role, environmentId: string) {
    const models = await bb.sdk.providers.models({
      providerId: role.providerId,
      environmentId,
    });
    const model = models.models.find((model) => model.id === role.model);
    if (
      !model ||
      !model.supportedReasoningEfforts?.some(
        (e) => e.reasoningEffort === role.reasoningLevel,
      )
    )
      throw new Error(
        `Unavailable model/effort: ${role.providerId}/${role.model}/${role.reasoningLevel}`,
      );
  }
  async function start(
    threadId: string,
    folder: string,
    worker: Role,
    reviewer: Role,
    command: string,
    setupCommand: string,
  ) {
    const source = await workspace(bb, threadId),
      thread = await bb.sdk.threads.get({ threadId });
    await validateRole(worker, source.environmentId);
    await validateRole(reviewer, source.environmentId);
    const data = await plan.load(threadId, folder);
    plan.requireCurrent(data);
    return beads.locked(
      `${source.hostId}:${data.context.project_id}`,
      async () => {
        const all = await beads.list(source.hostId, source.checkoutRoot);
        if (
          all.some((b) => {
            const r = runStateSchema.safeParse(b.metadata?.bbFactory);
            return (
              r.success &&
              ["running", "starting", "paused"].includes(r.data.stage)
            );
          })
        )
          throw new Error(
            "This project already has an active or paused factory run.",
          );
        const selectedSpecs = new Map(
          all.flatMap((b) => {
            const s = specStateSchema.safeParse(b.metadata?.bbFactory);
            return s.success &&
              (s.data.folder === folder || insideFolder(s.data.folder, folder))
              ? [[b.id, s.data] as const]
              : [];
          }),
        );
        const tasks = all.filter((b) => {
          const t = taskStateSchema.safeParse(b.metadata?.bbFactory);
          return (
            t.success &&
            selectedSpecs.get(t.data.specId)?.mode === "ready" &&
            selectedSpecs.get(t.data.specId)?.taskIds.includes(b.id) &&
            t.data.published &&
            b.status !== "closed"
          );
        });
        if (!tasks.length)
          throw new Error(
            "Accept and publish Tasks before starting the factory.",
          );
        if (
          tasks.some((b) => taskStateSchema.parse(b.metadata?.bbFactory).runId)
        )
          throw new Error(
            "Some selected tasks belong to an earlier run. Resume or resolve that run first.",
          );
        if (
          (
            await beads.exec(source.hostId, source.checkoutRoot, "git", [
              "status",
              "--porcelain",
            ])
          ).trim()
        )
          throw new Error(
            "Commit or stash workspace changes before Start factory; the run begins from the current committed code.",
          );
        const id = `bf-${hash(randomUUID()).slice(0, 20)}`,
          branch = `factory/${id}`,
          base = (
            await beads.exec(source.hostId, source.checkoutRoot, "git", [
              "rev-parse",
              "HEAD",
            ])
          ).trim();
        const run: RunState = {
          kind: "run",
          threadId,
          projectId: thread.projectId,
          hostId: source.hostId,
          root: source.checkoutRoot,
          specId: data.id,
          taskIds: tasks.map((b) => b.id),
          stage: "starting",
          authorizationIds: [
            ...new Set(
              tasks
                .map(
                  (b) =>
                    selectedSpecs.get(
                      taskStateSchema.parse(b.metadata?.bbFactory).specId,
                    )?.authorizationId,
                )
                .filter((id): id is string => !!id),
            ),
          ],
          branch,
          worktree: `${source.checkoutRoot}.factory/${id}/integration`,
          base,
          command,
          setupCommand,
          worker,
          reviewer,
          startedAt: now(),
          error: null,
        };
        await authority.validate(
          run,
          tasks.map((bead) => ({
            bead,
            state: taskStateSchema.parse(bead.metadata?.bbFactory),
          })),
        );
        await beads.create(
          source.hostId,
          source.checkoutRoot,
          id,
          `Factory ${folder}`,
          "epic",
          run,
        );
        await remember({ hostId: source.hostId, root: source.checkoutRoot });
        try {
          await git(run, run.root, [
            "worktree",
            "add",
            "-b",
            branch,
            run.worktree,
            base,
          ]);
          if (setupCommand) {
            const setup = await beads.command(
              run.hostId,
              run.worktree,
              "check",
              [],
              setupCommand,
              600000,
            );
            if (setup.code !== 0)
              throw new Error(
                `Integration setup failed: ${setup.stderr} ${setup.stdout}`,
              );
          }
          for (const bead of tasks) {
            const task = taskStateSchema.parse(bead.metadata?.bbFactory);
            await saveTask(run, bead.id, { ...task, runId: id });
          }
          await authority.gates(run, false);
          run.stage = "running";
          await saveRun(id, run);
        } catch (cause) {
          run.stage = "blocked";
          run.error = String(cause);
          await saveRun(id, run);
        }
        return plan.view(threadId, folder, { synchronize: false });
      },
    );
  }
  return start;
}
