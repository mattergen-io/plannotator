import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { getAncestorPaths } from "@plannotator/ui/utils/diffFileTree";
import { documentPath, folderPath, insideFolder, parentFolder, type SpecSet, type SetFile, type Spec } from "./contracts";
import { readDocument, workspace } from "./workspace";
import type { ReviewStore } from "./review-store";

export function specSets(bb: BbPluginApi, store: ReviewStore) {
  async function session(threadId: string) {
    const source = await workspace(bb, threadId);
    const result = await bb.sdk.files.listPaths({ hostId: source.hostId, path: source.checkoutRoot, query: "requirements.md",
      includeFiles: true, includeDirectories: false, includeHidden: true, excludeNames: [".git", "node_modules"], limit: 5000 });
    const folders = new Set<string>();
    for (const entry of result.paths) {
      if (entry.kind !== "file") continue;
      const parsed = documentPath.safeParse(entry.path.replace(/\\/g, "/"));
      if (parsed.success && parsed.data.split("/").at(-1)?.toLowerCase() === "requirements.md") folders.add(parentFolder(parsed.data));
    }
    const specs: Spec[] = [...folders].sort().map(folder => ({ folder,
      name: folder === "." ? source.paths.basename(source.checkoutRoot) : folder.split("/").at(-1)!,
      parent: getAncestorPaths(folder).reverse().find(parent => folders.has(parent)) ?? (folder !== "." && folders.has(".") ? "." : null),
    }));
    const selected = await bb.storage.kv.get(`selected:${threadId}`);
    const savedFolder = await bb.storage.kv.get(`selected-folder:${threadId}`);
    const path = typeof selected === "string" ? selected : null;
    const folder = typeof savedFolder === "string" && folders.has(savedFolder) ? savedFolder
      : path ? specs.filter(spec => insideFolder(path, spec.folder)).sort((a, b) => b.folder.length - a.folder.length)[0]?.folder ?? null : null;
    return { folder, path, specs, truncated: result.truncated };
  }

  async function read(threadId: string, input: string): Promise<SpecSet> {
    const folder = folderPath.parse(input), source = await workspace(bb, threadId);
    const listing = await bb.sdk.files.listPaths({ hostId: source.hostId, path: source.paths.join(source.checkoutRoot, folder),
      includeFiles: true, includeDirectories: true, includeHidden: true, excludeNames: [".git", "node_modules"], limit: 10000 });
    if (listing.truncated) throw new Error("This folder’s inventory is incomplete. Select a smaller spec folder.");
    const entries = listing.paths.map(entry => {
      const relative = entry.path.replace(/\\/g, "/");
      const path = folderPath.parse(folder === "." ? relative : `${folder}/${relative}`);
      if (path !== folder && !insideFolder(path, folder)) throw new Error("A listed entry escaped the selected folder.");
      return { path, kind: entry.kind };
    }).filter(entry => entry.path !== folder);
    const paths = [...new Set(entries.filter(entry => entry.kind === "file" && /\.(md|markdown)$/i.test(entry.path)).map(entry => entry.path))].sort();
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
    return { threadId, folder, hostId: source.hostId, checkoutRoot: source.checkoutRoot, environmentId: source.environmentId, files, entries,
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
