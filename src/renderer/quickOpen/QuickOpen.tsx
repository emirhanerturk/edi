import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileList } from '../../shared/api';
import { edi } from '../bridge';
import { BranchIcon, SearchIcon } from '../components/icons';
import { FileTypeIcon } from '../files/fileIcons';
import { changeSignature } from '../files/tree';
import { fileLetter, letterColor } from '../git/model';
import { type RecentFile, useApp } from '../store';
import { normalize, runs, search } from './match';
import './quickOpen.css';

/** A file the palette can open. */
export interface Pick {
  repoPath: string;
  path: string;
  /** Indexes of the matched letters in `path`. */
  positions: number[];
  /** Shown after the folder: the repo's name in the recent list. */
  hint: string | null;
}

export type Row =
  | { kind: 'label'; label: string }
  | { kind: 'group'; repoPath: string; name: string; branch: string | null; count: number; first: boolean }
  | { kind: 'file'; pick: Pick; index: number }
  | { kind: 'more'; repoPath: string; count: number };

export interface PaletteRepo {
  path: string;
  name: string;
  branch: string | null;
  /** Null until its list arrives. */
  files: string[] | null;
}

const RECENT_SHOWN = 10;

/**
 * The palette's rows: the recently opened files when nothing is typed, otherwise the files that match,
 * grouped by repo. `picks` are the files in the order the arrow keys go through them.
 */
export function paletteRows(query: string, repos: PaletteRepo[], recent: RecentFile[]): { rows: Row[]; picks: Pick[]; total: number } {
  const rows: Row[] = [];
  const picks: Pick[] = [];
  const add = (pick: Pick) => {
    rows.push({ kind: 'file', pick, index: picks.length });
    picks.push(pick);
  };
  if (normalize(query) === '') {
    const byPath = new Map(repos.map((repo) => [repo.path, repo]));
    const shown = recent.filter((file) => {
      const repo = byPath.get(file.repoPath);
      // A file deleted or renamed since is left out once its repo's list is in.
      return repo !== undefined && (repo.files === null || repo.files.includes(file.path));
    });
    if (shown.length > 0) rows.push({ kind: 'label', label: 'RECENTLY OPENED' });
    for (const file of shown.slice(0, RECENT_SHOWN)) add({ ...file, positions: [], hint: byPath.get(file.repoPath)!.name });
    return { rows, picks, total: 0 };
  }
  const groups = search(
    query,
    repos.map((repo) => ({ repoPath: repo.path, files: repo.files ?? [] })),
  );
  let total = 0;
  groups.forEach((group, index) => {
    const repo = repos.find((candidate) => candidate.path === group.repoPath)!;
    rows.push({ kind: 'group', repoPath: repo.path, name: repo.name, branch: repo.branch, count: group.total, first: index === 0 });
    for (const hit of group.hits) add({ repoPath: repo.path, path: hit.path, positions: hit.match.positions, hint: null });
    if (group.total > group.hits.length) rows.push({ kind: 'more', repoPath: repo.path, count: group.total - group.hits.length });
    total += group.total;
  });
  return { rows, picks, total };
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export interface QuickOpenViewProps {
  repos: PaletteRepo[];
  recent: RecentFile[];
  /** Status letters of changed files: `repoPath\npath` → letter. */
  letters: Map<string, string>;
  /** `pin`: ⌘↵ or ⌘-click keeps the tab. */
  onOpen(pick: Pick, pin: boolean): void;
  onClose(): void;
}

/** Quick open (⌘P): a file by its name or path, from every repository, grouped by repository. */
export function QuickOpenView({ repos, recent, letters, onOpen, onClose }: QuickOpenViewProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const byKeys = useRef(false);
  const { rows, picks, total } = useMemo(() => paletteRows(query, repos, recent), [query, repos, recent]);
  const current = Math.min(selected, Math.max(picks.length - 1, 0));
  const loading = repos.some((repo) => repo.files === null);

  useEffect(() => input.current?.focus(), []);

  // The row chosen with the arrow keys stays in sight.
  useLayoutEffect(() => {
    if (!byKeys.current) return;
    byKeys.current = false;
    const row = list.current?.querySelector<HTMLElement>('[data-selected="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (picks.length === 0) return;
      byKeys.current = true;
      setSelected(Math.max(0, Math.min(picks.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = picks[current];
      if (pick) onOpen(pick, event.metaKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const none = normalize(query) !== '' && picks.length === 0 && !loading;
  const repoCount = new Set(picks.map((pick) => pick.repoPath)).size;
  return (
    <div className="quick-open-layer" data-testid="quick-open">
      <button className="quick-open-backdrop" aria-label="Close Quick open" tabIndex={-1} onClick={onClose} />
      <div className="quick-open" role="dialog" aria-label="Quick open" onKeyDown={onKeyDown}>
        <label className="quick-open-field">
          <SearchIcon size={15} />
          <input
            ref={input}
            aria-label="Search files by name or path"
            placeholder="Search files by name or path"
            spellCheck={false}
            autoComplete="off"
            value={query}
            data-testid="quick-open-input"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
              list.current?.scrollTo?.({ top: 0 });
            }}
          />
          <span className="keycap">esc</span>
        </label>
        <div className="quick-open-list" ref={list} role="listbox" aria-label="Files">
          {rows.map((row) => {
            if (row.kind === 'label') return <div key="label" className="quick-open-label">{row.label}</div>;
            if (row.kind === 'group') {
              return (
                <div key={`group:${row.repoPath}`} className={`quick-open-group${row.first ? ' first' : ''}`} data-testid="quick-open-group">
                  <span className="quick-open-repo">{row.name}</span>
                  {row.branch !== null && (
                    <span className="quick-open-branch mono">
                      <BranchIcon size={11} />
                      {row.branch}
                    </span>
                  )}
                  <div className="spacer" />
                  <span className="quick-open-count">{row.count.toLocaleString('en-US')}</span>
                </div>
              );
            }
            if (row.kind === 'more') {
              return (
                <div key={`more:${row.repoPath}`} className="quick-open-more">
                  {plural(row.count, 'more file', 'more files')}; type more of the name to narrow it down
                </div>
              );
            }
            const { pick, index } = row;
            return (
              <FileRow
                key={`${pick.repoPath}\n${pick.path}`}
                pick={pick}
                selected={index === current}
                letter={letters.get(`${pick.repoPath}\n${pick.path}`) ?? ''}
                onOpen={(pin) => onOpen(pick, pin)}
                onHover={() => {
                  if (index !== current) setSelected(index);
                }}
              />
            );
          })}
          {none && (
            <div className="quick-open-none" data-testid="quick-open-none">
              <span className="quick-open-none-title">No files match “{query.trim()}”</span>
              <span>
                Names and paths in {repos.length === 1 ? 'the repository' : `all ${repos.length} repositories`} are searched. Files ignored by git are
                left out.
              </span>
            </div>
          )}
          {normalize(query) === '' && picks.length === 0 && (
            <div className="quick-open-none">
              <span>Type part of a file’s name or path.</span>
            </div>
          )}
        </div>
        <div className="quick-open-footer">
          <span className="quick-open-hint">
            <span className="keycap">↑</span>
            <span className="keycap">↓</span>
            to move
          </span>
          <span className="quick-open-hint">
            <span className="keycap">↵</span>
            to open
          </span>
          <span className="quick-open-hint">
            <span className="keycap">⌘↵</span>
            to keep it in a tab
          </span>
          <div className="spacer" />
          <span data-testid="quick-open-total">
            {total > 0 ? `${plural(total, 'file', 'files')} in ${plural(repoCount, 'repository', 'repositories')}` : loading && normalize(query) !== '' ? 'Listing files…' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function FileRow({ pick, selected, letter, onOpen, onHover }: { pick: Pick; selected: boolean; letter: string; onOpen(pin: boolean): void; onHover(): void }) {
  const slash = pick.path.lastIndexOf('/');
  const name = pick.path.slice(slash + 1);
  const dir = slash === -1 ? '' : pick.path.slice(0, slash);
  return (
    <button
      className={`quick-open-file${selected ? ' selected' : ''}`}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-testid="quick-open-file"
      title={pick.path}
      onClick={(event) => onOpen(event.metaKey)}
      onMouseMove={onHover}
    >
      <FileTypeIcon name={name} className="quick-open-icon" />
      <span className="quick-open-name">
        {runs(name, slash + 1, pick.positions).map((run, at) => (
          <span key={at} className={run.hit ? 'hit' : undefined}>
            {run.text}
          </span>
        ))}
      </span>
      <span className="quick-open-dir">
        {runs(dir, 0, pick.positions).map((run, at) => (
          <span key={at} className={run.hit ? 'hit' : undefined}>
            {run.text}
          </span>
        ))}
      </span>
      {pick.hint !== null && <span className="quick-open-hint-repo">{pick.hint}</span>}
      <span className="quick-open-letter mono" style={{ color: letter === '' ? undefined : letterColor(letter) }}>
        {letter}
      </span>
    </button>
  );
}

/** A repo's list, read once per state of its changes (as the Files tab does). */
const lists = new Map<string, { signature: string; list: FileList }>();
const signature = changeSignature;

/** The palette bound to app state: lists every repository's files while it is open. */
export function QuickOpen({ onOpened }: { onOpened(): void }) {
  const workspace = useApp((s) => s.workspace);
  const recent = useApp((s) => s.recent);
  const [loaded, setLoaded] = useState<Record<string, FileList>>(() =>
    Object.fromEntries(workspace.repos.flatMap((repo) => {
      const cached = lists.get(repo.path);
      return cached && cached.signature === signature(repo) ? [[repo.path, cached.list]] : [];
    })),
  );

  useEffect(() => {
    let live = true;
    for (const repo of workspace.repos) {
      const key = signature(repo);
      const cached = lists.get(repo.path);
      if (cached?.signature === key) continue;
      void edi.listFiles(repo.path).then(
        (list) => {
          lists.set(repo.path, { signature: key, list });
          if (live) setLoaded((prev) => ({ ...prev, [repo.path]: list }));
        },
        () => {
          if (live) setLoaded((prev) => ({ ...prev, [repo.path]: { ok: false, error: 'Could not list the files' } }));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [workspace.repos]);

  const repos = useMemo<PaletteRepo[]>(
    () =>
      workspace.repos.map((repo) => {
        const list = loaded[repo.path];
        return {
          path: repo.path,
          name: repo.name,
          branch: repo.status ? repo.status.head : null,
          files: list === undefined ? null : list.ok ? list.files : [],
        };
      }),
    [workspace.repos, loaded],
  );
  const letters = useMemo(() => {
    const map = new Map<string, string>();
    for (const repo of workspace.repos) for (const file of repo.status?.files ?? []) map.set(`${repo.path}\n${file.path}`, fileLetter(file));
    return map;
  }, [workspace.repos]);

  const close = () => useApp.getState().showQuickOpen(false);
  return (
    <QuickOpenView
      repos={repos}
      recent={recent}
      letters={letters}
      onClose={close}
      onOpen={(pick, pin) => {
        useApp.getState().openInCenter({ kind: 'file', repoPath: pick.repoPath, path: pick.path }, pin);
        close();
        onOpened();
      }}
    />
  );
}
