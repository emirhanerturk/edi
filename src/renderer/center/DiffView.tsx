import { useEffect, useState } from 'react';
import type { ParsedDiff } from '../../git/diffParse';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { type DiffTokens, highlightDiff } from '../highlight/highlight';
import { useApp } from '../store';
import { DiffPane } from './DiffPane';
import { tabId } from './tabs';
import { useView, useVersion } from './useView';

/** Son renklendirme. Dosya değişince yenisi gelene kadar eskisi kalır; `Code` uyuşmayan satırda onu kullanmaz. */
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

/** Diff görünümünün uygulama durumuna bağlı hâli. Reponun her durum yoklamasında yenilenir. */
export function DiffView({ repo, path }: { repo: RepoView; path: string }) {
  const refreshedAt = useApp((s) => s.workspace.refreshedAt);
  const mode = useApp((s) => s.layout.diffMode);
  // Yoklama ya da bir git işlemi (commit, stage) repo durumunu yenileyince diff de yeniden okunur.
  const version = useVersion(refreshedAt, repo.status);
  const { data } = useView(`${repo.path}\n${path}`, () => edi.diff(repo.path, path), version);
  const tokens = useDiffTokens(data?.ok ? data.diff : null, path);
  const info = data?.ok && !data.diff.binary && data.diff.hunks.length > 0 ? `+${data.diff.added} −${data.diff.removed}` : null;

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
      onMode={(next) => useApp.getState().setDiffMode(next)}
      onOpenInZed={() => void useApp.getState().openInZed(repo.path, path)}
      onOpenFile={() => {
        // Yeni sekme önizleme sekmesinin yerine geçer: diff kaybolmasın diye önce o kalıcı olur.
        const app = useApp.getState();
        app.pinCenterTab(tabId({ kind: 'diff', repoPath: repo.path, path }));
        app.openInCenter({ kind: 'file', repoPath: repo.path, path }, false);
      }}
    />
  );
}
