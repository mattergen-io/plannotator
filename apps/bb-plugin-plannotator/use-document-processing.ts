import { useEffect, useState } from "react";
import source from "./document-worker.generated.txt?raw" with { type: "text" };
import { processDocument, type ProcessedDocument } from "./document-processing";
import type { DocumentWorkerResult } from "./document-worker";

type Result = { content: string; baseline: string | null; value: ProcessedDocument | null; fallback: boolean; error?: string };

/** A document owns one worker; changing documents terminates obsolete work. */
export function useDocumentProcessing(content: string | undefined, baseline: string | null | undefined) {
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (content === undefined || baseline === undefined) return;
    let cancelled = false;
    let worker: Worker | undefined;
    let url: string | undefined;
    const fallback = () => {
      if (cancelled) return;
      try { setResult({ content, baseline, value: processDocument(content, baseline), fallback: true }); }
      catch (error) { setResult({ content, baseline, value: null, fallback: true, error: String(error) }); }
    };
    try {
      url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = (event: MessageEvent<DocumentWorkerResult>) => {
        if (cancelled) return;
        worker?.terminate();
        if (event.data.ok) setResult({ content, baseline, value: event.data.result as ProcessedDocument, fallback: false });
        else setResult({ content, baseline, value: null, fallback: false, error: event.data.error });
      };
      worker.onerror = () => { worker?.terminate(); fallback(); };
      worker.postMessage({ content, baseline });
    } catch {
      worker?.terminate();
      fallback();
    }
    return () => { cancelled = true; worker?.terminate(); if (url) URL.revokeObjectURL(url); };
  }, [content, baseline]);
  return result?.content === content && result?.baseline === baseline ? result : null;
}
