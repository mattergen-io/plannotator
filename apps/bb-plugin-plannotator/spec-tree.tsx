import { useMemo } from "react";
import { experimental_FileLink as FileLink } from "@get-bb/plugin-sdk/app";
import { buildDiffFileTree, type DiffFileTreeNode } from "@plannotator/ui/utils/diffFileTree";
import { needsReview, type SpecSet, type SetFile } from "./contracts";

const labels: Record<SetFile["status"], string> = {
  unreviewed: "Needs review", changed: "Changed", reviewed: "Reviewed", approved: "Approved", unavailable: "Unavailable", reference: "Reference",
};
const pendingLabel = (count: number) => `${count} ${count === 1 ? "needs" : "need"} review`;
type TreeEntry = { path: string; fullPath: string; kind: "file" | "directory"; review?: SetFile };
function pending(node: DiffFileTreeNode<TreeEntry>): number {
  return node.type === "file" ? Number(!!node.file?.review && needsReview(node.file.review)) : (node.children ?? []).reduce((sum, child) => sum + pending(child), 0);
}
function Rows({ nodes, selectedPath, environmentId, busy, onSelect }: {
  nodes: DiffFileTreeNode<TreeEntry>[]; selectedPath: string | null; environmentId: string; busy: boolean; onSelect: (path: string) => void;
}) {
  return <ul>{nodes.map(node => {
    const file = node.file, review = file?.review;
    return <li key={node.path}>
      {node.type === "folder" ? <details open><summary><span className="bb-review-tree-name">{node.name}</span>
        {!!pending(node) && <span className="bb-review-pending-count">{pendingLabel(pending(node))}</span>}
      </summary><Rows nodes={node.children ?? []} selectedPath={selectedPath} environmentId={environmentId} busy={busy} onSelect={onSelect} /></details>
        : review ? <button type="button" className="bb-review-tree-file" aria-current={selectedPath === file!.fullPath ? "page" : undefined}
          disabled={busy || !!review.error} title={review.error ?? file!.fullPath} onClick={() => onSelect(file!.fullPath)}>
          <span className="bb-review-tree-name">{node.name}</span>
          <span className={`bb-review-file-status bb-review-file-${review.status}`}>{labels[review.status]}</span>
          {!!review.commentCount && <span className="bb-review-comment-count">{review.commentCount} {review.commentCount === 1 ? "comment" : "comments"}</span>}
        </button> : <FileLink className="bb-review-tree-file" target={{ kind: "workspace", environmentId, path: file!.fullPath }} title={file!.fullPath}>
          <span className="bb-review-tree-name">{node.name}</span>
        </FileLink>}
      {review?.error && <p className="bb-review-file-error">{review.error}</p>}
    </li>;
  })}</ul>;
}
export function SpecTree({ specSet, selectedPath, busy, onSelect }: {
  specSet: SpecSet; selectedPath: string | null; busy: boolean; onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => {
    const reviews = new Map(specSet.files.map(file => [file.path, file]));
    return buildDiffFileTree(specSet.entries.map(entry => ({ ...entry, fullPath: entry.path, review: reviews.get(entry.path),
      path: specSet.folder === "." ? entry.path : entry.path.slice(specSet.folder.length + 1) })), { compactFolders: false, unwrapRoot: false });
  }, [specSet]);
  const count = specSet.files.filter(needsReview).length;
  return <section className="bb-review-tree"><header><h2 title={specSet.folder}>{specSet.folder.split("/").at(-1) === "." ? "Documents" : specSet.folder.split("/").at(-1)}</h2>
    <span className={count ? "bb-review-pending-count" : "bb-review-tree-complete"}>{count ? pendingLabel(count) : specSet.files.length ? "All reviewed" : "No documents to review"}</span>
  </header><nav aria-label="Spec documents"><Rows nodes={nodes} selectedPath={selectedPath} environmentId={specSet.environmentId} busy={busy} onSelect={onSelect} />
    {!specSet.entries.length && <p className="bb-review-empty-comments">This spec folder is empty.</p>}
  </nav></section>;
}
