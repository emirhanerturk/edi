import type { ServerInfo } from '../../shared/api';

export interface ServerRow {
  port: number;
  url: string;
  /** The repo containing the listening process's working directory; null if none. */
  repoName: string | null;
  /** Title of the tab the server runs in (e.g. `npm run dev`); null if there's no tab. */
  tabTitle: string | null;
  tabId: number;
}

const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);

/** Rows of the status bar menu. The repo is the longest (innermost) repo path containing the working directory. */
export function serverRows(servers: ServerInfo[], tabs: { id: number; title: string }[], repos: { name: string; path: string }[]): ServerRow[] {
  return servers.map((server) => {
    const cwd = server.cwd;
    const repo =
      cwd === null
        ? undefined
        : repos.filter((candidate) => inside(cwd, candidate.path)).sort((a, b) => b.path.length - a.path.length)[0];
    return {
      port: server.port,
      url: `http://localhost:${server.port}/`,
      repoName: repo?.name ?? null,
      tabTitle: tabs.find((tab) => tab.id === server.tabId)?.title ?? null,
      tabId: server.tabId,
    };
  });
}

/** Port label on a tab: the first port and the count of the rest (`5173 +1`); null if none. */
export function tabPorts(servers: ServerInfo[], tabId: number): string | null {
  const ports = servers.filter((server) => server.tabId === tabId).map((server) => server.port);
  if (ports.length === 0) return null;
  return ports.length === 1 ? String(ports[0]) : `${ports[0]} +${ports.length - 1}`;
}
