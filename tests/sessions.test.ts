import { describe, expect, it } from 'vitest';
import type { PsRow } from '../src/procs.js';
import { assignSessions, joinSessions, listClaudePids, listClaudeSessions, parseLsofPidCwd } from '../src/sessions.js';

const row = (pid: number, tty: string): PsRow => ({ pid, pgid: pid, tpgid: pid, tty, args: 'claude' });

describe('parseLsofPidCwd', () => {
  it("lsof -Fpn çıktısından pid'e göre çalışma dizinlerini çıkarır", () => {
    expect(parseLsofPidCwd('p50792\nfcwd\nn/a/quizei\np53467\nfcwd\nn/a/quizei/quizei-app\n')).toEqual(
      new Map([
        [50792, '/a/quizei'],
        [53467, '/a/quizei/quizei-app'],
      ]),
    );
  });
  it('boşluklu yolu korur', () => {
    expect(parseLsofPidCwd('p1\nfcwd\nn/a/benim klasör\n')).toEqual(new Map([[1, '/a/benim klasör']]));
  });
  it('boş çıktıda boş döner', () => {
    expect(parseLsofPidCwd('')).toEqual(new Map());
  });
});

describe('joinSessions', () => {
  it("terminali ya da çalışma dizini olmayan oturumları atar", () => {
    const cwds = new Map([
      [1, '/a/x'],
      [2, '/a/y'],
      [4, '/a/z'],
    ]);
    const ps = [row(1, 'ttys001'), row(2, ''), row(3, 'ttys003')];
    // 1: terminalde. 2: terminalsiz (ör. bir editörün arka plan süreci). 3: dizini okunamadı. 4: ps'te yok.
    expect(joinSessions([1, 2, 3, 4], cwds, ps)).toEqual([{ pid: 1, cwd: '/a/x', tty: 'ttys001' }]);
  });
});

describe('assignSessions', () => {
  const app = { name: 'quizei-app', path: '/a/quizei/quizei-app' };
  const next = { name: 'quizei-app-next-quiz', path: '/a/quizei/quizei-app-next-quiz' };

  it('oturumları repolara ve kök klasöre dağıtır', () => {
    const cwds = [
      '/a/quizei',
      '/a/quizei',
      '/a/quizei/quizei-app/src', // repo içinde alt klasör
      '/a/quizei/quizei-app-next-quiz', // adı quizei-app ile başlıyor ama başka repo
      '/a/quizei/temp', // kökün içinde, hiçbir repoda değil
      '/baska/yer',
    ];
    expect(assignSessions(cwds, '/a/quizei', [app, next])).toEqual({
      root: 3,
      byRepo: { [app.path]: 1, [next.path]: 1 },
    });
  });

  it('adı kök klasörle başlayan komşu klasörü saymaz', () => {
    expect(assignSessions(['/a/quizei-eski'], '/a/quizei', [app])).toEqual({ root: 0, byRepo: {} });
  });

  it('kök klasörün kendisi repoysa oturumu repoya yazar', () => {
    const self = { name: 'edi', path: '/a/edi' };
    expect(assignSessions(['/a/edi', '/a/edi/src'], '/a/edi', [self])).toEqual({ root: 0, byRepo: { '/a/edi': 2 } });
  });

  it('oturum yoksa sıfır döner', () => {
    expect(assignSessions([], '/a/quizei', [app])).toEqual({ root: 0, byRepo: {} });
  });
});

describe('listClaudeSessions', () => {
  it('hata fırlatmadan terminalli oturumları mutlak yollarla döner', async () => {
    const sessions = await listClaudeSessions([], await listClaudePids());
    expect(sessions).toEqual([]); // ps satırı verilmedi: hiçbirinin terminali bilinmiyor

    expect((await listClaudeSessions([], [])).length).toBe(0);
  });
});
