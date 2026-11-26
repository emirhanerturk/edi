// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    handlers,
    edi: {
      on: (channel: string, handler: (...args: unknown[]) => void) => {
        handlers[channel] = handler;
        return () => undefined;
      },
      openIn: async () => ({ ok: false, error: 'Could not open Zed' }),
      openProject: async () => ({ ok: false, error: 'Folder not found' }),
      // The initial state never arrives: the test sends the events itself.
      getState: () => new Promise(() => undefined),
      claudeUsage: () => new Promise(() => undefined),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');
const { ViewErrorBar } = await import('../../src/renderer/components/ViewErrorBar');

afterEach(cleanup);

const workspace = (dir: string) => ({ ...useApp.getState().workspace, dir, repos: [] });

describe('ViewErrorBar', () => {
  it('shows a failed "Open in…" error even with the center panel closed, and it can be dismissed', async () => {
    expect(useApp.getState().center.open).toBe(false);
    render(<ViewErrorBar />);
    expect(screen.queryByRole('alert')).toBeNull();
    await useApp.getState().openIn('zed', '/w/a', 'x.ts');
    expect(screen.getByRole('alert').textContent).toContain('Could not open Zed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the old error when switching to another folder', async () => {
    connect();
    bridge.handlers.workspace!(workspace('/w'));
    await useApp.getState().openIn('zed', '/w/a', 'x.ts');
    bridge.handlers.workspace!(workspace('/w'));
    expect(useApp.getState().centerError).toBe('Could not open Zed');
    bridge.handlers.workspace!(workspace('/other'));
    expect(useApp.getState().centerError).toBeNull();
  });

  it('shows a project that could not be opened while another one is open, and it can be dismissed', async () => {
    connect();
    bridge.handlers.workspace!(workspace('/w'));
    const gone = { id: 'p2', dir: '/gone', name: 'Gone', logo: { kind: 'letter' as const, color: 'blue' as const }, links: [], openedAt: 0, repoCount: 0, repos: { order: [], ignored: [] } };
    bridge.handlers.projects!([{ ...gone, logoUrl: null, exists: true, open: false }]);
    render(<ViewErrorBar />);
    await useApp.getState().openProject('p2');
    expect(screen.getByRole('alert').textContent).toContain('Gone: Folder not found');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useApp.getState().openError).toBeNull();
  });
});
