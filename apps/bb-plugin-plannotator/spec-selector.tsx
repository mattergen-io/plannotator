import { useMemo } from "react";
import type { Spec } from "./contracts";

type Groups = Map<string | null, Spec[]>;
function SpecRows({ groups, parent, selected, busy, onSelect }: {
  groups: Groups; parent: string | null; selected: string | null; busy: boolean; onSelect: (folder: string) => void;
}) {
  return <ul>{(groups.get(parent) ?? []).map(spec => {
    const choice = <button type="button" className="bb-review-spec-choice" title={spec.folder} aria-current={selected === spec.folder ? "true" : undefined}
      disabled={busy} onClick={event => { event.preventDefault(); event.stopPropagation(); onSelect(spec.folder); }}>{spec.name}</button>;
    return <li key={spec.folder}>{groups.has(spec.folder) ? <details open><summary>{choice}</summary>
      <SpecRows groups={groups} parent={spec.folder} selected={selected} busy={busy} onSelect={onSelect} />
    </details> : <div className="bb-review-spec-leaf">{choice}</div>}</li>;
  })}</ul>;
}
export function SpecSelector({ specs, selected, busy, truncated, onSelect, onRefresh }: {
  specs: Spec[]; selected: string | null; busy: boolean; truncated: boolean; onSelect: (folder: string) => void; onRefresh: () => void;
}) {
  const groups = useMemo(() => {
    const result: Groups = new Map();
    specs.forEach(spec => result.set(spec.parent, [...(result.get(spec.parent) ?? []), spec]));
    return result;
  }, [specs]);
  return <section className="bb-review-spec-selector">
    <header><h2>Spec sets</h2><button type="button" disabled={busy} onClick={onRefresh}>Refresh</button></header>
    <nav aria-label="Spec sets"><SpecRows groups={groups} parent={null} selected={selected} busy={busy} onSelect={onSelect} />
      {!specs.length && <p className="bb-review-empty-comments">{busy ? "Finding specs…" : "No specs found. Spec folders contain a requirements.md file."}</p>}
    </nav>
    {truncated && <p className="bb-review-file-error">The spec list is incomplete. Refresh to check for more specs.</p>}
  </section>;
}
