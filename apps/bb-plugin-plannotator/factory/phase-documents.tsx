import { useState, useEffect } from "react";
import { useReviewPlatform } from "../review-platform";
import { type FactoryView } from "./contracts";
import { phases, type Phase } from "./model";
export function PhaseDocuments({
  view,
  threadId,
  folder,
  busy,
  act,
}: {
  view: FactoryView;
  threadId: string;
  folder: string;
  busy: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const rpc = useReviewPlatform().factoryRpc,
    state = view.state!;
  const [previews, setPreviews] = useState<
    { key: string; title: string; pack: string }[]
  >([]);
  useEffect(() => setPreviews([]), [state.revision]);
  return (
    <>
      {state.phase === "tasks" && (
        <details>
          <summary>Task context-pack previews</summary>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setPreviews(
                  await rpc.call("factoryPreview", { threadId, folder }),
                ),
              )
            }
          >
            Validate and preview packs
          </button>
          {previews.map((p) => (
            <details key={p.key}>
              <summary>
                {p.key}: {p.title}
              </summary>
              <pre>{p.pack}</pre>
            </details>
          ))}
        </details>
      )}{" "}
      <details>
        <summary>
          Documents in phases · {view?.files.filter((f) => f.added).length}{" "}
          added since last acceptance
        </summary>
        <ul className="bb-factory-members">
          {view?.files.map((file) => (
            <li key={file.path}>
              <span title={file.path}>
                {file.path.split("/").at(-1)} {file.added && <small>New</small>}{" "}
                {file.reviewed ? "✓" : ""}
              </span>
              <select
                aria-label={`Phase for ${file.path}`}
                value={file.phase}
                disabled={busy || state.mode !== "draft"}
                onChange={(e) =>
                  void act(() =>
                    rpc.call("factoryMember", {
                      threadId,
                      folder: folder!,
                      revision: state.revision,
                      path: file.path,
                      phase: e.target.value as Phase | "reference",
                    }),
                  )
                }
              >
                {[...phases, "reference"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </details>
      {!!state.acceptances.length && (
        <details>
          <summary>Acceptance history</summary>
          <ul>
            {state.acceptances.map((a, index) => (
              <li key={index}>
                {a.phase} · {new Date(a.at).toLocaleString()} ·{" "}
                {a.documents.length} documents{" "}
                {a.decision === "split" ? "· split into children" : ""}
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      rpc.call("factoryReturn", {
                        threadId,
                        folder,
                        revision: state.revision,
                        phase: a.phase,
                      }),
                    )
                  }
                >
                  Reopen {a.phase}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
