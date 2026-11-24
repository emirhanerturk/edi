/**
 * Claude Code'un terminal başlığından durumu okur. Kural, docs/notes/claude-terminal-title.md
 * kaydından çıkarıldı: çalışırken başlık dönen bir yarım daireyle, kullanıcıyı beklerken
 * (yanıt bitti ya da izin soruyor) yıldızla başlar. Başka her başlık için `null` döner.
 */
export type ClaudeTitleState = 'waiting' | 'working';

export function claudeTitleState(title: string): ClaudeTitleState | null {
  if (title.startsWith('✳ ')) return 'waiting';
  if (title.startsWith('◐ ') || title.startsWith('◑ ')) return 'working';
  return null;
}
