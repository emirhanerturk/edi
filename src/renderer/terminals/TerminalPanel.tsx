import { useEffect, useRef } from 'react';
import { useApp } from '../store';
import { TabBar } from './TabBar';
import { setContainer } from './terminals';

/** Sol panel: sekme çubuğu ve etkin terminal. */
export function TerminalPanel() {
  const dir = useApp((s) => s.workspace.dir);
  const tabCount = useApp((s) => s.tabs.length);
  const hosts = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContainer(hosts.current);
    return () => setContainer(null);
  }, []);

  // Terminaller açık klasöre aittir: klasör değişince hepsi kapanır ve yeni klasörde bir tane açılır.
  useEffect(() => {
    const { resetTabs, newTab } = useApp.getState();
    resetTabs();
    void newTab();
    return () => resetTabs();
  }, [dir]);

  return (
    <section className="terminals" aria-label="Terminals">
      <TabBar />
      <div className="term-hosts" ref={hosts}>
        {tabCount === 0 && (
          <div className="term-empty">
            <p>No terminals open</p>
            <p className="term-empty-hint">
              <span className="mono">⌘T</span> new terminal · <span className="mono">⇧⌘T</span> new Claude Code session
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
