import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClaudeOutcome, ClaudeRunOptions } from '../src/main/claudeRun.js';
import { SummaryOps, limitInfo } from '../src/main/summaryOps.js';
import { Workspace } from '../src/main/workspace.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const open: Workspace[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.dispose();
});

/** A workspace with one repo that has a change, and Claude Code answering `answer` (each run is recorded). */
async function setup(answer: (opts: ClaudeRunOptions) => Promise<ClaudeOutcome> | ClaudeOutcome) {
  const dir = await makeTmpDir();
  const repo = await initRepo(dir, 'quizei-app', { commit: true });
  await writeFile(join(repo, 'README.md'), 'readme\nrank badge\n');
  const ws = new Workspace({ onChange: () => undefined, statusMs: 60_000 });
  open.push(ws);
  await ws.open(dir);
  const runs: ClaudeRunOptions[] = [];
  const ops = new SummaryOps(ws, {
    ask: async (opts) => {
      runs.push(opts);
      return answer(opts);
    },
    usage: async () => ({ fiveHour: { percent: 100, resetsAt: 1_800_000_000_000 }, week: null, updatedAt: 0 }),
    now: () => 42,
  });
  return { dir, repo, ops, runs };
}

const INVALID = { ok: false, reason: 'failed', error: 'Invalid request' };

describe('SummaryOps', () => {
  it('runs Claude Code in the repository on what changed, and gives back its answer', async () => {
    const { repo, ops, runs } = await setup(() => ({ ok: true, text: '```\n- **README:** Rozet notu eklendi.\n```' }));
    expect(await ops.summarize(1, { kind: 'changes', repoPath: repo })).toEqual({ ok: true, text: '- **README:** Rozet notu eklendi.', about: '1 file, 1 line', at: 42 });
    expect(runs[0]!.cwd).toBe(repo);
    expect(runs[0]!.prompt).toContain('Write in Turkish');
    expect(runs[0]!.prompt).toContain('+rank badge');
  });

  it('a commit message comes with the recent subjects, tidied', async () => {
    const { repo, ops, runs } = await setup(() => ({ ok: true, text: '"docs: note the rank badge"' }));
    expect(await ops.summarize(1, { kind: 'message', repoPath: repo })).toEqual(expect.objectContaining({ ok: true, text: 'docs: note the rank badge' }));
    expect(runs[0]!.prompt).toContain('<recent-subjects>\nchore: init\n</recent-subjects>');
  });

  it("a stash's line, cut to one line", async () => {
    const { repo, ops } = await setup(() => ({ ok: true, text: '- Rozet denemesi\nfazlası' }));
    await git(repo, 'stash', 'push', '-q', '-m', 'wip');
    const oid = (await git(repo, 'rev-parse', 'stash@{0}')).trim();
    expect(await ops.summarize(1, { kind: 'stash', repoPath: repo, oid })).toEqual(expect.objectContaining({ ok: true, text: 'Rozet denemesi', about: '1 file' }));
    expect(await ops.summarize(2, { kind: 'stash', repoPath: repo, oid: 'stash@{0}' })).toEqual(INVALID);
  });

  it("a pull request's title and description, with the compare page", async () => {
    const { repo, ops } = await setup(() => ({ ok: true, text: 'Show the weekly rank badge\n\n## Summary\n- Adds it.' }));
    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await git(repo, 'remote', 'set-head', 'origin', 'main');
    await git(repo, 'switch', '-q', '-c', 'feat/badge');
    await git(repo, 'commit', '-q', '-am', 'feat: badge');
    await git(repo, 'push', '-q', '-u', 'origin', 'feat/badge');
    await git(repo, 'remote', 'set-url', 'origin', 'https://github.com/emir/quizei-app.git');
    expect(await ops.summarize(1, { kind: 'pullRequest', repoPath: repo })).toEqual({
      ok: true,
      title: 'Show the weekly rank badge',
      text: '## Summary\n- Adds it.',
      about: '1 commit',
      at: 42,
      compareUrl: 'https://github.com/emir/quizei-app/compare/main...feat/badge',
    });
  });

  it('a commit by a short id; a day across repositories runs in the open folder', async () => {
    const { dir, repo, ops, runs } = await setup(() => ({ ok: true, text: '- **quizei-app:** Başlangıç.' }));
    const head = (await git(repo, 'rev-parse', 'HEAD')).trim();
    expect(await ops.summarize(1, { kind: 'commit', repoPath: repo, oid: head.slice(0, 7) })).toEqual(expect.objectContaining({ ok: true, about: '1 file' }));
    expect(await ops.summarize(2, { kind: 'commit', repoPath: repo, oid: 'HEAD' })).toEqual({ ok: false, reason: 'failed', error: 'Commit not found' });
    const day = await ops.summarize(3, { kind: 'day', label: 'TODAY', commits: [{ repoPath: repo, oids: [head], unpushed: [] }] });
    expect(day).toEqual(expect.objectContaining({ ok: true, about: '1 commit' }));
    expect(runs.at(-1)!.cwd).toBe(dir);
  });

  it('refuses what it was not given to read: unknown repositories, ids and malformed requests', async () => {
    const { dir, repo, ops, runs } = await setup(() => ({ ok: true, text: 'x' }));
    expect(await ops.summarize(1, { kind: 'changes', repoPath: dir })).toEqual({ ok: false, reason: 'failed', error: 'Unknown repository' });
    expect(await ops.summarize(0, { kind: 'changes', repoPath: repo })).toEqual(INVALID);
    expect(await ops.summarize(1, { kind: 'rm -rf', repoPath: repo })).toEqual(INVALID);
    expect(await ops.summarize(1, { kind: 'day', label: 'TODAY', commits: [{ repoPath: repo, oids: ['HEAD'] }] })).toEqual(INVALID);
    expect(await ops.summarize(1, { kind: 'day', label: 'TODAY', commits: [{ repoPath: dir, oids: [] }] })).toEqual(INVALID);
    expect(runs).toHaveLength(0);
  });

  it("a limit says when it resets, from the title bar's usage", async () => {
    const { repo, ops } = await setup(() => ({ ok: false, reason: 'limit', error: "You've hit your limit", resetsAt: null }));
    expect(await ops.summarize(1, { kind: 'changes', repoPath: repo })).toEqual({
      ok: false,
      reason: 'limit',
      error: 'Claude Code has reached its 5-hour limit.',
      resetsAt: 1_800_000_000_000,
    });
    expect(limitInfo(null, 7)).toEqual({ error: 'Claude Code has reached its usage limit.', resetsAt: 7 });
  });

  it('a run can be stopped', async () => {
    const { repo, ops } = await setup(
      (opts) =>
        new Promise((resolve) => {
          opts.signal!.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled', error: 'Cancelled' }));
        }),
    );
    const running = ops.summarize(7, { kind: 'changes', repoPath: repo });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ops.cancel(7);
    expect(await running).toEqual({ ok: false, reason: 'cancelled', error: 'Cancelled' });
  });
});
