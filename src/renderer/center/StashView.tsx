import { useCallback, useEffect } from 'react';
import type { CommitFile, RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { useNow } from '../components/useNow';
import { useApp } from '../store';
import { useCommitTokens } from './CommitView';
import { commitMedia } from './media';
import { StashPane } from './StashPane';
import { useView } from './useView';

/**
 * The stash view bound to app state. A stash's changes don't change, but it can leave the list (popped
 * or dropped from a terminal) or get a new message: it is read again whenever the repo's stash count
 * moves and when an operation in the repo starts or ends.
 */
export function StashView({ repo, oid }: { repo: RepoView; oid: string }) {
  const count = repo.status?.stashes ?? 0;
  const { data } = useView(`${repo.path}\n${oid}`, () => edi.stash(repo.path, oid), `${count}\n${repo.busy ?? ''}`);
  const stash = data?.ok ? data.stash : null;
  const tokens = useCommitTokens(stash);
  const now = useNow(30_000);
  const files = stash?.files.length ?? null;
  const info = files === null ? null : `${files} ${files === 1 ? 'file' : 'files'} stashed`;

  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);
  // A stash keeps the files that were new (untracked) in its third parent.
  const media = useCallback((file: CommitFile) => commitMedia(repo.path, oid, file, file.untracked ? `${oid}^3` : oid), [repo.path, oid]);

  return (
    <StashPane
      media={media}
      repoName={repo.name}
      result={data}
      now={now}
      tokens={tokens}
      busy={repo.busy}
      canApply={!(repo.status?.files.some((file) => file.kind === 'conflicted') ?? false)}
      onAction={(action) => {
        if (stash) void useApp.getState().stashAction(repo.path, stash.entry, action);
      }}
      onRename={(message) => {
        if (stash) void useApp.getState().renameStash(repo.path, stash.entry, message);
      }}
      onCopy={() => {
        if (stash) void navigator.clipboard.writeText(stash.entry.oid).catch(() => undefined);
      }}
    />
  );
}
