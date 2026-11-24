// `git diff` çıktısını (tek dosyanın unified diff'i) satırlara ayırır. Electron'a bağlı değildir.

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
  /** Git "Binary files … differ" dedi: gösterilecek satır yok. */
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(text: string): ParsedDiff {
  const diff: ParsedDiff = { hunks: [], added: 0, removed: 0, binary: false };
  let hunk: Hunk | null = null;
  // Hunk'ta kalan satır sayıları: içerik satırlarını başlıklardan ayırmanın tek güvenilir yolu.
  // ("--- a" ile başlayan bir silme ya da "@@" ile başlayan bir bağlam satırı başlığa benzer.)
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
        // Bazı araçlar boş bağlam satırının baştaki boşluğunu siler.
        hunk.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: body });
        oldLeft--;
        newLeft--;
      }
      // "\ No newline at end of file" ve tanınmayan satırlar sayılmaz.
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

/** Yan yana görünümde bir satır: sol eski, sağ yeni; o tarafta satır yoksa `null`. */
export interface SplitRow {
  left: SplitSide | null;
  right: SplitSide | null;
}

/**
 * Hunk'ı yan yana satırlara çevirir. Art arda gelen silmeler, hemen ardından gelen eklemelerle
 * sırayla eşleştirilir; artan satırların karşısı boş kalır.
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
      // Eklemelerden sonra gelen silme yeni bir değişiklik öbeğidir.
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
