import { useState, useEffect } from "react";
import {
  useRpc,
  useBbNavigate,
  experimental_ProviderModelPicker as ModelPicker,
} from "@get-bb/plugin-sdk/app";
import { factoryContract, type FactoryView } from "./contracts";
import { defaultRoles, type Role } from "./model";
export function RunControls({
  view,
  threadId,
  folder,
  environmentId,
  busy,
  act,
}: {
  view: FactoryView;
  threadId: string;
  folder: string;
  environmentId?: string;
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const rpc = useRpc<typeof factoryContract>(),
    navigate = useBbNavigate();
  const [worker, setWorker] = useState<Role>(defaultRoles.worker),
    [reviewer, setReviewer] = useState<Role>(defaultRoles.reviewer),
    [command, setCommand] = useState(""),
    [setupCommand, setSetup] = useState("");
  const active = view.runs.find((r) =>
    ["running", "paused", "starting"].includes(r.state.stage),
  );
  const latest = active ?? view.runs[0];
  useEffect(() => {
    if (latest) {
      setWorker(latest.state.worker);
      setReviewer(latest.state.reviewer);
      setCommand(latest.state.command);
      setSetup(latest.state.setupCommand);
    }
  }, [latest?.bead.id]);
  return (
    <>
      <details open={view.runs.length > 0}>
        <summary>Factory run</summary>
        <div className="bb-factory-models">
          <label>
            Worker
            <ModelPicker
              disabled={busy || !!active}
              value={worker}
              onChange={setWorker}
              routing={
                environmentId
                  ? { kind: "environment", environmentId }
                  : undefined
              }
            />
          </label>
          <label>
            Reviewer
            <ModelPicker
              disabled={busy || !!active}
              value={reviewer}
              onChange={setReviewer}
              routing={
                environmentId
                  ? { kind: "environment", environmentId }
                  : undefined
              }
            />
          </label>
        </div>
        <label>
          Workspace setup command (optional)
          <input
            disabled={busy || !!active}
            placeholder="e.g. bun install --frozen-lockfile"
            value={setupCommand}
            onChange={(e) => setSetup(e.target.value)}
          />
        </label>
        <label>
          Verification command
          <input
            disabled={busy || !!active}
            placeholder="e.g. npm test"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
        </label>
        <p>
          Two tasks at a time · two correction rounds · checks and independent
          review · integrate into a factory branch.
        </p>
        {!active && (
          <button
            disabled={
              busy ||
              !command.trim() ||
              !view?.tasks.some(
                (t) => t.state.published && t.bead.status !== "closed",
              )
            }
            onClick={() =>
              void act(() =>
                rpc.call("factoryStart", {
                  threadId,
                  folder: folder!,
                  worker,
                  reviewer,
                  command,
                  setupCommand,
                }),
              )
            }
          >
            Start factory
          </button>
        )}
        {active && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() =>
                rpc.call(
                  active.state.stage === "paused"
                    ? "factoryResume"
                    : "factoryPause",
                  { threadId, folder: folder!, runId: active.bead.id },
                ),
              )
            }
          >
            {active.state.stage === "paused"
              ? "Resume run"
              : "Pause after current turns"}
          </button>
        )}
        {active && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() =>
                rpc.call("factoryStop", {
                  threadId,
                  folder,
                  runId: active.bead.id,
                }),
              )
            }
          >
            Stop run; preserve work
          </button>
        )}
        {view?.runs.map((run) => (
          <div key={run.bead.id} className="bb-factory-run">
            <strong>{run.state.stage}</strong> · <code>{run.state.branch}</code>
            <div>{run.state.error}</div>
            <small>{run.state.worktree}</small>
          </div>
        ))}
      </details>
      {!!view?.tasks.length && (
        <details open={view.runs.length > 0}>
          <summary>
            Beads tasks ·{" "}
            {view.tasks.filter((t) => t.bead.status === "closed").length}/
            {view.tasks.length} complete
          </summary>
          <ul className="bb-factory-tasks">
            {view.tasks.map((task) => (
              <li key={task.bead.id}>
                <strong>{task.bead.title}</strong>{" "}
                <span>
                  {task.state.stage} · fixes {task.state.attempts}/2
                </span>
                <small>{task.bead.id}</small>
                {task.state.stage === "blocked" && task.state.runId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        rpc.call("factoryRetry", {
                          threadId,
                          folder,
                          runId: task.state.runId!,
                          beadId: task.bead.id,
                        }),
                      )
                    }
                  >
                    Retry with two new correction rounds
                  </button>
                )}
                {task.state.workerId && (
                  <button
                    onClick={() =>
                      navigate.toThread(task.state.workerId!, {
                        split: true,
                      })
                    }
                  >
                    Open worker
                  </button>
                )}
                {task.state.reviewerId && (
                  <button
                    onClick={() =>
                      navigate.toThread(task.state.reviewerId!, {
                        split: true,
                      })
                    }
                  >
                    Open reviewer
                  </button>
                )}
                <details>
                  <summary>Context pack</summary>
                  <pre>{task.pack}</pre>
                </details>
                <details>
                  <summary>Evidence</summary>
                  {task.state.evidence.map((e, i) => (
                    <pre key={i}>{e}</pre>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
