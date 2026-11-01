import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SpecSets } from "../spec-sets";
import type { ReviewStore } from "../review-store";
import type { ReviewTarget } from "../contracts";
import { insideFolder } from "../contracts";
import { hash, readDocument } from "../workspace";
import { messageDelivery } from "../message-delivery";
import {
  now,
  phases,
  manifestKey,
  phaseFromName,
  type SpecState,
  type Phase,
} from "./model";
import type { BeadsClient } from "./beads";
import { taskAuthoringInstructions } from "./tasks";
import { planningState } from "./planning-state";
export function planning(
  bb: BbPluginApi,
  beads: BeadsClient,
  sets: SpecSets,
  store: ReviewStore,
) {
  const stateStore = planningState(bb, beads, sets);
  const { load, members, persist, requireCurrent, view } = stateStore;
  const deliver = messageDelivery(bb, store);
  async function initialize(
    threadId: string,
    folder: string,
    phase: Phase,
    confirmPrior: boolean,
    selection?: {
      manifest: { path: string; sha256: string }[];
      members: Record<string, Phase | "reference">;
    },
  ) {
    const first = await load(threadId, folder);
    return beads.locked(
      `${first.source.hostId}:${first.context.project_id}`,
      async () => {
        const data = await load(threadId, folder);
        if (data.state)
          throw new Error("This spec already has phase tracking.");
        if (
          selection &&
          (manifestKey(selection.manifest) !== manifestKey(data.documents) ||
            Object.keys(selection.members).sort().join("\n") !==
              data.documents
                .map((d) => d.path)
                .sort()
                .join("\n"))
        )
          throw new Error(
            "The import documents changed. Refresh and confirm their phase membership again.",
          );
        if (phase !== "requirements" && !confirmPrior)
          throw new Error(
            "Confirm the earlier accepted document versions during import.",
          );
        if (
          phase !== "requirements" &&
          data.catalogue.specs.some(
            (s) => insideFolder(s.folder, folder) && s.folder !== folder,
          )
        )
          throw new Error("A parent with child specs remains at Requirements.");
        let parentId: string | null = null;
        for (const parent of data.catalogue.specs
          .filter((s) => insideFolder(folder, s.folder) && s.folder !== folder)
          .sort((a, b) => a.folder.length - b.folder.length)) {
          const id = `bf-${hash(JSON.stringify([data.source.hostId, data.context.project_id, parent.folder])).slice(0, 16)}`;
          const parentState: SpecState = {
            kind: "spec",
            checkoutRoot: data.source.checkoutRoot,
            folder: parent.folder,
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
            parentId,
            error: null,
          };
          await beads.create(
            data.source.hostId,
            data.source.checkoutRoot,
            id,
            parent.name,
            "epic",
            parentState,
            parentId ?? undefined,
          );
          parentId = id;
        }
        const state: SpecState = {
          kind: "spec",
          checkoutRoot: data.source.checkoutRoot,
          folder,
          threadId,
          phase,
          revision: 0,
          mode: "draft",
          members: {},
          reviewed: {},
          acceptances: [],
          taskIds: [],
          authorizationId: null,
          pendingPrompt: null,
          sizing: null,
          parentId,
          error: null,
        };
        state.members = selection ? selection.members : members(data, state);
        for (const earlier of phases.slice(0, phases.indexOf(phase))) {
          const documents = data.documents.filter(
            (doc) => state.members[doc.path] === earlier,
          );
          if (
            !documents.length ||
            (earlier === "requirements" && documents.length !== 1)
          )
            throw new Error(`Import needs accepted ${earlier} documents.`);
          if (
            earlier === "requirements" &&
            documents.some(
              (doc) =>
                phaseFromName(doc.path.split("/").at(-1)!) !== "requirements",
            )
          )
            throw new Error(
              "The Requirements document must contain requirements in its filename.",
            );
          state.acceptances.push({
            phase: earlier,
            at: now(),
            documents,
            inventory: data.documents.map((d) => ({
              path: d.path,
              sha256: d.sha256,
            })),
          });
          for (const doc of documents) {
            state.reviewed[doc.path] = doc.sha256;
            const current = await readDocument(
              bb,
              threadId,
              doc.path,
              data.source,
            );
            store.capture(current);
            store.reviewed({
              ...current,
              revision: store.get(current.id, current.sha256)!.revision,
            });
          }
        }
        await beads.create(
          data.source.hostId,
          data.source.checkoutRoot,
          data.id,
          folder.split("/").at(-1)!,
          "epic",
          state,
          parentId ?? undefined,
        );
        return view(threadId, folder, { synchronize: false });
      },
    );
  }
  async function reviewed(target: ReviewTarget) {
    const saved = store.requireVersion(target),
      live = await readDocument(bb, target.threadId, saved.source.path);
    if (live.id !== target.id || live.sha256 !== target.sha256)
      throw new Error(
        "The document or checkout changed. Refresh before reviewing.",
      );
    const session = await sets.session(target.threadId);
    const owner = session.specs
      .filter((s) => insideFolder(live.path, s.folder))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
    if (owner) {
      const first = await load(target.threadId, owner.folder);
      await beads.locked(
        `${first.source.hostId}:${first.context.project_id}`,
        async () => {
          const data = await load(target.threadId, owner.folder),
            state = requireCurrent(data);
          state.reviewed[live.path] = live.sha256;
          state.revision++;
          await persist(data, state);
        },
      );
    }
    store.reviewed(target);
  }
  async function draft(
    threadId: string,
    folder: string,
    action: Phase | "sizing" | "children",
    idea = "",
  ) {
    const first = await load(threadId, folder);
    return beads.locked(
      `${first.source.hostId}:${first.context.project_id}`,
      async () => {
        const data = await load(threadId, folder),
          state = requireCurrent(data);
        if (action === "sizing") {
          const requirements = data.documents.filter(
            (doc) => state.members[doc.path] === "requirements",
          );
          if (
            state.phase !== "requirements" ||
            state.mode !== "draft" ||
            requirements.length !== 1 ||
            requirements.some((doc) => state.reviewed[doc.path] !== doc.sha256)
          )
            throw new Error(
              "Review every current Requirements document before requesting sizing.",
            );
          const manifest = hash(
            JSON.stringify(
              requirements.map((doc) => ({
                path: doc.path,
                sha256: doc.sha256,
              })),
            ),
          );
          if (state.sizing?.manifest === manifest && state.sizing.assessment)
            return;
          const previous =
            (await bb.sdk.threads.output({ threadId })).output ?? "";
          state.sizing = {
            manifest,
            previousReplyHash: hash(previous),
            assessment: null,
          };
          state.revision++;
          await persist(data, state);
        }
        const request =
          action === "sizing"
            ? "Assess the Requirements scope, complexity, dependencies, and risks. Recommend continuing to Design or splitting into child specs, with rationale. Wait for the user's decision."
            : action === "children"
              ? "Draft child specs from the accepted parent Requirements, each in its own descendant folder with one requirements.md. Preserve the parent's accepted Requirements. Stop for Requirements review in each child; do not draft child Design or implementation."
              : `Work with the user to draft ${action} for this spec. ${action === "tasks" ? taskAuthoringInstructions : action === "requirements" ? "Use one Requirements Markdown document." : "Use as many Design documents as the scope needs."} Stop for review and phase acceptance.`;
        const text = `Spec ${JSON.stringify(folder)}; Beads identity ${data.id}. Current phase ${state.phase}, revision ${state.revision}. Read applicable repository instructions and the spec's accepted documents before working.\n\n${request}\n\n${idea ? `User idea/context:\n${idea}` : ""}`;
        const result = await deliver(
          `draft:${data.id}:${state.revision}:${hash(text)}`,
          threadId,
          text,
        );
        if (result.error) throw new Error(result.error);
      },
    );
  }
  return { ...stateStore, initialize, reviewed, draft, deliver };
}
export type Planning = ReturnType<typeof planning>;
