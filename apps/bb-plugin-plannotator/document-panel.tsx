import type {FactoryView} from "./factory/contracts";
import { FactoryControls } from "./factory/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { Viewer, type ViewerHandle } from "@plannotator/ui/components/Viewer";
import { RenderedMarkdown } from "@plannotator/ui/components/RenderedMarkdown";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel";
import { ScrollViewportProvider } from "@plannotator/ui/hooks/useScrollViewport";
import { PortalProvider } from "@plannotator/ui/components/PortalProvider";
import { computeDocumentChanges } from "@plannotator/ui/hooks/useDocumentChanges";
import { parseMarkdownToBlocks } from "@plannotator/ui/utils/parser";
import type { Annotation, EditorMode, InputMethod } from "@plannotator/ui/types";
import { useReview } from "./use-review";
import { targetOf, feedbackSelection } from "./contracts";
import { SpecTree } from "./spec-tree";
import { SpecSelector } from "./spec-selector";

export function DocumentPanel({ threadId, initialPath }: { threadId: string; initialPath?: string }) {
  const review = useReview(threadId, initialPath), composer = useComposer();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("selection"), [inputMethod, setInputMethod] = useState<InputMethod>("drag");
  const [notesOpen, setNotesOpen] = useState(false);
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [uncertain, setUncertain] = useState<"feedback" | "approve" | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const [factoryInitialized,setFactoryInitialized]=useState(false);
  const [factoryView,setFactoryView]=useState<FactoryView|null>(null);
  const doc = review.document;
  const blocks = useMemo(() => parseMarkdownToBlocks(doc?.content ?? ""), [doc?.content]);
  const diff = useMemo(() => doc?.baseline !== null && doc?.baseline !== undefined ? computeDocumentChanges(doc.baseline, doc.content) : null, [doc?.baseline, doc?.content]);
  const removals = useMemo(() => (diff?.blocks ?? []).flatMap(block => {
    const content = block.type === "removed" ? block.content : block.type === "modified"
      ? block.inlineTokens ? block.inlineTokens.filter(token => token.type === "removed").map(token => token.value).join(" … ") : block.oldContent : null;
    return content?.trim() ? [{ line: block.oldStart, content }] : [];
  }), [diff]);
  const annotations = (doc?.annotations ?? []) as Annotation[];
  useEffect(() => {
    const element = document.createElement("div");
    element.className = "bb-plannotator-ui bb-plannotator-portals theme-plannotator";
    document.body.appendChild(element); setPortal(element);
    return () => element.remove();
  }, []);
  useEffect(() => {
    setSelected(null); setUncertain(null); setNotesOpen(!!doc?.annotations.length);
  }, [doc?.id, doc?.sha256]);
  const feedbackCount = review.specSet?.files.reduce((count, file) => count + file.commentCount, 0) ?? 0;
  async function prepare() {
    await review.flush();
    const current = review.current.current;
    if (!current) throw new Error("Open a document first.");
    const set = review.currentSet.current;
    if (!set) throw new Error("Select a spec set first.");
    return review.rpc.call("prepare", { ...targetOf(current), action: "feedback", set: feedbackSelection(set) });
  }
  function addToChat() {
    void review.run(async () => {
      const { text } = await prepare();
      if (composer.scope.kind !== "thread" || composer.scope.threadId !== threadId) throw new Error("Open this thread’s composer before adding feedback.");
      composer.insert(text, { at: "end", block: true }); composer.focus(); review.setNotice("Feedback added to your chat draft.");
    });
  }
  function send(action: "feedback" | "approve", resend = false) {
    void review.run(async () => {
      await review.flush(); const current = review.current.current; if (!current) return;
      const set = review.currentSet.current;
      const result = await review.rpc.call("send", { ...targetOf(current), action, resend, ...(action === "feedback" && set ? { set: feedbackSelection(set) } : {}) });
      setUncertain(result.status === "uncertain" ? action : null);
      review.setNotice(result.status === "sent" ? action === "approve" ? "Approval sent. The agent will acknowledge and wait." : "Combined feedback sent to this conversation." : result.error);
      await review.load(current.path);
    });
  }
  const historical = !!doc && doc.sha256 !== doc.currentSha256;
  const selectionActions = doc ? [{ id: "add-to-chat", label: "Add to chat", onSelect: (context: { text: string }) => {
    if (composer.scope.kind !== "thread" || composer.scope.threadId !== threadId) return;
    composer.insert(`From ${JSON.stringify(doc.path)} (SHA-256 ${doc.sha256}):\n\n${context.text.split("\n").map(line => `> ${line}`).join("\n")}`, { at: "end", block: true }); composer.focus();
  } }] : [];
  return <div className="bb-plannotator-ui bb-plannotator-panel theme-plannotator">
    <div className="bb-review-workspace">
      <aside className="bb-review-navigation">
        <SpecSelector specs={review.specs} selected={review.specSet?.folder ?? null} busy={review.busy} truncated={review.truncated}
          onSelect={folder => void review.run(() => review.loadSet(folder))} onRefresh={review.refresh} />
        {review.specSet && <SpecTree specSet={{...review.specSet,files:review.specSet.files.map(file=>({...file,...(factoryView?.treeStatuses[file.path]?{status:factoryView.treeStatuses[file.path]}:{})}))}} selectedPath={doc?.path ?? null} busy={review.busy} onSelect={path => void review.run(() => review.load(path))} />}
      </aside>
      <main className="bb-review-main">
        <FactoryControls threadId={threadId} folder={review.specSet?.folder??null} environmentId={review.specSet?.environmentId} flush={review.flush} onInitialized={setFactoryInitialized} onView={setFactoryView} onRefresh={review.refresh}/>
    {review.error && <div role="alert" className="bb-review-error">{review.error}
      {review.dirty && doc && <button disabled={review.busy} onClick={() => void review.run(() => review.load(doc.path, doc.sha256, true))}>Discard local edits and reload saved feedback</button>}
    </div>}
    {review.notice && <div role="status" className="bb-review-status">{review.notice}</div>}
    {doc ? <>
      <header className="bb-review-header">
        <div className="bb-review-header-main">
          <label className="bb-review-version">Review version <select aria-label="Review version" disabled={review.busy} value={doc.sha256} onChange={event => void review.run(() => review.load(doc.path, event.target.value))}>
            {doc.versions.map(version => <option key={version.sha256} value={version.sha256}>{version.sha256 === doc.currentSha256 ? "Current" : "Earlier"} · {version.sha256.slice(0,8)} · {version.commentCount} comments</option>)}
          </select></label>
      <div className="bb-review-actions">
        <button onClick={addToChat} disabled={review.busy || !feedbackCount || historical}>Add to chat</button>
        <button onClick={() => send("feedback")} disabled={review.busy || !feedbackCount || historical}>Send feedback</button>
        <button title="Mark only the displayed document as reviewed" disabled={review.busy || historical} onClick={() => void review.run(async () => {
          await review.flush(); const current = review.current.current; if (!current) return;
          await review.rpc.call("reviewed", { ...targetOf(current),...(factoryInitialized&&review.specSet?{specFolder:review.specSet.folder}:{}) }); await review.load(current.path); review.setNotice("Reviewed baseline updated.");
        })}>Reviewed</button>
        <button aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>Comments ({annotations.length})</button>
      </div>
          {review.dirty && <span role="status" className="bb-review-saving">Saving feedback…</span>}
        </div>
        <div className="bb-review-scope"><span>Feedback includes comments across this set. Reviewed checks off this document; Accept advances the spec phase.</span>
          {diff && <span className="bb-review-change-legend">{diff.stats.additions || diff.stats.deletions ? <>Changes since review: <span>added</span> · <span>edited</span></> : "No changes since review."}</span>}
        </div>
      </header>
      {uncertain && <div className="bb-review-error">Check the conversation before resending. <button onClick={() => send(uncertain, true)} disabled={review.busy}>Resend</button></div>}
      {historical && <div className="bb-review-status">Viewing an earlier document version and its saved feedback. <button onClick={() => void review.run(() => review.load(doc.path))}>View current</button></div>}
      {portal && <PortalProvider container={portal}><ScrollViewportProvider viewport={viewport}>
        <div ref={setViewport} className="bb-review-document" aria-label="Review document">
          <Viewer key={`${doc.id}:${doc.sha256}`} ref={viewer} blocks={blocks} markdown={doc.content} annotations={annotations} mode={mode} inputMethod={inputMethod} taterMode={false}
            onAddAnnotation={annotation => { review.edit(current => [...current, annotation]); setNotesOpen(true); }} onSelectAnnotation={setSelected} selectedAnnotationId={selected}
            onDeleteAnnotation={id => { viewer.current?.removeHighlight(id); review.edit(current => current.filter(annotation => annotation.id !== id)); }}
            onEditAnnotation={(id, updates) => review.edit(current => current.map(annotation => annotation.id === id ? { ...annotation, ...updates } : annotation))}
            documentChanges={diff?.blocks} maxWidth={null} allowImages={false} quickLabels={false} disableCodePathValidation gridEnabled={false} sourceInfo={doc.path} readOnly={historical}
            annotationHeader={{ onInputMethodChange: setInputMethod, onModeChange: setMode, hideQuickLabel: true }}
            selectionActions={selectionActions} copyLabel="Copy document" commentDraftKey={`${doc.id}:${doc.sha256}`}
            resolveLocalLink={() => ({ kind: "unavailable", title: "Open linked documents through the document picker." })} />
          {!!removals.length && <section className="bb-review-removed" aria-label="Removed text since review">
            <h3>Removed text since review</h3>
            {removals.map((removed, index) => <div key={index}><span>Previous line {removed.line}</span><del className="bb-review-removed-content"><RenderedMarkdown markdown={removed.content} resolveLocalLink={() => ({ kind: "unavailable", title: "Removed text from the previous review." })} resolveImage={() => ({ kind: "unavailable", title: "Image from the previous review." })} /></del></div>)}
          </section>}
        </div>
        {notesOpen && <div className="bb-review-comments"><AnnotationPanel presentation="embedded" isOpen annotations={annotations} blocks={blocks} selectedId={selected} onSelect={setSelected}
          onDelete={id => { viewer.current?.removeHighlight(id); review.edit(current => current.filter(annotation => annotation.id !== id)); }}
          onEdit={(id, updates) => review.edit(current => current.map(annotation => annotation.id === id ? { ...annotation, ...updates } : annotation))} readOnly={historical} sharingEnabled={false} />
          {!annotations.length && <p className="bb-review-empty-comments">Select text or choose Global comment to add feedback.</p>}
        </div>}
      </ScrollViewportProvider></PortalProvider>}
    </> : <div className="bb-review-empty">{review.busy ? "Opening document…" : "Select a spec from the tree to start a review."}</div>}
      </main>
    </div>
  </div>;
}
