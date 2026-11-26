import { useEffect, useMemo, useState } from 'react';
import type { ParsedDiff } from '../../git/diffParse';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { type DiffTokens, highlightDiff } from '../highlight/highlight';
import { useApp } from '../store';
import { DiffPane } from './DiffPane';
import { workingMedia } from './media';
import { tabId } from './tabs';
import { useView, useVersion } from './useView';

/** Last highlighting. When the file changes, the old one stays until the new one arrives; `Code` doesn't use it on a mismatched line. */
function useDiffTokens(diff: ParsedDiff | null, path: string): DiffTokens | null {
  const [tokens, setTokens] = useState<DiffTokens | null>(null);
  useEffect(() => {
    if (!diff) return;
    let current = true;
    void highlightDiff(diff, path).then((next) => {
      if (current) setTokens(next);
    });
    return () => {
      current = false;
    };
  }, [diff, path]);
  return tokens;
}

/** The diff view bound to app state. Refreshed on every status poll of the repo. */
export function DiffView({ repo, path }: { repo: RepoView; path: string }) {
  const refreshedAt = useApp((s) => s.workspace.refreshedAt);
  const mode = useApp((s) => s.layout.diffMode);
  // When a poll or a git operation (commit, stage) refreshes the repo status, the diff is reread too.
  const version = useVersion(refreshedAt, repo.status);
  const { data } = useView(`${repo.path}\n${path}`, () => edi.diff(repo.path, path), version);
  const tokens = useDiffTokens(data?.ok ? data.diff : null, path);
  const info = data?.ok && !data.diff.binary && data.diff.hunks.length > 0 ? `+${data.diff.added} −${data.diff.removed}` : null;
  const headOid = repo.status?.headOid ?? null;
  const file = data?.ok && data.diff.binary ? data.file : null;
  // The image or video in HEAD and on disk; the version moves with every status read, as the diff's does.
  const media = useMemo(() => (file ? workingMedia(repo.path, headOid, file, version) : null), [file, repo.path, headOid, version]);

  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);

  return (
    <DiffPane
      repoName={repo.name}
      path={path}
      view={data}
      mode={mode}
      tokens={tokens}
      media={media}
      onMode={(next) => useApp.getState().setDiffMode(next)}
      onOpenIn={(editor) => void useApp.getState().openIn(editor, repo.path, path)}
      onOpenFile={() => {
        // The new tab replaces the preview tab: so the diff isn't lost, that one is pinned first.
        const app = useApp.getState();
        app.pinCenterTab(tabId({ kind: 'diff', repoPath: repo.path, path }));
        app.openInCenter({ kind: 'file', repoPath: repo.path, path }, false);
      }}
    />
  );
}
