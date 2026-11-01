import { useCallback, useEffect, useRef } from "react";
import { addedTextRanges, type HighlightInput, type TextRange } from "@plannotator/ui/hooks/useDocumentChanges";
import source from "./document-worker.generated.txt" with { type: "text" };
import type { DocumentWorkerResult } from "./document-worker";

export function useHighlightProjection() {
  const active = useRef<(() => void) | null>(null);
  useEffect(() => () => active.current?.(), []);
  return useCallback((inputs: HighlightInput[]): Promise<TextRange[][]> => {
    active.current?.();
    return new Promise((resolve) => {
      let worker: Worker | undefined, url: string | undefined, finished = false;
      const finish = (result: TextRange[][]) => {
        if (finished) return;
        finished = true; worker?.terminate(); if (url) URL.revokeObjectURL(url);
        if (active.current === cancel) active.current = null;
        resolve(result);
      };
      const cancel = () => finish([]);
      const fallback = () => finish(inputs.map(input => addedTextRanges(input.tokens, input.rendered)));
      active.current = cancel;
      try {
        url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(url);
        worker.onmessage = (event: MessageEvent<DocumentWorkerResult>) => {
          if (event.data.ok) finish(event.data.result as TextRange[][]);
          else finish([]);
        };
        worker.onerror = fallback;
        worker.postMessage({ highlights: inputs });
      } catch { fallback(); }
    });
  }, []);
}
