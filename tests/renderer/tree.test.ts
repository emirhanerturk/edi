import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/git/types';
import { type TreeNode, buildTree, flattenTree } from '../../src/renderer/files/tree';

const change = (path: string, x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({ path, origPath: null, x, y, kind });
/** Ağacı okunur biçimde: klasör "ad/", değişen dosya "ad M", değişiklik içeren klasör "ad/ ●". */
const show = (nodes: TreeNode[], depth = 0): string[] =>
  nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.name}${node.kind === 'dir' ? '/' : ''}${node.letter ? ` ${node.letter}` : ''}${node.kind === 'dir' && node.dirty ? ' ●' : ''}`,
    ...show(node.children, depth + 1),
  ]);

describe('buildTree', () => {
  it('klasörler önce, sonra dosyalar; ikisi de büyük-küçük harf gözetmeden ada göre', () => {
    const tree = buildTree(['b.ts', 'A.md', 'src/z.ts', 'src/lib/a.ts', 'Docs/x.md', 'c.ts', 'src/B.ts'], []);
    expect(show(tree)).toEqual(['Docs/', '  x.md', 'src/', '  lib/', '    a.ts', '  B.ts', '  z.ts', 'A.md', 'b.ts', 'c.ts']);
  });

  it('yollar ve ad alanları doğru', () => {
    const tree = buildTree(['src/lib/a.ts'], []);
    expect(tree[0]).toMatchObject({ name: 'src', path: 'src', kind: 'dir' });
    expect(tree[0]!.children[0]).toMatchObject({ name: 'lib', path: 'src/lib', kind: 'dir' });
    expect(tree[0]!.children[0]!.children[0]).toEqual({ name: 'a.ts', path: 'src/lib/a.ts', kind: 'file', children: [], letter: null, dirty: false });
  });

  it('değişen dosyalar harfini alır, onları içeren klasörler işaretlenir', () => {
    const tree = buildTree(
      ['app/game/play.tsx', 'app/game/result.tsx', 'lib/x.ts', 'README.md', 'new.ts'],
      [change('app/game/play.tsx', '.', 'M'), change('new.ts', '?', '?', 'untracked'), change('README.md', 'A', '.')],
    );
    expect(show(tree)).toEqual(['app/ ●', '  game/ ●', '    play.tsx M', '    result.tsx', 'lib/', '  x.ts', 'new.ts ?', 'README.md A']);
  });

  it('silinen dosya listelenmez ama klasörü değişiklik içerir', () => {
    const tree = buildTree(['src/a.ts'], [change('src/gone.ts', '.', 'D')]);
    expect(show(tree)).toEqual(['src/ ●', '  a.ts']);
  });

  it('dosya listesi henüz eskiyse değişiklik listesindeki yeni dosyalar yine görünür', () => {
    const tree = buildTree(['README.md'], [change('src/yeni.ts', '?', '?', 'untracked'), change('src/eski.ts', 'D', '.')]);
    expect(show(tree)).toEqual(['src/ ●', '  yeni.ts ?', 'README.md']);
  });

  it('yeniden adlandırılan dosya yeni adıyla görünür', () => {
    const tree = buildTree(['b.ts'], [{ path: 'b.ts', origPath: 'a.ts', x: 'R', y: '.', kind: 'changed' }]);
    expect(show(tree)).toEqual(['b.ts R']);
  });

  it('boş listede boş ağaç', () => {
    expect(buildTree([], [])).toEqual([]);
  });
});

describe('flattenTree', () => {
  const tree = buildTree(['src/lib/a.ts', 'src/b.ts', 'README.md'], []);

  it('kapalı klasörün içi listelenmez', () => {
    expect(flattenTree(tree, () => false).map((row) => [row.node.path, row.depth, row.open])).toEqual([
      ['src', 0, false],
      ['README.md', 0, false],
    ]);
  });

  it('açık klasörlerin içi derinliğiyle listelenir', () => {
    const open = new Set(['src', 'src/lib']);
    expect(flattenTree(tree, (path) => open.has(path)).map((row) => [row.node.path, row.depth, row.open])).toEqual([
      ['src', 0, true],
      ['src/lib', 1, true],
      ['src/lib/a.ts', 2, false],
      ['src/b.ts', 1, false],
      ['README.md', 0, false],
    ]);
  });

  it('başlangıç derinliği verilebilir', () => {
    expect(flattenTree(tree, () => false, 1).map((row) => row.depth)).toEqual([1, 1]);
  });
});
