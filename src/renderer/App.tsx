import { type CSSProperties, useEffect, useRef } from 'react';
import { edi } from './bridge';
import { CenterPanel } from './center/CenterPanel';
import { EmptyState } from './components/EmptyState';
import { Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { RightPanel } from './right/RightPanel';
import { connect, useApp } from './store';
import { TerminalPanel } from './terminals/TerminalPanel';

export function App() {
  const ready = useApp((s) => s.ready);
  const dir = useApp((s) => s.workspace.dir);
  const right = useApp((s) => s.layout.right);
  const left = useApp((s) => s.layout.left);
  const centerOpen = useApp((s) => s.center.open);
  const body = useRef<HTMLElement>(null);
  const dragStart = useRef(0);

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
        <main
          className={`app-body${centerOpen ? ' with-center' : ''}`}
          ref={body}
          style={{ '--right-width': `${right}px`, '--left-width': `${left}px` } as CSSProperties}
        >
          <TerminalPanel />
          {centerOpen && (
            <Splitter
              label="Resize the terminal panel"
              onStart={() => {
                dragStart.current = body.current?.querySelector('.terminals')?.getBoundingClientRect().width ?? left;
              }}
              onDrag={(dx) => useApp.getState().resizeLeft(dragStart.current + dx, body.current?.clientWidth ?? window.innerWidth)}
              onEnd={() => useApp.getState().saveLayout()}
            />
          )}
          <CenterPanel />
          <Splitter
            label="Resize the Git panel"
            onStart={() => {
              // Görünen genişlikten başlanır: pencere daraldıysa kayıtlı değerden küçük olabilir.
              dragStart.current = body.current?.querySelector('.git')?.getBoundingClientRect().width ?? right;
            }}
            onDrag={(dx) => useApp.getState().resizeRight(dragStart.current - dx, body.current?.clientWidth ?? window.innerWidth)}
            onEnd={() => useApp.getState().saveLayout()}
          />
          <RightPanel />
        </main>
      )}
      {ready && dir !== null && <StatusBar />}
    </div>
  );
}
