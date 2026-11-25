import { menuKeys } from './keys';
import { edi } from '../bridge';
import { plural, tildify } from '../format';
import { ProjectLogo } from '../projects/ProjectLogo';
import { useApp } from '../store';
import type { ProjectView } from '../../shared/api';
import { linkHost, linkName, linkText } from '../../shared/projects';
import { ChevronDown, ClaudeMark, LinkArrow, StarIcon } from './icons';
import { usePopover } from './usePopover';
import { UsageMeter } from './UsageMeter';
import { useNow } from './useNow';

/**
 * The window's title bar. On the left, right after the window buttons: the open project (its menu
 * switches projects) with its main link written out and the others behind +N; without a project, the
 * app's name. On the right: the Claude Code sessions and the usage limits. The middle drags the window.
 */
export function TitleBar() {
  const workspace = useApp((s) => s.workspace);
  const project = useApp((s) => (s.workspace.dir === null ? null : (s.projects.find((other) => other.open) ?? null)));
  const sessions = workspace.rootSessions + workspace.repos.reduce((sum, repo) => sum + repo.claude, 0);
  const usage = useApp((s) => s.usage);
  // To tell whether the reset time is "today", and for the data's age.
  const now = useNow(30_000);

  return (
    <header className="titlebar" data-testid="titlebar">
      {project ? <ProjectBar project={project} /> : <span className="titlebar-name">edi</span>}
      <div className="spacer" />
      {sessions > 0 && (
        <div className="titlebar-sessions" title="Claude Code sessions running in a terminal in this project">
          <ClaudeMark size={13} label="Claude Code" />
          <span>{plural(sessions, 'session', 'sessions')}</span>
        </div>
      )}
      <UsageMeter usage={usage} now={now} />
    </header>
  );
}

function ProjectBar({ project }: { project: ProjectView }) {
  return (
    <div className="titlebar-project">
      <ProjectMenu project={project} />
      {project.links.length > 0 && (
        <>
          <span className="titlebar-divider" aria-hidden="true" />
          <ProjectLinks project={project} />
        </>
      )}
    </div>
  );
}

/** The project's logo and name; the menu: edit it, show it in Finder, switch to another, all projects, a new one. */
function ProjectMenu({ project }: { project: ProjectView }) {
  const home = useApp((s) => s.home);
  const projects = useApp((s) => s.projects);
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const others = projects.filter((other) => !other.open && other.exists).slice(0, 5);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="project-switch" ref={ref} onKeyDown={menuKeys}>
      <button
        className="project-button"
        data-testid="project-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tildify(project.dir, home)}
        onClick={() => setOpen(!open)}
      >
        <ProjectLogo project={project} size={18} />
        <span className="project-button-name">{project.name}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="menu project-menu" role="menu" aria-label={project.name} data-testid="project-menu">
          <div className="project-menu-head">
            <ProjectLogo project={project} size={28} />
            <div className="project-menu-title">
              <span className="project-menu-name">{project.name}</span>
              <span className="project-menu-path mono">
                {tildify(project.dir, home)} · {plural(project.repoCount, 'repo', 'repos')}
              </span>
            </div>
          </div>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={() => pick(() => void useApp.getState().startEditProject(project.id))}>
            <span className="menu-item-text">Edit project…</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={() => pick(() => void edi.revealProject(project.id))}>
            <span className="menu-item-text">Reveal in Finder</span>
          </button>
          {others.length > 0 && (
            <>
              <div className="menu-divider" />
              <div className="menu-label">RECENT</div>
              {others.map((other) => (
                <button key={other.id} className="menu-item" role="menuitem" onClick={() => pick(() => void useApp.getState().openProject(other.id))}>
                  <ProjectLogo project={other} size={16} />
                  <span className="menu-item-text">{other.name}</span>
                  <span className="menu-item-hint">{plural(other.repoCount, 'repo', 'repos')}</span>
                </button>
              ))}
            </>
          )}
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={() => pick(() => useApp.getState().showProjects(true))}>
            <span className="menu-item-text">All projects</span>
            <span className="menu-item-hint mono">⇧⌘O</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={() => pick(() => void useApp.getState().startNewProject())}>
            <span className="menu-item-text">New project…</span>
            <span className="menu-item-hint mono">⌘O</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The main link written out (a click opens it in the browser) and, with more links, +N and its menu. */
function ProjectLinks({ project }: { project: ProjectView }) {
  const openUrl = useApp((s) => s.openUrl);
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const [main] = project.links;
  const more = project.links.length - 1;
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  if (!main) return null;

  return (
    <div className="titlebar-links" ref={ref} onKeyDown={menuKeys}>
      <button className="titlebar-link" data-testid="main-link" title={`Open ${linkText(main.url)} in the browser`} onClick={() => void openUrl(main.url)}>
        <span className="titlebar-link-text">{linkText(main.url)}</span>
        <LinkArrow size={11} />
      </button>
      {more > 0 && (
        <button
          className="links-more"
          data-testid="links-more"
          aria-label={plural(more, 'more link', 'more links')}
          aria-haspopup="menu"
          aria-expanded={open}
          title={project.links.slice(1).map(linkName).join(', ')}
          onClick={() => setOpen(!open)}
        >
          +{more}
        </button>
      )}
      {open && (
        <div className="menu links-menu" role="menu" aria-label="Links" data-testid="links-menu">
          <div className="menu-label">LINKS</div>
          {project.links.map((link, index) => (
            <button key={link.url} className="menu-item" role="menuitem" title={link.url} onClick={() => pick(() => void openUrl(link.url))}>
              {index === 0 ? <StarIcon size={12} filled label="Main link" className="links-star" /> : <span className="links-star" aria-hidden="true" />}
              <span className="menu-item-text">{linkName(link)}</span>
              {link.label.trim() !== '' && <span className="menu-item-hint">{linkHost(link.url)}</span>}
              <LinkArrow size={11} className="links-arrow" />
            </button>
          ))}
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={() => pick(() => void useApp.getState().startEditProject(project.id))}>
            <span className="menu-item-text">Edit links…</span>
          </button>
        </div>
      )}
    </div>
  );
}
