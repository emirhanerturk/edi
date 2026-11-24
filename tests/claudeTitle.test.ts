import { describe, expect, it } from 'vitest';
import { claudeTitleState } from '../src/shared/claudeTitle.js';

// Başlıklar docs/notes/claude-terminal-title.md kaydından alındı.
describe('claudeTitleState', () => {
  it('dönen yarım daire: çalışıyor', () => {
    for (const title of ['◐ Claude Code', '◑ Claude Code', '◑ Basit yanıt isteği', '◐ Perm-test2.txt dosya yazma']) {
      expect(claudeTitleState(title), title).toBe('working');
    }
  });

  it('yıldız: bekliyor (yanıt bitti ya da izin soruyor)', () => {
    for (const title of ['✳ Claude Code', '✳ Basit yanıt isteği', '✳ Perm-test2.txt dosya yazma']) {
      expect(claudeTitleState(title), title).toBe('waiting');
    }
  });

  it("Claude Code'un olmayan başlıklar: null", () => {
    for (const title of ['', 'zsh', 'user@host: ~/studios/edi', 'vim README.md', 'Claude Code', ' ✳ Claude Code', 'a ◐ b']) {
      expect(claudeTitleState(title), JSON.stringify(title)).toBeNull();
    }
  });
});
