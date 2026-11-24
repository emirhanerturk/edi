import { useEffect, useRef } from 'react';
import { useApp } from '../store';
import { TabBar } from './TabBar';
import { setContainer } from './terminals';

/** Left panel: the tab bar and the active terminal. */
export function TerminalPanel() {
  const dir = useApp((s) => s.workspace.dir);
  const tabCount = useApp((s) => s.tabs.length);
  const hosts = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContainer(hosts.current);
    return () => setContainer(null);
  }, []);

  // Terminals belong to the open folder: when the folder changes, they all close and one opens in the new folder.
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
