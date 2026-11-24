/**
 * Reads Claude Code's state from its terminal title. The rule comes from the notes in
 * docs/notes/claude-terminal-title.md: while working, the title starts with a spinning half circle;
 * while waiting for the user (reply finished or asking for permission), with a star. Returns `null` for any other title.
 */
export type ClaudeTitleState = 'waiting' | 'working';

export function claudeTitleState(title: string): ClaudeTitleState | null {
  if (title.startsWith('✳ ')) return 'waiting';
  if (title.startsWith('◐ ') || title.startsWith('◑ ')) return 'working';
  return null;
}
