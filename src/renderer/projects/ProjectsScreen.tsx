import { type KeyboardEvent, type MouseEvent, useEffect, useRef } from 'react';
import type { ProjectMenuAction, ProjectView } from '../../shared/api';
import { linkText } from '../../shared/projects';
import { edi } from '../bridge';
import { GlobeIcon, MoreIcon, PlusIcon, WarningIcon } from '../components/icons';
import { useNow } from '../components/useNow';
import { Wordmark } from '../components/Wordmark';
import { plural, tildify } from '../format';
import { useApp } from '../store';
import { ProjectLogo } from './ProjectLogo';
import { badgeOf, openedLabel } from './model';

const MOVES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** On the grid: the arrows move between the cards, Up and Down by a row (as many cards as the grid has columns). */
function gridKeys(event: KeyboardEvent<HTMLElement>): void {
  if (!MOVES.includes(event.key)) return;
  const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card]')];
  const at = cards.findIndex((card) => card === document.activeElement);
  if (at === -1) return;
  const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').filter((track) => track !== '').length || 1;
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : at + steps[event.key]!;
  event.preventDefault();
  cards[next]?.focus();
}

/**
 * The Projects screen: what edi opens on, and what All projects (⇧⌘O) shows over the open project
 * (`overlay`), which keeps running behind it; Esc goes back to it.
 */
export function ProjectsScreen({ overlay }: { overlay: boolean }) {
  const projects = useApp((s) => s.projects);
  const home = useApp((s) => s.home);
  const openError = useApp((s) => s.openError);
  const dismissOpenError = useApp((s) => s.dismissOpenError);
  const startNewProject = useApp((s) => s.startNewProject);
  const now = useNow(60_000);
  const openName = projects.find((project) => project.open)?.name;
  const grid = useRef<HTMLDivElement>(null);

  // The keyboard starts on the screen: on the open project's card over it (Enter goes back), else on
  // the first card (Enter opens the last project). Over a project, the focus goes back to where it was
  // (a terminal, say) once the screen closes.
  useEffect(() => {
    const before = document.activeElement;
    const cards = grid.current;
    (cards?.querySelector<HTMLElement>('.project-card.is-open') ?? cards?.querySelector<HTMLElement>('[data-card]'))?.focus();
    return () => {
      if (overlay && before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [overlay]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Esc in the sheet or a menu is theirs.
      if (event.key !== 'Escape' || event.defaultPrevented || useApp.getState().sheet !== null) return;
      useApp.getState().showProjects(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  return (
    <main className={overlay ? 'projects overlay' : 'projects'} data-testid="projects" aria-label="Projects">
      <div className="projects-box">
        <div className="projects-brand">
          <Wordmark />
          <span className="projects-tagline">Almost an editor. The rest is git.</span>
        </div>
        <div className="projects-head">
          <h1>Projects</h1>
          <div className="spacer" />
          <button className="button-primary" onClick={() => void startNewProject()}>
            <PlusIcon size={12} strokeWidth={1.9} />
            <span>New project</span>
          </button>
          <span className="keycap mono">⌘O</span>
        </div>

        {openError && (
          <p className="projects-error" role="alert">
            <span>{openError}</span>
            <button className="button-quiet" onClick={dismissOpenError}>
              Dismiss
            </button>
          </p>
        )}

        <div className="projects-grid" ref={grid} onKeyDown={gridKeys}>
          {projects.map((project, index) => (
            <ProjectCard key={project.id} project={project} badge={badgeOf(project, index, projects)} home={home} now={now} />
          ))}
          <button className="project-new" data-card data-testid="new-project-card" onClick={() => void startNewProject()}>
            <span className="project-new-icon" aria-hidden="true">
              <PlusIcon size={16} strokeWidth={1.7} />
            </span>
            <span className="project-new-title">New project</span>
            <span className="project-new-hint">Start from a folder</span>
          </button>
        </div>

        <div className="projects-hints">
          <span>
            <span className="mono">↵</span> open
          </span>
          <span>
            <span className="mono">←↑↓→</span> move
          </span>
          {overlay && openName !== undefined && (
            <span>
              <span className="mono">esc</span> back to {openName}
            </span>
          )}
          <span>Right-click a project to edit it or remove it from the list</span>
        </div>
      </div>
    </main>
  );
}

interface CardProps {
  project: ProjectView;
  badge: 'open' | 'last' | null;
  home: string;
  now: number;
}

/** A project on the Projects screen: a click opens it; the … button and a right-click give the rest. */
function ProjectCard({ project, badge, home, now }: CardProps) {
  const openProject = useApp((s) => s.openProject);
  const sessions = useApp((s) => (project.open ? s.workspace.rootSessions + s.workspace.repos.reduce((sum, repo) => sum + repo.claude, 0) : 0));
  const main = project.links[0];
  const more = project.links.length - 1;

  const menu = async () => {
    const action: ProjectMenuAction | null = await edi.projectMenu(project.id);
    const state = useApp.getState();
    if (action === 'open') await state.openProject(project.id);
    else if (action === 'edit') await state.startEditProject(project.id);
    else if (action === 'reveal') await edi.revealProject(project.id);
    else if (action === 'remove') await state.removeProject(project.id);
    else if (action?.startsWith('link:')) {
      const link = project.links[Number(action.slice(5))];
      if (link) await state.openProjectLink(link.url);
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    void menu();
  };

  if (!project.exists) return <MissingCard project={project} home={home} onContextMenu={onContextMenu} />;

  return (
    <div className={`project-card-wrap${badge ? ' has-badge' : ''}`} data-testid="project-card" data-project={project.name}>
      <button className={`project-card${badge ? ` is-${badge}` : ''}`} data-card onClick={() => void openProject(project.id)} onContextMenu={onContextMenu}>
        <span className="project-card-top">
          <ProjectLogo project={project} size={40} />
          {badge === 'last' && <span className="project-badge">Last opened</span>}
          {badge === 'open' && (
            <span className="project-badge open">
              <span className="project-badge-dot" aria-hidden="true" />
              Open
            </span>
          )}
        </span>
        <span className="project-name">{project.name}</span>
        <span className="project-path mono">{tildify(project.dir, home)}</span>
        <span className="spacer" />
        <span className="project-foot">
          <span className="project-foot-fixed">{plural(project.repoCount, 'repo', 'repos')}</span>
          {main && (
            <>
              <GlobeIcon size={11} className="project-foot-globe" />
              <span className="project-foot-link">{linkText(main.url)}</span>
              {more > 0 && <span className="project-foot-fixed">+{more}</span>}
            </>
          )}
          <span className="spacer" />
          <span className="project-foot-fixed">{project.open && sessions > 0 ? plural(sessions, 'session', 'sessions') : openedLabel(project.openedAt, now)}</span>
        </span>
      </button>
      <button className="project-more" aria-label={`More for ${project.name}`} title="More" onClick={() => void menu()}>
        <MoreIcon size={14} />
      </button>
    </div>
  );
}

/** A project whose folder isn't there any more: find it again, or forget the project. */
function MissingCard({ project, home, onContextMenu }: { project: ProjectView; home: string; onContextMenu(event: MouseEvent): void }) {
  const locateProject = useApp((s) => s.locateProject);
  const removeProject = useApp((s) => s.removeProject);
  return (
    <div className="project-card missing" data-testid="project-card" data-project={project.name} onContextMenu={onContextMenu}>
      <span className="project-card-top">
        <ProjectLogo project={project} size={40} />
        <span className="project-missing">
          <WarningIcon size={13} />
          <span>Folder not found</span>
        </span>
      </span>
      <span className="project-name">{project.name}</span>
      <span className="project-path mono">{tildify(project.dir, home)}</span>
      <span className="spacer" />
      <span className="project-actions">
        <button className="button-outline" data-card onClick={() => void locateProject(project.id)}>
          Locate…
        </button>
        <button className="button-quiet" onClick={() => void removeProject(project.id)}>
          Remove from list
        </button>
      </span>
    </div>
  );
}
