// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import type { CommitDetail, CommitFile, CommitResult } from '../../src/git/types';
import { CommitPane, type CommitPaneProps, bodyParagraphs, initiallyCollapsed } from '../../src/renderer/center/CommitPane';
import { filesToHighlight } from '../../src/renderer/center/CommitView';

afterEach(cleanup);

const now = new Date(2026, 10, 24, 15, 0).getTime();
const lines = (n: number) => `@@ -0,0 +1,${n} @@\n${Array.from({ length: n }, (_, i) => `+line ${i}`).join('\n')}\n`;
const file = (path: string, diff: string, over: Partial<CommitFile> = {}): CommitFile => ({ path, origPath: null, letter: 'M', diff: parseDiff(diff), ...over });

const play = file('app/game/[gameId]/play.tsx', '@@ -41,2 +41,3 @@\n   return (\n-    <AdBanner />\n+    {betweenRounds && (\n+      <RoundBreak />\n');
const big = file('lib/big.ts', lines(401), { letter: 'A' });
const edge = file('lib/edge.ts', lines(400), { letter: 'A' });

const detail = (over: Partial<CommitDetail> = {}): CommitDetail => ({
  oid: '3ed0fc5'.padEnd(40, 'a'),
  short: '3ed0fc5',
  subject: 'feat(music-quiz): move the ad manager banner between rounds',
  authorName: 'Me',
  authorEmail: 'me@x.dev',
  date: now - 60 * 60_000,
  parents: 1,
  tags: [],
  body: 'The banner sat under the answer grid.\nIt pushed the timer off small screens.\n\nIt now shows only between rounds.',
  files: [play, big, edge],
  tooLarge: false,
  added: 805,
  removed: 1,
  ...over,
});

function renderPane(result: CommitResult | null, over: Partial<CommitPaneProps> = {}) {
  const props: CommitPaneProps = { repoName: 'quizei-app-next-quiz', branch: 'main', result, now, tokens: new Map(), onCopy: vi.fn(), onOpenUrl: vi.fn(), ...over };
  render(<CommitPane {...props} />);
  return props;
}

const sections = () => screen.getAllByTestId('commit-file');

describe('CommitPane', () => {
  it('body paragraphs keep their indentation; blank lines between and around them go', () => {
    expect(bodyParagraphs('Steps:\n  1. open\n  2. close\n\n    npm run dev\n    npm test\n  \n\n- last\n')).toEqual([
      'Steps:\n  1. open\n  2. close',
      '    npm run dev\n    npm test',
      '- last',
    ]);
    expect(bodyParagraphs('')).toEqual([]);
    expect(bodyParagraphs('\n  \n')).toEqual([]);
  });

  it('coloring skips a file over what is left of the budget and goes on with smaller ones', () => {
    const small = file('a.ts', lines(2));
    const middle = file('b.ts', lines(50));
    const tail = file('c.ts', lines(3));
    const size = (f: CommitFile) => f.diff.hunks.flatMap((h) => h.lines).reduce((sum, l) => sum + l.text.length + 1, 0);
    const budget = size(small) + size(tail) + 5;
    expect(filesToHighlight([small, middle, tail, big], budget).map((f) => f.path)).toEqual(['a.ts', 'c.ts']);
  });

  it('header: dimmed prefix, body paragraphs, repo, branch, long age, totals, hash', () => {
    const { onCopy } = renderPane({ ok: true, commit: detail() });
    const title = screen.getByRole('heading', { level: 1 });
    expect(within(title).getByText('feat(music-quiz):', { exact: false }).className).toContain('prefix');
    expect(title.textContent).toBe('feat(music-quiz): move the ad manager banner between rounds');
    const paragraphs = screen.getAllByTestId('commit-body');
    expect(paragraphs.map((p) => p.textContent)).toEqual(['The banner sat under the answer grid.\nIt pushed the timer off small screens.', 'It now shows only between rounds.']);
    const meta = screen.getByTestId('commit-meta');
    // The author comes first: the name, with the email on hover.
    const author = within(meta).getByTestId('commit-author');
    expect(author.textContent).toBe('Me');
    expect(author.title).toBe('Me <me@x.dev>');
    expect(meta.firstElementChild!.firstElementChild).toBe(author);
    expect(within(meta).getByText('quizei-app-next-quiz')).toBeTruthy();
    expect(within(meta).getByText('main')).toBeTruthy();
    expect(within(meta).getByText('1 hour ago')).toBeTruthy();
    expect(within(meta).getByText('+805')).toBeTruthy();
    expect(within(meta).getByText('−1')).toBeTruthy();
    fireEvent.click(within(meta).getByRole('button', { name: /Copy hash/ }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(within(meta).getByRole('button', { name: /Copy hash/ }).textContent).toContain('3ed0fc5');
  });

  it('after copying the hash the button shows a green check for a moment', () => {
    vi.useFakeTimers();
    try {
      renderPane({ ok: true, commit: detail(), webUrl: null });
      const copy = within(screen.getByTestId('commit-meta')).getByRole('button', { name: /Copy hash/ });
      expect(copy.dataset.copied).toBe('false');
      fireEvent.click(copy);
      expect(copy.dataset.copied).toBe('true');
      expect(copy.title).toBe('Copied');
      act(() => vi.advanceTimersByTime(1600));
      expect(copy.dataset.copied).toBe('false');
      expect(copy.title).toBe('Copy hash');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pushed commit has a GitHub link that opens in the browser; otherwise there is no button', () => {
    const url = `https://github.com/quizei/app/commit/${'3ed0fc5'.padEnd(40, 'a')}`;
    const { onOpenUrl } = renderPane({ ok: true, commit: detail(), webUrl: url });
    const link = within(screen.getByTestId('commit-meta')).getByRole('button', { name: 'Open on GitHub' });
    expect(link.title).toBe(url);
    // The GitHub button is the last one in the row, after the hash.
    expect(link.parentElement!.lastElementChild).toBe(link);
    fireEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledWith(url);
    cleanup();
    renderPane({ ok: true, commit: detail(), webUrl: null });
    expect(screen.queryByRole('button', { name: 'Open on GitHub' })).toBeNull();
  });

  it('one button collapses every file, and expands them all once all are collapsed', () => {
    renderPane({ ok: true, commit: detail() });
    const expanded = () => screen.getAllByTestId('commit-file-head').map((head) => head.getAttribute('aria-expanded'));
    expect(expanded()).toContain('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all files' }));
    expect(expanded()).toEqual(['false', 'false', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all files' }));
    expect(expanded()).toEqual(['true', 'true', 'true']);
    // Collapsing files one by one, the button still says "collapse" until all are collapsed.
    fireEvent.click(screen.getAllByTestId('commit-file-head')[0]!);
    expect(screen.getByRole('button', { name: 'Collapse all files' })).toBeTruthy();
  });

  it('no expand/collapse button for a commit with no files or one too large to show line by line', () => {
    renderPane({ ok: true, commit: detail({ files: [] }) });
    expect(screen.queryByRole('button', { name: /all files/ })).toBeNull();
    cleanup();
    renderPane({ ok: true, commit: detail({ tooLarge: true }) });
    expect(screen.queryByRole('button', { name: /all files/ })).toBeNull();
  });

  it("shows the author's email when there is no name", () => {
    renderPane({ ok: true, commit: detail({ authorName: '', authorEmail: 'bot@ci.dev' }) });
    expect(screen.getByTestId('commit-author').textContent).toBe('bot@ci.dev');
  });

  it('stacks the files with their lines; one over 400 lines starts collapsed and expands on click', () => {
    renderPane({ ok: true, commit: detail() });
    expect(sections()).toHaveLength(3);
    const [first, second, third] = sections();
    const firstHead = within(first!).getByTestId('commit-file-head');
    expect(firstHead.getAttribute('aria-expanded')).toBe('true');
    expect(within(firstHead).getByText('M')).toBeTruthy();
    expect(within(firstHead).getByText('play.tsx')).toBeTruthy();
    expect(firstHead.textContent).toContain('app/game/[gameId]/');
    expect(within(firstHead).getByText('+2')).toBeTruthy();
    expect(within(first!).getAllByTestId('diff-row').map((row) => row.getAttribute('data-kind'))).toEqual(['context', 'del', 'add', 'add']);

    const bigHead = within(second!).getByTestId('commit-file-head');
    expect(bigHead.getAttribute('aria-expanded')).toBe('false');
    expect(within(second!).queryAllByTestId('diff-row')).toHaveLength(0);
    fireEvent.click(bigHead);
    expect(within(second!).getAllByTestId('diff-row')).toHaveLength(401);

    expect(within(third!).getByTestId('commit-file-head').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(third!).getByTestId('commit-file-head'));
    expect(within(third!).queryAllByTestId('diff-row')).toHaveLength(0);
  });

  it('notes for binary, mode-only and renamed files', () => {
    renderPane({
      ok: true,
      commit: detail({
        files: [
          file('img/logo.png', 'Binary files a/img/logo.png and b/img/logo.png differ\n', { letter: 'A' }),
          file('run.sh', ''),
          file('lib/new-name.ts', '', { letter: 'R', origPath: 'lib/old-name.ts' }),
        ],
      }),
    });
    const [binary, mode, renamed] = sections();
    expect(within(binary!).getByText('Binary file')).toBeTruthy();
    expect(within(mode!).getByText('No content changes')).toBeTruthy();
    expect(renamed!.textContent).toContain('Renamed from lib/old-name.ts');
  });

  it('a commit with an empty subject, no body and no files', () => {
    renderPane({ ok: true, commit: detail({ subject: '', body: '', files: [], added: 0, removed: 0 }) });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('(no subject)');
    expect(screen.queryAllByTestId('commit-body')).toHaveLength(0);
    expect(screen.getByText('No file changes')).toBeTruthy();
  });

  it('error and loading states', () => {
    renderPane({ ok: false, error: 'Commit not found' });
    expect(screen.getByRole('alert').textContent).toContain('Commit not found');
    cleanup();
    renderPane(null);
    expect(screen.queryAllByTestId('commit-file')).toHaveLength(0);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('CommitPane: a very large commit', () => {
  it('a note instead of the diff; files are listed with their counts and do not expand', () => {
    const counted = (path: string, added: number, removed: number): CommitFile => ({
      path,
      origPath: null,
      letter: 'M',
      diff: { hunks: [], added, removed, binary: false },
    });
    renderPane({ ok: true, commit: detail({ tooLarge: true, files: [counted('data/big.json', 1_000_000, 0), counted('README.md', 1, 1)] }) });
    expect(screen.getByText("This commit is too large to show line by line. Each file's counts are below.")).toBeTruthy();
    const [first] = sections();
    const firstHead = within(first!).getByTestId('commit-file-head');
    expect(within(firstHead).getByText('+1000000')).toBeTruthy();
    expect(firstHead.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(firstHead);
    expect(screen.queryByText('No content changes')).toBeNull();
    expect(screen.queryAllByTestId('diff-row')).toHaveLength(0);
  });
});

describe('initiallyCollapsed', () => {
  it('files over 400 lines, and those that would push the open lines past 3000, start collapsed', () => {
    const many = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`, lines(400)));
    expect([...initiallyCollapsed([play, big, edge])]).toEqual(['lib/big.ts']);
    expect([...initiallyCollapsed(many)]).toEqual(['f7.ts', 'f8.ts', 'f9.ts']);
  });

  it("each file's header has a button that opens the file, without folding it; a deleted file has none", () => {
    const gone = file('lib/old.ts', '@@ -1,1 +0,0 @@\n-old\n', { letter: 'D' });
    const { onOpenFile } = renderPane({ ok: true, commit: detail({ files: [play, gone] }) }, { onOpenFile: vi.fn() });
    const [first, second] = sections();
    const head = within(first!).getByTestId('commit-file-head');
    fireEvent.click(within(first!).getByRole('button', { name: 'Open play.tsx' }));
    expect(onOpenFile).toHaveBeenCalledWith('app/game/[gameId]/play.tsx');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(within(second!).queryByRole('button', { name: /^Open / })).toBeNull();
  });
});
