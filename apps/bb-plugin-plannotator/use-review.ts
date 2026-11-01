import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { Annotation } from "@plannotator/ui/types";
import { CHANNEL, rpcContract, annotationsSchema, targetOf, parentFolder, insideFolder, summarizeDocument, type ReviewDocument, type SpecSet, type Spec } from "./contracts";

export function useReview(threadId: string, initialPath?: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [document, setDocument] = useState<ReviewDocument | null>(null), [specSet, setSpecSet] = useState<SpecSet | null>(null);
  const [specs, setSpecs] = useState<Spec[]>([]), [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = useRef<ReviewDocument | null>(null), currentSet = useRef<SpecSet | null>(null), isDirty = useRef(false), generation = useRef(0);
  const saving = useRef(Promise.resolve());
  const connection = useRealtimeConnectionState();
  const commitSet = useCallback((set: SpecSet) => { currentSet.current = set; setSpecSet(set); }, []);
  const commit = useCallback((doc: ReviewDocument | null) => {
    current.current = doc; setDocument(doc);
    const set = currentSet.current;
    if (doc && set && doc.sha256 === doc.currentSha256 && doc.hostId === set.hostId && doc.checkoutRoot === set.checkoutRoot)
      commitSet({ ...set, selectedPath: doc.path, files: set.files.map(file => file.path === doc.path ? summarizeDocument(doc) : file) });
  }, [commitSet]);
  const flush = useCallback(() => {
    const pending = saving.current.catch(() => {}).then(async () => {
      while (isDirty.current && current.current) {
        const sent = current.current;
        const saved = await rpc.call("save", { ...targetOf(sent), annotations: sent.annotations });
        if (current.current?.id !== sent.id || current.current.sha256 !== sent.sha256) return;
        const unchanged = current.current.annotations === sent.annotations;
        commit({ ...current.current, revision: saved.revision });
        isDirty.current = !unchanged; setDirty(!unchanged);
      }
    });
    saving.current = pending; return pending;
  }, [rpc, commit]);
  const loadSet = useCallback(async (folder: string, preferredPath?: string, sha256?: string) => {
    const request = ++generation.current;
    await flush();
    if (request !== generation.current) return;
    const set = await rpc.call("specSet", { threadId, folder });
    const path = preferredPath && set.files.some(file => file.path === preferredPath && !file.error) ? preferredPath : set.selectedPath;
    const sameSource = current.current?.hostId === set.hostId && current.current?.checkoutRoot === set.checkoutRoot;
    const doc = path ? await rpc.call("open", { threadId, path, ...(sha256 && sameSource ? { sha256 } : {}) }) : null;
    if (request !== generation.current) return;
    if (current.current?.id !== doc?.id || current.current?.sha256 !== doc?.sha256) setNotice(null);
    commitSet(set); commit(doc); isDirty.current = false; setDirty(false);
  }, [rpc, threadId, flush, commit, commitSet]);
  const load = useCallback(async (path: string, sha256?: string, discardLocal = false) => {
    if (discardLocal) { await saving.current.catch(() => {}); isDirty.current = false; setDirty(false); }
    if (!currentSet.current || !insideFolder(path, currentSet.current.folder)) {
      const owner = specs.filter(spec => insideFolder(path, spec.folder)).sort((a, b) => b.folder.length - a.folder.length)[0]?.folder ?? parentFolder(path);
      return loadSet(owner, path, sha256);
    }
    const request = ++generation.current;
    await flush();
    if (request !== generation.current) return;
    const doc = await rpc.call("open", { threadId, path, ...(sha256 ? { sha256 } : {}) });
    if (request !== generation.current) return;
    if (current.current?.id !== doc.id || current.current?.sha256 !== doc.sha256) setNotice(null);
    commit(doc); isDirty.current = false; setDirty(false);
  }, [rpc, threadId, flush, commit, loadSet, specs]);
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void run(async () => {
      const session = await rpc.call("session", { threadId });
      if (cancelled) return;
      setSpecs(session.specs); setTruncated(session.truncated);
      const folder = initialPath
        ? session.specs.filter(spec => insideFolder(initialPath, spec.folder)).sort((a, b) => b.folder.length - a.folder.length)[0]?.folder ?? parentFolder(initialPath)
        : session.folder;
      if (folder) await loadSet(folder, initialPath ?? session.path ?? undefined);
    });
    return () => { cancelled = true; generation.current++; };
  }, [threadId, initialPath, rpc, loadSet, run]);
  const refresh = useCallback(() => {
    const set = currentSet.current, doc = current.current;
    void run(async () => {
      const session = await rpc.call("session", { threadId }); setSpecs(session.specs); setTruncated(session.truncated);
      if (set) await loadSet(set.folder, doc?.path, doc && doc.sha256 !== doc.currentSha256 ? doc.sha256 : undefined);
    });
  }, [run, loadSet, rpc, threadId]);
  useRealtime(CHANNEL, value => {
    if (value && typeof value === "object" && !Array.isArray(value) && "threadId" in value && value.threadId === threadId) refresh();
  });
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (previousConnection.current !== "connected" && connection === "connected") refresh();
    previousConnection.current = connection;
  }, [connection, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => { void flush().catch(cause => setError(String(cause))); }, 400);
    return () => clearTimeout(timer);
  }, [document?.annotations, dirty, flush]);
  useEffect(() => () => { void flush().catch(() => {}); }, [flush]);
  const edit = useCallback((update: (annotations: Annotation[]) => Annotation[]) => {
    if (!current.current) return;
    try {
      // Plannotator’s optional undefined fields must be normalized for BB’s JSON RPC.
      const annotations = annotationsSchema.parse(JSON.parse(JSON.stringify(update(current.current.annotations as Annotation[]))));
      commit({ ...current.current, annotations, versions: current.current.versions.map(version => version.sha256 === current.current!.sha256 ? { ...version, commentCount: annotations.length } : version) });
      isDirty.current = true; setDirty(true); setNotice(null); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [commit]);
  return { rpc, document, specSet, specs, truncated, busy, dirty, error, notice, setNotice, run, load, loadSet, refresh, flush, edit, current, currentSet };
}
