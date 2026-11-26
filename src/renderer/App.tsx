import { type CSSProperties, useEffect, useRef } from 'react';
import { CenterPanel } from './center/CenterPanel';
import { type Area, areaOf, closeTarget } from './components/keys';
import { Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { ViewErrorBar } from './components/ViewErrorBar';
import { TitleBar } from './components/TitleBar';
import { ProjectSheet } from './projects/ProjectSheet';
import { ProjectsScreen } from './projects/ProjectsScreen';
import { QuickOpen } from './quickOpen/QuickOpen';
import { RightPanel } from './right/RightPanel';
import { connect, useApp } from './store';
import { TerminalPanel } from './terminals/TerminalPanel';

export function App() {
  const ready = useApp((s) => s.ready);
  const dir = useApp((s) => s.workspace.dir);
  const right = useApp((s) => s.layout.right);
  const left = useApp((s) => s.layout.left);
  const centerOpen = useApp((s) => s.center.open);
  const projectsShown = useApp((s) => s.projectsShown);
  const sheet = useApp((s) => s.sheet);
  const quickOpen = useApp((s) => s.quickOpen);
  // With the terminals on the right the row is drawn reversed, so a drag to the right narrows them.
  const flip = useApp((s) => s.layout.terminals === 'right') ? -1 : 1;
  const body = useRef<HTMLElement>(null);
  const dragStart = useRef(0);
  // The panel the user is working in, followed by clicks and focus: ⌘W closes a tab there.
  const area = useRef<Area>('terminals');

  useEffect(() => connect(), []);

  useEffect(() => {
    const follow = (event: Event) => {
      area.current = areaOf(event.target) ?? area.current;
    };
    // Listened to in the capture phase: the shortcut is handled before it reaches the terminal, even when the terminal has focus.
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      const state = useApp.getState();
      const { tabs, activeTab, newTab, closeTab, activate } = state;
      // The project's terminals and files are behind the Projects screen or a sheet: their shortcuts wait.
      const covered = state.sheet !== null || state.projectsShown || state.workspace.dir === null;
      const key = event.key.toLowerCase();
      let handled = true;
      // Any other shortcut leaves Quick open, and ⌘W only that: what the others do happens behind it.
      if (state.quickOpen && key !== 'p') {
        state.showQuickOpen(false);
        if (key === 'w' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (key === 'p' && !event.shiftKey) {
        if (covered) handled = false;
        else state.showQuickOpen(true);
      } else if (key === 'o' && !event.shiftKey) {
        if (state.sheet === null) void state.startNewProject();
      } else if (key === 'o') {
        // All projects, and back.
        if (state.sheet === null && state.workspace.dir !== null) state.showProjects(!state.projectsShown);
      } else if (key === 't') {
        if (!covered) {
          area.current = 'terminals';
          void newTab({ claude: event.shiftKey });
        }
      } else if (key === 'n' && !event.shiftKey) {
        if (covered) handled = false;
        else {
          area.current = 'center';
          state.newUntitled();
        }
      } else if (key === 'w' && !event.shiftKey) {
        // The tab of the panel in use: a file or diff in the center panel, the terminal in the terminals.
        const target = covered ? null : closeTarget(area.current, state.center, activeTab);
        if (target?.kind === 'terminal') closeTab(target.id);
        else if (target?.kind === 'center') void state.closeCenterTab(target.id);
      } else if (/^[1-9]$/.test(key) && !event.shiftKey) {
        const tab = tabs[Number(key) - 1];
        if (!covered && tab) {
          area.current = 'terminals';
          activate(tab.id);
        }
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', follow, true);
    window.addEventListener('focusin', follow, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', follow, true);
      window.removeEventListener('focusin', follow, true);
    };
  }, []);

  return (
    <div className="app">
      <TitleBar />
      {!ready ? (
        <main className="app-body" />
      ) : dir === null ? (
        <ProjectsScreen overlay={false} />
      ) : (
        <main
          className={`app-body${centerOpen ? ' with-center' : ''}${flip === -1 ? ' terminals-right' : ''}`}
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
              onDrag={(dx) => useApp.getState().resizeLeft(dragStart.current + flip * dx, body.current?.clientWidth ?? window.innerWidth)}
              onEnd={() => useApp.getState().saveLayout()}
            />
          )}
          <CenterPanel />
          <Splitter
            label="Resize the Git panel"
            onStart={() => {
              // Start from the visible width: if the window shrank, it can be smaller than the saved value.
              dragStart.current = body.current?.querySelector('.git')?.getBoundingClientRect().width ?? right;
            }}
            onDrag={(dx) => useApp.getState().resizeRight(dragStart.current - flip * dx, body.current?.clientWidth ?? window.innerWidth)}
            onEnd={() => useApp.getState().saveLayout()}
          />
          <RightPanel />
        </main>
      )}
      {ready && dir !== null && <ViewErrorBar />}
      {ready && dir !== null && <StatusBar />}
      {/* All projects: over the open project, which keeps running behind it. */}
      {ready && dir !== null && projectsShown && <ProjectsScreen overlay />}
      {/* Quick open (⌘P): a file opened from it is where the user works next. */}
      {ready && dir !== null && quickOpen && !projectsShown && sheet === null && (
        <QuickOpen
          onOpened={() => {
            area.current = 'center';
          }}
        />
      )}
      {sheet !== null && <ProjectSheet key={sheet.serial} sheet={sheet} />}
    </div>
  );
}
