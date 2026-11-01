import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { reviewStore } from "../review-store";

it("migrates old source content into version storage without losing review history", async () => {
  const host = createFakePluginHost({ pluginId: "plannotator" });
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, [`CREATE TABLE review_documents (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, baselineSha TEXT);
    CREATE TABLE review_versions (documentId TEXT NOT NULL, sha256 TEXT NOT NULL, content TEXT NOT NULL, annotations TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0,
      approvedAt TEXT, updatedAt TEXT NOT NULL, PRIMARY KEY(documentId, sha256));
    CREATE TABLE review_deliveries (key TEXT PRIMARY KEY, data TEXT NOT NULL);`]);
  const source = { id: "doc", threadId: "thread", path: "requirements.md", environmentId: "env", hostId: "host", checkoutRoot: "/repo", sha256: "new", content: "New content" };
  db.prepare("INSERT INTO review_documents VALUES (?, ?, ?, ?, ?)").run(source.id, source.threadId, source.path, JSON.stringify(source), "old");
  db.prepare("INSERT INTO review_versions (documentId,sha256,content,annotations,revision,updatedAt) VALUES (?,?,?,?,?,?)")
    .run("doc", "old", "Old content", '[{"text":"keep"}]', 3, "2026-01-01");
  const store = reviewStore(host.bb);
  expect(store.get("doc", "new")?.content).toBe("New content");
  expect(store.get("doc", "old")).toMatchObject({ content: "Old content", annotations: '[{"text":"keep"}]', revision: 3 });
  expect(store.getSource("doc")).not.toHaveProperty("content");
  const row = db.prepare("SELECT baselineSha,source FROM review_documents WHERE id=?").get("doc") as { baselineSha: string; source: string };
  expect(row.baselineSha).toBe("old");
  expect(JSON.parse(row.source)).not.toHaveProperty("content");
  store.capture({ ...source, sha256: "newer", content: "Newest content" });
  expect(store.get("doc", "newer")?.content).toBe("Newest content");
  expect(store.getSource("doc")).not.toHaveProperty("content");
  await host.harness.lifecycle.dispose();
});
