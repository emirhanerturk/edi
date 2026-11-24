import { useEffect, useRef, useState } from 'react';
import type { DirEntry, DirList, FileList } from '../../git/types';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { ChevronDown, ChevronRight, FileIcon } from '../components/icons';
import { letterColor } from '../git/model';
import { useApp } from '../store';
import { type TreeRow, buildTree, flattenTree, insideIgnored } from './tree';
import './files.css';

/** Açık klasörlerin anahtarı: repo yolu ve klasörün repoya göre yolu (repo kökü için boş). */
export const dirKey = (repoPath: string, path: string) => `${repoPath}\n${path}`;

export interface FilesPanelViewProps {
  repos: RepoView[];
  /** Açık klasör tek bir repo: ağaç doğrudan onun içeriğiyle başlar. */
  single: boolean;
  /** Yüklenmiş dosya listeleri (repo yolu → liste); yüklenmemişse yoktur. */
  lists: Record<string, FileList>;
  /** Açılıp okunmuş yok sayılan klasörlerin içi (`dirKey` → tek seviye); okunuyorsa yoktur. */
  dirs: Record<string, DirList>;
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
export function FilesPanelView({ repos, single, lists, dirs, open, selected, onToggle, onOpenFile }: FilesPanelViewProps) {
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
    const tree = buildTree(list.files, repo.status?.files ?? [], list.ignored, loaded);
    const lines: Line[] = [];
    // "N more not shown" notu, yok sayılan klasörün son satırından sonra gelir.
    const pending: { depth: number; line: Line }[] = [];
    const flushTo = (depth: number) => {
      while (pending.length > 0 && pending[pending.length - 1]!.depth >= depth) lines.push(pending.pop()!.line);
    };
    for (const row of flattenTree(tree, (path) => open[dirKey(repo.path, path)] === true, depth)) {
      flushTo(row.depth);
      lines.push({ type: 'node', repo, row });
      const { node } = row;
      if (node.kind !== 'dir' || !row.open || !insideIgnored(node.path, list.ignored)) continue;
      // Yok sayılan klasörün içi açılınca okunur: okunurken, okunamazsa ve sınırı aşınca not.
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

  const renderLine = (line: Line) => {
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
          ignored={node.ignored}
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
        ignored={node.ignored}
        badge={node.letter ?? ''}
        selected={selected?.repoPath === repo.path && selected.path === node.path}
        onClick={() => onOpenFile(repo.path, node.path, false)}
        onDoubleClick={() => onOpenFile(repo.path, node.path, true)}
      />
    );
  };

  if (single) {
    return (
      <div className="git-list files-tree single" role="tree" aria-label="Files">
        {treeLines(repos[0]!, 0).map(renderLine)}
      </div>
    );
  }

  // Çok repolu görünüm: her repo, Git sekmesindeki gibi kendi bölümü; açık olan vurgulu.
  return (
    <div className="git-list files-tree" role="tree" aria-label="Files">
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
  /** `.gitignore`'a takılıyor: soluk. */
  ignored?: boolean;
  /** Dosyada durum harfi, klasörde "●"; yoksa boş. */
  badge: string;
  selected?: boolean;
  onClick(): void;
  onDoubleClick?(): void;
}

function TreeItem({ name, title, depth, kind, open, ignored = false, badge, selected, onClick, onDoubleClick }: TreeItemProps) {
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

/**
 * Değişince dosya listesi yeniden okunur: branch ve HEAD (branch değişimi, pull, commit temiz
 * repoda da dosyaları değiştirir) ve değişen dosyaların yolları (yeni ya da silinen dosya olabilir).
 */
const changeSignature = (repo: RepoView) =>
  [repo.status?.head ?? '', repo.status?.headOid ?? '', ...(repo.status?.files ?? []).map((file) => `${file.x}${file.y} ${file.path}`)].join('\n');

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
  const [dirs, setDirs] = useState<Record<string, DirList>>({});
  /** Okunan ya da okunmakta olan yok sayılan klasörler (`dirKey`); kapanınca silinir. */
  const dirsRead = useRef(new Set<string>());
  const { repos } = workspace;
  const single = repos.length === 1 && repos[0]!.path === workspace.dir;

  // Başka klasöre geçince eski listeler çizim sırasında atılır (React yeniden çizer, yükleme
  // etkisi temiz başlar); klasöre dönüldüğünde liste yeniden okunur.
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
          // Bu arada daha yeni bir yükleme başladıysa bu sonuç atılır.
          if (loaded.current.get(repo.path) === signature) setLists((prev) => ({ ...prev, [repo.path]: list }));
        },
        () => loaded.current.delete(repo.path),
      );
    }
  }, [repos, open, single]);

  // Yok sayılan bir klasör açılınca içi okunur; kapanınca unutulur, yeniden açılınca tazelenir.
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
            // Bu arada kapandıysa sonuç atılır.
            if (dirsRead.current.has(key)) setDirs((prev) => ({ ...prev, [key]: dir }));
          },
          () => dirsRead.current.delete(key),
        );
      }
    }
  }, [repos, lists, open]);

  const active = center.open ? (center.tabs.find((tab) => tab.id === center.active) ?? null) : null;
  const { toggleFilesDir, openInCenter } = useApp.getState();
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
    />
  );
}
