import { type DragEvent, useState } from 'react';
import { BellIcon, ClaudeMark, CloseIcon, SnippetIcon, TerminalIcon } from '../components/icons';
import { tabPorts } from '../servers/model';
import { SnippetsMenu } from '../snippets/SnippetsMenu';
import { NewTabButtons } from './NewTabButtons';
import { type Tab, dropIndex, useApp } from '../store';

/** What a dragged tab carries: only the tab bar takes it (not the terminal, as text). */
const TAB_DRAG = 'application/x-edi-tab';

type Side = 'before' | 'after';

/** Which half of the tab the pointer is over: the left half drops before it, the right half after. */
export function dropSide(clientX: number, box: { left: number; width: number }): Side {
  return clientX < box.left + box.width / 2 ? 'before' : 'after';
}

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeTab = useApp((s) => s.activeTab);
  const newTab = useApp((s) => s.newTab);
  const reorderTab = useApp((s) => s.reorderTab);
  // The tab being dragged, and where it would go: before or after another tab.
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; side: Side } | null>(null);

  const from = dragging === null ? -1 : tabs.findIndex((tab) => tab.id === dragging);
  const to = dragging === null || over === null ? -1 : dropIndex(tabs, dragging, over.id, over.side);
  // The line shows only where dropping would move the tab.
  const line = from !== -1 && to !== -1 && to !== from ? over : null;

  const end = () => {
    setDragging(null);
    setOver(null);
  };
  const drop = (event: DragEvent) => {
    if (dragging === null) return;
    event.preventDefault();
    if (line !== null) reorderTab(dragging, to);
    end();
  };
  /** Allows the drop while a tab of this bar is dragged. */
  const accept = (event: DragEvent) => {
    if (dragging === null || !event.dataTransfer.types.includes(TAB_DRAG)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return true;
  };

  return (
    <div
      className="tabbar"
      onDoubleClick={(event) => {
        // Only the empty part: not a tab, a button or a menu opened from the bar.
        if (!(event.target as HTMLElement).closest('.tab, button, [role="menu"]')) void newTab();
      }}
      onDragOver={(event) => {
        // Past the last tab (the empty part, the buttons): the tab goes to the end.
        if ((event.target as HTMLElement).closest('.tab') || !accept(event)) return;
        const last = tabs.at(-1);
        if (last && (over?.id !== last.id || over.side !== 'after')) setOver({ id: last.id, side: 'after' });
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
      }}
      onDrop={drop}
    >
      <div className="tabbar-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab}
            dragged={tab.id === dragging}
            line={line?.id === tab.id ? line.side : null}
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG, String(tab.id));
              event.dataTransfer.effectAllowed = 'move';
              setDragging(tab.id);
            }}
            onDragOver={(event) => {
              if (!accept(event)) return;
              const side = dropSide(event.clientX, event.currentTarget.getBoundingClientRect());
              if (over?.id !== tab.id || over.side !== side) setOver({ id: tab.id, side });
            }}
            onDragEnd={end}
          />
        ))}
      </div>
      <div className="spacer" />
      <SnippetsMenu />
      <NewTabButtons />
    </div>
  );
}

interface TabButtonProps {
  tab: Tab;
  active: boolean;
  /** This tab is being dragged. */
  dragged: boolean;
  /** Where the dragged tab would land: a line on this tab's left or right edge. */
  line: Side | null;
  onDragStart(event: DragEvent<HTMLDivElement>): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDragEnd(): void;
}

function TabButton({ tab, active, dragged, line, onDragStart, onDragOver, onDragEnd }: TabButtonProps) {
  const activate = useApp((s) => s.activate);
  const closeTab = useApp((s) => s.closeTab);
  const ports = useApp((s) => tabPorts(s.servers, tab.id));

  return (
    <div
      className={`tab${active ? ' active' : ''}${dragged ? ' dragging' : ''}${line ? ` drop-${line}` : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      data-testid="tab"
      data-claude={tab.claude}
      data-snippet={tab.snippet === true}
      role="tab"
      aria-selected={active}
      tabIndex={-1}
      title={tab.place ? `${tab.title} — ${tab.place}` : tab.title}
      onMouseDown={(event) => {
        // Middle click closes the tab.
        if (event.button === 1) {
          event.preventDefault();
          closeTab(tab.id);
        } else if (event.button === 0) activate(tab.id);
      }}
    >
      {tab.claude ? <ClaudeMark size={13} /> : tab.snippet ? <SnippetIcon size={13} className="tab-snippet-icon" /> : <TerminalIcon size={13} />}
      <span className="tab-title">{tab.title}</span>
      {tab.place && (
        <span className="tab-place" data-testid="tab-place">
          {tab.place}
        </span>
      )}
      {ports !== null && (
        <span className="tab-port mono" data-testid="tab-port" title="Listening on localhost">
          {ports}
        </span>
      )}
      {tab.exited && <span className="tab-exited">exited</span>}
      {tab.waiting && !active && <BellIcon size={13} label="Needs input" style={{ flex: 'none', color: 'var(--yellow)' }} />}
      {/* Takes up space on every tab; on an inactive tab it shows on hover (CSS). */}
      <button
        className="tab-close"
        data-reveal={active ? 'always' : 'hover'}
        aria-label="Close tab"
        title={active ? 'Close tab (⌘W)' : 'Close tab'}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => closeTab(tab.id)}
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}
