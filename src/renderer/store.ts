import { create } from 'zustand';
import type { Layout, RecentFolder, WorkspaceView } from '../shared/api';
import { edi } from './bridge';
import { disposeAllTerminals, disposeTerminal, openTerminal, showTerminal, writeTerminal } from './terminals/terminals';

export interface Tab {
  id: number;
  title: string;
  /** Önde Claude Code çalışıyor. */
  claude: boolean;
  /** Claude Code yanıt bekliyor (yalnız arka plandaki sekmede gösterilir). */
  waiting: boolean;
  /** Kabuğun dışında bir süreç çalışıyor: kapatılırken sorulur. */
  busy: boolean;
  /** Kabuk kapandı; sekme, çıktısı okunabilsin diye yerinde durur. */
  exited: boolean;
}

interface AppStore {
  /** İlk durum ana süreçten geldi mi. */
  ready: boolean;
  home: string;
  workspace: WorkspaceView;
  recent: RecentFolder[];
  layout: Layout;
  /** Klasör açılamadıysa nedeni. */
  openError: string | null;
  openFolder(dir: string): Promise<void>;
  dismissOpenError(): void;

  tabs: Tab[];
  activeTab: number | null;
  newTab(opts?: { claude?: boolean; repoPath?: string }): Promise<void>;
  closeTab(id: number): void;
  activate(id: number): void;
  /** Tüm sekmeleri kapatır (klasör değişince). */
  resetTabs(): void;
}

const EMPTY: WorkspaceView = { dir: null, repos: [], rootSessions: 0, refreshedAt: 0 };

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  home: '',
  workspace: EMPTY,
  recent: [],
  layout: { left: 492, right: 372, diffMode: 'split', historyLayout: 'timeline' },
  openError: null,
  async openFolder(dir) {
    const result = await edi.openFolder(dir);
    set({ openError: result.ok ? null : `${dir}: ${result.error}` });
  },
  dismissOpenError: () => set({ openError: null }),

  tabs: [],
  activeTab: null,
  async newTab(opts = {}) {
    const dir = get().workspace.dir;
    if (dir === null) return;
    let created;
    try {
      created = await openTerminal(opts);
    } catch {
      return; // Klasör bu arada kapandı ya da terminal alanı henüz yok.
    }
    if (get().workspace.dir !== dir) {
      // Terminal açılırken klasör değişti: bu terminal eski klasöre ait.
      edi.pty.close(created.id);
      disposeTerminal(created.id);
      return;
    }
    const tab: Tab = {
      id: created.id,
      title: opts.claude ? 'claude' : created.title,
      claude: opts.claude === true,
      waiting: false,
      busy: false,
      exited: false,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id }));
  },
  closeTab(id) {
    const { tabs, activeTab } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    const tab = tabs[index];
    if (!tab) return;
    if (tab.busy && !tab.exited && !window.confirm('A process is still running in this terminal. Close it?')) return;
    edi.pty.close(id);
    disposeTerminal(id);
    const rest = tabs.filter((other) => other.id !== id);
    // Etkin sekme kapandıysa sağındaki (yoksa solundaki) öne gelir.
    const next = activeTab === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? null) : activeTab;
    set({ tabs: rest, activeTab: next });
    showTerminal(next);
  },
  activate(id) {
    if (!get().tabs.some((tab) => tab.id === id)) return;
    set((state) => ({ activeTab: id, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, waiting: false } : tab)) }));
    showTerminal(id);
  },
  resetTabs() {
    disposeAllTerminals();
    set({ tabs: [], activeTab: null });
  },
}));

/** Ana süreçten ilk durumu alır ve değişikliklere abone olur. Dönen işlev abonelikleri kaldırır. */
export function connect(): () => void {
  const off = [
    edi.on('workspace', (workspace) => useApp.setState({ workspace })),
    edi.on('recent', (recent) => useApp.setState({ recent })),
    edi.on('pty:data', (id, data) => writeTerminal(id, data)),
    edi.on('pty:exit', (id) =>
      useApp.setState((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, exited: true, busy: false, waiting: false } : tab)),
      })),
    ),
  ];
  void edi.getState().then((state) => useApp.setState({ ...state, ready: true }));
  return () => off.forEach((unsubscribe) => unsubscribe());
}
