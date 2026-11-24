// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileContent } from '../../src/git/types';
import { FilePane, fileInfo, splitLines } from '../../src/renderer/center/FilePane';
import { mediaUrl } from '../../src/shared/media';

afterEach(cleanup);

function renderPane(content: FileContent | null, opts: { isNew?: boolean; path?: string } = {}) {
  const onOpenInZed = vi.fn();
  render(<FilePane repoName="quizei-app" repoPath="/w/quizei-app" path={opts.path ?? 'components/video/video-poster.tsx'} content={content} isNew={opts.isNew ?? false} tokens={null} onOpenInZed={onOpenInZed} />);
  return { onOpenInZed };
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

describe('FilePane', () => {
  it('the header shows repo, path, a read-only note and Open in Zed', () => {
    const { onOpenInZed } = renderPane(text('a\n'));
    const header = screen.getByTestId('view-header');
    expect(within(header).getByText('quizei-app')).toBeTruthy();
    expect(header.textContent).toContain('components/video/video-poster.tsx');
    expect(within(header).getByText('Read-only')).toBeTruthy();
    expect(within(header).queryByText('new file')).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: 'Open in Zed' }));
    expect(onOpenInZed).toHaveBeenCalledTimes(1);
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
      <FilePane repoName="r" repoPath="/w/r" path="intro.mp4" content={{ ok: true, kind: 'media', media: 'video', size: 10, mtime: 7 }} isNew={false} tokens={null} onOpenInZed={() => undefined} />,
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
        onOpenInZed={() => undefined}
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
    expect(screen.getAllByRole('button', { name: 'Open in Zed' }).length).toBeGreaterThan(0);
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
