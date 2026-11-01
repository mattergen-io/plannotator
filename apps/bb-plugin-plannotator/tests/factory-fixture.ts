import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readdir,
  readFile,
  rm,
  mkdir,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../host";
import { hostContract } from "../host-contract";
import { factory } from "../factory/server";
import { specSets } from "../spec-sets";
import { reviewStore } from "../review-store";
import { readDocument } from "../workspace";
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});
export async function factoryFixture({ initializeBeads = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bb-factory-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Factory Test");
  git("config", "user.email", "factory@example.invalid");
  await mkdir(join(root, ".kiro/specs/demo"), { recursive: true });
  await writeFile(
    join(root, ".kiro/specs/demo/requirements.md"),
    "# Requirements\n\n## Sum\nReturn the sum of two numbers.\n",
  );
  await writeFile(
    join(root, "sum.test.mjs"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('baseline',()=>assert.equal(1,1));\n",
  );
  git("add", ".");
  git("commit", "-qm", "Fixture baseline");
  if (initializeBeads)
    execFileSync(
      "bd",
      [
        "init",
        "--prefix",
        "bf",
        "--skip-agents",
        "--skip-hooks",
        "--non-interactive",
      ],
      { cwd: root, stdio: "pipe" },
    );
  const host = experimental_createHostEntryHarness(hostEntry);
  const faults = {
    taskCreatesBeforeFailure: null as number | null,
    taskCloseFailure: false,
    contextError: null as string | null,
    initCount: 0,
  };
  const sent: string[] = [],
    spawned: {
      id: string;
      prompt: string;
      path: string;
      title: string;
      model?: string;
      reasoningLevel?: string;
    }[] = [];
  const states = new Map<string, "idle" | "active" | "error">(),
    outputs = new Map<string, string>();
  const fake = createFakePluginHost({
    pluginId: "plannotator",
    experimental_callHostRpc: (call) => {
      const input = hostContract.command.input.parse(call.input);
      if (input.program === "bd" && input.args[0] === "init")
        faults.initCount++;
      if (
        input.program === "bd" &&
        input.args[0] === "context" &&
        faults.contextError
      )
        return { code: 1, stdout: "", stderr: faults.contextError };
      if (
        input.program === "bd" &&
        input.args[0] === "create" &&
        input.args[input.args.indexOf("--type") + 1] === "task" &&
        faults.taskCreatesBeforeFailure !== null
      ) {
        if (faults.taskCreatesBeforeFailure === 0) {
          faults.taskCreatesBeforeFailure = null;
          return {
            code: 1,
            stdout: "",
            stderr: "Controlled task-publication failure",
          };
        }
        faults.taskCreatesBeforeFailure--;
      }
      if (
        input.program === "bd" &&
        input.args[0] === "close" &&
        faults.taskCloseFailure
      ) {
        faults.taskCloseFailure = false;
        return { code: 1, stdout: "", stderr: "Controlled close interruption" };
      }
      return host.experimental_call("command", input);
    },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "project-1",
            environmentId: "env-1",
            status: states.get(threadId) ?? "idle",
            queuedMessageCount: 0,
          }),
        send: async ({ input }) => {
          sent.push(JSON.stringify(input));
          return {};
        },
        promptHistory: async () => ({ prompts: sent }),
        list: async () =>
          spawned.map((thread) =>
            makeThreadResponse({
              id: thread.id,
              title: thread.title,
              projectId: "project-1",
              status: states.get(thread.id) ?? "idle",
            }),
          ),
        output: async ({ threadId }) => ({
          output: outputs.get(threadId) ?? null,
        }),
        spawn: async (args) => {
          const id = `worker-${spawned.length + 1}`;
          const environment = args.environment;
          const path =
            environment.type === "host" &&
            environment.workspace.type === "unmanaged"
              ? environment.workspace.path!
              : root;
          spawned.push({
            id,
            prompt: args.prompt!,
            path,
            title: args.title!,
            model: args.model,
            reasoningLevel: args.reasoningLevel,
          });
          states.set(id, "active");
          return makeThreadResponse({
            id,
            status: "active",
            environmentId: "env-1",
          });
        },
      },
      providers: {
        models: async () => ({
          models: [
            {
              id: "gpt-6.1-terra",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            },
            {
              id: "gpt-6.1-sol",
              supportedReasoningEfforts: [{ reasoningEffort: "xhigh" }],
            },
          ],
        }),
      },
      hosts: {
        pathsExist: async ({ paths }) => ({
          existence: Object.fromEntries(
            await Promise.all(
              paths.map(async (path) => {
                try {
                  await lstat(path);
                  return [path, true];
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === "ENOENT")
                    return [path, false];
                  throw error;
                }
              }),
            ),
          ),
        }),
      },
      environments: {
        get: async () => ({
          id: "env-1",
          path: root,
          hostId: "host-1",
          status: "ready",
        }),
      },
      files: {
        read: async ({ path }) => {
          const content = await readFile(path, "utf8");
          return {
            content,
            contentEncoding: "utf8",
            sizeBytes: Buffer.byteLength(content),
          };
        },
        listPaths: async ({
          path,
          includeFiles,
          includeDirectories,
          query,
        }) => ({
          paths: (await readdir(path, { recursive: true, withFileTypes: true }))
            .filter(
              (e) =>
                !relative(path, join(e.parentPath, e.name))
                  .split(/[\\/]/)
                  .some((p) =>
                    [".git", ".beads", "node_modules"].includes(p),
                  ) &&
                ((includeFiles && e.isFile()) ||
                  (includeDirectories && e.isDirectory())),
            )
            .map((e) => ({
              path: relative(path, join(e.parentPath, e.name)).replace(
                /\\/g,
                "/",
              ),
              kind: e.isDirectory() ? "directory" : "file",
            }))
            .filter((e) => !query || e.path.includes(query)),
          truncated: false,
        }),
      },
    },
  });
  const store = reviewStore(fake.bb),
    sets = specSets(fake.bb, store),
    workflow = factory(fake.bb, sets, store);
  disposers.push(async () => {
    await fake.harness.lifecycle.dispose();
    await host.experimental_dispose();
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.factory`, { recursive: true, force: true });
  });
  const folder = ".kiro/specs/demo",
    threadId = "planner";
  const view = () => workflow.plan.view(threadId, folder);
  async function review(path: string) {
    const doc = await readDocument(fake.bb, threadId, `${folder}/${path}`);
    store.capture(doc);
    await workflow.plan.reviewed({ ...doc, revision: 0 });
  }
  async function accept(decision?: "continue" | "split") {
    const v = await view();
    return fake.harness.behavior.callRpc("factoryAccept", {
      threadId,
      folder,
      revision: v.state!.revision,
      manifest: v.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      ...(decision ? { decision } : {}),
    });
  }
  async function assess() {
    await workflow.plan.draft(threadId, folder, "sizing");
    outputs.set(
      threadId,
      `This is a small leaf spec; continue to Design. Assessment ${Date.now()}.`,
    );
    await view();
  }
  return {
    ...fake,
    faults,
    ...workflow,
    root,
    git,
    host,
    sets,
    store,
    sent,
    spawned,
    states,
    outputs,
    folder,
    threadId,
    view,
    review,
    accept,
    assess,
  };
}
export const taskMarkdown = `# Tasks

## T1: Sum helper
### Responsibilities
Own sum.mjs and its focused test. Export sum(a,b); no UI or other features.
### Requirements
.kiro/specs/demo/requirements.md#sum
### Design
.kiro/specs/demo/design.md#module
### Dependencies
None
### Acceptance
sum(2,3) returns 5; negative operands work.
### Verification
node --test
`;
