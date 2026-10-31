import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { Annotation } from "@plannotator/ui/types";
import { CHANNEL, rpcContract, annotationsSchema, targetOf, type ReviewDocument } from "./contracts";

export function useReview(threadId: string, initialPath?: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = useRef<ReviewDocument | null>(null), isDirty = useRef(false), generation = useRef(0);
  const saving = useRef(Promise.resolve());
  const connection = useRealtimeConnectionState();
  const commit = useCallback((doc: ReviewDocument) => { current.current = doc; setDocument(doc); }, []);
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
    saving.current = pending;
    return pending;
  }, [rpc, commit]);
  const load = useCallback(async (path: string, sha256?: string, discardLocal = false) => {
    if (discardLocal) {
      await saving.current.catch(() => {});
      isDirty.current = false; setDirty(false);
    } else await flush();
    const request = ++generation.current;
    const doc = await rpc.call("open", { threadId, path, ...(sha256 ? { sha256 } : {}) });
    if (request !== generation.current) return;
    if (current.current?.id !== doc.id || current.current?.sha256 !== doc.sha256) setNotice(null);
    commit(doc); isDirty.current = false; setDirty(false);
  }, [rpc, threadId, flush, commit]);
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
      setFiles(session.files); setTruncated(session.truncated);
      const path = initialPath ?? session.path;
      if (path) await load(path);
    });
    return () => { cancelled = true; generation.current++; };
  }, [threadId, initialPath, rpc, load, run]);
  const refresh = useCallback(() => {
    const doc = current.current;
    if (doc) void run(() => load(doc.path, doc.sha256 !== doc.currentSha256 ? doc.sha256 : undefined));
  }, [run, load]);
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
      // Plannotator’s model uses optional undefined fields; BB RPC accepts JSON values only.
      const annotations = annotationsSchema.parse(JSON.parse(JSON.stringify(update(current.current.annotations as Annotation[]))));
      commit({ ...current.current, annotations, versions: current.current.versions.map(version => version.sha256 === current.current!.sha256 ? { ...version, commentCount: annotations.length } : version) });
      isDirty.current = true; setDirty(true); setNotice(null); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [commit]);
  return { rpc, document, files, truncated, busy, dirty, error, notice, setNotice, run, load, refresh, flush, edit, current };
}
