import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SpecSets } from "../spec-sets";
import { folderPath, insideFolder } from "../contracts";
import { hash, workspace, readDocument } from "../workspace";
import {
  specStateSchema,
  taskStateSchema,
  runStateSchema,
  phases,
  phaseFromName,
  type SpecState,
  type Phase,
  type Snapshot,
} from "./model";
import type { BeadsClient } from "./beads";
import type { FactoryView } from "./contracts";
export function planningState(
  bb: BbPluginApi,
  beads: BeadsClient,
  sets: SpecSets,
) {
  async function inventory(threadId: string, input: string) {
    const folder = folderPath.parse(input),
      source = await workspace(bb, threadId),
      catalogue = await sets.session(threadId);
    if (catalogue.truncated)
      throw new Error(
        "Spec discovery is incomplete; refresh a complete inventory before changing phase state.",
      );
    const set = await sets.read(threadId, folder);
    const owned = set.files.filter(
      (file) =>
        !catalogue.specs.some(
          (spec) =>
            spec.folder !== folder &&
            insideFolder(spec.folder, folder) &&
            insideFolder(file.path, spec.folder),
        ),
    );
    if (owned.some((file) => file.error))
      throw new Error(
        "Resolve unreadable spec documents before changing its phase.",
      );
    const documents: Snapshot[] = [];
    for (const file of owned) {
      const doc = await readDocument(bb, threadId, file.path, source);
      documents.push({
        path: doc.path,
        sha256: doc.sha256,
        content: doc.content,
      });
    }
    return {
      threadId,
      source,
      folder,
      documents,
      catalogue,
      allFiles: set.files,
    };
  }
  async function load(threadId: string, folder: string) {
    const data = await inventory(threadId, folder);
    const context = await beads.json(
      data.source.hostId,
      data.source.checkoutRoot,
      ["context"],
    );
    if (!context.project_id)
      throw new Error("Initialize a Beads workspace for this repository.");
    const all = await beads.list(data.source.hostId, data.source.checkoutRoot);
    if (all.length >= 1000)
      throw new Error(
        "Factory inventory exceeds 1,000 beads; narrow the configured factory workspace.",
      );
    const id = `bf-${hash(JSON.stringify([data.source.hostId, context.project_id, data.folder])).slice(0, 16)}`;
    const bead = all.find((b) => b.id === id) ?? null;
    const state = bead ? specStateSchema.parse(bead.metadata?.bbFactory) : null;
    return { ...data, context, all, id, bead, state };
  }
  type Loaded = Awaited<ReturnType<typeof load>>;
  function members(data: Loaded, state: SpecState) {
    const next = { ...state.members };
    for (const doc of data.documents)
      if (!next[doc.path])
        next[doc.path] =
          phaseFromName(doc.path.split("/").at(-1)!) ??
          (state.phase === "design" ? "design" : "reference");
    return next;
  }
  function requireCurrent(data: Loaded, revision?: number): SpecState {
    if (!data.state)
      throw new Error("Initialize this spec's phase tracking first.");
    if (data.state.threadId !== data.threadId)
      throw new Error(
        "Open this spec’s associated planning thread before changing phase state.",
      );
    if (data.state.checkoutRoot !== data.source.checkoutRoot)
      throw new Error(
        "This spec is associated with another checkout. Open its planning thread before changing phase state.",
      );
    if (revision !== undefined && data.state.revision !== revision)
      throw new Error(
        "The spec phase changed. Refresh before applying this action.",
      );
    return { ...data.state, members: members(data, data.state) };
  }
  const persist = (data: Loaded, state: SpecState) =>
    beads.write(data.source.hostId, data.source.checkoutRoot, data.id, state);
  async function synchronize(data: Loaded) {
    if (
      !data.state ||
      data.state.threadId !== data.threadId ||
      data.state.checkoutRoot !== data.source.checkoutRoot
    )
      return data;
    const state = requireCurrent(data);
    let changed =
      JSON.stringify(state.members) !== JSON.stringify(data.state.members);
    // Reopen only this tracked draft; another checkout can never invalidate it by being viewed.
    const accepted = [
      ...new Map(
        state.acceptances
          .filter((a) => phases.indexOf(a.phase) <= phases.indexOf(state.phase))
          .map((a) => [a.phase, a]),
      ).values(),
    ];
    const stale = accepted.filter((a) =>
      a.documents.some(
        (old) =>
          !data.documents.some(
            (doc) => doc.path === old.path && doc.sha256 === old.sha256,
          ),
      ),
    );
    if (
      stale.length &&
      (state.mode !== "draft" ||
        state.phase !== stale[0].phase ||
        state.error !==
          "Accepted source changed; review and accept this phase again.")
    ) {
      state.phase = stale.sort(
        (a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase),
      )[0].phase;
      for (const [path, phase] of Object.entries(state.members))
        if (
          phase !== "reference" &&
          phases.indexOf(phase) >= phases.indexOf(state.phase)
        )
          delete state.reviewed[path];
      state.mode = "draft";
      state.error =
        "Accepted source changed; review and accept this phase again.";
      changed = true;
      for (const bead of data.all) {
        const task = taskStateSchema.safeParse(bead.metadata?.bbFactory);
        if (
          task.success &&
          task.data.specId === data.id &&
          bead.status !== "closed" &&
          !task.data.runId
        )
          await beads.write(
            data.source.hostId,
            data.source.checkoutRoot,
            bead.id,
            {
              ...task.data,
              published: false,
              stage: "blocked",
              evidence: [...task.data.evidence, "Accepted source changed."],
            },
            "blocked",
          );
      }
    }
    if (state.sizing && state.phase === "requirements") {
      const requirements = data.documents.filter(
        (doc) => state.members[doc.path] === "requirements",
      );
      const manifest = hash(
        JSON.stringify(
          requirements.map(({ path, sha256 }) => ({ path, sha256 })),
        ),
      );
      if (manifest !== state.sizing.manifest) {
        state.sizing = null;
        changed = true;
      } else if (!state.sizing.assessment) {
        const thread = await bb.sdk.threads.get({ threadId: state.threadId });
        if (thread.status === "idle" && !thread.queuedMessageCount) {
          const reply = (
            await bb.sdk.threads.output({ threadId: state.threadId })
          ).output;
          if (reply?.trim() && hash(reply) !== state.sizing.previousReplyHash) {
            state.sizing.assessment = reply.slice(-32000);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      state.revision++;
      await persist(data, state);
      return {
        ...data,
        state,
        all: await beads.list(data.source.hostId, data.source.checkoutRoot),
      };
    }
    return data;
  }
  async function view(
    threadId: string,
    folder: string,
    options = { synchronize: true },
  ): Promise<FactoryView> {
    const base = {
      configured: false,
      error: null as string | null,
      spec: null,
      state: null,
      suggestedPhase: "requirements" as Phase,
      files: [],
      treeStatuses: {},
      tasks: [],
      runs: [],
    };
    try {
      const first = await load(threadId, folder);
      const data = options.synchronize
        ? await beads.locked(
            `${first.source.hostId}:${first.context.project_id}`,
            async () => synchronize(await load(threadId, folder)),
          )
        : first;
      const state = data.state;
      const suggestedPhase = data.documents.some(
        (doc) => phaseFromName(doc.path.split("/").at(-1)!) === "tasks",
      )
        ? "tasks"
        : data.documents.some(
              (doc) => phaseFromName(doc.path.split("/").at(-1)!) === "design",
            )
          ? "design"
          : "requirements";
      const previous = state?.acceptances.at(-1)?.inventory ?? [];
      const selectedSpecs = new Map(
        data.all.flatMap((bead) => {
          const parsed = specStateSchema.safeParse(bead.metadata?.bbFactory);
          return parsed.success &&
            (parsed.data.folder === data.folder ||
              insideFolder(parsed.data.folder, data.folder))
            ? [[bead.id, parsed.data] as const]
            : [];
        }),
      );

      return {
        configured: true,
        error:
          state && state.threadId !== threadId
            ? "This spec is associated with another planning thread."
            : state?.checkoutRoot !== undefined &&
                state.checkoutRoot !== data.source.checkoutRoot
              ? "This spec's planning checkout differs from this thread."
              : (state?.error ?? null),
        spec: data.bead
          ? {
              id: data.bead.id,
              title: data.bead.title,
              status: data.bead.status,
            }
          : null,
        state,
        suggestedPhase,
        files: data.documents.map((doc) => ({
          path: doc.path,
          sha256: doc.sha256,
          phase:
            state?.members[doc.path] ??
            phaseFromName(doc.path.split("/").at(-1)!) ??
            "reference",
          reviewed: state?.reviewed[doc.path] === doc.sha256,
          added:
            !!state?.acceptances.length &&
            !previous.some((old) => old.path === doc.path),
        })),
        treeStatuses: Object.fromEntries(
          data.allFiles.flatMap((file) => {
            const owner = [...selectedSpecs.values()]
              .filter(
                (spec) =>
                  file.path.startsWith(`${spec.folder}/`) ||
                  spec.folder === ".",
              )
              .sort((a, b) => b.folder.length - a.folder.length)[0];
            if (!owner) return [];
            const member = owner.members[file.path];
            const status =
              member === "reference"
                ? "reference"
                : owner.reviewed[file.path] === file.sha256
                  ? "reviewed"
                  : owner.reviewed[file.path]
                    ? "changed"
                    : "unreviewed";
            return [[file.path, status]];
          }),
        ),
        tasks: data.all.flatMap((bead) => {
          const task = taskStateSchema.safeParse(bead.metadata?.bbFactory);
          return task.success &&
            selectedSpecs.get(task.data.specId)?.taskIds.includes(bead.id)
            ? [
                {
                  bead: { id: bead.id, title: bead.title, status: bead.status },
                  state: task.data,
                  pack: bead.description ?? "",
                },
              ]
            : [];
        }),
        runs: data.all.flatMap((bead) => {
          const run = runStateSchema.safeParse(bead.metadata?.bbFactory);
          return run.success &&
            (run.data.specId === data.id ||
              run.data.taskIds.some((id) =>
                [...selectedSpecs.values()].some((spec) =>
                  spec.taskIds.includes(id),
                ),
              ))
            ? [
                {
                  bead: { id: bead.id, title: bead.title, status: bead.status },
                  state: run.data,
                },
              ]
            : [];
        }),
      };
    } catch (cause) {
      return {
        ...base,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }
  return {
    inventory,
    load,
    members,
    requireCurrent,
    persist,
    synchronize,
    view,
  };
}
