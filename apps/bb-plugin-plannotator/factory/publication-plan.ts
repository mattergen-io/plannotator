import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import type { Planning } from "./planning";
import {
  specStateSchema,
  manifestKey,
  type SpecState,
  type Snapshot,
  type Phase,
} from "./model";
import { hash, readDocument } from "../workspace";
import { parseTasks, contextPack } from "./tasks";
export async function preparePublication(
  bb: BbPluginApi,
  beads: BeadsClient,
  threadId: string,
  data: Awaited<ReturnType<Planning["load"]>>,
  state: SpecState,
  documents: Snapshot[],
) {
  let packs: {
    id: string;
    key: string;
    title: string;
    pack: ReturnType<typeof contextPack>;
    dependencies: string[];
  }[] = [];
  let generation = "";
  let sourceManifest: Snapshot[] = [];
  const accepted: Snapshot[] = [];
  const ancestors: Snapshot[] = [];
  for (const phase of ["requirements", "design"] as Phase[]) {
    const previous = state.acceptances.filter((a) => a.phase === phase).at(-1);
    if (!previous) throw new Error(`Accept ${phase} before publishing Tasks.`);
    for (const old of previous.documents) {
      const live = await readDocument(bb, threadId, old.path);
      if (live.sha256 !== old.sha256)
        throw new Error(
          `Accepted ${phase} changed. Return to that phase before publishing.`,
        );
      accepted.push(old);
    }
  }
  let parentId = state.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (seen.has(parentId)) throw new Error("Spec hierarchy contains a cycle.");
    seen.add(parentId);
    const parent = specStateSchema.parse(
      (await beads.get(data.source.hostId, data.source.checkoutRoot, parentId))
        .metadata?.bbFactory,
    );
    const requirements = parent.acceptances
      .filter((a) => a.phase === "requirements")
      .at(-1);
    if (!requirements)
      throw new Error(
        `Accept parent Requirements in ${parent.folder} before publishing child tasks.`,
      );
    for (const old of requirements.documents) {
      const live = await readDocument(bb, threadId, old.path);
      if (live.sha256 !== old.sha256)
        throw new Error(`Parent Requirements changed: ${old.path}`);
      accepted.push(old);
      ancestors.push(old);
    }
    parentId = parent.parentId;
  }
  sourceManifest = [...accepted, ...documents];
  const tasks = parseTasks(documents[0].content);
  generation = hash(
    JSON.stringify([
      manifestKey([...accepted, ...documents]),
      state.acceptances.filter((a) => a.phase === "tasks").length +
        (state.mode === "publishing" ? 0 : 1),
    ]),
  );
  const ids = new Map(
    tasks.map((task) => [
      task.key,
      `bf-${hash(`${data.id}:${task.key}:${generation}`).slice(0, 20)}`,
    ]),
  );
  packs = tasks.map((task) => ({
    id: ids.get(task.key)!,
    key: task.key,
    title: task.title,
    pack: contextPack(task, accepted, ancestors),
    dependencies: task.dependencies.map((key) => ids.get(key)!),
  }));

  return { packs, generation, sourceManifest };
}
