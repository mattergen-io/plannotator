import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { getAncestorPaths } from "@plannotator/ui/utils/diffFileTree";
import { documentPath, folderPath, insideFolder, parentFolder, type SpecSet, type SetFile } from "./contracts";
import { readDocument, workspace } from "./workspace";
import type { ReviewStore } from "./review-store";

export function specSets(bb: BbPluginApi, store: ReviewStore) {
  async function session(threadId: string) {
    const source = await workspace(bb, threadId);
    const result = await bb.sdk.files.listPaths({ hostId: source.hostId, path: source.checkoutRoot,
      includeFiles: true, includeDirectories: false, includeHidden: true, excludeNames: [".git", "node_modules"], limit: 5000 });
    const folders = new Set<string>(["."]);
    for (const entry of result.paths) {
      const parsed = documentPath.safeParse(entry.path.replace(/\\/g, "/"));
      if (parsed.success) getAncestorPaths(parsed.data).forEach(folder => folders.add(folder));
    }
    const selected = await bb.storage.kv.get(`selected:${threadId}`);
    const savedFolder = await bb.storage.kv.get(`selected-folder:${threadId}`);
    const path = typeof selected === "string" ? selected : null;
    return { folder: typeof savedFolder === "string" ? savedFolder : path ? parentFolder(path) : null, path,
      folders: [...folders].sort(), truncated: result.truncated };
  }
  async function read(threadId: string, input: string): Promise<SpecSet> {
    const folder = folderPath.parse(input), source = await workspace(bb, threadId);
    const listing = await bb.sdk.files.listPaths({ hostId: source.hostId, path: source.paths.join(source.checkoutRoot, folder),
      includeFiles: true, includeDirectories: false, includeHidden: true, excludeNames: [".git", "node_modules"], limit: 10000 });
    if (listing.truncated) throw new Error("This folder’s inventory is incomplete. Select a smaller spec folder.");
    const paths = [...new Set(listing.paths.filter(entry => entry.kind === "file").flatMap(entry => {
      const relative = entry.path.replace(/\\/g, "/");
      if (!/\.(md|markdown)$/i.test(relative)) return [];
      const path = documentPath.parse(folder === "." ? relative : `${folder}/${relative}`);
      if (!insideFolder(path, folder)) throw new Error("A listed document escaped the selected folder.");
      return [path];
    }))].sort();
    if (paths.length > 200) throw new Error("A spec set supports up to 200 Markdown documents. Select a smaller folder.");
    const files: SetFile[] = [];
    // Keep remote-host reads bounded while checking unopened documents too.
    for (let offset = 0; offset < paths.length; offset += 8) files.push(...await Promise.all(paths.slice(offset, offset + 8).map(async path => {
      try {
        const document = await readDocument(bb, threadId, path, source);
        store.capture(document); return store.summary(document);
      } catch (cause) {
        return { path, id: null, sha256: null, revision: null, status: "unavailable" as const, commentCount: 0,
          error: cause instanceof Error ? cause.message : String(cause) };
      }
    })));
    const fresh = await workspace(bb, threadId);
    if (fresh.hostId !== source.hostId || fresh.checkoutRoot !== source.checkoutRoot || fresh.environmentId !== source.environmentId)
      throw new Error("This thread moved while loading the spec set. Refresh before reviewing.");
    const selected = await bb.storage.kv.get(`selected:${threadId}`);
    return { threadId, folder, hostId: source.hostId, checkoutRoot: source.checkoutRoot, environmentId: source.environmentId, files,
      selectedPath: typeof selected === "string" && files.some(file => file.path === selected && !file.error) ? selected
        : files.find(file => file.path === `${folder === "." ? "" : folder + "/"}requirements.md` && !file.error)?.path ?? files.find(file => !file.error)?.path ?? null };
  }
  async function select(threadId: string, folder: string) {
    const set = await read(threadId, folder);
    await bb.storage.kv.set(`selected-folder:${threadId}`, set.folder);
    return set;
  }
  return { session, read, select };
}
export type SpecSets = ReturnType<typeof specSets>;
