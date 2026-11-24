// Splits `git diff` output (a single file's unified diff) into lines. Doesn't depend on Electron.

export type DiffLine =
  | { kind: 'context'; oldNo: number; newNo: number; text: string }
  | { kind: 'add'; newNo: number; text: string }
  | { kind: 'del'; oldNo: number; text: string };

export interface Hunk {
  /** `@@ -38,12 +38,16 @@ export function PlayScreen() {` */
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: Hunk[];
  added: number;
  removed: number;
  /** Git said "Binary files … differ": there are no lines to show. */
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(text: string): ParsedDiff {
  const diff: ParsedDiff = { hunks: [], added: 0, removed: 0, binary: false };
  let hunk: Hunk | null = null;
  // Lines left in the hunk: the only reliable way to tell content lines from headers.
  // (A deletion starting with "--- a" or a context line starting with "@@" looks like a header.)
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const mark = line[0];
      const body = line.slice(1);
      if (mark === '+') {
        hunk.lines.push({ kind: 'add', newNo: newNo++, text: body });
        newLeft--;
        diff.added++;
      } else if (mark === '-') {
        hunk.lines.push({ kind: 'del', oldNo: oldNo++, text: body });
        oldLeft--;
        diff.removed++;
      } else if (mark === ' ' || line === '') {
        // Some tools strip the leading space of an empty context line.
        hunk.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: body });
        oldLeft--;
        newLeft--;
      }
      // "\ No newline at end of file" and unrecognized lines aren't counted.
      continue;
    }
    const match = HUNK.exec(line);
    if (match) {
      oldNo = Number(match[1]);
      oldLeft = match[2] === undefined ? 1 : Number(match[2]);
      newNo = Number(match[3]);
      newLeft = match[4] === undefined ? 1 : Number(match[4]);
      hunk = { header: line, lines: [] };
      diff.hunks.push(hunk);
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      diff.binary = true;
    }
  }
  return diff;
}

export interface SplitSide {
  no: number;
  text: string;
  changed: boolean;
}

/** A row in the side-by-side view: left is old, right is new; `null` if that side has no line. */
export interface SplitRow {
  left: SplitSide | null;
  right: SplitSide | null;
}

/**
 * Turns a hunk into side-by-side rows. A run of deletions is paired in order with the additions
 * that immediately follow; leftover lines have an empty opposite side.
 */
export function splitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: SplitSide[] = [];
  let adds: SplitSide[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === 'del') {
      // A deletion after additions starts a new block of changes.
      if (adds.length > 0) flush();
      dels.push({ no: line.oldNo, text: line.text, changed: true });
    } else if (line.kind === 'add') {
      adds.push({ no: line.newNo, text: line.text, changed: true });
    } else {
      flush();
      rows.push({ left: { no: line.oldNo, text: line.text, changed: false }, right: { no: line.newNo, text: line.text, changed: false } });
    }
  }
  flush();
  return rows;
}
