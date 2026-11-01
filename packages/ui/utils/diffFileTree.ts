/**
 * Pure tree builder for a list of changed files (a diff), shared by
 * Plannotator's code-review file tree (`packages/review-editor`) and the
 * embeddable `DiffFileTree` component. Browser-safe, no React.
 *
 * Shape rules (the review's, unchanged when this moved here):
 * - folders before files at every level, each group sorted by name
 *   (`localeCompare`);
 * - a folder whose only child is a folder is merged into it
 *   (`packages/app/src`), recursively;
 * - when the whole tree is one root folder holding only files, that folder is
 *   unwrapped and the files sit at the root;
 * - a folder's +/- counts are the sums of everything under it.
 */

/** Change status a tree row can show. 'binary' is a host-facing extra; the
 * review's own parser never produces it. */
export type DiffFileTreeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';

/** Hosts may reuse the path tree without inventing diff statuses or counts. */
export interface FileTreeInput {
  path: string;
  kind?: "file" | "directory";
  additions?: number;
  deletions?: number;
}

export interface DiffFileTreeFile extends FileTreeInput {
  oldPath?: string;
  status: DiffFileTreeStatus;
  additions: number;
  deletions: number;
}

export interface DiffFileTreeNode<F extends FileTreeInput = DiffFileTreeFile> {
  type: 'file' | 'folder';
  /** Display name: the file name, or the (possibly merged) folder segment(s). */
  name: string;
  /** File: the file's own path. Folder: the full folder path from the root. */
  path: string;
  depth: number;
  /** Index of the file in the input array (file nodes only). */
  fileIndex?: number;
  file?: F;
  directory?: F;
  children?: DiffFileTreeNode<F>[];
  additions: number;
  deletions: number;
}

interface TrieNode<F> {
  children: Map<string, TrieNode<F>>;
  file?: { index: number; data: F };
  directory?: F;
}

function buildTrie<F extends FileTreeInput>(files: readonly F[]): TrieNode<F> {
  const root: TrieNode<F> = { children: new Map() };

  for (let i = 0; i < files.length; i++) {
    const segments = files[i].path.split('/').filter(Boolean);
    let current = root;

    for (const segment of segments) {
      if (!current.children.has(segment)) current.children.set(segment, { children: new Map() });
      current = current.children.get(segment)!;
    }
    if (files[i].kind === 'directory') current.directory = files[i];
    else current.file = { index: i, data: files[i] };
  }

  return root;
}

function trieToNodes<F extends FileTreeInput>(
  trie: TrieNode<F>,
  parentPath: string,
  depth: number,
): DiffFileTreeNode<F>[] {
  const folders: DiffFileTreeNode<F>[] = [];
  const fileNodes: DiffFileTreeNode<F>[] = [];

  for (const [name, child] of trie.children) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    if (child.file) {
      fileNodes.push({
        type: 'file',
        name,
        path: child.file.data.path,
        depth,
        fileIndex: child.file.index,
        file: child.file.data,
        additions: child.file.data.additions ?? 0,
        deletions: child.file.data.deletions ?? 0,
      });
    } else {
      const children = trieToNodes(child, fullPath, depth + 1);
      const additions = children.reduce((s, c) => s + c.additions, 0);
      const deletions = children.reduce((s, c) => s + c.deletions, 0);

      folders.push({
        type: 'folder',
        name,
        path: fullPath,
        depth,
        children,
        ...(child.directory ? { directory: child.directory } : {}),
        additions,
        deletions,
      });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  fileNodes.sort((a, b) => a.name.localeCompare(b.name));

  return [...folders, ...fileNodes];
}

function collapseSingleChild<F extends FileTreeInput>(nodes: DiffFileTreeNode<F>[]): DiffFileTreeNode<F>[] {
  return nodes.map(node => {
    if (node.type !== 'folder' || !node.children) return node;

    let current = node;
    while (
      current.children &&
      current.children.length === 1 &&
      current.children[0].type === 'folder'
    ) {
      const child = current.children[0];
      current = {
        ...child,
        name: `${current.name}/${child.name}`,
        depth: node.depth,
      };
    }

    return {
      ...current,
      children: current.children ? collapseSingleChild(fixDepths(current.children, node.depth + 1)) : undefined,
    };
  });
}

function fixDepths<F extends FileTreeInput>(nodes: DiffFileTreeNode<F>[], depth: number): DiffFileTreeNode<F>[] {
  return nodes.map(node => ({
    ...node,
    depth,
    children: node.children ? fixDepths(node.children, depth + 1) : undefined,
  }));
}

/** Native file browsers can preserve every directory level and the base row. */
export interface FileTreeOptions { compactFolders?: boolean; unwrapRoot?: boolean }
export function buildDiffFileTree<F extends FileTreeInput>(files: readonly F[], options: FileTreeOptions = {}): DiffFileTreeNode<F>[] {
  if (files.length === 0) return [];

  const trie = buildTrie(files);
  let tree = trieToNodes(trie, '', 0);
  if (options.compactFolders !== false) tree = collapseSingleChild(tree);

  // Flat fallback: if the tree is a single root folder with only file children, unwrap it
  if (
    options.unwrapRoot !== false &&
    tree.length === 1 &&
    tree[0].type === 'folder' &&
    tree[0].children?.every(c => c.type === 'file')
  ) {
    return fixDepths(tree[0].children!, 0);
  }

  return tree;
}

/** Every proper ancestor folder path of a file path (`a/b/c.ts` → `a`, `a/b`).
 * A merged folder's path is one of these, so expanding them all reveals the file. */
export function getAncestorPaths(filePath: string): string[] {
  const segments = filePath.split('/').filter(Boolean);
  const paths: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    paths.push(segments.slice(0, i).join('/'));
  }
  return paths;
}

/** File indexes in the order the tree renders them (ignores collapse state). */
export function getVisualFileOrder<F extends FileTreeInput>(nodes: DiffFileTreeNode<F>[]): number[] {
  const order: number[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.fileIndex != null) {
      order.push(node.fileIndex);
    } else if (node.children) {
      order.push(...getVisualFileOrder(node.children));
    }
  }
  return order;
}

export function getAllFolderPaths<F extends FileTreeInput>(nodes: DiffFileTreeNode<F>[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      paths.push(node.path);
      if (node.children) {
        paths.push(...getAllFolderPaths(node.children));
      }
    }
  }
  return paths;
}
