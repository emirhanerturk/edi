import { create } from 'zustand';
import type { Layout, RecentFolder, WorkspaceView } from '../shared/api';
import { edi } from './bridge';

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
}

const EMPTY: WorkspaceView = { dir: null, repos: [], rootSessions: 0, refreshedAt: 0 };

export const useApp = create<AppStore>((set) => ({
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
}));

/** Ana süreçten ilk durumu alır ve değişikliklere abone olur. Dönen işlev abonelikleri kaldırır. */
export function connect(): () => void {
  const off = [
    edi.on('workspace', (workspace) => useApp.setState({ workspace })),
    edi.on('recent', (recent) => useApp.setState({ recent })),
  ];
  void edi.getState().then((state) => useApp.setState({ ...state, ready: true }));
  return () => off.forEach((unsubscribe) => unsubscribe());
}
