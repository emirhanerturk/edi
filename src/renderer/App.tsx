import { useEffect } from 'react';
import { edi } from './bridge';
import { EmptyState } from './components/EmptyState';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { GitPanel } from './git/GitPanel';
import { connect, useApp } from './store';
import { TerminalPanel } from './terminals/TerminalPanel';

export function App() {
  const ready = useApp((s) => s.ready);
  const dir = useApp((s) => s.workspace.dir);

  useEffect(() => connect(), []);

  useEffect(() => {
    // Yakalama aşamasında dinlenir: kısayol, odak terminalde olsa da terminale gitmeden önce işlenir.
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      const { tabs, activeTab, newTab, closeTab, activate } = useApp.getState();
      const key = event.key.toLowerCase();
      let handled = true;
      if (key === 'o' && !event.shiftKey) void edi.chooseFolder();
      else if (key === 't') void newTab({ claude: event.shiftKey });
      else if (key === 'w' && !event.shiftKey) {
        if (activeTab !== null) closeTab(activeTab);
      } else if (/^[1-9]$/.test(key) && !event.shiftKey) {
        const tab = tabs[Number(key) - 1];
        if (tab) activate(tab.id);
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="app">
      <TitleBar />
      {!ready ? (
        <main className="app-body" />
      ) : dir === null ? (
        <EmptyState />
      ) : (
        <main className="app-body">
          <TerminalPanel />
          <GitPanel />
        </main>
      )}
      {ready && dir !== null && <StatusBar />}
    </div>
  );
}
