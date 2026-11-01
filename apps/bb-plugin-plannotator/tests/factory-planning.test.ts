import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { factoryFixture } from "./factory-fixture";
import { readDocument } from "../workspace";
import { factoryViewSchema } from "../factory/contracts";
it("imports explicit membership only for the exact confirmed document inventory", async () => {
  const f = await factoryFixture();
  await rename(
    join(f.root, f.folder, "requirements.md"),
    join(f.root, f.folder, "product-requirements.md"),
  );
  await writeFile(
    join(f.root, f.folder, "architecture.md"),
    "# Architecture\nPure modules.\n",
  );
  const view = await f.view();
  const selection = {
    threadId: f.threadId,
    folder: f.folder,
    phase: "design",
    confirmPrior: true,
    manifest: view.files.map(({ path, sha256 }) => ({ path, sha256 })),
    members: Object.fromEntries(
      view.files.map((file) => [
        file.path,
        file.path.endsWith("architecture.md") ? "design" : "requirements",
      ]),
    ),
  };
  await writeFile(
    join(f.root, f.folder, "notes.md"),
    "# Reference\nScope notes.\n",
  );
  await expect(
    f.harness.behavior.callRpc("factoryInitialize", selection),
  ).rejects.toThrow("import documents changed");
  expect((await f.view()).state).toBeNull();
  const current = await f.view();
  await expect(
    f.harness.behavior.callRpc("factoryInitialize", {
      ...selection,
      manifest: current.files.map(({ path, sha256 }) => ({ path, sha256 })),
      members: Object.fromEntries(
        current.files.map((file) => [
          file.path,
          file.path.endsWith("architecture.md") ? "requirements" : "reference",
        ]),
      ),
    }),
  ).rejects.toThrow("filename");
  const raw = await f.harness.behavior.callRpc("factoryInitialize", {
    ...selection,
    manifest: current.files.map(({ path, sha256 }) => ({ path, sha256 })),
    members: { ...selection.members, [f.folder + "/notes.md"]: "reference" },
  });
  const result = factoryViewSchema.parse(raw);
  expect(result.state?.phase).toBe("design");
  expect(result.state!.acceptances).toHaveLength(1);
  expect(result.state!.acceptances[0].documents[0].path).toContain(
    "product-requirements.md",
  );
  expect(
    result.files.find((file) => file.path.endsWith("architecture.md"))?.phase,
  ).toBe("design");
}, 30000);
it("keeps another thread read-only instead of redirecting its phase prompts", async () => {
  const f = await factoryFixture();
  await f.plan.initialize(f.threadId, f.folder, "requirements", false);
  const before = await f.view();
  const other = await f.plan.view("another-thread", f.folder);
  expect(other.error).toContain("another planning thread");
  await expect(
    f.plan.draft("another-thread", f.folder, "requirements"),
  ).rejects.toThrow("associated planning thread");
  expect(f.sent).toHaveLength(0);
  expect((await f.view()).state).toEqual(before.state);
}, 30000);
it("keeps a decomposed parent at Requirements and assigns children to their nearest spec", async () => {
  const f = await factoryFixture();
  await f.plan.initialize(f.threadId, f.folder, "requirements", false);
  await f.review("requirements.md");
  await f.assess();
  await f.accept("split");
  expect((await f.view()).state?.mode).toBe("decomposed");
  expect((await f.view()).state?.phase).toBe("requirements");
  const child = f.folder + "/blocks/01";
  await mkdir(join(f.root, child), { recursive: true });
  await writeFile(join(f.root, f.folder, "blocks/README.md"), "# Container\n");
  await writeFile(
    join(f.root, child, "01-requirements.md"),
    "# Child requirements\nA bounded child.\n",
  );
  const catalog = await f.sets.session(f.threadId);
  expect(catalog.specs.map((s) => s.folder)).toEqual([f.folder, child]);
  const childView = await f.plan.initialize(
    f.threadId,
    child,
    "requirements",
    false,
  );
  expect(childView.state?.parentId).toBe((await f.view()).spec?.id);
  expect(childView.files).toHaveLength(1);
  expect(
    (await f.view()).files.some((file) => file.path.startsWith(child)),
  ).toBe(false);
  await expect(f.accept("continue")).rejects.toThrow("already accepted");
}, 30000);

it("preserves both exact review marks when Design documents are reviewed concurrently", async () => {
  const f = await factoryFixture();
  await writeFile(
    join(f.root, f.folder, "design.md"),
    "# Design\nModule boundaries.\n",
  );
  await writeFile(
    join(f.root, f.folder, "design-data.md"),
    "# Data design\nData contract.\n",
  );
  await f.plan.initialize(f.threadId, f.folder, "design", true);
  const targets = await Promise.all(
    ["design.md", "design-data.md"].map(async (file) => {
      const doc = await readDocument(f.bb, f.threadId, `${f.folder}/${file}`);
      f.store.capture(doc);
      return { ...doc, revision: 0 };
    }),
  );
  await Promise.all(targets.map((target) => f.plan.reviewed(target)));
  const view = await f.view();
  expect(
    view.files
      .filter((file) => file.phase === "design")
      .every((file) => file.reviewed),
  ).toBe(true);
  expect(view.state?.revision).toBe(2);
}, 30000);
