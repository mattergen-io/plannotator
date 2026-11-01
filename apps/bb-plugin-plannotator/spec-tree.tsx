import { useMemo } from "react";
import { buildDiffFileTree, type DiffFileTreeNode } from "@plannotator/ui/utils/diffFileTree";
import { needsReview, type SpecSet, type SetFile } from "./contracts";

const labels: Record<SetFile["status"], string> = {
  unreviewed: "Needs review", changed: "Changed", reviewed: "Reviewed", approved: "Approved", unavailable: "Unavailable",
};
const pendingLabel = (count: number) => `${count} ${count === 1 ? "needs" : "need"} review`;
type TreeFile = SetFile & { fullPath: string };
function pending(node: DiffFileTreeNode<TreeFile>): number {
  return node.file ? Number(needsReview(node.file)) : (node.children ?? []).reduce((sum, child) => sum + pending(child), 0);
}
function Rows({ nodes, selectedPath, busy, onSelect }: {
  nodes: DiffFileTreeNode<TreeFile>[]; selectedPath: string | null; busy: boolean; onSelect: (path: string) => void;
}) {
  return <ul>{nodes.map(node => <li key={node.path}>
    {node.file ? <button type="button" className="bb-review-tree-file" aria-current={selectedPath === node.file.fullPath ? "page" : undefined}
      disabled={busy || !!node.file.error} title={node.file.error ?? node.file.fullPath} onClick={() => onSelect(node.file!.fullPath)}>
      <span className="bb-review-tree-name">{node.name}</span>
      <span className={`bb-review-file-status bb-review-file-${node.file.status}`}>{labels[node.file.status]}</span>
      {!!node.file.commentCount && <span className="bb-review-comment-count">{node.file.commentCount} {node.file.commentCount === 1 ? "comment" : "comments"}</span>}
    </button> : <details open><summary><span className="bb-review-tree-name">{node.name}</span>
      {!!pending(node) && <span className="bb-review-pending-count">{pendingLabel(pending(node))}</span>}
    </summary><Rows nodes={node.children ?? []} selectedPath={selectedPath} busy={busy} onSelect={onSelect} /></details>}
    {node.file?.error && <p className="bb-review-file-error">{node.file.error}</p>}
  </li>)}</ul>;
}
export function SpecTree({ specSet, selectedPath, busy, onSelect }: {
  specSet: SpecSet; selectedPath: string | null; busy: boolean; onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => buildDiffFileTree(specSet.files.map(file => ({ ...file, fullPath: file.path,
    path: specSet.folder === "." ? file.path : file.path.slice(specSet.folder.length + 1) }))), [specSet]);
  const count = specSet.files.filter(needsReview).length;
  return <details className="bb-review-tree" open><summary>Documents ({specSet.files.length})
    <span className={count ? "bb-review-pending-count" : "bb-review-tree-complete"}>{count ? pendingLabel(count) : specSet.files.length ? "All reviewed" : "No documents"}</span>
  </summary><nav aria-label="Spec documents"><Rows nodes={nodes} selectedPath={selectedPath} busy={busy} onSelect={onSelect} />
    {!specSet.files.length && <p className="bb-review-empty-comments">No Markdown documents in this folder yet.</p>}
  </nav></details>;
}
