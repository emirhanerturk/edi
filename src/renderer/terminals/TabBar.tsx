import { BellIcon, ClaudeMark, CloseIcon, PlusIcon, TerminalIcon } from '../components/icons';
import { tabPorts } from '../servers/model';
import { type Tab, useApp } from '../store';

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeTab = useApp((s) => s.activeTab);
  const newTab = useApp((s) => s.newTab);

  return (
    <div className="tabbar">
      <div className="tabbar-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={tab.id === activeTab} />
        ))}
      </div>
      <div className="spacer" />
      <button className="tabbar-add" data-testid="new-terminal" aria-label="New terminal" title="New terminal (⌘T)" onClick={() => void newTab()}>
        <PlusIcon size={14} />
      </button>
      <button
        className="tabbar-add tabbar-add-claude"
        data-testid="new-claude"
        aria-label="New Claude Code session"
        title="New Claude Code session (⇧⌘T)"
        onClick={() => void newTab({ claude: true })}
      >
        <ClaudeMark size={13} />
        <PlusIcon size={9} strokeWidth={2.4} />
      </button>
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
      role="tab"
      aria-selected={active}
      tabIndex={-1}
      title={tab.title}
      onMouseDown={(event) => {
        // Orta tuş sekmeyi kapatır.
        if (event.button === 1) {
          event.preventDefault();
          closeTab(tab.id);
        } else if (event.button === 0) activate(tab.id);
      }}
    >
      {tab.claude ? <ClaudeMark size={13} /> : <TerminalIcon size={13} />}
      <span className="tab-title">{tab.title}</span>
      {ports !== null && (
        <span className="tab-port mono" data-testid="tab-port" title="Listening on localhost">
          {ports}
        </span>
      )}
      {tab.exited && <span className="tab-exited">exited</span>}
      {tab.waiting && !active && <BellIcon size={13} label="Needs input" style={{ flex: 'none', color: 'var(--yellow)' }} />}
      {active && (
        <button
          className="tab-close"
          aria-label="Close tab"
          title="Close tab (⌘W)"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => closeTab(tab.id)}
        >
          <CloseIcon size={11} />
        </button>
      )}
    </div>
  );
}
