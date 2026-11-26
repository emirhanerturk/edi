import { useEffect, useRef, useState } from 'react';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { useNow } from '../components/useNow';
import { useApp } from '../store';
import { useDiffTokens } from './DiffView';
import { type FileChangeView, FileHistoryPane, UNCOMMITTED } from './FileHistoryPane';
import { type CenterTarget, tabId } from './tabs';
import { useView, useVersion } from './useView';

const PAGE = 50;
const MAX = 5000;

/**
 * A file's history bound to app state. Read again when HEAD moves; the row for its uncommitted changes
 * follows the repo's status.
 */
export function FileHistoryView({ repo, path }: { repo: RepoView; path: string }) {
  const [limit, setLimit] = useState(PAGE);
  const head = repo.status?.headOid ?? '';
  const { data: history } = useView(`${repo.path}\n${path}\n${limit}`, () => edi.fileHistory(repo.path, path, limit), head);
  const uncommitted = repo.status?.files.some((file) => file.path === path) ?? false;
  const refreshedAt = useApp((s) => s.workspace.refreshedAt);
  const version = useVersion(refreshedAt, repo.status);
  const now = useNow(30_000);

  const [picked, setPicked] = useState<string | null>(null);
  const entries = history?.ok ? history.entries : [];
  const exists = (key: string | null) => key !== null && (key === UNCOMMITTED ? uncommitted : entries.some((entry) => entry.commit.oid === key));
  // The pick, while it is still in the list; else the uncommitted changes, else the newest commit.
  const selected = exists(picked) ? picked : uncommitted ? UNCOMMITTED : (entries[0]?.commit.oid ?? null);
  const entry = entries.find((candidate) => candidate.commit.oid === selected) ?? null;

  const { data: change } = useView<FileChangeView | null>(
    `${repo.path}\n${path}\n${selected ?? ''}`,
    async () => {
      if (selected === UNCOMMITTED) {
        const view = await edi.diff(repo.path, path);
        return view.ok ? { ok: true, diff: view.diff } : { ok: false, error: view.error };
      }
      return entry ? edi.fileChange(repo.path, entry.commit.oid, entry.path, entry.origPath) : null;
    },
    // A commit's change doesn't change; the uncommitted one is read again with the status.
    selected === UNCOMMITTED ? version : 0,
  );
  const tokens = useDiffTokens(change?.ok ? change.diff : null, entry?.path ?? path);

  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const name = path.slice(path.lastIndexOf('/') + 1);
  const info = history?.ok ? `${name} · ${entries.length}${history.hasMore ? '+' : ''} ${entries.length === 1 ? 'commit' : 'commits'}` : null;
  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);

  // What opens from here takes the preview tab: the history tab stays.
  const open = (target: CenterTarget) => {
    const app = useApp.getState();
    app.pinCenterTab(tabId({ kind: 'history', repoPath: repo.path, path }));
    app.openInCenter(target, false);
  };

  return (
    <FileHistoryPane
      repoName={repo.name}
      path={path}
      history={history}
      uncommitted={uncommitted}
      selected={selected}
      onSelect={setPicked}
      change={change}
      tokens={tokens}
      now={now}
      copied={copied}
      canLoadMore={history?.ok === true && history.hasMore && limit < MAX}
      onLoadMore={() => setLimit((current) => Math.min(current + PAGE, MAX))}
      onOpenFile={() => open({ kind: 'file', repoPath: repo.path, path })}
      onOpenIn={(editor) => void useApp.getState().openIn(editor, repo.path, path)}
      onOpenCommit={(oid) => open({ kind: 'commit', repoPath: repo.path, path: oid })}
      onOpenChanges={() => open({ kind: 'diff', repoPath: repo.path, path })}
      onCopy={(oid) => {
        void navigator.clipboard.writeText(oid).catch(() => undefined);
        setCopied(oid);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1500);
      }}
    />
  );
}
