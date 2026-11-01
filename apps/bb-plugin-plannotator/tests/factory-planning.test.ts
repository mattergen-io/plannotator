import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { factoryFixture } from "./factory-fixture";
import { readDocument, workspace } from "../workspace";
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

it("automatically initializes a missing workspace once for concurrent requests", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  const [first, second] = await Promise.all([f.view(), f.view()]);
  expect(first.configured).toBe(true);
  expect(second.configured).toBe(true);
  expect(f.faults.initCount).toBe(1);
  const context = await f.beads.json("host-1", f.root, ["context"]);
  expect(context.project_id).toBeTruthy();
  expect((await f.view()).configured).toBe(true);
  expect((await f.beads.json("host-1", f.root, ["context"])).project_id).toBe(
    context.project_id,
  );
  expect(f.faults.initCount).toBe(1);
}, 30000);
it("creates Beads when starting a new spec with no workspace", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  const result = await f.harness.behavior.callRpc("factoryNewSpec", {
    threadId: f.threadId,
    name: "Fresh spec",
    idea: "A small feature",
  });
  expect(result).toEqual({ folder: ".kiro/specs/fresh-spec" });
  expect(f.faults.initCount).toBe(1);
  expect(f.sent.join("\n")).toContain("A small feature");
}, 30000);
it("preserves an existing but unusable Beads directory", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  await mkdir(join(f.root, ".beads"));
  const marker = join(f.root, ".beads", "existing-data.txt");
  await writeFile(marker, "preserve me");
  const view = await f.view();
  expect(view.configured).toBe(false);
  expect(view.error).toContain("A .beads directory exists");
  expect(f.faults.initCount).toBe(0);
  expect(await readFile(marker, "utf8")).toBe("preserve me");
}, 30000);
it("surfaces Beads connection errors without attempting initialization", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  f.faults.contextError = "database is unavailable";
  const view = await f.view();
  expect(view.configured).toBe(false);
  expect(view.error).toContain("database is unavailable");
  await expect(
    f.harness.behavior.callRpc("factorySetup", {
      threadId: f.threadId,
      folder: f.folder,
    }),
  ).rejects.toThrow("database is unavailable");
  expect(f.faults.initCount).toBe(0);
}, 30000);
it("reuses the existing project identity from a linked Git worktree", async () => {
  const f = await factoryFixture();
  const rootContext = await f.beads.json("host-1", f.root, ["context"]);
  const worktree = `${f.root}.factory/worktree`;
  f.git("worktree", "add", "-b", "linked", worktree);
  const source = await workspace(f.bb, f.threadId);
  const linked = await f.beads.ensureContext({
    ...source,
    checkoutRoot: worktree,
  });
  expect(linked.project_id).toBe(rootContext.project_id);
  expect(linked.is_worktree).toBe(true);
  expect(f.faults.initCount).toBe(0);
}, 30000);
it("initializes one shared workspace when a project and worktree start together", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  const worktree = `${f.root}.factory/worktree`;
  f.git("worktree", "add", "-b", "linked", worktree);
  const source = await workspace(f.bb, f.threadId);
  const [primary, linked] = await Promise.all([
    f.beads.ensureContext(source),
    f.beads.ensureContext({ ...source, checkoutRoot: worktree }),
  ]);
  expect(primary.project_id).toBe(linked.project_id);
  expect(linked.is_worktree).toBe(true);
  expect(f.faults.initCount).toBe(1);
}, 30000);
it("does not initialize over an unusable primary workspace from a worktree", async () => {
  const f = await factoryFixture({ initializeBeads: false });
  const worktree = `${f.root}.factory/worktree`;
  f.git("worktree", "add", "-b", "linked", worktree);
  await mkdir(join(f.root, ".beads"));
  const marker = join(f.root, ".beads", "existing-data.txt");
  await writeFile(marker, "preserve me");
  const source = await workspace(f.bb, f.threadId);
  await expect(
    f.beads.ensureContext({ ...source, checkoutRoot: worktree }),
  ).rejects.toThrow(".beads directory exists");
  expect(f.faults.initCount).toBe(0);
  expect(await readFile(marker, "utf8")).toBe("preserve me");
}, 30000);

it("reads each document once for a synchronized status view", async () => {
  const f = await factoryFixture();
  await writeFile(join(f.root, f.folder, "design.md"), "# Design\nA design.\n");
  f.reads.length = 0;
  const view = await f.view();
  expect(view.configured).toBe(true);
  expect(f.reads.sort()).toEqual([
    join(f.root, f.folder, "design.md"),
    join(f.root, f.folder, "requirements.md"),
  ].sort());
}, 30000);
