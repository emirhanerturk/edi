import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type FileChange,
  getStatus,
  hasUnstaged,
  isDeleted,
  isStaged,
  parseStatus,
  statusLetter,
  statusTag,
} from '../src/git/status.js';
import { git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const H = '587be6b4c3f93f93c489c0111bba5596147a26cb';
const hdr = '# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head main\0';
const file = (x: string, y: string, kind: FileChange['kind'] = 'changed'): FileChange => ({
  path: 'p',
  origPath: null,
  x,
  y,
  kind,
});

describe('parseStatus', () => {
  it('upstream ve ahead/behind değerlerini okur', () => {
    expect(parseStatus(`${hdr}# branch.upstream origin/main\0# branch.ab +1 -2\0`)).toEqual({
      head: 'main',
      detached: false,
      unborn: false,
      upstream: 'origin/main',
      ahead: 1,
      behind: 2,
      files: [],
    });
  });

  it('upstream yoksa ahead/behind bilinmez', () => {
    expect(parseStatus(hdr)).toMatchObject({ upstream: null, ahead: null, behind: null });
  });

  it("upstream silinmişse (branch.ab yok) ahead/behind bilinmez", () => {
    expect(parseStatus(`${hdr}# branch.upstream origin/gitti\0`)).toMatchObject({
      upstream: 'origin/gitti',
      ahead: null,
      behind: null,
    });
  });

  it('detached HEAD için kısa hash verir', () => {
    expect(
      parseStatus('# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head (detached)\0'),
    ).toMatchObject({ head: 'c8be86c', detached: true });
  });

  it("commit'i olmayan repoyu tanır", () => {
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      head: 'main',
      unborn: true,
      detached: false,
    });
  });

  it('rename kaydının eski yol alanını tüketir', () => {
    const s = parseStatus(`${hdr}2 R. N... 100644 100644 100644 ${H} ${H} R100 yeni.txt\0boş dosya.txt\0? unt.txt\0`);
    expect(s.files).toEqual([
      { path: 'yeni.txt', origPath: 'boş dosya.txt', x: 'R', y: '.', kind: 'changed' },
      { path: 'unt.txt', origPath: null, x: '?', y: '?', kind: 'untracked' },
    ]);
  });

  it('boşluklu yolu bölmez', () => {
    const s = parseStatus(`${hdr}1 .M N... 100644 100644 100644 ${H} ${H} a b/c d.txt\0`);
    expect(s.files).toEqual([{ path: 'a b/c d.txt', origPath: null, x: '.', y: 'M', kind: 'changed' }]);
  });

  it('çakışmalı kaydı tanır', () => {
    const s = parseStatus(`${hdr}u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} x y.txt\0`);
    expect(s.files).toEqual([{ path: 'x y.txt', origPath: null, x: 'U', y: 'U', kind: 'conflicted' }]);
  });

  it('yok sayılan (!) kayıtları atlar', () => {
    expect(parseStatus(`${hdr}! node_modules/\0? a.txt\0`).files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('boş çıktıda çökmez', () => {
    expect(parseStatus('')).toMatchObject({ head: '', files: [] });
  });
});

describe('dosya yardımcıları', () => {
  it('stage durumunu ayırt eder', () => {
    expect([isStaged(file('.', 'M')), hasUnstaged(file('.', 'M'))]).toEqual([false, true]);
    expect([isStaged(file('M', '.')), hasUnstaged(file('M', '.'))]).toEqual([true, false]);
    expect([isStaged(file('A', 'M')), hasUnstaged(file('A', 'M'))]).toEqual([true, true]);
    expect([isStaged(file('?', '?', 'untracked')), hasUnstaged(file('?', '?', 'untracked'))]).toEqual([false, true]);
    expect([isStaged(file('U', 'U', 'conflicted')), hasUnstaged(file('U', 'U', 'conflicted'))]).toEqual([
      false,
      false,
    ]);
  });

  it('silinmiş dosyayı tanır', () => {
    expect(isDeleted(file('.', 'D'))).toBe(true);
    expect(isDeleted(file('D', '.'))).toBe(true);
    expect(isDeleted(file('M', '.'))).toBe(false);
    expect(isDeleted(file('?', '?', 'untracked'))).toBe(false);
  });

  it('harf ve etiket üretir', () => {
    expect([statusLetter(file('.', 'M')), statusTag(file('.', 'M'))]).toEqual(['M', '']);
    expect([statusLetter(file('M', '.')), statusTag(file('M', '.'))]).toEqual(['M', '[staged]']);
    expect([statusLetter(file('A', 'M')), statusTag(file('A', 'M'))]).toEqual(['M', '[kısmen]']);
    expect([statusLetter(file('?', '?', 'untracked')), statusTag(file('?', '?', 'untracked'))]).toEqual(['?', '']);
    expect([statusLetter(file('U', 'U', 'conflicted')), statusTag(file('U', 'U', 'conflicted'))]).toEqual(['U', '']);
  });
});

describe('getStatus', () => {
  it('yeni dosyaları klasör olarak değil tek tek listeler', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await mkdir(join(repo, 'd'));
    await writeFile(join(repo, 'd', 'n.txt'), 'x\n');
    await writeFile(join(repo, 'boş dosya.txt'), 'x\n');

    const r = await getStatus(repo);
    expect(r.ok && r.status.files.map((f) => f.path).sort()).toEqual(['boş dosya.txt', 'd/n.txt']);
  });

  it('stage edilmiş, değiştirilmiş ve yeni dosyayı ayırır', async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    await writeFile(join(repo, 'README.md'), 'değişti\n');
    await writeFile(join(repo, 'staged.txt'), 'x\n');
    await git(repo, 'add', 'staged.txt');
    await writeFile(join(repo, 'yeni.txt'), 'x\n');

    const r = await getStatus(repo);
    const byPath = Object.fromEntries((r.ok ? r.status.files : []).map((f) => [f.path, `${f.x}${f.y}`]));
    expect(byPath).toEqual({ 'README.md': '.M', 'staged.txt': 'A.', 'yeni.txt': '??' });
  });

  it("commit'i olmayan repoda çalışır", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a');
    await writeFile(join(repo, 'ilk.txt'), 'x\n');
    const r = await getStatus(repo);
    expect(r).toMatchObject({ ok: true, status: { head: 'main', unborn: true, files: [{ path: 'ilk.txt' }] } });
  });

  it('olmayan yolda hata döner', async () => {
    expect((await getStatus('/yok/boyle/yer')).ok).toBe(false);
  });
});
