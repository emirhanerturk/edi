import { useEffect, useRef, useState } from 'react';
import type { FileList } from '../../git/types';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { ChevronDown, ChevronRight, FileIcon } from '../components/icons';
import { letterColor } from '../git/model';
import { useApp } from '../store';
import { type TreeRow, buildTree, flattenTree } from './tree';
import './files.css';

/** Açık klasörlerin anahtarı: repo yolu ve klasörün repoya göre yolu (repo kökü için boş). */
export const dirKey = (repoPath: string, path: string) => `${repoPath}\n${path}`;

export interface FilesPanelViewProps {
  repos: RepoView[];
  /** Açık klasör tek bir repo: ağaç doğrudan onun içeriğiyle başlar. */
  single: boolean;
  /** Yüklenmiş dosya listeleri (repo yolu → liste); yüklenmemişse yoktur. */
  lists: Record<string, FileList>;
  open: Record<string, boolean>;
  /** Orta panelde açık olan dosya. */
  selected: { repoPath: string; path: string } | null;
  onToggle(key: string, open: boolean): void;
  onOpenFile(repoPath: string, path: string, pin: boolean): void;
}

type Line =
  | { type: 'repo'; repo: RepoView; open: boolean }
  | { type: 'node'; repo: RepoView; row: TreeRow }
  | { type: 'note'; key: string; text: string; error: boolean; depth: number };

/** Files sekmesi: her repo bir üst klasör; içinde çalışma ağacı, değişen dosyalar işaretli. */
export function FilesPanelView({ repos, single, lists, open, selected, onToggle, onOpenFile }: FilesPanelViewProps) {
  if (repos.length === 0) {
    return (
      <div className="git-list">
        <p className="git-empty">No git repositories in this folder</p>
      </div>
    );
  }

  const lines: Line[] = [];
  const addTree = (repo: RepoView, depth: number) => {
    const list = lists[repo.path];
    if (!list) lines.push({ type: 'note', key: `${repo.path}:loading`, text: 'Loading…', error: false, depth });
    else if (!list.ok) lines.push({ type: 'note', key: `${repo.path}:error`, text: list.error, error: true, depth });
    else {
      const tree = buildTree(list.files, repo.status?.files ?? []);
      for (const row of flattenTree(tree, (path) => open[dirKey(repo.path, path)] === true, depth)) lines.push({ type: 'node', repo, row });
    }
  };
  if (single) addTree(repos[0]!, 0);
  else {
    for (const repo of repos) {
      const isOpen = open[dirKey(repo.path, '')] === true;
      lines.push({ type: 'repo', repo, open: isOpen });
      if (isOpen) addTree(repo, 1);
    }
  }

  return (
    <div className="git-list files-tree" role="tree" aria-label="Files">
      {lines.map((line) => {
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
              badge={node.dirty ? '●' : ''}
              onClick={() => onToggle(dirKey(repo.path, node.path), !row.open)}
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
            badge={node.letter ?? ''}
            selected={selected?.repoPath === repo.path && selected.path === node.path}
            onClick={() => onOpenFile(repo.path, node.path, false)}
            onDoubleClick={() => onOpenFile(repo.path, node.path, true)}
          />
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
  /** Dosyada durum harfi, klasörde "●"; yoksa boş. */
  badge: string;
  selected?: boolean;
  onClick(): void;
  onDoubleClick?(): void;
}

function TreeItem({ name, title, depth, kind, open, badge, selected, onClick, onDoubleClick }: TreeItemProps) {
  const isFile = kind === 'file';
  const color = isFile && badge !== '' ? letterColor(badge) : undefined;
  return (
    <div
      className={`tree-row ${kind}${selected ? ' selected' : ''}`}
      data-testid="tree-row"
      data-depth={depth}
      data-name={name}
      data-badge={badge}
      role="treeitem"
      tabIndex={0}
      aria-expanded={isFile ? undefined : open}
      aria-current={selected ? 'true' : undefined}
      aria-selected={isFile ? selected === true : undefined}
      title={title ?? name}
      style={{ paddingLeft: indent(depth) }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onClick();
      }}
    >
      {isFile ? (
        <FileIcon size={12} className="tree-icon" />
      ) : open ? (
        <ChevronDown size={11} strokeWidth={1.9} className="tree-icon" />
      ) : (
        <ChevronRight size={11} strokeWidth={1.9} className="tree-icon" />
      )}
      <span className="tree-name" style={color ? { color } : undefined}>
        {name}
      </span>
      {badge !== '' && (
        <span className="tree-badge mono" style={{ color: isFile ? color : 'var(--yellow)' }}>
          {badge}
        </span>
      )}
    </div>
  );
}

/** Değişen dosyaların yolları: değişince dosya listesi yeniden okunur (yeni ya da silinen dosya olabilir). */
const changeSignature = (repo: RepoView) => (repo.status?.files ?? []).map((file) => `${file.x}${file.y} ${file.path}`).join('\n');

/**
 * Files sekmesinin uygulama durumuna bağlı hâli. Bir reponun dosya listesi, klasörü ilk açıldığında
 * yüklenir; değişiklik listesi değiştikçe ve sekme yeniden gösterildiğinde tazelenir.
 */
export function FilesPanel() {
  const workspace = useApp((s) => s.workspace);
  const open = useApp((s) => s.filesOpen);
  const center = useApp((s) => s.center);
  const [lists, setLists] = useState<Record<string, FileList>>({});
  const loaded = useRef(new Map<string, string>());
  const { repos } = workspace;
  const single = repos.length === 1 && repos[0]!.path === workspace.dir;

  useEffect(() => {
    for (const repo of repos) {
      const wanted = single || open[dirKey(repo.path, '')] === true;
      const signature = changeSignature(repo);
      if (!wanted || loaded.current.get(repo.path) === signature) continue;
      loaded.current.set(repo.path, signature);
      void edi.listFiles(repo.path).then(
        (list) => {
          // Bu arada daha yeni bir yükleme başladıysa bu sonuç atılır.
          if (loaded.current.get(repo.path) === signature) setLists((prev) => ({ ...prev, [repo.path]: list }));
        },
        () => loaded.current.delete(repo.path),
      );
    }
  }, [repos, open, single]);

  const active = center.open ? (center.tabs.find((tab) => tab.id === center.active) ?? null) : null;
  const { toggleFilesDir, openInCenter } = useApp.getState();
  return (
    <FilesPanelView
      repos={repos}
      single={single}
      lists={lists}
      open={open}
      selected={active && { repoPath: active.repoPath, path: active.path }}
      onToggle={toggleFilesDir}
      onOpenFile={(repoPath, path, pin) => openInCenter({ kind: 'file', repoPath, path }, pin)}
    />
  );
}
