// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitFile, FileChange } from '../../src/shared/api';

vi.mock('../../src/renderer/bridge', () => ({ edi: { mediaSize: vi.fn(async () => 2048) } }));

const { commitMedia, workingMedia } = await import('../../src/renderer/center/media');
const { MediaCompare } = await import('../../src/renderer/center/MediaCompare');

afterEach(cleanup);

const OID = 'a'.repeat(40);
const binary = { hunks: [], added: 0, removed: 0, binary: true };
const commitFile = (over: Partial<CommitFile>): CommitFile => ({ path: 'assets/logo.png', origPath: null, letter: 'M', diff: binary, ...over });
const change = (over: Partial<FileChange>): FileChange => ({ path: 'assets/logo.png', origPath: null, x: '.', y: 'M', kind: 'changed', ...over });

describe('commitMedia', () => {
  it("compares the parent's version with the commit's; an added file has no before, a deleted one no after", () => {
    expect(commitMedia('/r', OID, commitFile({}))).toEqual({
      media: 'image',
      before: { repoPath: '/r', path: 'assets/logo.png', rev: `${OID}^`, version: 0 },
      after: { repoPath: '/r', path: 'assets/logo.png', rev: OID, version: 0 },
    });
    expect(commitMedia('/r', OID, commitFile({ letter: 'A' }))?.before).toBeNull();
    expect(commitMedia('/r', OID, commitFile({ letter: 'D' }))?.after).toBeNull();
    expect(commitMedia('/r', OID, commitFile({ letter: 'R', origPath: 'old.png' }))?.before?.path).toBe('old.png');
    expect(commitMedia('/r', OID, commitFile({ path: 'clip.mp4' }))?.media).toBe('video');
    // Not media, or not a binary diff (SVG): the lines show instead.
    expect(commitMedia('/r', OID, commitFile({ path: 'a.ts' }))).toBeNull();
    expect(commitMedia('/r', OID, commitFile({ path: 'a.svg', diff: { ...binary, binary: false } }))).toBeNull();
    // A stash's new file is in its third parent.
    expect(commitMedia('/r', OID, commitFile({ letter: 'A', untracked: true }), `${OID}^3`)?.after?.rev).toBe(`${OID}^3`);
  });
});

describe('workingMedia', () => {
  it("compares HEAD's version with the one on disk", () => {
    expect(workingMedia('/r', OID, change({}), 7)).toEqual({
      media: 'image',
      before: { repoPath: '/r', path: 'assets/logo.png', rev: OID, version: 0 },
      after: { repoPath: '/r', path: 'assets/logo.png', rev: null, version: 7 },
    });
    expect(workingMedia('/r', OID, change({ x: 'A', y: '.' }), 7)?.before).toBeNull();
    expect(workingMedia('/r', null, change({}), 7)?.before).toBeNull();
    expect(workingMedia('/r', OID, change({ y: 'D' }), 7)?.after).toBeNull();
  });
});

describe('MediaCompare', () => {
  it('shows before and after side by side, from the commit and its parent, with the size', async () => {
    render(<MediaCompare pair={commitMedia('/r', OID, commitFile({}))!} />);
    expect(screen.getByTestId('media-compare').className).toContain('two');
    const images = screen.getAllByRole('img') as HTMLImageElement[];
    expect(images.map((image) => new URL(image.src).searchParams.get('rev'))).toEqual([`${OID}^`, OID]);
    expect(screen.getAllByTestId('media-figure').map((figure) => figure.querySelector('.media-label')!.textContent)).toEqual(['BEFORE', 'AFTER']);
    expect((await screen.findAllByText('2.0 KB')).length).toBe(2);
  });

  it('an added or deleted one alone, centered, marked NEW or DELETED', () => {
    render(<MediaCompare pair={commitMedia('/r', OID, commitFile({ letter: 'A' }))!} />);
    expect(screen.getByTestId('media-compare').className).toContain('one');
    expect(screen.getByText('NEW')).toBeTruthy();
    cleanup();
    render(<MediaCompare pair={commitMedia('/r', OID, commitFile({ letter: 'D', path: 'clip.mp4' }))!} />);
    expect(screen.getByText('DELETED')).toBeTruthy();
    expect(document.querySelector('video')).toBeTruthy();
  });
});
