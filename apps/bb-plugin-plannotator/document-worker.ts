import { processDocument, type ProcessedDocument } from "./document-processing";

type Request = { content: string; baseline: string | null };
export type DocumentWorkerResult = { ok: true; result: ProcessedDocument } | { ok: false; error: string };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: DocumentWorkerResult) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ ok: true, result: processDocument(data.content, data.baseline) });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
