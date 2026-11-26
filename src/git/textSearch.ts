// Searching a repository's files for text, and replacing what was found. Doesn't depend on Electron.
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildPattern, includeFilter } from '../shared/textPattern.js';
import { runGit } from './exec.js';
import { readRepoFile, writeRepoFile } from './files.js';
import type { ReplaceResult, TextFile, TextLine, TextQuery, TextSearchResult } from './types.js';

/** At most this many matches come back from one repository. */
export const MAX_MATCHES = 2000;
/** A long line is cut to this many characters, from a little before its first match. */
export const LINE_CHARS = 300;
/** A line's matches past this many aren't marked (a minified file). */
const MAX_RANGES = 50;
/** One file's search or replacement may take this long; a pattern that takes longer is given up on. */
const PATTERN_MS = 1500;
/** Files read at the same time. */
const READERS = 16;
const MAX_PATTERN = 1000;
const MAX_INCLUDE = 1000;
export const MAX_REPLACEMENT = 10_000;

export const TOO_SLOW = 'This regular expression takes too long to run';
export const CHANGED = 'It changed after the search';
export const STOPPED = 'Stopped';

const split = (stdout: string) => stdout.split('\0').filter((path) => path !== '');
export const stampOf = (text: string) => createHash('sha1').update(text).digest('hex');

/** The page's query, checked: null if it isn't one. */
export function textQuery(value: unknown): TextQuery | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pattern !== 'string' || v.pattern === '' || v.pattern.length > MAX_PATTERN) return null;
  if (typeof v.regex !== 'boolean' || typeof v.matchCase !== 'boolean' || typeof v.wholeWord !== 'boolean') return null;
  if (typeof v.include !== 'string' || v.include.length > MAX_INCLUDE) return null;
  return { pattern: v.pattern, regex: v.regex, matchCase: v.matchCase, wholeWord: v.wholeWord, include: v.include };
}

const guardContext = vm.createContext({ task: null as (() => unknown) | null });
const guardScript = new vm.Script('task()');

/**
 * Runs `task`, stopped with TOO_SLOW if it takes longer than `ms`: a pattern like `(a+)+b` can take
 * longer than the age of the universe on a line it doesn't match, and would freeze the app.
 */
export function guarded<T>(task: () => T, ms = PATTERN_MS): T {
  guardContext.task = task;
  try {
    return guardScript.runInContext(guardContext, { timeout: ms }) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error(TOO_SLOW);
    throw error;
  } finally {
    guardContext.task = null;
  }
}

/** The lines of `text` without their line ending. */
const linesOf = (text: string) => text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

/** The lines that match, with where; empty matches don't count. At most `limit` matches. */
export function findMatches(re: RegExp, text: string, limit: number): { line: number; text: string; ranges: [number, number][]; count: number }[] {
  const out: { line: number; text: string; ranges: [number, number][]; count: number }[] = [];
  const lines = linesOf(text);
  let total = 0;
  for (let index = 0; index < lines.length && total < limit; index++) {
    const line = lines[index]!;
    re.lastIndex = 0;
    const ranges: [number, number][] = [];
    let count = 0;
    let match: RegExpExecArray | null;
    while (total < limit && (match = re.exec(line)) !== null) {
      if (match[0] === '') {
        re.lastIndex++;
        continue;
      }
      count++;
      total++;
      if (ranges.length < MAX_RANGES) ranges.push([match.index, match.index + match[0].length]);
    }
    if (count > 0) out.push({ line: index + 1, text: line, ranges, count });
  }
  return out;
}

/** A line as it is sent: a long one is cut to LINE_CHARS from a little before its first match. */
export function cutLine(line: number, text: string, ranges: [number, number][], count: number): TextLine {
  if (text.length <= LINE_CHARS) return { line, text, from: 0, cut: false, ranges, count };
  const from = Math.max(0, ranges[0]![0] - 40);
  const end = from + LINE_CHARS;
  return {
    line,
    text: text.slice(from, end),
    from,
    cut: end < text.length,
    ranges: ranges.filter(([start]) => start < end).map(([start, stop]) => [start - from, Math.min(stop, end) - from]),
    count,
  };
}

/**
 * The text that replaces one match, as `String.prototype.replace` would make it from `template`: `$$`, `$&`,
 * `` $` ``, `$'`, `$1`–`$99` and `$<name>`. `args` are what a replace callback gets.
 */
export function expand(template: string, args: unknown[]): string {
  const last = args[args.length - 1];
  const named = typeof last === 'object' && last !== null;
  const groups = named ? (last as Record<string, string | undefined>) : undefined;
  const subject = args[args.length - (named ? 2 : 1)] as string;
  const position = args[args.length - (named ? 3 : 2)] as number;
  const match = args[0] as string;
  const captures = args.slice(1, args.length - (named ? 3 : 2)) as (string | undefined)[];
  return template.replace(/\$([$&`']|\d{1,2}|<[^>]*>)/g, (whole, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return match;
    if (token === '`') return subject.slice(0, position);
    if (token === "'") return subject.slice(position + match.length);
    if (token.startsWith('<')) return groups ? (groups[token.slice(1, -1)] ?? '') : whole;
    const n = Number(token);
    if (n >= 1 && n <= captures.length) return captures[n - 1] ?? '';
    // "$10" with fewer than ten groups is group 1 followed by "0".
    const one = Number(token[0]);
    if (token.length === 2 && one >= 1 && one <= captures.length) return (captures[one - 1] ?? '') + token[1];
    return whole;
  });
}

/**
 * Replaces every match on the given lines (1-based); empty matches are left alone, as the search skips
 * them. `regex`: the replacement can use `$1` and the like; otherwise it is put in as typed.
 */
export function replaceLines(re: RegExp, text: string, lines: number[], replacement: string, regex: boolean): { text: string; count: number } {
  const all = text.split('\n');
  let count = 0;
  for (const number of new Set(lines)) {
    const line = all[number - 1];
    if (line === undefined) continue;
    const cr = line.endsWith('\r');
    const body = cr ? line.slice(0, -1) : line;
    re.lastIndex = 0;
    const next = body.replace(re, (...args: unknown[]) => {
      if (args[0] === '') return '';
      count++;
      return regex ? expand(replacement, args) : replacement;
    });
    all[number - 1] = cr ? `${next}\r` : next;
  }
  return { text: all.join('\n'), count };
}

/**
 * Searches the repository's files: tracked ones and new ones not ignored, as the Files tab lists them.
 * Files over 1 MB, binary files, images and videos are skipped, and so is anything that leads outside the
 * repo. Files are searched in path order, and the search stops at `limit` matches. `stopped` is asked
 * between files: a newer search makes this one stop.
 */
export async function searchRepo(repo: string, query: TextQuery, opts: { limit?: number; stopped?: () => boolean } = {}): Promise<TextSearchResult> {
  const pattern = buildPattern(query);
  if (!pattern.ok) return { ok: false, error: pattern.error };
  const limit = opts.limit ?? MAX_MATCHES;
  const stopped = opts.stopped ?? (() => false);
  const [present, deleted] = await Promise.all([
    runGit(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    runGit(repo, ['ls-files', '-z', '--deleted']),
  ]);
  if (!present.ok) return { ok: false, error: present.error };
  const gone = new Set(deleted.ok ? split(deleted.stdout) : []);
  const wanted = includeFilter(query.include);
  // A nested repo is listed as `dir/`; a submodule is a folder, which reading refuses.
  const paths = [...new Set(split(present.stdout))].filter((path) => !path.endsWith('/') && !gone.has(path) && wanted(path)).sort();

  // Files are taken in order, so the ones done when the limit is reached are the first ones.
  const found: TextFile[] = [];
  const order = new Map(paths.map((path, index) => [path, index]));
  let count = 0;
  let next = 0;
  let failure: string | null = null;
  const reader = async () => {
    while (next < paths.length && count < limit && failure === null && !stopped()) {
      const path = paths[next++]!;
      const content = await readRepoFile(repo, path);
      if (!content.ok || content.kind !== 'text' || failure !== null || stopped()) continue;
      let lines;
      try {
        lines = guarded(() => findMatches(pattern.re, content.text, Math.max(limit - count, 1)));
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        return;
      }
      if (lines.length === 0) continue;
      count += lines.reduce((sum, line) => sum + line.count, 0);
      found.push({ path, stamp: stampOf(content.text), lines: lines.map((line) => cutLine(line.line, line.text, line.ranges, line.count)) });
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  if (failure !== null) return { ok: false, error: failure };
  if (stopped()) return { ok: false, error: STOPPED };

  found.sort((a, b) => order.get(a.path)! - order.get(b.path)!);
  // Readers working side by side may have gone past the limit: the lines past it are dropped (a line is
  // replaced whole, so it is listed whole).
  const files: TextFile[] = [];
  let listed = 0;
  for (const file of found) {
    if (listed >= limit) break;
    const lines: TextLine[] = [];
    for (const line of file.lines) {
      if (listed >= limit) break;
      lines.push(line);
      listed += line.count;
    }
    files.push({ ...file, lines });
  }
  return { ok: true, files, count: listed, truncated: count >= limit };
}

/**
 * Replaces the matches on the given lines of one file, only if the file still holds the text that was
 * searched (`stamp`). The write goes through the editor's save, which checks once more that the disk
 * holds what was read.
 */
export async function replaceInFile(repo: string, path: string, query: TextQuery, replacement: string, stamp: string, lines: number[]): Promise<ReplaceResult> {
  const pattern = buildPattern(query);
  if (!pattern.ok) return { ok: false, error: pattern.error };
  const content = await readRepoFile(repo, path);
  if (!content.ok) return { ok: false, error: content.error };
  if (content.kind !== 'text') return { ok: false, error: 'Not a text file' };
  if (stampOf(content.text) !== stamp) return { ok: false, error: CHANGED, changed: true };
  // Bytes that aren't UTF-8 were read as U+FFFD: writing the text back would lose them.
  if (content.text.includes('�')) return { ok: false, error: 'It is not UTF-8 text' };
  let result;
  try {
    result = guarded(() => replaceLines(pattern.re, content.text, lines, replacement, query.regex));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (result.count === 0 || result.text === content.text) return { ok: true, count: 0, stamp };
  const written = await writeRepoFile(repo, path, result.text, content.text);
  if (!written.ok) return written.conflict === 'changed' ? { ok: false, error: CHANGED, changed: true } : { ok: false, error: written.error };
  return { ok: true, count: result.count, stamp: stampOf(result.text) };
}
