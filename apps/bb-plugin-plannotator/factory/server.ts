import { preparePublication } from "./publication-plan";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SpecSets } from "../spec-sets";
import type { ReviewStore } from "../review-store";
import { workspace, hash } from "../workspace";
import { parentFolder } from "../contracts";
import { beadsClient } from "./beads";
import { planning } from "./planning";
import { acceptance } from "./acceptance";
import { execution } from "./execution";
import { factoryContract } from "./contracts";
import type { SpecState } from "./model";

export function factory(bb: BbPluginApi, sets: SpecSets, store: ReviewStore) {
  const beads = beadsClient(bb),
    plan = planning(bb, beads, sets, store),
    accept = acceptance(bb, beads, plan),
    engine = execution(bb, beads, plan);
  bb.rpc.register(factoryContract, {
    factoryStatus: async ({ threadId, folder }) => {
      const result = await plan.view(threadId, folder);
      if (
        result.runs.some((r) =>
          ["running", "paused", "starting"].includes(r.state.stage),
        )
      ) {
        const source = await workspace(bb, threadId);
        await engine.remember({
          hostId: source.hostId,
          root: source.checkoutRoot,
        });
      }
      return result;
    },
    factorySetup: async ({ threadId }) => {
      const source = await workspace(bb, threadId);
      await beads.ensureContext(source);
      return { ok: true as const };
    },
    factoryInitialize: ({
      threadId,
      folder,
      phase,
      confirmPrior,
      manifest,
      members,
    }) =>
      plan.initialize(threadId, folder, phase, confirmPrior, {
        manifest,
        members,
      }),
    factoryMember: ({ threadId, folder, revision, path, phase }) =>
      accept.member(threadId, folder, revision, path, phase),
    factoryAccept: ({ threadId, folder, revision, manifest, decision }) =>
      accept.accept(threadId, folder, revision, manifest, decision),
    factoryReturn: ({ threadId, folder, revision, phase }) =>
      accept.returnTo(threadId, folder, revision, phase),
    factoryRetry: ({ threadId, folder, runId, beadId }) =>
      engine.retry(threadId, folder, runId, beadId),
    factoryStop: ({ threadId, folder, runId }) =>
      engine.stop(threadId, folder, runId),
    factoryPreview: async ({ threadId, folder }) => {
      const data = await plan.load(threadId, folder),
        state = plan.requireCurrent(data);
      if (state.phase !== "tasks")
        throw new Error("Context packs are prepared during the Tasks phase.");
      const documents = data.documents.filter(
        (d) => state.members[d.path] === "tasks",
      );
      if (documents.length !== 1)
        throw new Error("Choose one Tasks document first.");
      const prepared = await preparePublication(
        bb,
        beads,
        threadId,
        data,
        state,
        documents,
      );
      return prepared.packs.map((p) => ({
        key: p.key,
        title: p.title,
        pack: p.pack.text,
        sources: p.pack.sources.map(({ path, sha256 }) => ({ path, sha256 })),
      }));
    },
    factoryDraft: async ({ threadId, folder, action, idea }) => {
      await plan.draft(threadId, folder, action, idea);
      return { ok: true as const };
    },
    factoryDeliver: async ({ threadId, folder, resend }) => {
      const first = await plan.load(threadId, folder);
      return beads.locked(
        `${first.source.hostId}:${first.context.project_id}`,
        async () => {
          const data = await plan.load(threadId, folder),
            state = plan.requireCurrent(data);
          await accept.sendPending(data, state, resend);
          return plan.view(threadId, folder, { synchronize: false });
        },
      );
    },
    factoryNewSpec: async ({ threadId, name, idea }) => {
      const source = await workspace(bb, threadId),
        catalogue = await sets.session(threadId);
      const root = parentFolder(
        catalogue.specs.sort((a, b) => a.folder.length - b.folder.length)[0]
          ?.folder ?? ".kiro/specs/example",
      );
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!slug)
        throw new Error("Choose a spec name containing letters or numbers.");
      const folder = root === "." ? slug : `${root}/${slug}`;
      if (catalogue.specs.some((s) => s.folder === folder))
        throw new Error("A spec with that name already exists.");
      const context = await beads.ensureContext(source);
      const id = `bf-${hash(JSON.stringify([source.hostId, context.project_id, folder])).slice(0, 16)}`;
      const state: SpecState = {
        kind: "spec",
        checkoutRoot: source.checkoutRoot,
        folder,
        threadId,
        phase: "requirements",
        revision: 0,
        mode: "draft",
        members: {},
        reviewed: {},
        acceptances: [],
        taskIds: [],
        authorizationId: null,
        pendingPrompt: null,
        sizing: null,
        parentId: null,
        error: null,
      };
      await beads.create(
        source.hostId,
        source.checkoutRoot,
        id,
        name,
        "epic",
        state,
      );
      const result = await plan.deliver(
        `new:${id}`,
        threadId,
        `Work with the user on a new spec named ${JSON.stringify(name)}. Beads identity ${id}. Read applicable repository instructions and draft one requirements.md in ${JSON.stringify(folder)}. Clarify missing product decisions in this conversation. Stop for Requirements review and size assessment before any Design or implementation.\n\nUser idea:\n${idea}`,
      );
      if (result.error) throw new Error(result.error);
      await bb.storage.kv.set(`selected-folder:${threadId}`, folder);
      return { folder };
    },
    factoryStart: ({
      threadId,
      folder,
      worker,
      reviewer,
      command,
      setupCommand,
    }) =>
      engine.start(threadId, folder, worker, reviewer, command, setupCommand),
    factoryPause: ({ threadId, folder, runId }) =>
      engine.change(threadId, folder, runId, "paused"),
    factoryResume: ({ threadId, folder, runId }) =>
      engine.change(threadId, folder, runId, "running"),
  });
  bb.background.service("beads-factory", {
    async start(signal) {
      while (!signal.aborted) {
        await engine.tick();
        await new Promise<void>((resolve) => {
          const end = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", end);
            resolve();
          };
          const timer = setTimeout(end, 5000);
          signal.addEventListener("abort", end, { once: true });
          if (signal.aborted) end();
        });
      }
    },
  });
  return { plan, engine, beads };
}
