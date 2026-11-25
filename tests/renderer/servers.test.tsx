// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerInfo } from '../../src/shared/api';

const bridge = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    handlers,
    edi: {
      on: (channel: string, handler: (...args: unknown[]) => void) => {
        handlers[channel] = handler;
        return () => undefined;
      },
      openUrl: vi.fn(async () => ({ ok: true, message: 'Opened in the browser' })),
      getState: () => new Promise(() => undefined),
      claudeUsage: () => new Promise(() => undefined),
    },
  };
});
vi.mock('../../src/renderer/bridge', () => ({ edi: bridge.edi }));

const { useApp, connect } = await import('../../src/renderer/store');
const { serverRows, tabPorts } = await import('../../src/renderer/servers/model');
const { ServersMenu } = await import('../../src/renderer/servers/ServersMenu');
const { TabBar } = await import('../../src/renderer/terminals/TabBar');

afterEach(cleanup);

const server = (tabId: number, port: number, cwd: string | null = null): ServerInfo => ({ tabId, port, pid: port, cwd });

describe('serverRows', () => {
  it('repo is the longest repo path containing the working directory; tab title; localhost URL', () => {
    const repos = [
      { name: 'web', path: '/w/web' },
      { name: 'web-admin', path: '/w/web/admin' },
      { name: 'api', path: '/w/api' },
    ];
    const tabs = [
      { id: 1, title: 'npm run dev' },
      { id: 2, title: 'zsh' },
    ];
    expect(serverRows([server(1, 3000, '/w/web/admin/src'), server(2, 5173, '/w/webx'), server(9, 8080, '/w/api')], tabs, repos)).toEqual([
      { port: 3000, url: 'http://localhost:3000/', repoName: 'web-admin', tabTitle: 'npm run dev', tabId: 1 },
      { port: 5173, url: 'http://localhost:5173/', repoName: null, tabTitle: 'zsh', tabId: 2 },
      { port: 8080, url: 'http://localhost:8080/', repoName: 'api', tabTitle: null, tabId: 9 },
    ]);
  });
});

describe('tabPorts', () => {
  it('the first port and a count of the rest', () => {
    const servers = [server(1, 5173), server(1, 24678), server(1, 9229), server(2, 3000)];
    expect(tabPorts(servers, 1)).toBe('5173 +2');
    expect(tabPorts(servers, 2)).toBe('3000');
    expect(tabPorts(servers, 3)).toBeNull();
  });
});

describe('ServersMenu', () => {
  const rows = serverRows([server(2, 3000), server(1, 5173, '/w/web')], [{ id: 1, title: 'npm run dev' }], [{ name: 'web', path: '/w/web' }]);

  it('renders nothing without servers', () => {
    const { container } = render(<ServersMenu rows={[]} onOpen={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('a counter; the menu shows URL, repo and tab; clicking a row opens the URL and closes the menu', () => {
    const onOpen = vi.fn();
    render(<ServersMenu rows={rows} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: '2 servers' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['localhost:3000', 'localhost:5173web · npm run dev']);
    fireEvent.click(items[1]!);
    expect(onOpen).toHaveBeenCalledWith('http://localhost:5173/');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the last server stops, so the next server does not bring it back open', () => {
    const { rerender } = render(<ServersMenu rows={rows} onOpen={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '2 servers' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<ServersMenu rows={[]} onOpen={() => undefined} />);
    rerender(<ServersMenu rows={rows} onOpen={() => undefined} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a single server is written in the singular', () => {
    render(<ServersMenu rows={rows.slice(1)} onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: '1 server' })).toBeTruthy();
  });
});

describe('opening a link', () => {
  it('says in the error bar when the browser could not open it', async () => {
    bridge.edi.openUrl.mockResolvedValueOnce({ ok: false, error: 'Could not open the link' } as never);
    await useApp.getState().openUrl('http://localhost:5173/');
    expect(useApp.getState().centerError).toBe('Could not open the link: http://localhost:5173/');
    useApp.getState().dismissCenterError();
    await useApp.getState().openUrl('http://localhost:5173/');
    expect(useApp.getState().centerError).toBeNull();
  });
});

describe('store and tab label', () => {
  it('the servers event goes into the store, the port shows on the tab, and the list empties when the folder changes', async () => {
    connect();
    useApp.setState({
      tabs: [{ id: 1, title: 'npm run dev', claude: false, waiting: false, busy: true, exited: false, claudeUntil: 0, titleState: null }],
      activeTab: 1,
    });
    render(<TabBar />);
    expect(screen.queryByTestId('tab-port')).toBeNull();
    act(() => bridge.handlers.servers!([server(1, 5173), server(1, 24678)]));
    expect(useApp.getState().servers).toHaveLength(2);
    expect(screen.getByTestId('tab-port').textContent).toBe('5173 +1');

    act(() => bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/w' }));
    act(() => bridge.handlers.workspace!({ ...useApp.getState().workspace, dir: '/other' }));
    expect(useApp.getState().servers).toEqual([]);
  });
});
