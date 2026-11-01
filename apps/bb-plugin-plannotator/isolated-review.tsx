import React, { useEffect, useRef, useState } from "react";
import { Viewer, type ViewerHandle } from "@plannotator/ui/components/Viewer";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel";
import { ScrollViewportProvider } from "@plannotator/ui/hooks/useScrollViewport";
import { PortalProvider } from "@plannotator/ui/components/PortalProvider";
import type { Annotation, EditorMode, InputMethod } from "@plannotator/ui/types";
import { feedbackSelection, targetOf } from "./contracts";
import { isolatedRpc } from "./isolated-rpc";
import { useReview } from "./use-review";
import { useDocumentProcessing } from "./use-document-processing";
import { useHighlightProjection } from "./use-highlight-projection";
import { useOffscreenTables } from "./use-offscreen-tables";

export function IsolatedReview({ threadId, path, nonce, parentOrigin }: { threadId: string; path?: string; nonce: string; parentOrigin: string }) {
  const review = useReview(threadId, path, isolatedRpc, "connected");
  const [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("selection"), [input, setInput] = useState<InputMethod>("drag");
  const [viewport, setViewport] = useState<HTMLElement | null>(null), [notes, setNotes] = useState(false);
  const viewer = useRef<ViewerHandle>(null), pending = useRef(new Set<string>());
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element = document.createElement("div");
    element.className = "bb-plannotator-ui bb-plannotator-portals theme-plannotator";
    document.body.append(element); setPortal(element);
    return () => element.remove();
  }, []);
  const doc = review.document, processed = useDocumentProcessing(doc?.content, doc?.baseline), project = useHighlightProjection();
  useOffscreenTables(viewport, processed?.value);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.nonce !== nonce) return;
      if (event.data.type === "plannotator-refresh") review.refresh();
      if (event.data.type === "plannotator-draft-result" && pending.current.delete(event.data.id))
        setNotice(event.data.ok ? "Added to the BB composer." : String(event.data.error || "Could not reach the BB composer."));
    };
    window.addEventListener("message", onMessage); return () => window.removeEventListener("message", onMessage);
  }, [nonce, parentOrigin, review.refresh]);
  function addText(text: string) {
    const id = crypto.randomUUID(); pending.current.add(id);
    window.parent.postMessage({ type: "plannotator-draft", nonce, id, threadId, text }, parentOrigin);
    setNotice("Adding to the BB composer…");
    setTimeout(() => { if (pending.current.delete(id)) setNotice("BB composer bridge unavailable."); }, 5000);
  }
  function addFeedback() {
    void review.run(async () => {
      await review.flush(); const current = review.current.current, set = review.currentSet.current;
      if (!current || !set) throw new Error("Open a document first.");
      const { text } = await review.rpc.call("prepare", { ...targetOf(current), action: "feedback", set: feedbackSelection(set) });
      addText(text);
    });
  }
  const annotations = (doc?.annotations ?? []) as Annotation[];
  const count = review.specSet?.files.reduce((n, file) => n + file.commentCount, 0) ?? 0;
  return <div className="bb-plannotator-ui bb-plannotator-panel theme-plannotator">
    <div className="bb-review-workspace">
      <aside className="bb-review-navigation"><section className="bb-review-tree"><header><h2>Isolated preview</h2></header><nav>
        {review.specSet?.files.map(file => <button className="bb-review-tree-file" key={file.path} disabled={review.busy || !!file.error} onClick={() => void review.run(() => review.load(file.path))}>
          <span className="bb-review-tree-name">{file.path.split("/").at(-1)}</span><span className={`bb-review-file-status bb-review-file-${file.status}`}>{file.status}</span>
        </button>)}
      </nav></section></aside>
      <main className="bb-review-main">
        <div className="bb-review-status">Iframe review experiment · Phase and factory actions are temporarily unavailable.</div>
        {review.error && <div role="alert" className="bb-review-error">{review.error}</div>}
        {(notice || review.notice) && <div role="status" className="bb-review-status">{notice || review.notice}</div>}
        {doc ? <>
          <header className="bb-review-header"><div className="bb-review-header-main"><div className="bb-review-actions">
            <button onClick={addFeedback} disabled={review.busy || !count}>Add feedback to chat</button>
            <button onClick={() => setNotes(!notes)}>Comments ({annotations.length})</button>
            <button onClick={review.refresh} disabled={review.busy}>Refresh</button>
          </div></div></header>
          <PortalProvider container={portal ?? document.body}><ScrollViewportProvider viewport={viewport}>
            <div ref={setViewport} className="bb-review-document"><div className="bb-review-reading-column">
              {!processed && <div className="bb-review-empty">Preparing document…</div>}
              {processed?.error && <div role="alert" className="bb-review-error">{processed.error}</div>}
              {processed?.value && <Viewer key={`${doc.id}:${doc.sha256}`} ref={viewer} blocks={processed.value.blocks} markdown={doc.content} annotations={annotations} mode={mode} inputMethod={input} taterMode={false}
                onAddAnnotation={annotation => { review.edit(current => [...current, annotation]); setNotes(true); }} onSelectAnnotation={setSelected} selectedAnnotationId={selected}
                onDeleteAnnotation={id => { viewer.current?.removeHighlight(id); review.edit(current => current.filter(annotation => annotation.id !== id)); }}
                onEditAnnotation={(id, changes) => review.edit(current => current.map(annotation => annotation.id === id ? { ...annotation, ...changes } : annotation))}
                documentChanges={processed.value.diff?.blocks} projectDocumentChanges={project} maxWidth={null} allowImages={false} quickLabels={false} disableCodePathValidation gridEnabled={false} sourceInfo={doc.path}
                annotationHeader={{ onInputMethodChange: setInput, onModeChange: setMode, hideQuickLabel: true }}
                selectionActions={[{ id: "add-to-chat", label: "Add to chat", onSelect: ({ text }) => addText(`From ${JSON.stringify(doc.path)} (SHA-256 ${doc.sha256}):\n\n${text.split("\n").map(line => `> ${line}`).join("\n")}`) }]}
                resolveLocalLink={() => ({ kind: "unavailable", title: "Open linked documents in the regular panel." })} />}
            </div></div>
            {processed?.value && notes && <div className="bb-review-comments"><AnnotationPanel presentation="embedded" isOpen annotations={annotations} blocks={processed.value.blocks} selectedId={selected} onSelect={setSelected}
              onDelete={id => { viewer.current?.removeHighlight(id); review.edit(current => current.filter(annotation => annotation.id !== id)); }} onEdit={(id, changes) => review.edit(current => current.map(annotation => annotation.id === id ? { ...annotation, ...changes } : annotation))} sharingEnabled={false} /></div>}
          </ScrollViewportProvider></PortalProvider>
        </> : <div className="bb-review-empty">{review.busy ? "Opening document…" : "No document selected."}</div>}
      </main>
    </div>
  </div>;
}
