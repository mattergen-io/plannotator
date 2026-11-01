import { parseMarkdownToBlocks } from "@plannotator/ui/utils/parser";
import { computeDocumentChanges } from "@plannotator/ui/hooks/useDocumentChanges";

export function processDocument(content: string, baseline: string | null) {
  const blocks = parseMarkdownToBlocks(content);
  const diff = baseline === null ? null : computeDocumentChanges(baseline, content);
  const removals = (diff?.blocks ?? []).flatMap(block => {
    const content = block.type === "removed" ? block.content : block.type === "modified"
      ? block.inlineTokens ? block.inlineTokens.filter(token => token.type === "removed").map(token => token.value).join(" … ") : block.oldContent : null;
    return content?.trim() ? [{ line: block.oldStart, content }] : [];
  });
  return { blocks, diff, removals };
}
export type ProcessedDocument = ReturnType<typeof processDocument>;
