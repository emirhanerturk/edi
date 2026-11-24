// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import type { CommitFile, StashDetail, StashResult } from '../../src/git/types';
import { StashPane, type StashPaneProps } from '../../src/renderer/center/StashPane';

afterEach(cleanup);

const now = new Date(2026, 10, 25, 9, 0).getTime();
const file = (path: string, diff: string, over: Partial<CommitFile> = {}): CommitFile => ({ path, origPath: null, letter: 'M', diff: parseDiff(diff), ...over });

const detail = (over: Partial<StashDetail['entry']> = {}): StashDetail => ({
  entry: {
    oid: 'c'.repeat(40),
    index: 0,
    subject: 'WIP on feat/login: 1a2b3c4 feat: add login form',
    message: null,
    branch: 'feat/login',
    baseSubject: 'feat: add login form',
    date: now - 2 * 3_600_000,
    untracked: true,
    ...over,
  },
  short: 'ccccccc',
  base: { oid: '1a2b3c4'.padEnd(40, '0'), short: '1a2b3c4', subject: 'feat: add login form' },
  files: [
    file('src/login.tsx', '@@ -1,1 +1,2 @@\n line\n+added\n'),
    file('notes.txt', '@@ -0,0 +1,1 @@\n+todo\n', { letter: 'A', untracked: true }),
  ],
  added: 2,
  removed: 0,
  tooLarge: false,
});

function renderPane(result: StashResult | null, over: Partial<StashPaneProps> = {}) {
  const props: StashPaneProps = { repoName: 'quizei-app', result, now, tokens: new Map(), busy: null, canApply: true, onAction: vi.fn(), onCopy: vi.fn(), ...over };
  render(<StashPane {...props} />);
  return props;
}

describe('StashPane', () => {
  it('shows the title, where and when it was stashed, what it sits on, and every file; new files carry ?', () => {
    renderPane({ ok: true, stash: detail() });
    expect(screen.getByTestId('stash-title').textContent).toBe('WIP on feat/login');
    const meta = screen.getByTestId('stash-meta');
    expect(meta.textContent).toContain('feat/login');
    expect(meta.textContent).toContain('quizei-app');
    expect(meta.textContent).toContain('2 hours ago');
    expect(meta.textContent).toContain('on top of 1a2b3c4 feat: add login form');
    expect(meta.textContent).toContain('+2');
    const files = screen.getAllByTestId('commit-file');
    expect(files.map((el) => el.querySelector('.commit-file-letter')?.textContent)).toEqual(['M', '?']);
    expect(within(files[1]!).getByTitle('New file')).toBeTruthy();
  });

  it('a stash with a message is titled by it', () => {
    renderPane({ ok: true, stash: detail({ message: 'fix spacing on mobile', baseSubject: null, subject: 'On main: fix spacing on mobile', branch: 'main' }) });
    expect(screen.getByTestId('stash-title').textContent).toBe('fix spacing on mobile');
  });

  it('Pop, Apply and Drop run their action; all wait while an operation runs', () => {
    const props = renderPane({ ok: true, stash: detail() });
    fireEvent.click(screen.getByTestId('stash-view-pop'));
    fireEvent.click(screen.getByTestId('stash-view-apply'));
    fireEvent.click(screen.getByTestId('stash-view-drop'));
    expect((props.onAction as ReturnType<typeof vi.fn>).mock.calls).toEqual([['pop'], ['apply'], ['drop']]);
    cleanup();
    renderPane({ ok: true, stash: detail() }, { busy: 'Popping stash…' });
    for (const id of ['stash-view-pop', 'stash-view-apply', 'stash-view-drop']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Popping stash…')).toBeTruthy();
  });

  it('during a conflict only Drop is offered', () => {
    renderPane({ ok: true, stash: detail() }, { canApply: false });
    const pop = screen.getByTestId('stash-view-pop') as HTMLButtonElement;
    expect(pop.disabled).toBe(true);
    expect(pop.title).toBe('Resolve the conflicts first');
    expect((screen.getByTestId('stash-view-apply') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('stash-view-drop') as HTMLButtonElement).disabled).toBe(false);
  });

  it('copies the stash id', () => {
    const props = renderPane({ ok: true, stash: detail() });
    fireEvent.click(screen.getByRole('button', { name: 'Copy hash ccccccc' }));
    expect(props.onCopy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy hash ccccccc' }).title).toBe('Copied');
  });

  it('says when the stash is gone, without buttons; other errors show as an alert', () => {
    renderPane({ ok: false, error: 'This stash is no longer in the list', gone: true });
    expect(screen.getByText('This stash is no longer in the list: it was popped or dropped.')).toBeTruthy();
    expect(screen.queryByTestId('stash-view-pop')).toBeNull();
    cleanup();
    renderPane({ ok: false, error: 'fatal: bad object' });
    expect(screen.getByRole('alert').textContent).toBe('fatal: bad object');
  });
});
