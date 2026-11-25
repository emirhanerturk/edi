import { realpath } from 'node:fs/promises';
import * as pty from 'node-pty';
import { describe, expect, it } from 'vitest';
import { type PsRow, listPs } from '../src/procs.js';
import { assignSessions, joinSessions, listClaudePids, listClaudeSessions, parseLsofPidCwd } from '../src/sessions.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const row = (pid: number, tty: string): PsRow => ({ pid, pgid: pid, tpgid: pid, tty, args: 'claude' });

describe('parseLsofPidCwd', () => {
  it('extracts working directories by pid from lsof -Fpn output', () => {
    expect(parseLsofPidCwd('p50792\nfcwd\nn/a/quizei\np53467\nfcwd\nn/a/quizei/quizei-app\n')).toEqual(
      new Map([
        [50792, '/a/quizei'],
        [53467, '/a/quizei/quizei-app'],
      ]),
    );
  });
  it('keeps a path with spaces', () => {
    expect(parseLsofPidCwd('p1\nfcwd\nn/a/benim klasör\n')).toEqual(new Map([[1, '/a/benim klasör']]));
  });
  it('returns an empty map for empty output', () => {
    expect(parseLsofPidCwd('')).toEqual(new Map());
  });
});

describe('joinSessions', () => {
  it('drops sessions without a terminal or working directory', () => {
    const cwds = new Map([
      [1, '/a/x'],
      [2, '/a/y'],
      [4, '/a/z'],
    ]);
    const ps = [row(1, 'ttys001'), row(2, ''), row(3, 'ttys003')];
    // 1: in a terminal. 2: no terminal (e.g. an editor's background process). 3: directory unreadable. 4: not in ps.
    expect(joinSessions([1, 2, 3, 4], cwds, ps)).toEqual([{ pid: 1, cwd: '/a/x', tty: 'ttys001' }]);
  });
});

describe('assignSessions', () => {
  const app = { name: 'quizei-app', path: '/a/quizei/quizei-app' };
  const next = { name: 'quizei-app-next-quiz', path: '/a/quizei/quizei-app-next-quiz' };

  it('distributes sessions to repos and the root folder', () => {
    const cwds = [
      '/a/quizei',
      '/a/quizei',
      '/a/quizei/quizei-app/src', // a subfolder inside a repo
      '/a/quizei/quizei-app-next-quiz', // starts with quizei-app but is another repo
      '/a/quizei/temp', // inside the root but in no repo
      '/elsewhere',
    ];
    expect(assignSessions(cwds, '/a/quizei', [app, next])).toEqual({
      root: 3,
      byRepo: { [app.path]: 1, [next.path]: 1 },
    });
  });

  it('does not count a sibling folder whose name starts with the root name', () => {
    expect(assignSessions(['/a/quizei-old'], '/a/quizei', [app])).toEqual({ root: 0, byRepo: {} });
  });

  it('assigns the session to the repo when the root folder itself is a repo', () => {
    const self = { name: 'edi', path: '/a/edi' };
    expect(assignSessions(['/a/edi', '/a/edi/src'], '/a/edi', [self])).toEqual({ root: 0, byRepo: { '/a/edi': 2 } });
  });

  it('returns zero when there are no sessions', () => {
    expect(assignSessions([], '/a/quizei', [app])).toEqual({ root: 0, byRepo: {} });
  });
});

describe('listClaudeSessions', () => {
  it('finds a process named claude running in a terminal, with its folder and terminal', async () => {
    const dir = await realpath(await makeTmpDir());
    // A stand-in for Claude Code: a process whose name is `claude`, in a real terminal.
    const proc = pty.spawn('/bin/zsh', ['-f', '-c', 'exec -a claude sleep 30'], { cwd: dir, cols: 80, rows: 24, env: { PATH: '/bin:/usr/bin' } });
    try {
      let found: Awaited<ReturnType<typeof listClaudeSessions>> = [];
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const [ps, pids] = await Promise.all([listPs(), listClaudePids()]);
        found = (await listClaudeSessions(ps, pids)).filter((session) => session.pid === proc.pid);
        if (found.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(found).toEqual([{ pid: proc.pid, cwd: dir, tty: expect.stringMatching(/^ttys\d+$/) }]);
    } finally {
      proc.kill();
    }
  });

  it('returns nothing without processes, or when none of them is in a terminal', async () => {
    expect(await listClaudeSessions([], [])).toEqual([]);
    expect(await listClaudeSessions([row(process.pid, '')], [process.pid])).toEqual([]); // '' is how ps rows say "no terminal"
  });
});
