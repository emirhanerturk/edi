// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiff } from '../../src/git/diffParse';
import type { DiffView, FileContent } from '../../src/shared/api';

const spies = vi.hoisted(() => ({ diffRows: vi.fn(), splitLines: vi.fn() }));
vi.mock('../../src/renderer/center/diffRows', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/center/diffRows')>();
  spies.diffRows.mockImplementation(real.diffRows);
  return { ...real, diffRows: spies.diffRows };
});
vi.mock('../../src/renderer/center/lines', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/center/lines')>();
  spies.splitLines.mockImplementation(real.splitLines);
  return { ...real, splitLines: spies.splitLines };
});

const { DiffPane } = await import('../../src/renderer/center/DiffPane');
const { FilePane } = await import('../../src/renderer/center/FilePane');

afterEach(cleanup);

// Polling re-renders the connected view every 2 s; with the same data the body must not be recomputed.
describe('large views are not recomputed for the same data', () => {
  it('new callbacks do not rebuild the diff body', () => {
    const view: DiffView = {
      ok: true,
      diff: parseDiff('@@ -1 +1 @@\n-a\n+b\n'),
      file: { path: 'a.ts', origPath: null, x: '.', y: 'M', kind: 'changed' },
    };
    const pane = () => <DiffPane repoName="r" path="a.ts" view={view} mode="split" tokens={null} onMode={() => undefined} onOpenInZed={() => undefined} onOpenFile={() => undefined} />;
    const { rerender } = render(pane());
    rerender(pane());
    rerender(pane());
    expect(spies.diffRows).toHaveBeenCalledTimes(1);
  });

  it('new callbacks do not re-split the file body', () => {
    const content: FileContent = { ok: true, kind: 'text', text: 'a\nb\n', size: 4 };
    const pane = () => <FilePane repoName="r" repoPath="/w/r" path="a.ts" content={content} isNew={false} tokens={null} onOpenInZed={() => undefined} />;
    const { rerender } = render(pane());
    rerender(pane());
    rerender(pane());
    expect(spies.splitLines).toHaveBeenCalledTimes(1);
  });
});
