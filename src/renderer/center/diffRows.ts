// Ayrıştırılmış diff'i ekranda çizilecek satırlara çevirir.
import { type ParsedDiff, splitRows } from '../../git/diffParse';

export type LineKind = 'context' | 'add' | 'del';

export interface Cell {
  no: number;
  text: string;
  kind: LineKind;
}

export type Row =
  | { type: 'hunk'; text: string }
  /** Yan yana görünüm: sol eski, sağ yeni; o tarafta satır yoksa null. */
  | { type: 'split'; left: Cell | null; right: Cell | null }
  /** Tek sütun görünüm. */
  | { type: 'inline'; kind: LineKind; oldNo: number | null; newNo: number | null; text: string };

/** Bundan uzun diff'in devamı çizilmez; dosya Zed'de açılabilir. */
export const MAX_DIFF_LINES = 5000;

export function diffRows(diff: ParsedDiff, mode: 'split' | 'inline', max = MAX_DIFF_LINES): { rows: Row[]; truncated: boolean } {
  const rows: Row[] = [];
  let left = max;
  let truncated = false;
  for (const hunk of diff.hunks) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    const lines = hunk.lines.length > left ? hunk.lines.slice(0, left) : hunk.lines;
    if (lines.length < hunk.lines.length) truncated = true;
    left -= lines.length;
    rows.push({ type: 'hunk', text: hunk.header });
    if (mode === 'inline') {
      for (const line of lines) {
        rows.push({
          type: 'inline',
          kind: line.kind,
          oldNo: line.kind === 'add' ? null : line.oldNo,
          newNo: line.kind === 'del' ? null : line.newNo,
          text: line.text,
        });
      }
    } else {
      for (const row of splitRows({ header: hunk.header, lines })) {
        rows.push({
          type: 'split',
          left: row.left && { no: row.left.no, text: row.left.text, kind: row.left.changed ? 'del' : 'context' },
          right: row.right && { no: row.right.no, text: row.right.text, kind: row.right.changed ? 'add' : 'context' },
        });
      }
    }
  }
  return { rows, truncated };
}
