import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/git/types';
import { type TreeNode, buildTree, flattenTree, insideIgnored } from '../../src/renderer/files/tree';

const change = (path: string, x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({ path, origPath: null, x, y, kind });
/** The tree in readable form: folder "name/", changed file "name M", folder with changes "name/ ●". */
const show = (nodes: TreeNode[], depth = 0): string[] =>
  nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.name}${node.kind === 'dir' ? '/' : ''}${node.letter ? ` ${node.letter}` : ''}${node.kind === 'dir' && node.dirty ? ' ●' : ''}`,
    ...show(node.children, depth + 1),
  ]);

describe('buildTree', () => {
  it('folders first, then files; both by name, ignoring case', () => {
    const tree = buildTree(['b.ts', 'A.md', 'src/z.ts', 'src/lib/a.ts', 'Docs/x.md', 'c.ts', 'src/B.ts'], []);
    expect(show(tree)).toEqual(['Docs/', '  x.md', 'src/', '  lib/', '    a.ts', '  B.ts', '  z.ts', 'A.md', 'b.ts', 'c.ts']);
  });

  it('ignored files and folders take their place in the tree, marked; the folder is empty', () => {
    const tree = buildTree(['src/a.ts', '.gitignore'], [], ['node_modules/', '.env', 'src/debug.log', 'src/out/']);
    const flat = (nodes: TreeNode[]): string[] =>
      nodes.flatMap((node) => [`${node.path}${node.kind === 'dir' ? '/' : ''}${node.ignored ? ' (ignored)' : ''}`, ...flat(node.children)]);
    expect(flat(tree)).toEqual([
      'node_modules/ (ignored)',
      'src/',
      'src/out/ (ignored)',
      'src/a.ts',
      'src/debug.log (ignored)',
      '.env (ignored)',
      '.gitignore',
    ]);
    expect(tree[0]!.children).toEqual([]);
  });

  it("a loaded ignored folder's contents join the tree and count as ignored too", () => {
    const tree = buildTree(['a.ts'], [], ['node_modules/'], {
      node_modules: [
        { name: 'react', dir: true },
        { name: '.package-lock.json', dir: false },
      ],
      'node_modules/react': [{ name: 'index.js', dir: false }],
    });
    const flat = (nodes: TreeNode[]): string[] =>
      nodes.flatMap((node) => [`${node.path}${node.kind === 'dir' ? '/' : ''}${node.ignored ? ' (ignored)' : ''}`, ...flat(node.children)]);
    expect(flat(tree)).toEqual([
      'node_modules/ (ignored)',
      'node_modules/react/ (ignored)',
      'node_modules/react/index.js (ignored)',
      'node_modules/.package-lock.json (ignored)',
      'a.ts',
    ]);
  });

  it('insideIgnored: the ignored folder itself and what is inside it', () => {
    const ignored = ['node_modules/', 'ios/Pods/', '.env'];
    expect(['node_modules', 'node_modules/react', 'ios/Pods/x', 'ios', 'node_modules2', '.env', 'src'].map((path) => insideIgnored(path, ignored))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('paths and name fields are correct', () => {
    const tree = buildTree(['src/lib/a.ts'], []);
    expect(tree[0]).toMatchObject({ name: 'src', path: 'src', kind: 'dir' });
    expect(tree[0]!.children[0]).toMatchObject({ name: 'lib', path: 'src/lib', kind: 'dir' });
    expect(tree[0]!.children[0]!.children[0]).toEqual({ name: 'a.ts', path: 'src/lib/a.ts', kind: 'file', children: [], letter: null, dirty: false, ignored: false });
  });

  it('changed files get their letter and the folders containing them are marked', () => {
    const tree = buildTree(
      ['app/game/play.tsx', 'app/game/result.tsx', 'lib/x.ts', 'README.md', 'new.ts'],
      [change('app/game/play.tsx', '.', 'M'), change('new.ts', '?', '?', 'untracked'), change('README.md', 'A', '.')],
    );
    expect(show(tree)).toEqual(['app/ ●', '  game/ ●', '    play.tsx M', '    result.tsx', 'lib/', '  x.ts', 'new.ts ?', 'README.md A']);
  });

  it('a deleted file is not listed, but its folder counts as changed', () => {
    const tree = buildTree(['src/a.ts'], [change('src/gone.ts', '.', 'D')]);
    expect(show(tree)).toEqual(['src/ ●', '  a.ts']);
  });

  it('new files from the change list still show while the file list is stale', () => {
    const tree = buildTree(['README.md'], [change('src/new.ts', '?', '?', 'untracked'), change('src/old.ts', 'D', '.')]);
    expect(show(tree)).toEqual(['src/ ●', '  new.ts ?', 'README.md']);
  });

  it('a renamed file shows under its new name', () => {
    const tree = buildTree(['b.ts'], [{ path: 'b.ts', origPath: 'a.ts', x: 'R', y: '.', kind: 'changed' }]);
    expect(show(tree)).toEqual(['b.ts R']);
  });

  it('an empty list gives an empty tree', () => {
    expect(buildTree([], [])).toEqual([]);
  });

  it('empty folders show as folders with nothing inside', () => {
    const tree = buildTree(['a.ts'], [], [], {}, ['new', 'new/inner']);
    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual(['dir:new', 'file:a.ts']);
    expect(tree[0]!.children.map((node) => `${node.kind}:${node.path}`)).toEqual(['dir:new/inner']);
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });
});

describe('flattenTree', () => {
  const tree = buildTree(['src/lib/a.ts', 'src/b.ts', 'README.md'], []);

  it("a closed folder's contents are not listed", () => {
    expect(flattenTree(tree, () => false).map((row) => [row.node.path, row.depth, row.open])).toEqual([
      ['src', 0, false],
      ['README.md', 0, false],
    ]);
  });

  it("open folders' contents are listed with their depth", () => {
    const open = new Set(['src', 'src/lib']);
    expect(flattenTree(tree, (path) => open.has(path)).map((row) => [row.node.path, row.depth, row.open])).toEqual([
      ['src', 0, true],
      ['src/lib', 1, true],
      ['src/lib/a.ts', 2, false],
      ['src/b.ts', 1, false],
      ['README.md', 0, false],
    ]);
  });

  it('accepts a starting depth', () => {
    expect(flattenTree(tree, () => false, 1).map((row) => row.depth)).toEqual([1, 1]);
  });
});
