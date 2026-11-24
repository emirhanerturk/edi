import { useEffect, useState } from 'react';
import type { CommitDetail, RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { useNow } from '../components/useNow';
import { type DiffTokens, MAX_HIGHLIGHT_CHARS, highlightDiff } from '../highlight/highlight';
import { useApp } from '../store';
import { COLLAPSE_LINES, CommitPane } from './CommitPane';
import { useView } from './useView';

/**
 * Commit'in dosyalarını sırayla renklendirir. Açık başlayan (400 satıra kadar) dosyalar, toplamda
 * `MAX_HIGHLIGHT_CHARS` karaktere kadar renklenir; kalanı ve sonradan açılan büyük dosyalar düz kalır.
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

/** Commit görünümünün uygulama durumuna bağlı hâli. Commit değişmez: bir kez okunur. */
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
    />
  );
}
