import { describe, expect, it } from 'vitest';
import type { Project } from '../src/shared/api.js';
import { MAX_PROJECTS, byOpened, cleanInput, defaultProject, fromRecent, markOpened, normalizeProjects, repoSettingsOf } from '../src/main/projects.js';
import {
  LOGO_COLORS,
  MAX_REPO_NAMES,
  NO_REPO_SETTINGS,
  arrangeRepos,
  colorFor,
  letterOf,
  linkHost,
  linkName,
  linkText,
  normalizeLink,
  orderRepos,
} from '../src/shared/projects.js';

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  dir: '/s/quizei',
  name: 'Quizei',
  logo: { kind: 'letter', color: 'purple' },
  links: [],
  openedAt: 0,
  repoCount: 1,
  repos: { order: [], ignored: [] },
  ...over,
});

describe('links', () => {
  it('adds https:// when no scheme is typed, http:// for a local address', () => {
    expect(normalizeLink('quizei.com')).toBe('https://quizei.com/');
    expect(normalizeLink('  admin.quizei.com/panel ')).toBe('https://admin.quizei.com/panel');
    expect(normalizeLink('quizei.com:8080/x')).toBe('https://quizei.com:8080/x');
    expect(normalizeLink('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeLink('127.0.0.1')).toBe('http://127.0.0.1/');
    expect(normalizeLink('http://quizei.com')).toBe('http://quizei.com/');
    expect(normalizeLink('HTTPS://Quizei.com/A')).toBe('https://quizei.com/A');
  });

  it('refuses anything but a web address with a host', () => {
    for (const input of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'vscode://open', 'mailto:me@quizei.com', 'https://', 'a b.com']) {
      expect(normalizeLink(input)).toBeNull();
    }
    expect(normalizeLink(`https://quizei.com/${'x'.repeat(2048)}`)).toBeNull();
    // A password in a link would be written out in the title bar.
    expect(normalizeLink('https://me:secret@quizei.com')).toBeNull();
  });

  it('writes a link out without its scheme, www. and a trailing slash', () => {
    expect(linkText('https://quizei.com/')).toBe('quizei.com');
    expect(linkText('https://www.quizei.com/')).toBe('quizei.com');
    expect(linkText('https://github.com/emirhanerturk/edi')).toBe('github.com/emirhanerturk/edi');
    expect(linkText('https://github.com/emirhanerturk/edi/')).toBe('github.com/emirhanerturk/edi');
    expect(linkText('http://localhost:3000/a?b=1')).toBe('localhost:3000/a?b=1');
    expect(linkText('https://tr.wikipedia.org/wiki/%C3%87ay')).toBe('tr.wikipedia.org/wiki/Çay');
    expect(linkHost('https://www.apps.apple.com/tr/app/x')).toBe('apps.apple.com');
  });

  it('names a link by its label, or its address without one', () => {
    expect(linkName({ url: 'https://admin.quizei.com/', label: ' Admin ' })).toBe('Admin');
    expect(linkName({ url: 'https://admin.quizei.com/', label: '' })).toBe('admin.quizei.com');
  });
});

describe('letter logos', () => {
  it('takes the first letter of the name, upper case', () => {
    expect(letterOf('quizei')).toBe('Q');
    expect(letterOf('  edi')).toBe('E');
    expect(letterOf('çay')).toBe('Ç');
    expect(letterOf('')).toBe('?');
  });

  it('picks a color from the folder, always the same one', () => {
    expect(LOGO_COLORS).toContain(colorFor('/s/quizei'));
    expect(colorFor('/s/quizei')).toBe(colorFor('/s/quizei'));
    expect(new Set(['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'].map(colorFor)).size).toBeGreaterThan(1);
  });
});

describe('the projects in the state file', () => {
  it('keeps valid fields and drops broken ones', () => {
    const projects = normalizeProjects([
      {
        id: 'p1',
        dir: '/s/quizei',
        name: ` ${'Q'.repeat(100)}`,
        logo: { kind: 'image', file: 'p1-0a0b0c0d.svg' },
        links: [
          { url: 'https://quizei.com', label: 'Site' },
          { url: 'javascript:alert(1)', label: 'x' },
          { url: 'https://quizei.com/', label: 'again' },
          { url: 7 },
        ],
        openedAt: 5,
        repoCount: 8,
        repos: { order: ['quizei-frontend', 'next-quiz'], ignored: ['next-quiz'] },
      },
      { id: 'p2', dir: '/s/edi', name: '', logo: { kind: 'image', file: '../state.json' }, links: [], openedAt: -1, repoCount: 1.5, repos: 'all' },
      { id: 'BAD ID', dir: '/s/x' },
      { id: 'p3' },
    ]);
    expect(projects).toEqual([
      {
        id: 'p1',
        dir: '/s/quizei',
        name: 'Q'.repeat(80),
        logo: { kind: 'image', file: 'p1-0a0b0c0d.svg' },
        links: [{ url: 'https://quizei.com/', label: 'Site' }],
        openedAt: 5,
        repoCount: 8,
        repos: { order: ['quizei-frontend', 'next-quiz'], ignored: ['next-quiz'] },
      },
      {
        id: 'p2',
        dir: '/s/edi',
        name: 'edi',
        logo: { kind: 'letter', color: colorFor('/s/edi') },
        links: [],
        openedAt: 0,
        repoCount: 0,
        repos: { order: [], ignored: [] },
      },
    ]);
  });

  it('makes projects of the folders opened before projects existed', () => {
    const projects = fromRecent(
      [
        { dir: '/s/edi', repoCount: 1 },
        { dir: '/s/quizei', repoCount: 8 },
        { dir: '/s/edi', repoCount: 2 },
        { dir: 'relative' },
      ],
      '/s/quizei',
      99,
    );
    expect(projects.map(({ dir, openedAt, repoCount }) => ({ dir, openedAt, repoCount }))).toEqual([
      { dir: '/s/edi', openedAt: 0, repoCount: 1 },
      { dir: '/s/quizei', openedAt: 99, repoCount: 8 },
    ]);
    // The last folder opened, even when it isn't in the list.
    expect(fromRecent([], '/s/alone', 7).map((p) => [p.dir, p.openedAt])).toEqual([['/s/alone', 7]]);
    expect(fromRecent(undefined, null, 7)).toEqual([]);
  });

  it('orders the projects last opened first, keeping the order of the ones never opened', () => {
    const list = [project({ id: 'a', openedAt: 0 }), project({ id: 'b', openedAt: 5 }), project({ id: 'c', openedAt: 0 }), project({ id: 'd', openedAt: 9 })];
    expect(byOpened(list).map((p) => p.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('marks the project opened, or makes one for a folder without', () => {
    const list = [project()];
    expect(markOpened(list, '/s/quizei', 9, 50)).toEqual([project({ openedAt: 50, repoCount: 9 })]);

    const added = markOpened(list, '/s/edi', 1, 60);
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ dir: '/s/edi', name: 'edi', openedAt: 60, repoCount: 1, links: [], logo: { kind: 'letter' }, repos: NO_REPO_SETTINGS });

    const template = {
      id: 'new',
      name: 'edi app',
      logo: { kind: 'image' as const, file: 'new-00000000.png' },
      links: [{ url: 'https://github.com/a/b', label: 'GitHub' }],
      repos: { order: ['b', 'a'], ignored: ['c'] },
    };
    expect(markOpened(list, '/s/edi', 1, 60, template)[1]).toEqual({ ...template, dir: '/s/edi', openedAt: 60, repoCount: 1 });
    // A template doesn't replace a project the folder already has.
    expect(markOpened(list, '/s/quizei', 9, 70, template)).toEqual([project({ openedAt: 70, repoCount: 9 })]);
  });

  it('keeps at most 200 projects, letting the one opened longest ago go', () => {
    const many = Array.from({ length: MAX_PROJECTS }, (_, i) => defaultProject(`/p/${i}`, 0, i + 1, `id-${i}`));
    const next = markOpened(many, '/p/new', 0, 1_000);
    expect(next).toHaveLength(MAX_PROJECTS);
    expect(next.some((p) => p.dir === '/p/0')).toBe(false);
    expect(next.some((p) => p.dir === '/p/new')).toBe(true);
  });
});

describe('the sheet input', () => {
  const valid = { dir: '/s/edi', name: ' edi ', logo: { kind: 'letter', color: 'blue' }, links: [{ url: 'github.com/a/b', label: ' GitHub ' }] };

  it('trims the name and normalizes the links, the first one staying first', () => {
    expect(cleanInput(valid)).toEqual({
      ok: true,
      input: {
        dir: '/s/edi',
        name: 'edi',
        logo: { kind: 'letter', color: 'blue' },
        links: [{ url: 'https://github.com/a/b', label: 'GitHub' }],
        repos: { order: [], ignored: [] },
      },
    });
    const repos = cleanInput({ ...valid, repos: { order: ['b', 'a', 'a'], ignored: ['a', '../x'] } });
    expect(repos.ok && repos.input.repos).toEqual({ order: ['b', 'a'], ignored: ['a'] });
    const twice = cleanInput({ ...valid, links: [{ url: 'https://x.com', label: 'a' }, { url: 'x.com', label: 'b' }] });
    expect(twice.ok && twice.input.links).toEqual([{ url: 'https://x.com/', label: 'a' }]);
  });

  it('refuses a missing name, a relative folder, a link that is not a web address and an unknown logo', () => {
    expect(cleanInput({ ...valid, name: '   ' })).toEqual({ ok: false, error: 'The project needs a name' });
    expect(cleanInput({ ...valid, dir: 'edi' })).toEqual({ ok: false, error: 'Folder not found' });
    expect(cleanInput({ ...valid, links: [{ url: 'javascript:alert(1)', label: '' }] })).toEqual({ ok: false, error: 'Not a web address: javascript:alert(1)' });
    expect(cleanInput({ ...valid, links: Array.from({ length: 13 }, (_, i) => ({ url: `https://x${i}.com`, label: '' })) }).ok).toBe(false);
    expect(cleanInput({ ...valid, logo: { kind: 'letter', color: 'teal' } }).ok).toBe(false);
    expect(cleanInput({ ...valid, logo: { kind: 'file', path: '/etc/passwd' } }).ok).toBe(false);
    expect(cleanInput(null).ok).toBe(false);
    expect(cleanInput({ ...valid, logo: { kind: 'candidate', id: 'abc' } })).toMatchObject({ ok: true, input: { logo: { kind: 'candidate', id: 'abc' } } });
    expect(cleanInput({ ...valid, logo: { kind: 'keep' } })).toMatchObject({ ok: true, input: { logo: { kind: 'keep' } } });
  });
});

describe('repository settings', () => {
  const found = ['next-quiz', 'quizei-admin', 'quizei-api', 'quizei-frontend'].map((name) => ({ name }));
  const names = (list: { name: string }[]) => list.map((repo) => repo.name);

  it('puts the ordered names first, then the others alphabetically, skipping names that are gone', () => {
    expect(names(orderRepos(found, ['quizei-frontend', 'gone', 'quizei-api']))).toEqual(['quizei-frontend', 'quizei-api', 'next-quiz', 'quizei-admin']);
  });

  it('drops the ignored ones; with nothing set the order is alphabetical', () => {
    expect(names(arrangeRepos(found, { order: ['quizei-frontend'], ignored: ['next-quiz', 'gone'] }))).toEqual(['quizei-frontend', 'quizei-admin', 'quizei-api']);
    expect(names(arrangeRepos(found, NO_REPO_SETTINGS))).toEqual(names(found));
    expect(arrangeRepos(found, { order: [], ignored: names(found) })).toEqual([]);
  });

  it('reads settings from the state file: names only, each once, nothing else', () => {
    expect(repoSettingsOf(undefined)).toEqual({ order: [], ignored: [] });
    expect(repoSettingsOf('x')).toEqual({ order: [], ignored: [] });
    expect(repoSettingsOf({ order: ['a', 'a', 3, '', ' b ', 'c/d', 'e\\f', '.', '..'], ignored: 'a' })).toEqual({ order: ['a', 'b'], ignored: [] });
    expect(repoSettingsOf({ order: Array.from({ length: 600 }, (_, i) => `r${i}`), ignored: [] }).order).toHaveLength(MAX_REPO_NAMES);
  });
});
