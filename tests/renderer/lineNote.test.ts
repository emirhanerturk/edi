import { describe, expect, it } from 'vitest';
import { lineNote } from '../../src/renderer/center/editor/lineNote';

const a = 'a'.repeat(40);
const blame = {
  lines: [a, null, a],
  commits: { [a]: { authorName: 'Ada Lovelace', authorEmail: 'ada@x.dev', date: Date.UTC(2026, 10, 21), summary: 'feat: start the engine' } },
};
const now = Date.UTC(2026, 10, 24);

describe('lineNote', () => {
  it("names the line's author, when and the commit subject; it links to the commit", () => {
    expect(lineNote(blame, 1, now)).toEqual({ text: 'Ada Lovelace, 3 days ago · feat: start the engine', oid: a });
  });

  it('a line not committed yet says so, without a link', () => {
    expect(lineNote(blame, 2, now)).toEqual({ text: 'Not committed yet', oid: null });
  });

  it('nothing for a line past the blame (just typed) or line 0', () => {
    expect(lineNote(blame, 4, now)).toBeNull();
    expect(lineNote(blame, 0, now)).toBeNull();
  });

  it('a very long subject is shortened', () => {
    const long = { ...blame, commits: { [a]: { ...blame.commits[a]!, summary: 'x'.repeat(120) } } };
    expect(lineNote(long, 1, now)!.text).toBe(`Ada Lovelace, 3 days ago · ${'x'.repeat(79)}…`);
  });
});
