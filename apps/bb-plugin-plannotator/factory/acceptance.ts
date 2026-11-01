import { preparePublication } from "./publication-plan";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import type { Planning } from "./planning";
import {
  phases,
  now,
  specStateSchema,
  phaseFromName,
  manifestKey,
  runStateSchema,
  taskStateSchema,
  type Phase,
  type SpecState,
  type Snapshot,
  type TaskState,
} from "./model";
import { hash, readDocument } from "../workspace";
import { insideFolder } from "../contracts";

export function acceptance(
  bb: BbPluginApi,
  beads: BeadsClient,
  plan: Planning,
) {
  async function accept(
    threadId: string,
    folder: string,
    revision: number,
    manifest: { path: string; sha256: string }[],
    decision?: "continue" | "split",
  ) {
    const first = await plan.load(threadId, folder);
    return beads.locked(
      `${first.source.hostId}:${first.context.project_id}`,
      async () => {
        const data = await plan.synchronize(await plan.load(threadId, folder)),
          state = plan.requireCurrent(data, revision);
        if (!["draft", "publishing"].includes(state.mode))
          throw new Error(
            "This phase is already accepted. Reopen it before accepting a new revision.",
          );
        if (manifestKey(manifest) !== manifestKey(data.documents))
          throw new Error(
            "The spec documents changed. Refresh and review them before accepting.",
          );
        const documents = data.documents.filter(
          (doc) => state.members[doc.path] === state.phase,
        );
        if (
          !documents.length ||
          (state.phase !== "design" && documents.length !== 1)
        )
          throw new Error(
            `${state.phase} requires ${state.phase === "design" ? "at least one review document" : "exactly one review document"}. Correct phase membership first.`,
          );
        if (
          state.phase !== "design" &&
          phaseFromName(documents[0].path.split("/").at(-1)!) !== state.phase
        )
          throw new Error(
            `The ${state.phase} document must contain that word in its filename.`,
          );
        if (documents.some((doc) => state.reviewed[doc.path] !== doc.sha256))
          throw new Error(
            "Review every current document in this phase before accepting it.",
          );
        if (state.pendingPrompt)
          throw new Error(
            "Resolve the pending phase instruction before accepting another phase.",
          );
        const active = data.all.some((bead) => {
          const task = taskStateSchema.safeParse(bead.metadata?.bbFactory);
          return (
            task.success &&
            task.data.specId === data.id &&
            task.data.runId &&
            !["done", "blocked"].includes(task.data.stage)
          );
        });
        if (active)
          throw new Error(
            "Pause and resolve active factory work before changing accepted source phases.",
          );
        if (state.phase === "requirements") {
          const sizingManifest = hash(
            JSON.stringify(
              documents.map((doc) => ({ path: doc.path, sha256: doc.sha256 })),
            ),
          );
          if (
            !state.sizing?.assessment ||
            state.sizing.manifest !== sizingManifest
          )
            throw new Error(
              "Request the agent's size assessment for these reviewed Requirements before deciding how to proceed.",
            );
          if (!decision)
            throw new Error(
              "Choose Continue to Design or Break into child specs after the sizing assessment.",
            );
          if (
            decision === "continue" &&
            data.catalogue.specs.some(
              (s) => s.folder !== folder && insideFolder(s.folder, folder),
            )
          )
            throw new Error(
              "This parent has child specs and remains at Requirements. Accept a breakdown instead.",
            );
        }
        const publication =
          state.phase === "tasks"
            ? await preparePublication(
                bb,
                beads,
                threadId,
                data,
                state,
                documents,
              )
            : null;
        if (state.mode !== "publishing")
          state.acceptances.push({
            phase: state.phase,
            at: now(),
            documents,
            inventory: data.documents.map((d) => ({
              path: d.path,
              sha256: d.sha256,
            })),
            ...(decision
              ? { decision, assessment: state.sizing!.assessment! }
              : {}),
          });
        state.error = null;
        state.revision++;
        if (state.phase === "tasks") {
          const { packs, generation, sourceManifest } = publication!;
          state.mode = "publishing";
          state.authorizationId = `bf-${hash(`${data.id}:authorize:${generation}`).slice(0, 20)}`;
          state.taskIds = packs.map((pack) => pack.id);
          await plan.persist(data, state);
          try {
            await beads.create(
              data.source.hostId,
              data.source.checkoutRoot,
              state.authorizationId,
              "Authorize implementation of accepted Tasks",
              "gate",
              { kind: "authorization", specId: data.id, generation },
            );
            for (const pack of packs) {
              const task: TaskState = {
                kind: "task",
                specId: data.id,
                key: pack.key,
                packHash: pack.pack.hash,
                sources: sourceManifest.map((s) => ({ ...s, content: "" })),
                generation,
                published: false,
                runId: null,
                stage: "pending",
                attempts: 0,
                epoch: 0,
                workerId: null,
                reviewerId: null,
                worktree: null,
                base: null,
                commit: null,
                branch: null,
                evidence: [],
                dependencies: pack.dependencies,
              };
              await beads.create(
                data.source.hostId,
                data.source.checkoutRoot,
                pack.id,
                `${pack.key}: ${pack.title}`,
                "task",
                task,
                data.id,
                pack.pack.text,
                "blocked",
              );
            }
            for (const pack of packs) {
              for (const dependency of [
                state.authorizationId,
                ...pack.dependencies,
              ])
                await beads.json(data.source.hostId, data.source.checkoutRoot, [
                  "dep",
                  "add",
                  pack.id,
                  dependency,
                ]);
            }
            for (const pack of packs) {
              const bead = await beads.get(
                  data.source.hostId,
                  data.source.checkoutRoot,
                  pack.id,
                ),
                task = taskStateSchema.parse(bead.metadata?.bbFactory);
              if (
                task.specId !== data.id ||
                task.generation !== generation ||
                task.packHash !== pack.pack.hash ||
                hash(bead.description ?? "") !== pack.pack.hash
              )
                throw new Error(
                  `Published task ${pack.id} differs from the accepted pack.`,
                );
              await beads.write(
                data.source.hostId,
                data.source.checkoutRoot,
                pack.id,
                { ...task, published: true },
                bead.status === "closed" ? undefined : "open",
              );
            }
            state.mode = "ready";
          } catch (cause) {
            state.error = `Publication incomplete: ${cause instanceof Error ? cause.message : String(cause)}`;
            state.revision++;
            await plan.persist(data, state);
            return plan.view(threadId, folder, { synchronize: false });
          }
        } else if (state.phase === "requirements" && decision === "split")
          state.mode = "decomposed";
        else {
          state.phase = phases[phases.indexOf(state.phase) + 1];
          state.mode = "draft";
        }
        const message =
          state.mode === "ready"
            ? `The user accepted Tasks for spec ${JSON.stringify(folder)}. Beads tasks ${state.taskIds.join(", ")} and their context packs are published. Acknowledge and wait for a separate Start factory action; do not begin implementation.`
            : state.mode === "decomposed"
              ? `The user accepted Requirements and chose to break ${JSON.stringify(folder)} into child specs. Draft child requirements.md documents in descendant folders, with clear responsibilities inherited from the parent. The parent remains at accepted Requirements. Stop for child Requirements review and sizing; do not draft Design or implement code.`
              : `The user accepted ${state.acceptances.at(-1)!.phase} for ${JSON.stringify(folder)} at the recorded exact document versions. Read those accepted documents and draft ${state.phase}. ${state.phase === "tasks" ? (await import("./tasks")).taskAuthoringInstructions : "Design may use multiple review documents. Stop for review and acceptance; do not implement code."}`;
        state.pendingPrompt = {
          key: `phase:${data.id}:${state.revision}`,
          text: message,
        };
        await plan.persist(data, state);
        await sendPending(data, state);
        return plan.view(threadId, folder, { synchronize: false });
      },
    );
  }
  async function sendPending(
    data: Awaited<ReturnType<Planning["load"]>>,
    state: SpecState,
    resend = false,
  ) {
    if (!state.pendingPrompt) return;
    const result = await plan.deliver(
      state.pendingPrompt.key,
      state.threadId,
      state.pendingPrompt.text,
      resend,
    );
    if (result.status === "sent") state.pendingPrompt = null;
    state.error = result.error;
    state.revision++;
    await plan.persist(data, state);
  }
  async function member(
    threadId: string,
    folder: string,
    revision: number,
    path: string,
    phase: Phase | "reference",
  ) {
    const data = await plan.load(threadId, folder);
    return beads.locked(
      `${data.source.hostId}:${data.context.project_id}`,
      async () => {
        const fresh = await plan.load(threadId, folder),
          state = plan.requireCurrent(fresh, revision);
        if (!fresh.documents.some((doc) => doc.path === path))
          throw new Error(
            "This document belongs to another spec or is unavailable.",
          );
        if (state.mode !== "draft")
          throw new Error(
            "Return to a draft phase before changing accepted document membership.",
          );
        state.members[path] = phase;
        delete state.reviewed[path];
        state.revision++;
        await plan.persist(fresh, state);
        return plan.view(threadId, folder, { synchronize: false });
      },
    );
  }
  async function returnTo(
    threadId: string,
    folder: string,
    revision: number,
    phase: Phase,
  ) {
    const first = await plan.load(threadId, folder);
    return beads.locked(
      `${first.source.hostId}:${first.context.project_id}`,
      async () => {
        const data = await plan.load(threadId, folder),
          state = plan.requireCurrent(data, revision);
        if (phases.indexOf(phase) > phases.indexOf(state.phase))
          throw new Error("Accept the current phase before advancing.");
        if (
          data.all.some((b) => {
            const r = runStateSchema.safeParse(b.metadata?.bbFactory);
            return (
              r.success &&
              ["running", "paused", "starting"].includes(r.data.stage) &&
              r.data.taskIds.some((id) => state.taskIds.includes(id))
            );
          })
        )
          throw new Error(
            "Stop the active factory run before reopening accepted planning.",
          );
        state.phase = phase;
        state.mode = "draft";
        state.pendingPrompt = null;
        state.error = null;
        state.revision++;
        for (const [path, member] of Object.entries(state.members))
          if (
            member !== "reference" &&
            phases.indexOf(member) >= phases.indexOf(phase)
          )
            delete state.reviewed[path];
        for (const id of state.taskIds) {
          const b = await beads.get(
              data.source.hostId,
              data.source.checkoutRoot,
              id,
            ),
            task = taskStateSchema.parse(b.metadata?.bbFactory);
          if (b.status !== "closed")
            await beads.write(
              data.source.hostId,
              data.source.checkoutRoot,
              id,
              { ...task, published: false, stage: "blocked" },
              "blocked",
            );
        }
        await plan.persist(data, state);
        return plan.view(threadId, folder, { synchronize: false });
      },
    );
  }
  return { accept, member, sendPending, returnTo };
}
