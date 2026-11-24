import { describe, expect, it } from 'vitest';
import { assignSessions, listClaudeCwds, parseLsofCwd } from '../src/sessions.js';

describe('parseLsofCwd', () => {
  it('lsof -Fpn çıktısından çalışma dizinlerini çıkarır', () => {
    expect(parseLsofCwd('p50792\nfcwd\nn/a/quizei\np53467\nfcwd\nn/a/quizei/quizei-app\n')).toEqual([
      '/a/quizei',
      '/a/quizei/quizei-app',
    ]);
  });
  it('boşluklu yolu korur', () => {
    expect(parseLsofCwd('p1\nfcwd\nn/a/benim klasör\n')).toEqual(['/a/benim klasör']);
  });
  it('boş çıktıda boş döner', () => {
    expect(parseLsofCwd('')).toEqual([]);
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

describe('listClaudeCwds', () => {
  it('hata fırlatmadan mutlak yollar döner', async () => {
    const cwds = await listClaudeCwds();
    expect(Array.isArray(cwds)).toBe(true);
    expect(cwds.every((cwd) => cwd.startsWith('/'))).toBe(true);
  });
});
