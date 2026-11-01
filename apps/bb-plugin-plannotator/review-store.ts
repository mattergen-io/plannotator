import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ReviewTarget } from "./contracts";
import { reviewStatus, annotationsSchema } from "./contracts";
import type { readDocument } from "./workspace";

type Source = Awaited<ReturnType<typeof readDocument>>;
type SourceMetadata = Omit<Source, "content">;
export type Version = { content: string; annotations: string; revision: number; approvedAt: string | null; updatedAt: string; sha256: string };
export type Delivery = { id: string; threadId: string; text: string; status: "pending" | "uncertain" | "sent"; error: string | null };
export function reviewStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [`CREATE TABLE review_documents (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, baselineSha TEXT);
    CREATE TABLE review_versions (documentId TEXT NOT NULL, sha256 TEXT NOT NULL, content TEXT NOT NULL, annotations TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0,
      approvedAt TEXT, updatedAt TEXT NOT NULL, PRIMARY KEY(documentId, sha256));
    CREATE TABLE review_deliveries (key TEXT PRIMARY KEY, data TEXT NOT NULL);`,
    `INSERT OR IGNORE INTO review_versions (documentId,sha256,content,updatedAt)
      SELECT id,json_extract(source,'$.sha256'),json_extract(source,'$.content'),datetime('now')
      FROM review_documents WHERE json_type(source,'$.sha256')='text' AND json_type(source,'$.content')='text';
    UPDATE review_documents SET source=json_remove(source,'$.content')
      WHERE json_type(source,'$.content')='text' AND EXISTS (
        SELECT 1 FROM review_versions v WHERE v.documentId=review_documents.id AND v.sha256=json_extract(review_documents.source,'$.sha256')
          AND v.content=json_extract(review_documents.source,'$.content')
      );`]);
  const getSource = (id: string) => {
    const row = db.prepare("SELECT source FROM review_documents WHERE id=?").get(id) as { source: string } | undefined;
    return row ? JSON.parse(row.source) as SourceMetadata : null;
  };
  const get = (id: string, sha256: string) => db.prepare("SELECT * FROM review_versions WHERE documentId=? AND sha256=?").get(id, sha256) as Version | undefined;
  const requireVersion = (target: ReviewTarget) => {
    const source = getSource(target.id), version = get(target.id, target.sha256);
    if (!source || source.threadId !== target.threadId || !version) throw new Error("This document version does not belong to the selected thread.");
    if (version.revision !== target.revision) throw new Error("This feedback changed in another panel. Your edits remain here; refresh before replacing the saved review.");
    return { source, version };
  };
  return {
    requireVersion, get, getSource,
    capture: (source: Source) => {
      const { content, ...metadata } = source;
      db.prepare("INSERT INTO review_documents VALUES (?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET source=excluded.source")
        .run(source.id, source.threadId, source.path, JSON.stringify(metadata));
      db.prepare("INSERT INTO review_versions (documentId,sha256,content,updatedAt) VALUES (?,?,?,?) ON CONFLICT DO NOTHING")
        .run(source.id, source.sha256, content, new Date().toISOString());
    },
    view: (source: Source, selectedHash = source.sha256) => {
      const row = get(source.id, selectedHash);
      if (!row) throw new Error("This saved review version is unavailable.");
      const baseline = db.prepare("SELECT v.content FROM review_documents d LEFT JOIN review_versions v ON v.documentId=d.id AND v.sha256=d.baselineSha WHERE d.id=?").get(source.id) as { content: string | null };
      const versions = db.prepare("SELECT sha256,updatedAt,annotations,approvedAt FROM review_versions WHERE documentId=? ORDER BY updatedAt DESC LIMIT 30").all(source.id) as Version[];
      return { ...source, sha256: selectedHash, currentSha256: source.sha256, content: row.content, annotations: annotationsSchema.parse(JSON.parse(row.annotations)),
        revision: row.revision, baseline: baseline.content, approvedAt: row.approvedAt,
        versions: versions.map(v => ({ sha256: v.sha256, updatedAt: v.updatedAt, approvedAt: v.approvedAt, commentCount: JSON.parse(v.annotations).length })) };
    },
    summary: (source: Source) => {
      const version = get(source.id, source.sha256)!;
      const row = db.prepare("SELECT baselineSha FROM review_documents WHERE id=?").get(source.id) as { baselineSha: string | null };
      return { path: source.path, id: source.id, sha256: source.sha256, revision: version.revision,
        status: reviewStatus(row.baselineSha, source.sha256, version.approvedAt), commentCount: JSON.parse(version.annotations).length, error: null };
    },
    save: db.transaction((target: ReviewTarget, annotations: unknown) => {
      requireVersion(target);
      const serialized = JSON.stringify(annotationsSchema.parse(annotations));
      db.prepare("UPDATE review_versions SET annotations=?,revision=revision+1,updatedAt=? WHERE documentId=? AND sha256=?")
        .run(serialized, new Date().toISOString(), target.id, target.sha256);
      return { revision: target.revision + 1 };
    }),
    reviewed: (target: ReviewTarget, approve = false) => {
      db.prepare("UPDATE review_documents SET baselineSha=? WHERE id=?").run(target.sha256, target.id);
      if (approve) db.prepare("UPDATE review_versions SET approvedAt=COALESCE(approvedAt,?) WHERE documentId=? AND sha256=?").run(new Date().toISOString(), target.id, target.sha256);
    },
    delivery: (key: string) => {
      const row = db.prepare("SELECT data FROM review_deliveries WHERE key=?").get(key) as { data: string } | undefined;
      return row ? JSON.parse(row.data) as Delivery : null;
    },
    putDelivery: (key: string, delivery: Delivery) => db.prepare("INSERT INTO review_deliveries VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(key, JSON.stringify(delivery)),
  };
}

export type ReviewStore = ReturnType<typeof reviewStore>;
