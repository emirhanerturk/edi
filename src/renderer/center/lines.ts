// Dosya metnini satırlara böler. Ayrı modülde: hem dosya görünümü hem durum çubuğu kullanır.

/** Dosyanın satırları; sondaki satır sonu boş bir satır sayılmaz. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
