import { describe, expect, it } from 'vitest';
import type { CommitSummary } from '../../src/git/types';
import { type HistoryRow, type RepoLog, boundary, byRepo, historyKey, isRelease, timeline } from '../../src/renderer/history/model';

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const now = new Date(2026, 10, 24, 15, 0).getTime();
let serial = 0;

function commit(subject: string, date: number, over: Partial<CommitSummary> = {}): CommitSummary {
  const oid = (++serial).toString(16).padStart(40, '0');
  return { oid, short: oid.slice(-7), subject, authorName: 'Me', authorEmail: 'me@x.dev', date, parents: 1, tags: [], ...over };
}

function repoLog(name: string, commits: CommitSummary[], over: Partial<RepoLog['log']> = {}, ahead = 0): RepoLog {
  return {
    repo: { name, path: `/w/${name}`, ahead },
    log: { ok: true, commits, hasMore: false, unpushed: [], upstream: 'origin/main', userEmail: 'me@x.dev', ...over },
  };
}

/** Satırların okunur özeti. */
const brief = (rows: HistoryRow[]) =>
  rows.map((row) =>
    row.type === 'day'
      ? `# ${row.label}`
      : row.type === 'remote'
        ? `-- ${row.upstream}`
        : row.type === 'release'
          ? `tag ${row.tag} ${row.repoName}`
          : `${row.commit.subject} ${row.repoName}${row.unpushed ? ' ↑' : ''}${row.author ? ` @${row.author}` : ''}${row.merge ? ' merge' : ''}${row.tag ? ` [${row.tag}]` : ''}`,
  );

describe('isRelease', () => {
  it('etiket konu satırıyla aynıysa (baştaki v sayılmaz) sürüm commitidir', () => {
    expect(isRelease('1.86.0', 'v1.86.0')).toBe(true);
    expect(isRelease('v1.86.0', 'v1.86.0')).toBe(true);
    expect(isRelease('v1.86.0', '1.86.0')).toBe(true);
    expect(isRelease('chore(release): 1.86.0', 'v1.86.0')).toBe(false);
    expect(isRelease('1.86.0', 'v1.86.1')).toBe(false);
    expect(isRelease('', 'v')).toBe(false);
  });
});

describe('boundary', () => {
  const busy = Array.from({ length: 50 }, (_, i) => commit(`feat: busy ${i}`, now - i * H));
  const quiet = Array.from({ length: 5 }, (_, i) => commit(`feat: quiet ${i}`, now - (i + 1) * 20 * D));

  it('daha fazlası olan repoların en eski yüklenen commitlerinin en yenisi', () => {
    expect(boundary([repoLog('busy', busy, { hasMore: true }), repoLog('quiet', quiet)])).toBe(now - 49 * H);
  });

  it('hepsi yüklendiyse sınır yok', () => {
    expect(boundary([repoLog('busy', busy), repoLog('quiet', quiet)])).toBeNull();
  });

  it('sınırdan eski commitler gösterilmez: sessiz reponun eskileri yanlış bir boşluk yaratmaz', () => {
    const rows = timeline([repoLog('busy', busy, { hasMore: true }), repoLog('quiet', quiet)], now, { single: false });
    expect(rows.filter((row) => row.type === 'commit')).toHaveLength(50);
    expect(brief(rows).some((line) => line.includes('quiet'))).toBe(false);
  });

  it('"Load 50 more" sınırı geri çeker', () => {
    const more = Array.from({ length: 100 }, (_, i) => commit(`feat: busy ${i}`, now - i * H));
    const quietRecent = [commit('feat: quiet new', now - 60 * H), ...quiet];
    const rows = timeline([repoLog('busy', more, { hasMore: true }), repoLog('quiet', quietRecent)], now, { single: false });
    expect(boundary([repoLog('busy', more, { hasMore: true }), repoLog('quiet', quietRecent)])).toBe(now - 99 * H);
    expect(brief(rows)).toContain('feat: quiet new quiet');
  });
});

describe('timeline', () => {
  it('tasarımdaki gibi: gün başlıkları, sürüm satırı, ok, yazar, merge', () => {
    const rows = timeline(
      [
        repoLog('quizei-app', [commit('fix(auth): refresh the session', now - 25 * M)], { unpushed: [] }),
        repoLog('quizei-app-next-quiz', [
          commit('feat(music-quiz): move the banner', now - 60 * M),
          commit('1.86.0', now - 61 * M, { tags: ['v1.86.0'] }),
          commit('feat(monetization): count a banner', now - 62 * M, { tags: ['beta'] }),
          commit('Merge pull request #187 from feat/consent-pings', now - 21 * H, { parents: 2 }),
        ]),
        repoLog('quizei-backend', [commit('build(deps): bump fastify', now - 4 * H, { authorName: 'dependabot', authorEmail: 'BOT@x.dev' })]),
      ].map((log, index) => (index === 0 ? { ...log, log: { ...log.log, unpushed: [log.log.commits[0]!.oid] } } : log)),
      now,
      { single: false },
    );
    expect(brief(rows)).toEqual([
      '# TODAY',
      'fix(auth): refresh the session quizei-app ↑',
      'feat(music-quiz): move the banner quizei-app-next-quiz',
      'tag v1.86.0 quizei-app-next-quiz',
      'feat(monetization): count a banner quizei-app-next-quiz [beta]',
      'build(deps): bump fastify quizei-backend @dependabot',
      '# YESTERDAY',
      'Merge pull request #187 from feat/consent-pings quizei-app-next-quiz merge',
    ]);
    expect(rows[0]).toEqual({ type: 'day', label: 'TODAY', first: true });
    expect(rows[6]).toEqual({ type: 'day', label: 'YESTERDAY', first: false });
  });

  it('aynı andaki commitler her reponun kendi sırasını korur', () => {
    const t = now - H;
    const rows = timeline([repoLog('a', [commit('a2', t), commit('a1', t)]), repoLog('b', [commit('b1', t)])], now, { single: false });
    expect(brief(rows).slice(1)).toEqual(['a2 a', 'a1 a', 'b1 b']);
  });

  it("reponun user.email'i yoksa yazar gösterilmez", () => {
    const rows = timeline([repoLog('a', [commit('x', now - H, { authorName: 'Biri', authorEmail: 'biri@x.dev' })], { userEmail: null })], now, { single: false });
    expect(brief(rows)).toEqual(['# TODAY', 'x a']);
  });

  it('tek repoda push edilenle edilmeyen arasına upstream çizgisi girer', () => {
    const local = commit('feat: local', now - H);
    const rows = timeline([repoLog('a', [local, commit('feat: pushed', now - 2 * H), commit('feat: older', now - 2 * D)], { unpushed: [local.oid] })], now, { single: true });
    expect(brief(rows)).toEqual(['# TODAY', 'feat: local a ↑', '-- origin/main', 'feat: pushed a', '# THIS WEEK', 'feat: older a']);
  });

  it('upstream yoksa, hepsi push edildiyse ya da hiçbiri edilmediyse çizgi yok', () => {
    const one = commit('feat: local', now - H);
    const two = commit('feat: pushed', now - 2 * H);
    for (const over of [{ upstream: null, unpushed: [one.oid] }, { unpushed: [] }, { unpushed: [one.oid, two.oid] }]) {
      const rows = timeline([repoLog('a', [one, two], over)], now, { single: true });
      expect(rows.some((row) => row.type === 'remote'), JSON.stringify(over)).toBe(false);
    }
    expect(timeline([repoLog('a', [one, two], { unpushed: [one.oid] })], now, { single: false }).some((row) => row.type === 'remote')).toBe(false);
  });

  it("commit'i olmayan repo hiçbir satır eklemez", () => {
    expect(timeline([repoLog('bos', [])], now, { single: false })).toEqual([]);
  });
});

describe('byRepo', () => {
  it('son commite göre sıralar; son 3 günde commit olan açık, son üç commiti verir', () => {
    const groups = byRepo(
      [
        repoLog('eski', [commit('feat: e', now - 5 * D)]),
        repoLog('bos', []),
        repoLog('yeni', [commit('a', now - H), commit('b', now - 2 * H), commit('c', now - 3 * H), commit('d', now - 4 * H)], {}, 1),
        repoLog('az', [], {}),
      ],
      now,
    );
    expect(groups.map((g) => [g.repoName, g.open, g.latest, g.ahead, g.commits.map((c) => c.subject)])).toEqual([
      ['yeni', true, now - H, 1, ['a', 'b', 'c']],
      ['eski', false, now - 5 * D, 0, ['feat: e']],
      ['az', false, null, 0, []],
      ['bos', false, null, 0, []],
    ]);
  });
});

describe('historyKey', () => {
  it('branch, HEAD, upstream ve ahead/behind değişince değişir', () => {
    const status = { head: 'main', headOid: 'a'.repeat(40), upstream: 'origin/main', ahead: 0, behind: 0 };
    const keys = [
      status,
      { ...status, head: 'other' },
      { ...status, headOid: 'b'.repeat(40) },
      { ...status, upstream: null },
      { ...status, ahead: 1 },
      { ...status, behind: 2 },
    ].map((s) => historyKey({ status: s }));
    expect(new Set(keys).size).toBe(6);
    expect(historyKey({ status: { ...status } })).toBe(keys[0]);
    expect(historyKey({ status: null })).toBe('');
  });
});
