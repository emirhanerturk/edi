// Splits file text into lines. In its own module: both the file view and the status bar use it.

/** The file's lines; a trailing newline doesn't count as an empty line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
