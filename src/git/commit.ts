// Tek bir commit'in bilgilerini, değişen dosyalarını ve diff'lerini okur. Yalnız okur.
import { parseDiff } from './diffParse.js';
import { runGit } from './exec.js';
import { PINNED, SUMMARY_FORMAT, parseSummary } from './log.js';
import type { CommitDetail, CommitFile, CommitResult } from './types.js';

export type { CommitDetail, CommitFile, CommitResult };

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const UNREADABLE = 'Could not read this commit';

/**
 * Çok dosyalı bir patch'i `diff --git` bölümlerine ayırır. Hunk içindeki satırlar sayılır;
 * böylece içeriği "diff --git" ile başlayan bir satır yeni bölüm sanılmaz.
 */
export function splitPatch(text: string): string[] {
  const chunks: string[][] = [];
  let oldLeft = 0;
  let newLeft = 0;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const current = chunks.at(-1);
    if (current && (oldLeft > 0 || newLeft > 0)) {
      current.push(line);
      const mark = line[0];
      if (mark === '+') newLeft--;
      else if (mark === '-') oldLeft--;
      else if (mark === ' ' || line === '') {
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      chunks.push([line]);
      continue;
    }
    // İlk bölümden önceki satırlar (boş biçim satırı) atılır.
    if (!current) continue;
    current.push(line);
    const match = HUNK.exec(line);
    if (match) {
      oldLeft = match[1] === undefined ? 1 : Number(match[1]);
      newLeft = match[2] === undefined ? 1 : Number(match[2]);
    }
  }
  return chunks.map((chunk) => `${chunk.join('\n')}\n`);
}

type NameStatus = Pick<CommitFile, 'path' | 'origPath' | 'letter'>;

/** `--name-status -z` çıktısı: "M\0yol\0" ya da "R087\0eski\0yeni\0". */
function parseNameStatus(out: string): NameStatus[] | null {
  const fields = out.split('\0');
  const files: NameStatus[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i]?.replace(/^\n/, '') ?? '';
    if (status === '') {
      i++;
      continue;
    }
    const letter = status[0] as NameStatus['letter'];
    if (!'AMDRCT'.includes(letter)) return null;
    if (letter === 'R' || letter === 'C') {
      const origPath = fields[i + 1];
      const path = fields[i + 2];
      if (origPath === undefined || path === undefined) return null;
      files.push({ path, origPath, letter });
      i += 3;
    } else {
      const path = fields[i + 1];
      if (path === undefined) return null;
      files.push({ path, origPath: null, letter });
      i += 2;
    }
  }
  return files;
}

/** Kullanıcı ayarlarından bağımsız diff: dış araç, textconv, renk ve submodule biçimi sabit. */
const DIFF = ['--root', '-M', '--diff-merges=first-parent', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short'];

/** `oid` önceden doğrulanmış, tam bir commit kimliği olmalı. */
export async function readCommit(repo: string, oid: string): Promise<CommitResult> {
  const [meta, names, patch] = await Promise.all([
    runGit(repo, [...PINNED, 'show', '-s', '--no-color', '--decorate=short', '--abbrev=7', `--format=${SUMMARY_FORMAT}%x1f%b`, oid, '--']),
    runGit(repo, [...PINNED, 'show', '--format=', '--name-status', '-z', ...DIFF, oid, '--']),
    runGit(repo, [...PINNED, 'show', '--format=', '-p', ...DIFF, oid, '--']),
  ]);
  if (!meta.ok) return { ok: false, error: meta.error };
  if (!names.ok) return { ok: false, error: names.error };
  if (!patch.ok) return { ok: false, error: patch.error };

  const fields = meta.stdout.split('\x1f');
  const summary = parseSummary(fields.slice(0, 8));
  if (!summary) return { ok: false, error: UNREADABLE };
  const body = fields.slice(8).join('\x1f').trimEnd();

  const list = parseNameStatus(names.stdout);
  const chunks = splitPatch(patch.stdout);
  if (!list || list.length !== chunks.length) return { ok: false, error: UNREADABLE };

  const files: CommitFile[] = list.map((file, index) => ({ ...file, diff: parseDiff(chunks[index]!) }));
  const commit: CommitDetail = {
    ...summary,
    body,
    files,
    added: files.reduce((sum, file) => sum + file.diff.added, 0),
    removed: files.reduce((sum, file) => sum + file.diff.removed, 0),
  };
  return { ok: true, commit };
}
