import { useCallback, useEffect, useState } from 'react';
import type { CommitDetail, RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { useNow } from '../components/useNow';
import { type DiffTokens, MAX_HIGHLIGHT_CHARS, highlightDiff } from '../highlight/highlight';
import { useApp } from '../store';
import { COLLAPSE_LINES, CommitPane } from './CommitPane';
import { tabId } from './tabs';
import { useView } from './useView';

/**
 * Highlights the commit's files in order. Files that start expanded (up to 400 lines) are highlighted
 * up to `MAX_HIGHLIGHT_CHARS` characters in total; the rest, and large files expanded later, stay plain.
 */
function useCommitTokens(commit: CommitDetail | null): Map<string, DiffTokens> {
  const [tokens, setTokens] = useState<Map<string, DiffTokens>>(() => new Map());
  useEffect(() => {
    if (!commit) return;
    let current = true;
    void (async () => {
      const next = new Map<string, DiffTokens>();
      let budget = MAX_HIGHLIGHT_CHARS;
      for (const file of commit.files) {
        const lines = file.diff.hunks.flatMap((hunk) => hunk.lines);
        if (file.diff.binary || lines.length === 0 || lines.length > COLLAPSE_LINES) continue;
        budget -= lines.reduce((sum, line) => sum + line.text.length + 1, 0);
        if (budget < 0) break;
        const result = await highlightDiff(file.diff, file.path);
        if (!current) return;
        if (result) {
          next.set(file.path, result);
          setTokens(new Map(next));
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [commit]);
  return tokens;
}

/** The commit view bound to app state. A commit doesn't change: it's read once. */
export function CommitView({ repo, oid }: { repo: RepoView; oid: string }) {
  const { data } = useView(`${repo.path}\n${oid}`, () => edi.commit(repo.path, oid), 0);
  const tokens = useCommitTokens(data?.ok ? data.commit : null);
  const now = useNow(30_000);
  const count = data?.ok ? data.commit.files.length : null;
  const info = count === null ? null : `${count} ${count === 1 ? 'file' : 'files'} changed`;

  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);
  // The commit tab stays; the file opens in the preview tab, as "Open file" does in the diff view.
  const openFile = useCallback(
    (path: string) => {
      const app = useApp.getState();
      app.pinCenterTab(tabId({ kind: 'commit', repoPath: repo.path, path: oid }));
      app.openInCenter({ kind: 'file', repoPath: repo.path, path }, false);
    },
    [repo.path, oid],
  );

  return (
    <CommitPane
      repoName={repo.name}
      branch={repo.status?.head ?? null}
      result={data}
      now={now}
      tokens={tokens}
      onCopy={() => {
        if (data?.ok) void navigator.clipboard.writeText(data.commit.oid).catch(() => undefined);
      }}
      onOpenUrl={(url) => void edi.openUrl(url)}
      onOpenFile={openFile}
    />
  );
}
