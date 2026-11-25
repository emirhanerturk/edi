// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileContent } from '../../src/git/types';
import { FilePane, fileInfo, splitLines } from '../../src/renderer/center/FilePane';
import { mediaUrl } from '../../src/shared/media';
import type { EditState } from '../../src/renderer/center/editSession';

afterEach(cleanup);

function renderPane(content: FileContent | null, opts: { isNew?: boolean; path?: string } = {}) {
  const onOpenIn = vi.fn();
  render(<FilePane repoName="quizei-app" repoPath="/w/quizei-app" path={opts.path ?? 'components/video/video-poster.tsx'} content={content} isNew={opts.isNew ?? false} tokens={null} onOpenIn={onOpenIn} />);
  return { onOpenIn };
}
const text = (value: string): FileContent => ({ ok: true, kind: 'text', text: value, size: value.length });

describe('splitLines', () => {
  it('a trailing newline does not count as an empty line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });

  it('an empty file has no lines', () => {
    expect(splitLines('')).toEqual([]);
  });
});

describe('fileInfo', () => {
  it('language and line count', () => {
    expect(fileInfo('a/play.tsx', text('a\nb\n'))).toBe('TypeScript JSX · 2 lines');
    expect(fileInfo('LICENSE', text('x\n'))).toBe('Plain Text · 1 line');
    expect(fileInfo('a.ts', text(''))).toBe('TypeScript · 0 lines');
  });

  it('type and size for images and videos', () => {
    expect(fileInfo('a/logo.png', { ok: true, kind: 'media', media: 'image', size: 2048, mtime: 1 })).toBe('PNG image · 2.0 KB');
    expect(fileInfo('intro.MP4', { ok: true, kind: 'media', media: 'video', size: 3 * 1_048_576, mtime: 1 })).toBe('MP4 video · 3.0 MB');
  });

  it('no line count for a non-text file', () => {
    expect(fileInfo('a.png', { ok: true, kind: 'binary', size: 2048 })).toBe('Binary · 2.0 KB');
    expect(fileInfo('big.json', { ok: true, kind: 'tooLarge', size: 2 * 1_048_576 })).toBe('JSON · 2.0 MB');
    expect(fileInfo('a.ts', { ok: false, error: 'File not found' })).toBeNull();
    expect(fileInfo('a.ts', null)).toBeNull();
  });
});

const CLEAN: EditState = { dirty: false, conflict: null, error: null, saving: false };

function renderEditing(edit: EditState, content: FileContent | null = text('a\n')) {
  const handlers = { onOpenIn: vi.fn(), onSave: vi.fn(), onKeepMine: vi.fn(), onLoadDisk: vi.fn(), onClose: vi.fn() };
  render(
    <FilePane
      repoName="r"
      repoPath="/w/r"
      path="src/app.ts"
      content={content}
      isNew={false}
      tokens={null}
      editor={<div data-testid="fake-editor" />}
      edit={edit}
      {...handlers}
    />,
  );
  return handlers;
}

describe('FilePane while editing', () => {
  it('shows the editor in place of the read-only lines', () => {
    renderEditing(CLEAN);
    expect(screen.getByTestId('fake-editor')).toBeTruthy();
    expect(screen.queryAllByTestId('file-line')).toHaveLength(0);
    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('with unsaved edits the header says so and Save saves', () => {
    const { onSave } = renderEditing({ ...CLEAN, dirty: true });
    const header = screen.getByTestId('view-header');
    expect(within(header).getByText('Unsaved')).toBeTruthy();
    const save = within(header).getByRole('button', { name: 'Save' });
    expect(save.title).toBe('Save (⌘S)');
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    cleanup();
    renderEditing({ ...CLEAN, dirty: true, saving: true });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a disk change under unsaved edits shows a bar with "Load disk version" and "Keep mine"', () => {
    const { onLoadDisk, onKeepMine } = renderEditing({ ...CLEAN, dirty: true, conflict: 'changed' });
    const bar = screen.getByRole('alert');
    expect(bar.textContent).toContain('This file changed on disk.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Load disk version' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Keep mine' }));
    expect(onLoadDisk).toHaveBeenCalledTimes(1);
    expect(onKeepMine).toHaveBeenCalledTimes(1);
  });

  it('a file deleted under unsaved edits keeps the editor, with "Close" and "Keep mine"', () => {
    const { onClose, onKeepMine } = renderEditing({ ...CLEAN, dirty: true, conflict: 'missing' }, { ok: false, error: 'File not found' });
    expect(screen.getByTestId('fake-editor')).toBeTruthy();
    const bar = screen.getByRole('alert');
    expect(bar.textContent).toContain('This file was deleted on disk.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Keep mine' }));
    expect([onClose.mock.calls.length, onKeepMine.mock.calls.length]).toEqual([1, 1]);
  });

  it('a failed save shows its error', () => {
    renderEditing({ ...CLEAN, dirty: true, error: 'Could not save the file' });
    expect(screen.getByRole('alert').textContent).toBe('Could not save: Could not save the file');
  });

  it('a deleted file without unsaved edits shows the usual note, not the editor', () => {
    renderEditing(CLEAN, { ok: false, error: 'File not found' });
    expect(screen.queryByTestId('fake-editor')).toBeNull();
    expect(screen.getByText('File not found')).toBeTruthy();
  });

  it('images, videos and binary files never show the editor', () => {
    renderEditing(CLEAN, { ok: true, kind: 'binary', size: 3 });
    expect(screen.queryByTestId('fake-editor')).toBeNull();
    expect(screen.getByText('Binary file')).toBeTruthy();
  });
});

describe('FilePane', () => {
  it('the header shows repo, path and Open in…; "Read-only" only for files that cannot be edited', () => {
    const { onOpenIn } = renderPane(text('a\n'));
    const header = screen.getByTestId('view-header');
    expect(within(header).getByText('quizei-app')).toBeTruthy();
    expect(header.textContent).toContain('components/video/video-poster.tsx');
    expect(within(header).queryByText('Read-only')).toBeNull();
    expect(within(header).queryByText('new file')).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: 'Open in…' }));
    fireEvent.click(within(header).getByRole('menuitem', { name: 'Zed' }));
    expect(onOpenIn).toHaveBeenCalledWith('zed');
    for (const content of [
      { ok: true, kind: 'binary', size: 4 },
      { ok: true, kind: 'tooLarge', size: 4 },
      { ok: true, kind: 'media', media: 'image', size: 4, mtime: 1 },
    ] as FileContent[]) {
      cleanup();
      renderPane(content, { path: 'a.png' });
      expect(within(screen.getByTestId('view-header')).getByText('Read-only'), content.ok ? content.kind : '').toBeTruthy();
    }
  });

  it('a "new file" mark on a new file', () => {
    renderPane(text('a\n'), { isNew: true });
    expect(within(screen.getByTestId('view-header')).getByText('new file')).toBeTruthy();
  });

  it('shows an image from its own URL, which changes when the file does; says so when it cannot be shown', () => {
    renderPane({ ok: true, kind: 'media', media: 'image', size: 10, mtime: 5 }, { path: 'assets/logo.png' });
    const image = screen.getByRole('img', { name: 'logo.png' }) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(mediaUrl('/w/quizei-app', 'assets/logo.png', 5));
    expect(screen.queryAllByTestId('file-line')).toHaveLength(0);
    fireEvent.error(image);
    expect(screen.getByText('This image could not be shown')).toBeTruthy();
  });

  it('shows a video with playback controls; says so when it cannot play', () => {
    const { container } = render(
      <FilePane repoName="r" repoPath="/w/r" path="intro.mp4" content={{ ok: true, kind: 'media', media: 'video', size: 10, mtime: 7 }} isNew={false} tokens={null} onOpenIn={() => undefined} />,
    );
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(mediaUrl('/w/r', 'intro.mp4', 7));
    expect(video.controls).toBe(true);
    fireEvent.error(video);
    expect(screen.getByText('This video could not be played')).toBeTruthy();
  });

  it('shows lines with their numbers', () => {
    renderPane(text('import a;\n\nconst b = 1;\n'));
    const lines = screen.getAllByTestId('file-line');
    expect(lines.map((line) => line.textContent)).toEqual(['1import a;', '2', '3const b = 1;']);
  });

  it('once colors arrive, a line is made of colored spans', () => {
    render(
      <FilePane
        repoName="r"
        repoPath="/w/r"
        path="a.ts"
        content={text('const a;\n')}
        isNew={false}
        tokens={[[{ text: 'const', color: '#c678dd' }, { text: ' a;', color: '#abb2bf' }]]}
        onOpenIn={() => undefined}
      />,
    );
    const spans = [...screen.getByTestId('file-line').querySelectorAll('.code span')];
    expect(spans.map((span) => [span.textContent, (span as HTMLElement).style.color])).toEqual([
      ['const', 'rgb(198, 120, 221)'],
      [' a;', 'rgb(171, 178, 191)'],
    ]);
  });

  it('a note instead of the content of a large file', () => {
    renderPane({ ok: true, kind: 'tooLarge', size: Math.round(2.4 * 1_048_576) });
    expect(screen.getByText('This file is too large to show (2.4 MB)')).toBeTruthy();
    expect(screen.queryAllByTestId('file-line')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Open in…' }).length).toBeGreaterThan(0);
  });

  it('a note for a binary file', () => {
    renderPane({ ok: true, kind: 'binary', size: 10 });
    expect(screen.getByText('Binary file')).toBeTruthy();
  });

  it('a note for a missing file, an alert for other errors', () => {
    renderPane({ ok: false, error: 'File not found' });
    expect(screen.getByText('File not found')).toBeTruthy();
    cleanup();
    renderPane({ ok: false, error: 'File is outside the repository' });
    expect(screen.getByRole('alert').textContent).toContain('File is outside the repository');
  });

  it('says when the file is empty', () => {
    renderPane(text(''));
    expect(screen.getByText('Empty file')).toBeTruthy();
  });

  it('keeps the header and shows no lines while loading', () => {
    renderPane(null);
    expect(screen.getByTestId('view-header')).toBeTruthy();
    expect(screen.queryAllByTestId('file-line')).toHaveLength(0);
  });
});
