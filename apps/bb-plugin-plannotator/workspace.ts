import path from "node:path";
import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { documentPath } from "./contracts";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function workspace(bb: BbPluginApi, threadId: string) {
  const thread = await bb.sdk.threads.get({ threadId });
  if (!thread.environmentId) throw new Error("This thread has no working folder.");
  const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
  if (environment.status !== "ready" || !environment.path) throw new Error("This thread’s working folder is unavailable. Restore its environment and try again.");
  const paths = environment.path.includes("\\") || /^[A-Za-z]:/.test(environment.path) ? path.win32 : path.posix;
  if (!paths.isAbsolute(environment.path)) throw new Error("The working folder must be an absolute path.");
  return { threadId, environmentId: environment.id, hostId: environment.hostId, checkoutRoot: paths.normalize(environment.path), paths };
}
export async function readDocument(bb: BbPluginApi, threadId: string, input: string, resolved?: Awaited<ReturnType<typeof workspace>>) {
  const source = resolved ?? await workspace(bb, threadId);
  const relative = documentPath.parse(input);
  const result = await bb.sdk.files.read({ hostId: source.hostId, rootPath: source.checkoutRoot, path: source.paths.join(source.checkoutRoot, relative) });
  if (result.contentEncoding !== "utf8" || result.content.includes("\0")) throw new Error("Choose a UTF-8 Markdown file.");
  if (result.sizeBytes > 256 * 1024) throw new Error("Document review currently supports files up to 256 KiB.");
  return { id: hash(JSON.stringify([threadId, source.hostId, source.checkoutRoot, relative])), threadId,
    environmentId: source.environmentId, hostId: source.hostId, checkoutRoot: source.checkoutRoot,
    path: relative, content: result.content, sha256: hash(result.content) };
}
