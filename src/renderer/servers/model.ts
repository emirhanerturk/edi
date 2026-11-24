import type { ServerInfo } from '../../shared/api';

export interface ServerRow {
  port: number;
  url: string;
  /** Dinleyen sürecin çalışma dizinini içeren repo; yoksa null. */
  repoName: string | null;
  /** Sunucunun çalıştığı sekmenin başlığı (ör. `npm run dev`); sekme yoksa null. */
  tabTitle: string | null;
  tabId: number;
}

const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);

/** Durum çubuğu menüsünün satırları. Repo, çalışma dizinini içeren en uzun (en içteki) repo yoludur. */
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

/** Sekmedeki port etiketi: ilk port ve kalanların sayısı (`5173 +1`); yoksa null. */
export function tabPorts(servers: ServerInfo[], tabId: number): string | null {
  const ports = servers.filter((server) => server.tabId === tabId).map((server) => server.port);
  if (ports.length === 0) return null;
  return ports.length === 1 ? String(ports[0]) : `${ports[0]} +${ports.length - 1}`;
}
