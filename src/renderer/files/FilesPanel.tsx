import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { DirEntry, DirList, FileList } from '../../git/types';
import type { FilesMenuKind, RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { FilePlus, Folder, FolderOpen, FolderPlus } from 'lucide-react';
import { ChevronDown, ChevronRight } from '../components/icons';
import { FileTypeIcon } from './fileIcons';
import { type FilesEdit, unsavedUnder } from './filesEdit';
import { letterColor } from '../git/model';
import { useApp } from '../store';
import { type TreeRow, buildTree, flattenTree, insideIgnored } from './tree';
import './files.css';

/** Key for open folders: the repo path and the folder's path relative to the repo (empty for the repo root). */
export const dirKey = (repoPath: string, path: string) => `${repoPath}\n${path}`;

export interface FilesPanelViewProps {
  repos: RepoView[];
  /** The open folder is a single repo: the tree starts directly with its contents. */
  single: boolean;
  /** Loaded file lists (repo path → list); absent if not loaded. */
  lists: Record<string, FileList>;
  /** Contents of ignored folders that were expanded and read (`dirKey` → one level); absent while reading. */
  dirs: Record<string, DirList>;
  open: Record<string, boolean>;
  /** The file open in the center panel. */
  selected: { repoPath: string; path: string } | null;
  onToggle(key: string, open: boolean): void;
  onOpenFile(repoPath: string, path: string, pin: boolean): void;
  /** A name being typed: a new file or folder in `parent` ('' is the repo root), or a rename. */
  edit?: FilesEdit | null;
  /** Why the last name was refused; shown under the input. */
  editError?: string | null;
  /** The New File / New Folder buttons on a repo or folder row. */
  onNew?(repoPath: string, parent: string, kind: 'file' | 'dir'): void;
  /** Right-click on a row ('' is the repo itself). */
  onRowMenu?(repoPath: string, path: string, kind: FilesMenuKind): void;
  onSubmitName?(name: string): void;
  onCancelEdit?(): void;
  /** ⌘⌫ on a file or folder row. */
  onTrash?(repoPath: string, path: string): void;
  /** F2 on a file or folder row. */
  onRename?(repoPath: string, path: string): void;
  /** The last failed file operation (moving to the Trash, Finder); clicking it dismisses it. */
  notice?: string | null;
  onDismissNotice?(): void;
}


type Line =
  | { type: 'repo'; repo: RepoView; open: boolean }
  | { type: 'node'; repo: RepoView; row: TreeRow }
  | { type: 'note'; key: string; text: string; error: boolean; depth: number }
  | { type: 'input'; key: string; kind: 'file' | 'dir'; depth: number };

/** Files tab: each repo is a top-level folder holding its working tree, with changed files marked. */
export function FilesPanelView(props: FilesPanelViewProps) {
  const { repos, single, lists, dirs, open, selected, onToggle, onOpenFile, edit = null, editError = null } = props;
  if (repos.length === 0) {
    return (
      <div className="git-list">
        <p className="git-empty">No git repositories in this folder</p>
      </div>
    );
  }

  const treeLines = (repo: RepoView, depth: number): Line[] => {
    const list = lists[repo.path];
    if (!list) return [{ type: 'note', key: `${repo.path}:loading`, text: 'Loading…', error: false, depth }];
    if (!list.ok) return [{ type: 'note', key: `${repo.path}:error`, text: list.error, error: true, depth }];
    const prefix = dirKey(repo.path, '');
    const loaded: Record<string, DirEntry[]> = {};
    for (const [key, dir] of Object.entries(dirs)) {
      if (key.startsWith(prefix) && dir.ok) loaded[key.slice(prefix.length)] = dir.entries;
    }
    const tree = buildTree(list.files, repo.status?.files ?? [], list.ignored, loaded, list.dirs);
    const lines: Line[] = [];
    const newHere = (parent: string, at: number) => {
      if (edit?.mode === 'new' && edit.repoPath === repo.path && edit.parent === parent) {
        lines.push({ type: 'input', key: `${repo.path}:new`, kind: edit.kind, depth: at });
        if (editError) lines.push({ type: 'note', key: `${repo.path}:new-error`, text: editError, error: true, depth: at });
      }
    };
    newHere('', depth);
    // The "N more not shown" note comes after the ignored folder's last row.
    const pending: { depth: number; line: Line }[] = [];
    const flushTo = (depth: number) => {
      while (pending.length > 0 && pending[pending.length - 1]!.depth >= depth) lines.push(pending.pop()!.line);
    };
    for (const row of flattenTree(tree, (path) => open[dirKey(repo.path, path)] === true, depth)) {
      flushTo(row.depth);
      lines.push({ type: 'node', repo, row });
      const { node } = row;
      if (node.kind === 'dir' && row.open) newHere(node.path, row.depth + 1);
      if (edit?.mode === 'rename' && edit.repoPath === repo.path && edit.path === node.path && editError) {
        lines.push({ type: 'note', key: `${repo.path}:rename-error`, text: editError, error: true, depth: row.depth });
      }
      if (node.kind !== 'dir' || !row.open || !insideIgnored(node.path, list.ignored)) continue;
      // An ignored folder's contents are read when it's expanded: a note while reading, if reading fails and when over the limit.
      const key = dirKey(repo.path, node.path);
      const dir = dirs[key];
      const noteDepth = row.depth + 1;
      if (!dir) lines.push({ type: 'note', key: `${key}:loading`, text: 'Loading…', error: false, depth: noteDepth });
      else if (!dir.ok) lines.push({ type: 'note', key: `${key}:error`, text: dir.error, error: true, depth: noteDepth });
      else if (dir.more > 0) {
        const text = `${dir.more.toLocaleString('en-US')} more not shown`;
        pending.push({ depth: row.depth, line: { type: 'note', key: `${key}:more`, text, error: false, depth: noteDepth } });
      }
    }
    flushTo(-1);
    return lines;
  };

  const nameInput = (label: string, initial: string, selectTo: number) => (
    <NameInput
      label={label}
      initial={initial}
      selectTo={selectTo}
      onSubmit={(name) => props.onSubmitName?.(name)}
      onCancel={() => props.onCancelEdit?.()}
    />
  );
  const renaming = (repo: RepoView, path: string) => edit?.mode === 'rename' && edit.repoPath === repo.path && edit.path === path;
  const renameInput = (name: string) => {
    const dot = name.lastIndexOf('.');
    return nameInput(`Rename ${name}`, name, dot > 0 ? dot : name.length);
  };

  const notice = props.notice ? (
    <p className="tree-note error files-notice" role="alert" title="Dismiss" onClick={() => props.onDismissNotice?.()}>
      {props.notice}
    </p>
  ) : null;

  const renderLine = (line: Line) => {
    if (line.type === 'input') {
      return (
        <div key={line.key} className="tree-row name-input-row" data-testid="name-input-row" style={{ paddingLeft: indent(line.depth) }}>
          <span className="tree-spacer" />
          {line.kind === 'dir' ? <Folder size={13} strokeWidth={1.6} className="tree-icon folder" aria-hidden="true" /> : <FileTypeIcon name="" className="tree-icon" />}
          {nameInput(line.kind === 'dir' ? 'New folder name' : 'New file name', '', 0)}
        </div>
      );
    }
    if (line.type === 'note') {
      return (
        <p key={line.key} className={`tree-note${line.error ? ' error' : ''}`} style={{ paddingLeft: indent(line.depth) + 17 }}>
          {line.text}
        </p>
      );
    }
    if (line.type === 'repo') {
      const { repo } = line;
      const dirty = (repo.status?.files.length ?? 0) > 0;
      return (
        <TreeItem
          key={repo.path}
          name={repo.name}
          depth={0}
          kind="repo"
          open={line.open}
          badge={dirty ? '●' : ''}
          onClick={() => onToggle(dirKey(repo.path, ''), !line.open)}
          onNew={props.onNew && ((kind) => props.onNew!(repo.path, '', kind))}
          onMenu={props.onRowMenu && (() => props.onRowMenu!(repo.path, '', 'repo'))}
        />
      );
    }
    const { repo, row } = line;
    const { node } = row;
    if (node.kind === 'dir') {
      return (
        <TreeItem
          key={`${repo.path}\n${node.path}`}
          name={node.name}
          depth={row.depth}
          kind="dir"
          open={row.open}
          ignored={node.ignored}
          badge={node.dirty ? '●' : ''}
          onClick={() => onToggle(dirKey(repo.path, node.path), !row.open)}
          onNew={props.onNew && ((kind) => props.onNew!(repo.path, node.path, kind))}
          onMenu={props.onRowMenu && (() => props.onRowMenu!(repo.path, node.path, 'dir'))}
          onTrash={props.onTrash && (() => props.onTrash!(repo.path, node.path))}
          onRename={props.onRename && (() => props.onRename!(repo.path, node.path))}
          nameEditor={renaming(repo, node.path) ? renameInput(node.name) : undefined}
        />
      );
    }
    return (
      <TreeItem
        key={`${repo.path}\n${node.path}`}
        name={node.name}
        title={node.path}
        depth={row.depth}
        kind="file"
        ignored={node.ignored}
        badge={node.letter ?? ''}
        selected={selected?.repoPath === repo.path && selected.path === node.path}
        onClick={() => onOpenFile(repo.path, node.path, false)}
        onDoubleClick={() => onOpenFile(repo.path, node.path, true)}
        onMenu={props.onRowMenu && (() => props.onRowMenu!(repo.path, node.path, 'file'))}
        onTrash={props.onTrash && (() => props.onTrash!(repo.path, node.path))}
        onRename={props.onRename && (() => props.onRename!(repo.path, node.path))}
        nameEditor={renaming(repo, node.path) ? renameInput(node.name) : undefined}
      />
    );
  };

  if (single) {
    return (
      <div className="git-list files-tree single" role="tree" aria-label="Files">
        {notice}
        {treeLines(repos[0]!, 0).map(renderLine)}
      </div>
    );
  }

  // Multi-repo view: each repo is its own section, as in the Git tab; the open one is highlighted.
  return (
    <div className="git-list files-tree" role="tree" aria-label="Files">
      {notice}
      {repos.map((repo) => {
        const isOpen = open[dirKey(repo.path, '')] === true;
        return (
          <div key={repo.path} className={`files-repo${isOpen ? ' open' : ''}`} data-testid="files-repo" data-repo={repo.name}>
            {renderLine({ type: 'repo', repo, open: isOpen })}
            {isOpen && treeLines(repo, 1).map(renderLine)}
          </div>
        );
      })}
    </div>
  );
}

const indent = (depth: number) => 12 + depth * 16;

interface TreeItemProps {
  name: string;
  title?: string;
  depth: number;
  kind: 'repo' | 'dir' | 'file';
  open?: boolean;
  /** Matched by `.gitignore`: dimmed. */
  ignored?: boolean;
  /** Status letter on a file, "●" on a folder; empty if none. */
  badge: string;
  selected?: boolean;
  onClick(): void;
  onDoubleClick?(): void;
  /** Repo and folder rows: the New File / New Folder buttons, shown on hover. */
  onNew?(kind: 'file' | 'dir'): void;
  onMenu?(): void;
  onTrash?(): void;
  onRename?(): void;
  /** Shown in place of the name while renaming. */
  nameEditor?: ReactNode;
}

function TreeItem(props: TreeItemProps) {
  const { name, title, depth, kind, open, ignored = false, badge, selected, onClick, onDoubleClick, onNew, nameEditor } = props;
  const isFile = kind === 'file';
  const color = isFile && badge !== '' ? letterColor(badge) : undefined;
  return (
    <div
      className={`tree-row ${kind}${selected ? ' selected' : ''}${ignored ? ' ignored' : ''}`}
      data-testid="tree-row"
      data-depth={depth}
      data-name={name}
      data-badge={badge}
      data-ignored={ignored ? 'true' : undefined}
      role="treeitem"
      tabIndex={0}
      aria-expanded={isFile ? undefined : open}
      aria-current={selected ? 'true' : undefined}
      aria-selected={isFile ? selected === true : undefined}
      title={ignored ? `${title ?? name} (ignored by git)` : (title ?? name)}
      style={{ paddingLeft: kind === 'repo' ? 10 : indent(depth) }}
      onClick={nameEditor ? undefined : onClick}
      onDoubleClick={nameEditor ? undefined : onDoubleClick}
      onContextMenu={
        props.onMenu &&
        ((event) => {
          event.preventDefault();
          props.onMenu!();
        })
      }
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          onClick();
        } else if (event.key === 'Backspace' && event.metaKey && props.onTrash) {
          event.preventDefault();
          props.onTrash();
        } else if (event.key === 'F2' && props.onRename) {
          event.preventDefault();
          props.onRename();
        }
      }}
    >
      {isFile ? (
        <>
          {/* Where a folder has its chevron: file and folder icons line up. */}
          <span className="tree-spacer" />
          <FileTypeIcon name={name} className="tree-icon" />
        </>
      ) : open ? (
        <ChevronDown size={11} strokeWidth={1.9} className="tree-icon" />
      ) : (
        <ChevronRight size={11} strokeWidth={1.9} className="tree-icon" />
      )}
      {kind === 'dir' &&
        (open ? <FolderOpen size={13} strokeWidth={1.6} className="tree-icon folder" aria-hidden="true" /> : <Folder size={13} strokeWidth={1.6} className="tree-icon folder" aria-hidden="true" />)}
      {nameEditor ?? (
        <span className="tree-name" style={color ? { color } : undefined}>
          {name}
        </span>
      )}
      {onNew && !nameEditor && (
        <span className="tree-actions">
          <button
            className="icon-button tiny"
            aria-label="New File"
            title="New File"
            onClick={(event) => {
              event.stopPropagation();
              onNew('file');
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <FilePlus size={12} strokeWidth={1.7} />
          </button>
          <button
            className="icon-button tiny"
            aria-label="New Folder"
            title="New Folder"
            onClick={(event) => {
              event.stopPropagation();
              onNew('dir');
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <FolderPlus size={12} strokeWidth={1.7} />
          </button>
        </span>
      )}
      {badge !== '' && !nameEditor && (
        <span className="tree-badge mono" style={{ color: isFile ? color : 'var(--yellow)' }}>
          {badge}
        </span>
      )}
    </div>
  );
}

interface NameInputProps {
  label: string;
  initial: string;
  /** The end of the initial selection (a rename selects the name before its extension). */
  selectTo: number;
  onSubmit(name: string): void;
  onCancel(): void;
}

/** The inline name field: Enter submits, Escape or clicking away cancels. */
function NameInput({ label, initial, selectTo, onSubmit, onCancel }: NameInputProps) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current!;
    element.focus();
    element.setSelectionRange(0, selectTo);
  }, [selectTo]);
  return (
    <input
      ref={input}
      className="tree-name-input"
      aria-label={label}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          if (value.trim() !== '') onSubmit(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}

/**
 * When it changes, the file list is reread: branch and HEAD (a branch switch, pull or commit changes
 * files even in a clean repo) and the paths of changed files (there may be new or deleted files).
 */
const changeSignature = (repo: RepoView) =>
  [repo.status?.head ?? '', repo.status?.headOid ?? '', ...(repo.status?.files ?? []).map((file) => `${file.x}${file.y} ${file.path}`)].join('\n');

/**
 * The Files tab bound to app state. A repo's file list loads the first time its folder is
 * expanded; it's refreshed whenever the change list changes and when the tab is shown again.
 */
export function FilesPanel() {
  const workspace = useApp((s) => s.workspace);
  const open = useApp((s) => s.filesOpen);
  const center = useApp((s) => s.center);
  const [lists, setLists] = useState<Record<string, FileList>>({});
  const loaded = useRef(new Map<string, string>());
  const [reloads, setReloads] = useState(0);
  const [dirs, setDirs] = useState<Record<string, DirList>>({});
  /** Ignored folders read or being read (`dirKey`); removed on collapse. */
  const dirsRead = useRef(new Set<string>());
  const { repos } = workspace;
  const single = repos.length === 1 && repos[0]!.path === workspace.dir;

  // When switching to another folder, the old lists are dropped during render (React rerenders, the load
  // effect starts clean); when returning to the folder, the list is reread.
  const [listsDir, setListsDir] = useState(workspace.dir);
  if (listsDir !== workspace.dir) {
    setListsDir(workspace.dir);
    setLists({});
    loaded.current.clear();
    setDirs({});
    dirsRead.current.clear();
  }

  useEffect(() => {
    for (const repo of repos) {
      const wanted = single || open[dirKey(repo.path, '')] === true;
      const signature = changeSignature(repo);
      if (!wanted || loaded.current.get(repo.path) === signature) continue;
      loaded.current.set(repo.path, signature);
      void edi.listFiles(repo.path).then(
        (list) => {
          // If a newer load started in the meantime, this result is dropped.
          if (loaded.current.get(repo.path) === signature) setLists((prev) => ({ ...prev, [repo.path]: list }));
        },
        () => loaded.current.delete(repo.path),
      );
    }
  }, [repos, open, single, reloads]);

  // When an ignored folder is expanded, its contents are read; on collapse they're forgotten, and refreshed when expanded again.
  useEffect(() => {
    for (const key of [...dirsRead.current]) {
      if (open[key] === true) continue;
      dirsRead.current.delete(key);
      setDirs(({ [key]: _gone, ...rest }) => rest);
    }
    for (const repo of repos) {
      const list = lists[repo.path];
      if (!list?.ok) continue;
      const prefix = dirKey(repo.path, '');
      for (const [key, isOpen] of Object.entries(open)) {
        if (!isOpen || !key.startsWith(prefix) || dirsRead.current.has(key)) continue;
        const path = key.slice(prefix.length);
        if (path === '' || !insideIgnored(path, list.ignored)) continue;
        dirsRead.current.add(key);
        void edi.listDir(repo.path, path).then(
          (dir) => {
            // If it collapsed in the meantime, the result is dropped.
            if (dirsRead.current.has(key)) setDirs((prev) => ({ ...prev, [key]: dir }));
          },
          () => dirsRead.current.delete(key),
        );
      }
    }
  }, [repos, lists, open]);

  const active = center.open ? (center.tabs.find((tab) => tab.id === center.active) ?? null) : null;
  const { toggleFilesDir, openInCenter, startFilesEdit, endFilesEdit, moveFileTabs } = useApp.getState();

  const edit = useApp((s) => s.filesEdit);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // While a name is being saved, clicking away (or a question dialog taking focus) doesn't cancel it.
  const submitting = useRef(false);
  useEffect(() => setEditError(null), [edit]);
  /** An empty new folder or a renamed one may not change the status: the list is read again by hand. */
  const reload = (repoPath: string) => {
    loaded.current.delete(repoPath);
    setReloads((count) => count + 1);
  };
  const unsaved = (repoPath: string, path: string) => {
    const state = useApp.getState();
    return unsavedUnder(state.center.tabs, state.unsaved, repoPath, path);
  };

  const submit = async (name: string) => {
    const current = useApp.getState().filesEdit;
    if (!current || submitting.current) return;
    submitting.current = true;
    try {
      if (current.mode === 'new') {
        const path = current.parent === '' ? name : `${current.parent}/${name}`;
        const result = await edi.createEntry(current.repoPath, path, current.kind);
        if (!result.ok) return setEditError(result.error);
        endFilesEdit();
        reload(current.repoPath);
        if (current.kind === 'file') openInCenter({ kind: 'file', repoPath: current.repoPath, path: result.path }, true);
        return;
      }
      if (name === current.path.slice(current.path.lastIndexOf('/') + 1)) return endFilesEdit();
      const result = await edi.renameEntry(current.repoPath, current.path, name, unsaved(current.repoPath, current.path));
      if (!result.ok) return result.cancelled ? endFilesEdit() : setEditError(result.error);
      endFilesEdit();
      moveFileTabs(current.repoPath, current.path, result.path);
      reload(current.repoPath);
    } finally {
      submitting.current = false;
    }
  };

  const trash = async (repoPath: string, path: string) => {
    setNotice(null);
    const result = await edi.trashEntry(repoPath, path, unsaved(repoPath, path));
    if (result.ok) {
      moveFileTabs(repoPath, path, null);
      reload(repoPath);
    } else if (!result.cancelled) setNotice(result.error);
  };

  const rowMenu = async (repoPath: string, path: string, kind: FilesMenuKind) => {
    const action = await edi.filesMenu(kind);
    if (action === 'newFile' || action === 'newFolder') startFilesEdit({ mode: 'new', kind: action === 'newFile' ? 'file' : 'dir', repoPath, parent: path });
    else if (action === 'rename') startFilesEdit({ mode: 'rename', repoPath, path });
    else if (action === 'trash') await trash(repoPath, path);
    else if (action === 'reveal') {
      const result = await edi.revealEntry(repoPath, path);
      if (!result.ok) setNotice(result.error);
    }
  };

  return (
    <FilesPanelView
      repos={repos}
      single={single}
      lists={lists}
      dirs={dirs}
      open={open}
      selected={active && { repoPath: active.repoPath, path: active.path }}
      onToggle={toggleFilesDir}
      onOpenFile={(repoPath, path, pin) => openInCenter({ kind: 'file', repoPath, path }, pin)}
      edit={edit}
      editError={editError}
      onNew={(repoPath, parent, kind) => startFilesEdit({ mode: 'new', kind, repoPath, parent })}
      onRowMenu={(repoPath, path, kind) => void rowMenu(repoPath, path, kind)}
      onSubmitName={(name) => void submit(name)}
      onCancelEdit={() => {
        if (!submitting.current) endFilesEdit();
      }}
      onTrash={(repoPath, path) => void trash(repoPath, path)}
      onRename={(repoPath, path) => startFilesEdit({ mode: 'rename', repoPath, path })}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    />
  );
}
