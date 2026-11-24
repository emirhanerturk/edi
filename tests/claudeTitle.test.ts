import { describe, expect, it } from 'vitest';
import { claudeTitleState } from '../src/shared/claudeTitle.js';

// The titles come from the record in docs/notes/claude-terminal-title.md.
describe('claudeTitleState', () => {
  it('a spinning half circle means working', () => {
    for (const title of ['◐ Claude Code', '◑ Claude Code', '◑ Basit yanıt isteği', '◐ Perm-test2.txt dosya yazma']) {
      expect(claudeTitleState(title), title).toBe('working');
    }
  });

  it('a star means waiting (reply finished or asking for permission)', () => {
    for (const title of ['✳ Claude Code', '✳ Basit yanıt isteği', '✳ Perm-test2.txt dosya yazma']) {
      expect(claudeTitleState(title), title).toBe('waiting');
    }
  });

  it('returns null for titles that are not from Claude Code', () => {
    for (const title of ['', 'zsh', 'user@host: ~/studios/edi', 'vim README.md', 'Claude Code', ' ✳ Claude Code', 'a ◐ b']) {
      expect(claudeTitleState(title), JSON.stringify(title)).toBeNull();
    }
  });
});
