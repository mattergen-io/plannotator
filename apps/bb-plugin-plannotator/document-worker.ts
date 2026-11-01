import { processDocument, type ProcessedDocument } from "./document-processing";
import { addedTextRanges, type HighlightInput, type TextRange } from "@plannotator/ui/hooks/useDocumentChanges";

type Request = { content: string; baseline: string | null } | { highlights: HighlightInput[] };
export type DocumentWorkerResult = { ok: true; result: ProcessedDocument | TextRange[][] } | { ok: false; error: string };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: DocumentWorkerResult) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ ok: true, result: "highlights" in data ? data.highlights.map(input => addedTextRanges(input.tokens, input.rendered)) : processDocument(data.content, data.baseline) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
