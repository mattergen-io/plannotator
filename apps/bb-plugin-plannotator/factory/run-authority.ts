import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BeadsClient } from "./beads";
import {
  taskStateSchema,
  type Bead,
  type TaskState,
  type RunState,
} from "./model";
import { workspace, readDocument, hash } from "../workspace";

export function runAuthority(bb: BbPluginApi, beads: BeadsClient) {
  async function validate(
    run: RunState,
    records?: { bead: Bead; state: TaskState }[],
  ) {
    const source = await workspace(bb, run.threadId);
    if (source.hostId !== run.hostId || source.checkoutRoot !== run.root)
      throw new Error(
        "The planning thread moved to another checkout; the accepted run is paused.",
      );
    const tasks =
      records ??
      (await Promise.all(
        run.taskIds.map(async (id) => {
          const bead = await beads.get(run.hostId, run.root, id);
          return {
            bead,
            state: taskStateSchema.parse(bead.metadata?.bbFactory),
          };
        }),
      ));
    const expected = new Map<string, string>();
    for (const { bead, state } of tasks) {
      if (!bead.description || hash(bead.description) !== state.packHash)
        throw new Error(
          `Published context pack changed: ${bead.id}. Reaccept Tasks.`,
        );
      for (const snapshot of state.sources) {
        if (
          expected.has(snapshot.path) &&
          expected.get(snapshot.path) !== snapshot.sha256
        )
          throw new Error(
            `Selected tasks reference different accepted versions of ${snapshot.path}.`,
          );
        expected.set(snapshot.path, snapshot.sha256);
      }
    }
    for (const [path, sha256] of expected)
      if ((await readDocument(bb, run.threadId, path)).sha256 !== sha256)
        throw new Error(
          `Accepted source changed: ${path}. Reaccept the affected phase before execution resumes.`,
        );
    return tasks;
  }
  async function gates(run: RunState, open: boolean) {
    for (const id of run.authorizationIds)
      await beads.exec(
        run.hostId,
        run.root,
        "bd",
        open
          ? [
              "reopen",
              id,
              "--reason",
              `Factory run ${run.stage}: ${run.branch}`,
            ]
          : [
              "gate",
              "resolve",
              id,
              "--reason",
              `User authorized ${run.branch}`,
            ],
      );
  }
  return { validate, gates };
}
