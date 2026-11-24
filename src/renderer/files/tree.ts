// Files sekmesinin saf mantığı: dosya listesinden ağaç, ağaçtan ekrandaki satırlar.
import type { FileChange } from '../../git/types';
import { fileLetter } from '../git/model';

export interface TreeNode {
  name: string;
  /** Repoya göre göreli yol. */
  path: string;
  kind: 'dir' | 'file';
  children: TreeNode[];
  /** Değişen dosyanın durum harfi; değişmemişse ya da klasörse null. */
  letter: string | null;
  /** Klasörün içinde (herhangi bir derinlikte) değişiklik var. Dosyada her zaman false. */
  dirty: boolean;
  /** `.gitignore`'a takılıyor: soluk gösterilir. Yok sayılan klasörün içi listelenmez. */
  ignored: boolean;
}

/** Çalışma ağacından kalkmış dosya: listede gösterilmez. */
const isGone = (f: FileChange) => f.kind === 'changed' && (f.y === 'D' || (f.y === '.' && f.x === 'D'));

const byName = (a: TreeNode, b: TreeNode) => {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Dosya listesini klasör ağacına çevirir. Değişiklik listesindeki dosyalar da eklenir: dosya
 * listesi bir yoklama geriden gelse de yeni dosya hemen görünür. Silinen dosyalar listelenmez,
 * ama bulundukları klasör değişiklik içerir sayılır.
 */
export function buildTree(files: string[], changes: FileChange[], ignored: string[] = []): TreeNode[] {
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

  // Yok sayılanlar: klasör `/` ile biter ve içi boş kalır.
  for (const entry of ignored) {
    if (entry.endsWith('/')) {
      dirOf(entry.slice(0, -1)).ignored = true;
    } else if (!seen.has(entry)) {
      seen.add(entry);
      const slash = entry.lastIndexOf('/');
      dirOf(parentPath(entry)).children.push({ name: entry.slice(slash + 1), path: entry, kind: 'file', children: [], letter: null, dirty: false, ignored: true });
    }
  }

  // Değişikliği içeren her klasör (silinen dosyanınki de) işaretlenir; ağaçta olmayan klasör atlanır.
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

export interface TreeRow {
  node: TreeNode;
  depth: number;
  open: boolean;
}

/** Ağacı, açık klasörlerin içi dahil, ekrandaki sırasıyla satırlara çevirir. */
export function flattenTree(nodes: TreeNode[], isOpen: (path: string) => boolean, depth = 0): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    const open = node.kind === 'dir' && isOpen(node.path);
    rows.push({ node, depth, open });
    if (open) rows.push(...flattenTree(node.children, isOpen, depth + 1));
  }
  return rows;
}
