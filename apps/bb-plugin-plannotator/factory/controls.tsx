import { ImportSpec } from "./import-spec";
import { PhaseDocuments } from "./phase-documents";
import { RunControls } from "./run-controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useRealtime, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { factoryContract, type FactoryView } from "./contracts";
import { type Phase } from "./model";
import { CHANNEL } from "../contracts";

export function FactoryControls({
  threadId,
  folder,
  environmentId,
  flush,
  onInitialized,
  onView,
  onRefresh,
}: {
  threadId: string;
  folder: string | null;
  environmentId?: string;
  flush: () => Promise<void>;
  onInitialized: (value: boolean) => void;
  onView: (view: FactoryView | null) => void;
  onRefresh: () => void;
}) {
  const rpc = useRpc<typeof factoryContract>();
  const navigate = useBbNavigate();
  const [view, setView] = useState<FactoryView | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const [newSpec, setNewSpec] = useState(false),
    [name, setName] = useState(""),
    [idea, setIdea] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!folder) {
      setView(null);
      onView(null);
      onInitialized(false);
      return;
    }
    try {
      const result = await rpc.call("factoryStatus", { threadId, folder });
      if (request !== generation.current) return;
      setView(result);
      onView(result);
      onInitialized(!!result.state);
    } catch (cause) {
      if (request === generation.current) setError(String(cause));
    }
  }, [threadId, folder, rpc, onInitialized, onView]);
  useEffect(() => {
    setView(null);
    setError(null);

    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useRealtime(CHANNEL, (value) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "threadId" in value &&
      value.threadId === threadId
    )
      void refresh();
  });
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await flush();
      await work();
      await refresh();
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const state = view?.state;
  const sizingReady =
    state?.phase !== "requirements" || !!state.sizing?.assessment;
  const required = view?.files.filter((f) => f.phase === state?.phase) ?? [],
    pending = required.filter((f) => !f.reviewed).length;
  const active = view?.runs.find((r) =>
    ["running", "paused", "starting"].includes(r.state.stage),
  );
  const manifest =
    view?.files.map((f) => ({ path: f.path, sha256: f.sha256 })) ?? [];
  const accept = (decision?: "continue" | "split") =>
    act(() =>
      rpc.call("factoryAccept", {
        threadId,
        folder: folder!,
        revision: state!.revision,
        manifest,
        ...(decision ? { decision } : {}),
      }),
    );
  const draft = (action: Phase | "sizing" | "children") =>
    act(() =>
      rpc.call("factoryDraft", { threadId, folder: folder!, action, idea: "" }),
    );
  if (state && state.threadId !== threadId)
    return (
      <section className="bb-factory" aria-label="Spec workflow and factory">
        <p>This spec is associated with another planning thread.</p>
        <button onClick={() => navigate.toThread(state.threadId)}>
          Open planning thread
        </button>
      </section>
    );
  return (
    <section className="bb-factory" aria-label="Spec workflow and factory">
      <div className="bb-factory-summary">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {state
            ? `${state.phase[0].toUpperCase() + state.phase.slice(1)} · ${state.mode === "decomposed" ? "Broken into child specs" : state.mode === "ready" ? "Ready for implementation" : `${required.length - pending}/${required.length} reviewed`}`
            : "Spec workflow"}
        </button>
        <button
          onClick={() => {
            setNewSpec(!newSpec);
            setOpen(true);
          }}
        >
          New spec
        </button>
        {state?.mode === "draft" && (
          <>
            {state.phase === "requirements" ? (
              <>
                <button disabled={busy} onClick={() => void draft("sizing")}>
                  Assess size
                </button>
                <button
                  disabled={
                    busy ||
                    !!pending ||
                    !required.length ||
                    (state.phase === "requirements" &&
                      !state.sizing?.assessment)
                  }
                  onClick={() => void accept("continue")}
                >
                  Accept → Design
                </button>
                <button
                  disabled={
                    busy ||
                    !!pending ||
                    !required.length ||
                    (state.phase === "requirements" &&
                      !state.sizing?.assessment)
                  }
                  onClick={() => void accept("split")}
                >
                  Accept → Break down
                </button>
              </>
            ) : (
              <button
                disabled={busy || !!pending || !required.length || !sizingReady}
                onClick={() => void accept()}
              >
                {state.phase === "tasks"
                  ? "Accept Tasks & publish"
                  : "Accept Design → Tasks"}
              </button>
            )}
          </>
        )}
        {state?.mode === "publishing" && (
          <button disabled={busy} onClick={() => void accept()}>
            Resume publication
          </button>
        )}
        {state?.pendingPrompt && (
          <button
            disabled={busy}
            onClick={() =>
              void act(() =>
                rpc.call("factoryDeliver", {
                  threadId,
                  folder: folder!,
                  resend: true,
                }),
              )
            }
          >
            Reconcile / resend phase instruction
          </button>
        )}
        {(active ?? view?.runs[0]) && (
          <span role="status">
            Factory {(active ?? view!.runs[0]).state.stage}
          </span>
        )}
        {busy && <span role="status">Updating…</span>}
      </div>
      {error && (
        <p role="alert" className="bb-factory-error">
          {error}
        </p>
      )}
      {open && (
        <div className="bb-factory-details">
          {newSpec && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await rpc.call("factoryNewSpec", { threadId, name, idea });
                  setNewSpec(false);
                  setName("");
                  setIdea("");
                });
              }}
            >
              <label>
                Spec name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Describe the idea
                <textarea
                  required
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                />
              </label>
              <button disabled={busy}>Start Requirements conversation</button>
            </form>
          )}
          {view && !view.configured && view.error && (
            <div>
              <p role="alert">{view.error}</p>
              <button disabled={busy} onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {view?.configured && !state && folder && (
            <ImportSpec
              view={view}
              busy={busy}
              onImport={(selection) =>
                act(() =>
                  rpc.call("factoryInitialize", {
                    threadId,
                    folder,
                    ...selection,
                  }),
                )
              }
            />
          )}
          {state && (
            <>
              {view?.error && <p className="bb-factory-error">{view.error}</p>}
              <p className="bb-factory-meta">
                Spec {view?.spec?.id} · revision {state.revision} ·{" "}
                {state.acceptances.length} acceptance records
              </p>
              {state.mode === "draft" && (
                <button disabled={busy} onClick={() => void draft(state.phase)}>
                  Draft / revise {state.phase} with agent
                </button>
              )}
              {state.mode === "decomposed" && (
                <p>
                  Parent Requirements accepted. Select a child spec to continue
                  its planning.
                </p>
              )}
              {view && folder && (
                <PhaseDocuments
                  view={view}
                  threadId={threadId}
                  folder={folder}
                  busy={busy}
                  act={act}
                />
              )}
              {view && folder && (
                <RunControls
                  view={view}
                  threadId={threadId}
                  folder={folder}
                  environmentId={environmentId}
                  busy={busy}
                  act={act}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
