import { create } from 'zustand';
import type { GitOp, Layout, RecentFolder, TabState, WorkspaceView } from '../shared/api';
import { type ClaudeTitleState, claudeTitleState } from '../shared/claudeTitle';
import { edi } from './bridge';
import { clampWidths } from './components/Splitter';
import { disposeAllTerminals, disposeTerminal, onTerminalTitle, openTerminal, showTerminal, writeTerminal } from './terminals/terminals';

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
  /**
   * Claude Code düğmesiyle açılan sekme, komut başlayana kadar birkaç saniye "claude" kalır;
   * bu ana kadar gelen "önde yalnız kabuk var" bilgisi yok sayılır.
   */
  claudeUntil: number;
  /** Claude Code'un terminal başlığından okunan son durum; başlık henüz gelmediyse null. */
  titleState: ClaudeTitleState | null;
}

/** Claude Code'un açılması için tanınan süre. */
const CLAUDE_START_MS = 8000;

/** Ana süreçten gelen süreç durumlarını sekmelere işler. */
export function applyTabStates(tabs: Tab[], states: TabState[], now: number): Tab[] {
  const byId = new Map(states.map((state) => [state.id, state]));
  return tabs.map((tab) => {
    const state = byId.get(tab.id);
    if (!state || tab.exited) return tab;
    if (!state.claude && now < tab.claudeUntil) return tab;
    // Claude Code kapandıysa zil de, başlıktan okunan durum da geçersizdir.
    const waiting = state.claude ? tab.waiting : false;
    const titleState = state.claude ? tab.titleState : null;
    if (
      tab.title === state.title &&
      tab.claude === state.claude &&
      tab.busy === state.busy &&
      tab.waiting === waiting &&
      tab.titleState === titleState
    ) {
      return tab;
    }
    return { ...tab, title: state.title, claude: state.claude, busy: state.busy, waiting, titleState };
  });
}

/**
 * Terminal başlığı değişince sekmeyi günceller. Zil, yalnız kullanıcı bakmazken olan şey için
 * yanar: arka plandaki bir Claude sekmesi çalışırken beklemeye geçtiğinde. Yeni açılmış boş
 * oturum ya da kullanıcının önünde biten yanıt zil yakmaz.
 */
export function applyTitle(tab: Tab, title: string, active: boolean): Tab {
  const next = claudeTitleState(title);
  if (next === null || tab.exited || next === tab.titleState) return tab;
  const waiting = next === 'waiting' && tab.titleState === 'working' && tab.claude && !active;
  return { ...tab, titleState: next, waiting };
}

/**
 * Sekmeyi listeden çıkarır. Etkin sekme kapandıysa sağındaki (yoksa solundaki) öne gelir ve,
 * `activate` ile öne gelmiş gibi, zili söner.
 */
export function removeTab(tabs: Tab[], activeTab: number | null, id: number): { tabs: Tab[]; activeTab: number | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return { tabs, activeTab };
  const rest = tabs.filter((tab) => tab.id !== id);
  if (activeTab !== id) return { tabs: rest, activeTab };
  const next = rest[Math.min(index, rest.length - 1)]?.id ?? null;
  return { tabs: rest.map((tab) => (tab.id === next && tab.waiting ? { ...tab, waiting: false } : tab)), activeTab: next };
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
  /** Sağ panelin genişliğini, `total` genişliğindeki alana sığdırarak değiştirir. */
  resizeRight(right: number, total: number): void;
  /** Panel genişliklerini kalıcı duruma yazar. */
  saveLayout(): void;

  tabs: Tab[];
  activeTab: number | null;
  newTab(opts?: { claude?: boolean; repoPath?: string }): Promise<void>;
  closeTab(id: number): void;
  activate(id: number): void;
  /** Tüm sekmeleri kapatır (klasör değişince). */
  resetTabs(): void;

  /** Git sekmesinde kullanıcının elle açıp kapattığı repolar (oturum boyunca). */
  expanded: Record<string, boolean>;
  toggleRepo(repoPath: string, open: boolean): void;

  /** Yazılmakta olan commit mesajları (repo yolu → metin). */
  drafts: Record<string, string>;
  /** Son git işleminin hatası (repo yolu → git'in satırı). */
  errors: Record<string, string>;
  setDraft(repoPath: string, message: string): void;
  dismissError(repoPath: string): void;
  gitOp(repoPath: string, op: GitOp): Promise<void>;
  fetchAll(): Promise<void>;
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

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
    if (!result.ok && result.cancelled) return; // Kullanıcı vazgeçti: hata değil.
    set({ openError: result.ok ? null : `${dir}: ${result.error}` });
  },
  resizeRight(right, total) {
    set((state) => ({ layout: { ...state.layout, right: clampWidths({ left: state.layout.left, right, total }).right } }));
  },
  saveLayout() {
    edi.setLayout({ right: get().layout.right });
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
      claudeUntil: opts.claude ? Date.now() + CLAUDE_START_MS : 0,
      titleState: null,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id }));
    onTerminalTitle(tab.id, (title) =>
      set((state) => ({ tabs: state.tabs.map((other) => (other.id === tab.id ? applyTitle(other, title, state.activeTab === tab.id) : other)) })),
    );
  },
  closeTab(id) {
    const { tabs, activeTab } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    const tab = tabs[index];
    if (!tab) return;
    if (tab.busy && !tab.exited && !window.confirm('A process is still running in this terminal. Close it?')) return;
    edi.pty.close(id);
    disposeTerminal(id);
    const next = removeTab(tabs, activeTab, id);
    set(next);
    showTerminal(next.activeTab);
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

  expanded: {},
  toggleRepo: (repoPath, open) => set((state) => ({ expanded: { ...state.expanded, [repoPath]: open } })),

  drafts: {},
  errors: {},
  setDraft: (repoPath, message) => set((state) => ({ drafts: { ...state.drafts, [repoPath]: message } })),
  dismissError: (repoPath) => set((state) => ({ errors: without(state.errors, repoPath) })),
  async gitOp(repoPath, op) {
    set((state) => ({ errors: without(state.errors, repoPath) }));
    const result = await edi.git(repoPath, op);
    set((state) => ({
      errors: result.ok ? without(state.errors, repoPath) : { ...state.errors, [repoPath]: result.error },
      // Commit atıldıysa mesaj temizlenir (push'u başarısız olsa bile commit yerindedir).
      drafts: op.op === 'commit' && (result.ok || result.error.startsWith('Committed, but')) ? without(state.drafts, repoPath) : state.drafts,
    }));
  },
  async fetchAll() {
    const results = await edi.fetchAll();
    set((state) => {
      let errors = state.errors;
      for (const { repoPath, result } of results) {
        errors = result.ok ? without(errors, repoPath) : { ...errors, [repoPath]: result.error };
      }
      return { errors };
    });
  },
}));

/** Ana süreçten ilk durumu alır ve değişikliklere abone olur. Dönen işlev abonelikleri kaldırır. */
export function connect(): () => void {
  const off = [
    edi.on('workspace', (workspace) => useApp.setState({ workspace })),
    edi.on('recent', (recent) => useApp.setState({ recent })),
    edi.on('pty:data', (id, data) => writeTerminal(id, data)),
    edi.on('tabs', (states) => useApp.setState((state) => ({ tabs: applyTabStates(state.tabs, states, Date.now()) }))),
    edi.on('pty:exit', (id) =>
      useApp.setState((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, exited: true, busy: false, waiting: false } : tab)),
      })),
    ),
  ];
  void edi.getState().then((state) => useApp.setState({ ...state, ready: true }));
  return () => off.forEach((unsubscribe) => unsubscribe());
}
