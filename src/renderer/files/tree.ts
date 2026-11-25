// Pure logic of the Files tab: a tree from the file list, and on-screen rows from the tree.
import type { DirEntry, FileChange } from '../../git/types';
import { fileLetter } from '../git/model';

export interface TreeNode {
  name: string;
  /** Path relative to the repo. */
  path: string;
  kind: 'dir' | 'file';
  children: TreeNode[];
  /** The changed file's status letter; null if unchanged or a folder. */
  letter: string | null;
  /** The folder has a change inside it (at any depth). Always false for a file. */
  dirty: boolean;
  /** Matched by `.gitignore`: shown dimmed. An ignored folder's contents aren't listed. */
  ignored: boolean;
}

/** A file gone from the working tree: not shown in the list. */
const isGone = (f: FileChange) => f.kind === 'changed' && (f.y === 'D' || (f.y === '.' && f.x === 'D'));

const byName = (a: TreeNode, b: TreeNode) => {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Turns the file list into a folder tree. Files in the change list are added too: even if the file
 * list lags one poll behind, a new file shows up right away. Deleted files aren't listed,
 * but the folder they were in counts as containing a change.
 */
export function buildTree(
  files: string[],
  changes: FileChange[],
  ignored: string[] = [],
  /** Contents of loaded ignored folders: folder path → one level of entries. */
  loaded: Record<string, DirEntry[]> = {},
  /** Empty folders (git doesn't list them). */
  emptyDirs: string[] = [],
): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [], letter: null, dirty: false, ignored: false };
  const dirs = new Map<string, TreeNode>([['', root]]);

  const dirOf = (path: string): TreeNode => {
    const found = dirs.get(path);
    if (found) return found;
    const slash = path.lastIndexOf('/');
    const parent = dirOf(slash === -1 ? '' : path.slice(0, slash));
    const node: TreeNode = { name: path.slice(slash + 1), path, kind: 'dir', children: [], letter: null, dirty: false, ignored: false };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  const parentPath = (path: string) => {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  };

  const letters = new Map(changes.filter((f) => !isGone(f)).map((f) => [f.path, fileLetter(f)]));
  const seen = new Set<string>();
  for (const path of [...files, ...letters.keys()]) {
    if (seen.has(path)) continue;
    seen.add(path);
    const slash = path.lastIndexOf('/');
    dirOf(parentPath(path)).children.push({
      name: path.slice(slash + 1),
      path,
      kind: 'file',
      children: [],
      letter: letters.get(path) ?? null,
      dirty: false,
      ignored: false,
    });
  }

  for (const dir of emptyDirs) dirOf(dir);

  // Ignored entries: a folder ends with `/` and stays empty.
  for (const entry of ignored) {
    if (entry.endsWith('/')) {
      dirOf(entry.slice(0, -1)).ignored = true;
    } else if (!seen.has(entry)) {
      seen.add(entry);
      const slash = entry.lastIndexOf('/');
      dirOf(parentPath(entry)).children.push({ name: entry.slice(slash + 1), path: entry, kind: 'file', children: [], letter: null, dirty: false, ignored: true });
    }
  }

  // Contents of ignored folders that were expanded and read; everything inside them is ignored too.
  for (const [dir, entries] of Object.entries(loaded)) {
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.dir) {
        dirOf(path).ignored = true;
      } else if (!seen.has(path)) {
        seen.add(path);
        dirOf(dir).children.push({ name: entry.name, path, kind: 'file', children: [], letter: null, dirty: false, ignored: true });
      }
    }
  }

  // Every folder containing a change (including a deleted file's) is marked; folders not in the tree are skipped.
  for (const change of changes) {
    let dir = parentPath(change.path);
    while (dir !== '') {
      const node = dirs.get(dir);
      if (node) node.dirty = true;
      dir = parentPath(dir);
    }
  }

  const sort = (node: TreeNode) => {
    node.children.sort(byName);
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

interface TreeInputs {
  changes: string;
  ignored: string[];
  loaded: Record<string, DirEntry[]>;
  emptyDirs: string[];
  tree: TreeNode[];
}

/** The default for a list left out: one array, so that leaving it out twice counts as the same. */
const NONE: string[] = [];

/** The last tree built for each file list (the list is replaced, not changed, when it is read again). */
const trees = new WeakMap<string[], TreeInputs>();

const sameLoaded = (a: Record<string, DirEntry[]>, b: Record<string, DirEntry[]>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/**
 * `buildTree`, built again only when its inputs change. The Files tab is drawn again on every status
 * poll, and the change list arrives as a new array each time even when nothing changed: it is
 * compared by content, the rest (kept as they are in the store) by identity.
 */
export function cachedTree(
  files: string[],
  changes: FileChange[],
  ignored: string[] = NONE,
  loaded: Record<string, DirEntry[]> = {},
  emptyDirs: string[] = NONE,
): TreeNode[] {
  const key = JSON.stringify(changes);
  const last = trees.get(files);
  if (last && last.changes === key && last.ignored === ignored && last.emptyDirs === emptyDirs && sameLoaded(last.loaded, loaded)) return last.tree;
  const tree = buildTree(files, changes, ignored, loaded, emptyDirs);
  trees.set(files, { changes: key, ignored, loaded, emptyDirs, tree });
  return tree;
}

/** Whether the path is an ignored folder itself or inside one (`ignored`: the list from `listFiles`). */
export function insideIgnored(path: string, ignored: string[]): boolean {
  return ignored.some((entry) => entry.endsWith('/') && (`${path}/` === entry || path.startsWith(entry)));
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  open: boolean;
}

/** Turns the tree, including the contents of expanded folders, into rows in on-screen order. */
export function flattenTree(nodes: TreeNode[], isOpen: (path: string) => boolean, depth = 0): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    const open = node.kind === 'dir' && isOpen(node.path);
    rows.push({ node, depth, open });
    if (open) rows.push(...flattenTree(node.children, isOpen, depth + 1));
  }
  return rows;
}
