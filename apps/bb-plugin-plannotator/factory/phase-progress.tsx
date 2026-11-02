import { phases, type SpecState } from "./model";

const labels = { requirements: "Requirements", design: "Design", tasks: "Tasks" } as const;

export function PhaseProgress({ state }: { state: SpecState | null | undefined }) {
  const current = state ? phases.indexOf(state.phase) : -1;
  return <ol className="bb-phase-progress" aria-label="Spec phases">
    {phases.map((phase, index) => {
      const isCurrent = !!state && index === current && (state.mode === "draft" || state.mode === "publishing");
      const accepted = !!state && state.acceptances.some(item => item.phase === phase) &&
        (state.mode === "ready" || state.mode === "decomposed" || index < current);
      const status = isCurrent ? (state?.mode === "publishing" ? "Publishing" : "Current") : accepted ? "Approved" : state?.mode === "decomposed" && index > current ? "Not applicable" : "Upcoming";
      return <li key={phase} className={`bb-phase bb-phase-${status.toLowerCase().replace(" ", "-")}`} aria-current={isCurrent ? "step" : undefined} aria-label={`${labels[phase]}: ${status}`}>
        <span aria-hidden="true" className="bb-phase-marker">{accepted ? "✓" : isCurrent ? "●" : "○"}</span><span>{labels[phase]}</span><span className="bb-phase-status">{status}</span>
      </li>;
    })}
  </ol>;
}
