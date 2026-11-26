import { describe, expect, it } from 'vitest';
import { MAX_SNIPPETS, commandOf, copyName, duplicateSnippet, placeOf, saveSnippet, snippetsOf, typedCommand } from '../src/main/snippets.js';
import { deleteSnippetQuestion, runSnippetQuestion } from '../src/main/questions.js';
import type { Snippet } from '../src/shared/api.js';

const snippet = (over: Partial<Snippet> = {}): Snippet => ({ id: 's1', name: 'Seed test data', group: 'Database', where: 'quizei-backend', command: 'npm run db:seed', ask: false, ...over });
const input = { name: 'Dev server', group: 'Dev', where: 'quizei-backend', command: 'npm run dev', ask: false };

describe('snippetsOf', () => {
  it('keeps well-formed snippets from the state file, and drops the rest', () => {
    expect(
      snippetsOf([
        snippet(),
        snippet(),
        { ...snippet({ id: 's2' }), name: '  Two   words  ', command: 'a\r\nb\n\n', ask: 'yes' },
        { ...snippet({ id: 's3' }), where: '../outside' },
        { ...snippet({ id: 's4' }), command: '   ' },
        { ...snippet({ id: 'NOT AN ID' }) },
        'junk',
      ]),
    ).toEqual([snippet(), snippet({ id: 's2', name: 'Two words', command: 'a\nb', ask: false })]);
    expect(snippetsOf(undefined)).toEqual([]);
  });
});

describe('saveSnippet', () => {
  it('adds a new snippet with an id, and saves an edited one in its place', () => {
    const added = saveSnippet([snippet()], input, ['quizei-backend']);
    if (!added.ok) throw new Error(added.error);
    expect(added.snippets.map((s) => s.name)).toEqual(['Seed test data', 'Dev server']);
    expect(added.snippets[1]).toEqual({ id: added.id, ...input });
    const edited = saveSnippet(added.snippets, { ...input, id: 's1', name: 'Seed', where: '', ask: true }, ['quizei-backend']);
    expect(edited.ok && edited.snippets[0]).toEqual({ id: 's1', name: 'Seed', group: 'Dev', where: '', command: 'npm run dev', ask: true });
  });

  it('refuses a snippet without a name or a command, in a place not in the project, or past the limit', () => {
    expect(saveSnippet([], { ...input, name: ' ' }, ['quizei-backend'])).toEqual({ ok: false, error: 'The snippet needs a name' });
    expect(saveSnippet([], { ...input, command: '\n\n' }, ['quizei-backend'])).toEqual({ ok: false, error: 'The snippet needs a command' });
    expect(saveSnippet([], { ...input, where: 'elsewhere' }, ['quizei-backend'])).toEqual({ ok: false, error: 'That repository is not in the project' });
    expect(saveSnippet([], { ...input, where: '../x' }, ['../x'])).toEqual({ ok: false, error: 'That repository is not in the project' });
    expect(saveSnippet([], { ...input, id: 'missing' }, ['quizei-backend'])).toEqual({ ok: false, error: 'Snippet not found' });
    const full = Array.from({ length: MAX_SNIPPETS }, (_, n) => snippet({ id: `s${n}` }));
    expect(saveSnippet(full, input, ['quizei-backend']).ok).toBe(false);
    expect(saveSnippet([], 'rm -rf /', [])).toEqual({ ok: false, error: 'Invalid request' });
  });
});

describe('duplicateSnippet and copyName', () => {
  it('puts a copy right after the snippet, under a name no other has', () => {
    const list = [snippet(), snippet({ id: 's2', name: 'Other' })];
    const copied = duplicateSnippet(list, 's1');
    if (!copied.ok) throw new Error(copied.error);
    expect(copied.snippets.map((s) => s.name)).toEqual(['Seed test data', 'Seed test data copy', 'Other']);
    expect(copyName(copied.snippets, 'Seed test data')).toBe('Seed test data copy 2');
    expect(duplicateSnippet(list, 'missing')).toEqual({ ok: false, error: 'Snippet not found' });
  });
});

describe('commands', () => {
  it('keeps the lines as typed, without trailing blanks, and types them one by one', () => {
    expect(commandOf('\nnpm install  \r\nnpm test\n\n')).toBe('npm install\nnpm test');
    expect(typedCommand('for repo in *; do\n  (cd "$repo" && npm install)\ndone')).toBe('for repo in *; do\r  (cd "$repo" && npm install)\rdone');
  });
});

describe('snippet questions', () => {
  it('asks before running, saying where and what', () => {
    expect(runSnippetQuestion('Deploy marketing site', 'quizei-marketing', 'npm run build\nnpx wrangler pages deploy dist')).toEqual({
      type: 'warning',
      message: 'Run “Deploy marketing site”?',
      detail: 'In quizei-marketing: npm run build; npx wrangler pages deploy dist',
      buttons: ['Run', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    expect(deleteSnippetQuestion('Seed').message).toBe('Delete the snippet “Seed”?');
  });
});

describe('placeOf', () => {
  it('runs in the project folder or in the repository while it is still there', () => {
    const repos = [
      { name: 'quizei-backend', path: '/s/quizei/quizei-backend' },
      { name: 'quizei', path: '/s/quizei' },
    ];
    expect(placeOf(snippet({ where: '' }), '/s/quizei', repos)).toEqual({ ok: true, cwd: '/s/quizei', label: 'the project folder' });
    expect(placeOf(snippet(), '/s/quizei', repos)).toEqual({ ok: true, cwd: '/s/quizei/quizei-backend', label: 'quizei-backend' });
    expect(placeOf(snippet({ where: 'quizei' }), '/s/quizei', repos)).toEqual({ ok: false, error: 'quizei is not in the project any more' });
  });
});
