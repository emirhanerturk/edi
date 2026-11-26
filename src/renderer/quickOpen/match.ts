// Quick open's matching: a file's name and path against what was typed. Pure; shared by the palette and its tests.

export interface Match {
  /** Higher is better. */
  score: number;
  /** Indexes in the path (`dir/name`) of the letters that matched, ascending. */
  positions: number[];
}

/** The query as it is matched: lower case, spaces dropped (they only separate words for the eye). */
export const normalize = (query: string) => query.toLowerCase().replace(/\s+/g, '');

const range = (from: number, length: number) => Array.from({ length }, (_, k) => from + k);

/**
 * How well `query` (already normalized) matches the path. Best when it is in the file's name (at its start
 * better still), then anywhere in the path as typed, then its letters in order, as far to the right as they
 * go so they land in the name before the folders. Null when it doesn't match at all.
 */
export function matchPath(query: string, path: string): Match | null {
  if (query === '') return { score: 0, positions: [] };
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const name = lower.slice(slash + 1);
  let at = name.indexOf(query);
  if (at !== -1) return { score: 1000 - name.length - at * 3 + (at === 0 ? 40 : 0), positions: range(slash + 1 + at, query.length) };
  at = lower.indexOf(query);
  if (at !== -1) return { score: 700 - lower.length, positions: range(at, query.length) };
  const positions: number[] = [];
  let k = query.length - 1;
  for (let j = lower.length - 1; j >= 0 && k >= 0; j--) {
    if (lower[j] === query[k]) {
      positions.unshift(j);
      k--;
    }
  }
  if (k >= 0) return null;
  let score = 300 - lower.length;
  for (let t = 1; t < positions.length; t++) if (positions[t] === positions[t - 1]! + 1) score += 10;
  for (const position of positions) if (position > slash) score += 6;
  return { score, positions };
}

/** Splits `text` (which starts at `offset` in the path) into runs that matched and runs that didn't. */
export function runs(text: string, offset: number, positions: number[]): { text: string; hit: boolean }[] {
  const hits = new Set(positions);
  const out: { text: string; hit: boolean }[] = [];
  for (let c = 0; c < text.length; c++) {
    const hit = hits.has(offset + c);
    const last = out.at(-1);
    if (last && last.hit === hit) last.text += text[c];
    else out.push({ text: text[c]!, hit });
  }
  return out;
}

export interface RepoFiles {
  repoPath: string;
  files: string[];
}

export interface Group {
  repoPath: string;
  hits: { path: string; match: Match }[];
  /** How many files matched; more than `hits` when the list was cut at `perRepo`. */
  total: number;
}

/**
 * The files that match, grouped by repo: the best file first in each group, the group with the best file
 * first. At most `perRepo` files a repo.
 */
export function search(query: string, repos: RepoFiles[], perRepo = 50): Group[] {
  const q = normalize(query);
  const groups: Group[] = [];
  for (const repo of repos) {
    const hits: Group['hits'] = [];
    for (const path of repo.files) {
      const match = matchPath(q, path);
      if (match) hits.push({ path, match });
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => b.match.score - a.match.score || a.path.localeCompare(b.path));
    groups.push({ repoPath: repo.repoPath, hits: hits.slice(0, perRepo), total: hits.length });
  }
  return groups.sort((a, b) => b.hits[0]!.match.score - a.hits[0]!.match.score);
}
