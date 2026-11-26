import { BellIcon, ClaudeMark, CloseIcon, SnippetIcon, TerminalIcon } from '../components/icons';
import { tabPorts } from '../servers/model';
import { SnippetsMenu } from '../snippets/SnippetsMenu';
import { NewTabButtons } from './NewTabButtons';
import { type Tab, useApp } from '../store';

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeTab = useApp((s) => s.activeTab);
  const newTab = useApp((s) => s.newTab);

  return (
    <div
      className="tabbar"
      onDoubleClick={(event) => {
        // Only the empty part: not a tab, a button or a menu opened from the bar.
        if (!(event.target as HTMLElement).closest('.tab, button, [role="menu"]')) void newTab();
      }}
    >
      <div className="tabbar-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={tab.id === activeTab} />
        ))}
      </div>
      <div className="spacer" />
      <SnippetsMenu />
      <NewTabButtons />
    </div>
  );
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const activate = useApp((s) => s.activate);
  const closeTab = useApp((s) => s.closeTab);
  const ports = useApp((s) => tabPorts(s.servers, tab.id));

  return (
    <div
      className={`tab${active ? ' active' : ''}`}
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
