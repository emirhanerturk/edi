import { describe, expect, it } from 'vitest';
import type { Repo } from '../src/git/discover.js';
import type { FileChange, RepoStatus } from '../src/git/status.js';
import { type RepoState, buildRows, repoSummary, resolveCursor, windowTop } from '../src/ui/rows.js';

const f = (path: string): FileChange => ({ path, origPath: null, x: '.', y: 'M', kind: 'changed' });
const st = (status: Partial<RepoStatus>): RepoState => ({
  status: { head: 'main', detached: false, unborn: false, upstream: 'origin/main', ahead: 0, behind: 0, files: [], ...status },
  error: null,
  busy: null,
});
const clean: Repo = { name: 'temiz', path: '/w/temiz' };
const dirty: Repo = { name: 'kirli', path: '/w/kirli' };
const states = { [clean.path]: st({}), [dirty.path]: st({ files: [f('a.txt'), f('b.txt')] }) };
const shape = (rows: ReturnType<typeof buildRows>) =>
  rows.map((r) => (r.type === 'repo' ? `${r.repo.name}:${r.expanded ? 'açık' : 'kapalı'}` : r.file.path));

describe('buildRows', () => {
  it('temiz repo kapalı, değişiklikli repo açık gelir', () => {
    expect(shape(buildRows([clean, dirty], states, {}))).toEqual(['temiz:kapalı', 'kirli:açık', 'a.txt', 'b.txt']);
  });

  it('kullanıcının tercihi varsayılanı ezer', () => {
    expect(shape(buildRows([clean, dirty], states, { [dirty.path]: false }))).toEqual(['temiz:kapalı', 'kirli:kapalı']);
    expect(shape(buildRows([clean, dirty], states, { [clean.path]: true }))).toEqual([
      'temiz:açık',
      'kirli:açık',
      'a.txt',
      'b.txt',
    ]);
  });

  it('durumu henüz okunmamış repo için de satır üretir', () => {
    const rows = buildRows([clean], {}, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'repo', expanded: false, state: { status: null, error: null, busy: null } });
  });

  it('aynı adlı dosyalar farklı repolarda farklı anahtar alır', () => {
    const other: Repo = { name: 'diger', path: '/w/diger' };
    const rows = buildRows([dirty, other], { ...states, [other.path]: st({ files: [f('a.txt')] }) }, {});
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('buildRows anahtarları', () => {
  it('aynı yolun iki kaydı (git rm --cached sonrası) farklı anahtar alır', () => {
    const removed: FileChange = { path: 'README.md', origPath: null, x: 'D', y: '.', kind: 'changed' };
    const untracked: FileChange = { path: 'README.md', origPath: null, x: '?', y: '?', kind: 'untracked' };
    const rows = buildRows([dirty], { [dirty.path]: st({ files: [removed, untracked] }) }, {});
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(resolveCursor(rows, rows[2]!.key, 2)).toBe(2);
  });
});

describe('resolveCursor', () => {
  const rows = buildRows([clean, dirty], states, {});
  const keyOfB = rows[3]!.key;

  it('araya satır girince aynı dosyada kalır', () => {
    const grown = buildRows([clean, dirty], { ...states, [dirty.path]: st({ files: [f('a.txt'), f('a0.txt'), f('b.txt')] }) }, {});
    expect(resolveCursor(grown, keyOfB, 3)).toBe(4);
  });

  it('anahtar kaybolunca eski konumu sınırlar içine çeker', () => {
    expect(resolveCursor(rows.slice(0, 3), 'yok', 9)).toBe(2);
    expect(resolveCursor(rows, null, 0)).toBe(0);
    expect(resolveCursor([], 'yok', 3)).toBe(0);
  });
});

describe('windowTop', () => {
  it('imleç pencere içindeyken kaymaz', () => {
    expect(windowTop(100, 5, 10, 2)).toBe(2);
  });
  it('imleç aşağı taşınca en az kadar kayar', () => {
    expect(windowTop(100, 99, 3, 0)).toBe(97);
    expect(windowTop(100, 12, 10, 2)).toBe(3);
  });
  it('imleç yukarı taşınca en az kadar kayar', () => {
    expect(windowTop(100, 1, 10, 2)).toBe(1);
  });
  it('liste pencereye sığıyorsa baştan başlar', () => {
    expect(windowTop(3, 2, 10, 0)).toBe(0);
  });
  it('liste kısalınca boşluk bırakmaz', () => {
    expect(windowTop(5, 4, 3, 50)).toBe(2);
  });
  it('sıfır yükseklikte çökmez, imleci gösterir', () => {
    expect(windowTop(100, 7, 0, 0)).toBe(7);
  });
});

describe('repoSummary', () => {
  it('branch, senkron durumu ve değişiklik sayısını verir', () => {
    expect(repoSummary(st({ ahead: 1, behind: 2, files: [f('a'), f('b'), f('c')] }))).toEqual({
      branch: 'main',
      sync: '↓2 ↑1',
      changes: '● 3 değişiklik',
    });
  });
  it('sıfır olan yönü yazmaz', () => {
    expect(repoSummary(st({ ahead: 1, behind: 0 })).sync).toBe('↑1');
    expect(repoSummary(st({ ahead: 0, behind: 4 })).sync).toBe('↓4');
    expect(repoSummary(st({}))).toEqual({ branch: 'main', sync: '', changes: '✓ temiz' });
  });
  it("upstream yoksa söyler, detached HEAD'de söylemez", () => {
    expect(repoSummary(st({ upstream: null, ahead: null, behind: null })).sync).toBe('upstream yok');
    expect(repoSummary(st({ head: 'c8be86c', detached: true, upstream: null, ahead: null, behind: null }))).toMatchObject({
      branch: 'c8be86c',
      sync: '',
    });
  });
  it('upstream silinmişse sayı uydurmaz', () => {
    expect(repoSummary(st({ upstream: 'origin/gitti', ahead: null, behind: null })).sync).toBe('upstream yok');
  });
  it('okunamayan repoda hatayı gösterir', () => {
    expect(repoSummary({ status: null, error: 'fatal: not a git repository', busy: null })).toEqual({
      branch: '',
      sync: '',
      changes: '! fatal: not a git repository',
    });
  });
  it('durum beklenirken yükleniyor der', () => {
    expect(repoSummary({ status: null, error: null, busy: null }).changes).toBe('yükleniyor…');
  });
  it('işlem sürerken onu gösterir', () => {
    expect(repoSummary({ ...st({ files: [f('a')] }), busy: 'push ediliyor…' }).changes).toBe('push ediliyor…');
  });
});
