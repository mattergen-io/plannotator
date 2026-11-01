import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { rpcContract } from "../contracts";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });
export const disposeAfter = (dispose: () => Promise<void>) => disposers.push(dispose);
export async function setup() {
  const root = await mkdtemp(join(tmpdir(), "bb-review-test-"));
  await writeFile(join(root, "plan.md"), "# Plan\n\nThe agent should revise this document.\n");
  const state = { root, content: "", sent: [] as string[], failSend: false, listingTruncated: false };
  const host = createFakePluginHost({ pluginId: "plannotator", sdk: {
    threads: { get: async ({ threadId }) => makeThreadResponse({ id: threadId, environmentId: "environment-1" }),
      send: async ({ input }) => { state.sent.push(JSON.stringify(input)); if (state.failSend) throw new Error("Connection lost after accepting message"); return {}; },
      promptHistory: async () => ({ prompts: state.sent }), },
    environments: { get: async () => ({ id: "environment-1", status: "ready", path: state.root, hostId: "host-1" }) },
    files: { listPaths: async ({ path, includeFiles, includeDirectories }) => ({ paths: (await readdir(path, { recursive: true, withFileTypes: true }))
        .filter(entry => ((includeFiles && entry.isFile()) || (includeDirectories && entry.isDirectory())) && !relative(path, join(entry.parentPath, entry.name)).split(/[\\/]/).some(part => part === ".git" || part === "node_modules"))
        .map(entry => ({ path: relative(path, join(entry.parentPath, entry.name)).replace(/\\/g, "/"), kind: entry.isDirectory() ? "directory" : "file" })), truncated: state.listingTruncated }),
      read: async ({ path, rootPath }) => {
        expect(rootPath).toBe(state.root);
        if (relative(await realpath(rootPath!), await realpath(path)).startsWith("..")) throw new Error("Path escapes workspace root");
        const content = await readFile(path, "utf8"); return { content, contentEncoding: "utf8", sizeBytes: Buffer.byteLength(content) };
      } },
  } });
  await plugin(host.bb);
  disposers.push(async () => { await host.harness.lifecycle.dispose(); await rm(root, { recursive: true, force: true }); });
  const open = async (threadId = "thread-1", sha256?: string) => rpcContract.open.output.parse(await host.harness.behavior.callRpc("open", { threadId, path: "plan.md", ...(sha256 ? { sha256 } : {}) }));
  return { ...host, state, open };
}
export function annotation() { return { id: "comment-1", blockId: "block-1", startOffset: 0, endOffset: 0, type: "GLOBAL_COMMENT" as const, originalText: "", text: "Add explicit acceptance criteria.", createdA: 1 }; }
