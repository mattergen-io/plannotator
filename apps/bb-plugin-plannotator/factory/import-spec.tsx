import { useEffect, useState } from "react";
import { phases, type Phase } from "./model";
import type { FactoryView } from "./contracts";
type Membership = Record<string, Phase | "reference">;
export function ImportSpec({
  view,
  busy,
  onImport,
}: {
  view: FactoryView;
  busy: boolean;
  onImport: (selection: {
    phase: Phase;
    confirmPrior: boolean;
    manifest: { path: string; sha256: string }[];
    members: Membership;
  }) => Promise<void>;
}) {
  const [phase, setPhase] = useState(view.suggestedPhase),
    [confirm, setConfirm] = useState(false),
    [members, setMembers] = useState<Membership>({});
  const manifest = view.files.map(({ path, sha256 }) => ({ path, sha256 }));
  const version = JSON.stringify(manifest);
  useEffect(() => {
    setMembers(Object.fromEntries(view.files.map((f) => [f.path, f.phase])));
    setConfirm(false);
  }, [version]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onImport({ phase, confirmPrior: confirm, manifest, members });
      }}
    >
      <p>
        Confirm document membership and where this spec starts. Earlier phases
        are accepted at exactly the displayed versions.
      </p>
      <label>
        Current phase{" "}
        <select
          value={phase}
          onChange={(e) => {
            setPhase(e.target.value as Phase);
            setConfirm(false);
          }}
        >
          {phases.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {view.files.map((file) => (
        <label key={file.path} className="bb-factory-file">
          <span title={file.sha256}>{file.path}</span>
          <select
            aria-label={`Import phase for ${file.path}`}
            value={members[file.path] ?? file.phase}
            onChange={(e) => {
              setMembers({
                ...members,
                [file.path]: e.target.value as Phase | "reference",
              });
              setConfirm(false);
            }}
          >
            {[...phases, "reference"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      ))}
      {phase !== "requirements" && (
        <label>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          I accept the current documents in the earlier phases.
        </label>
      )}
      <button disabled={busy || (phase !== "requirements" && !confirm)}>
        Initialize phase tracking
      </button>
    </form>
  );
}
