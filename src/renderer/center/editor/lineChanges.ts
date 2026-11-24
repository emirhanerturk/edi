// The editor's changed-line bars: the current text against the HEAD version, line by line.

export interface LineChange {
  kind: 'added' | 'modified' | 'deleted';
  /** New line numbers, 1-based. For `deleted`, both are the line the removed lines followed (0: above the first). */
  start: number;
  end: number;
}

/** Above this many lines on either side, no bars: the diff runs on the page's main thread. */
export const MAX_LINES = 20_000;
/** Above this many differing lines the middle part counts as one block instead of being diffed exactly. */
const MAX_EDITS = 1000;

const split = (text: string) => text.split(/\r?\n/);

type Op = 0 | 1 | 2; // equal, delete (old line), insert (new line)

/** Myers' diff of two line arrays, as a list of operations; null if it needs more than `maxEdits` edits. */
function myers(a: string[], b: string[], maxEdits: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const offset = maxEdits + 1;
  let v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxEdits; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrack(trace, a.length, b.length, offset);
      }
    }
    v = next;
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    if (d > 0) {
      ops.push(x === prevX ? 2 : 1);
      x = prevX;
      y = prevY;
    }
  }
  return ops.reverse();
}

/** The changed lines of `current` against `head` (null: not in HEAD, every line is new). Null above the line limit. */
export function lineChanges(head: string | null, current: string): LineChange[] | null {
  const b = split(current);
  if (b.length > MAX_LINES) return null;
  if (head === null) {
    const count = current === '' ? 0 : b.length - (b[b.length - 1] === '' ? 1 : 0);
    return count === 0 ? [] : [{ kind: 'added', start: 1, end: count }];
  }
  const a = split(head);
  if (a.length > MAX_LINES) return null;

  // Common start and end are skipped: a typical edit leaves only a few lines to diff.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (midA.length === 0 && midB.length === 0) return [];

  const ops: Op[] = myers(midA, midB, MAX_EDITS) ?? [...midA.map((): Op => 1), ...midB.map((): Op => 2)];
  const changes: LineChange[] = [];
  let j = prefix; // new lines before the current position
  let index = 0;
  while (index < ops.length) {
    if (ops[index] === 0) {
      j++;
      index++;
      continue;
    }
    const start = j;
    let deleted = 0;
    let inserted = 0;
    while (index < ops.length && ops[index] !== 0) {
      if (ops[index] === 1) deleted++;
      else inserted++;
      index++;
    }
    j += inserted;
    if (inserted === 0) changes.push({ kind: 'deleted', start, end: start });
    else changes.push({ kind: deleted > 0 ? 'modified' : 'added', start: start + 1, end: start + inserted });
  }
  return changes;
}
