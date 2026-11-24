import { useEffect, useMemo, useState } from 'react';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { type Token, highlightLines } from '../highlight/highlight';
import { useApp } from '../store';
import { FilePane, fileInfo } from './FilePane';
import { useView, useVersion } from './useView';

/** Last highlighting; when the text changes, the old one stays until the new one arrives (`Code` doesn't use it on a mismatched line). */
function useFileTokens(text: string | null, path: string): Token[][] | null {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  useEffect(() => {
    if (text === null) return;
    let current = true;
    void highlightLines(text, path).then((next) => {
      if (current) setTokens(next);
    });
    return () => {
      current = false;
    };
  }, [text, path]);
  return tokens;
}

/** The file view bound to app state. Reread on every status poll of the repo. */
export function FileView({ repo, path }: { repo: RepoView; path: string }) {
  const refreshedAt = useApp((s) => s.workspace.refreshedAt);
  const version = useVersion(refreshedAt, repo.status);
  const { data } = useView(`${repo.path}\n${path}`, () => edi.readFile(repo.path, path), version);
  const text = data?.ok && data.kind === 'text' ? data.text : null;
  const tokens = useFileTokens(text, path);
  const isNew = repo.status?.files.some((file) => file.path === path && file.kind === 'untracked') ?? false;
  // The text is split to count lines: only when the data changes.
  const info = useMemo(() => fileInfo(path, data), [path, data]);

  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);

  return (
    <FilePane
      repoName={repo.name}
      repoPath={repo.path}
      path={path}
      content={data}
      isNew={isNew}
      tokens={tokens}
      onOpenInZed={() => void useApp.getState().openInZed(repo.path, path)}
    />
  );
}
