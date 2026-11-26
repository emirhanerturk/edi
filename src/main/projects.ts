// The projects kept in the state file, and the rules for the sheet's input. Every field is validated
// on its own: a hand-edited file or one left by another version doesn't crash the app.
// Doesn't depend on Electron.
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type { Project, ProjectInput, ProjectLink, ProjectLogo, RepoSettings } from '../shared/api.js';
import { MAX_LABEL, MAX_LINKS, MAX_NAME, MAX_REPO_NAMES, colorFor, isLogoColor, normalizeLink } from '../shared/projects.js';

/** At most this many projects are kept; past it, the one opened longest ago goes. */
export const MAX_PROJECTS = 200;
/** A project's id: what `randomUUID` makes. */
const ID = /^[a-z0-9-]{1,64}$/;
/** The name of a logo edi keeps: the project's id, a random part and an image extension. Nothing else is served or deleted. */
export const LOGO_FILE = /^[a-z0-9-]{1,100}\.(png|jpg|gif|webp|avif|svg|ico)$/;

/** What a project is made from: everything the sheet decides. */
export type ProjectTemplate = Pick<Project, 'id' | 'name' | 'logo' | 'links' | 'repos'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max).trim() : '');
const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

function logoOf(raw: unknown, dir: string): ProjectLogo {
  if (isRecord(raw)) {
    if (raw.kind === 'image' && typeof raw.file === 'string' && LOGO_FILE.test(raw.file)) return { kind: 'image', file: raw.file };
    if (raw.kind === 'letter' && isLogoColor(raw.color)) return { kind: 'letter', color: raw.color };
  }
  return { kind: 'letter', color: colorFor(dir) };
}

/** The links from the state file: web addresses only, each once, at most twelve. */
function linksOf(raw: unknown): ProjectLink[] {
  if (!Array.isArray(raw)) return [];
  const links: ProjectLink[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.url !== 'string') continue;
    const url = normalizeLink(item.url);
    if (url === null || links.some((link) => link.url === url)) continue;
    links.push({ url, label: text(item.label, MAX_LABEL) });
    if (links.length === MAX_LINKS) break;
  }
  return links;
}

/** A list of repo folder names: trimmed, each once, never a path or `.`/`..`, at most `MAX_REPO_NAMES`. */
function repoNamesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name) || names.includes(name)) continue;
    names.push(name);
    if (names.length === MAX_REPO_NAMES) break;
  }
  return names;
}

/** A project's repo order and ignored repos, from the state file or the sheet; anything else is left out. */
export function repoSettingsOf(raw: unknown): RepoSettings {
  return isRecord(raw) ? { order: repoNamesOf(raw.order), ignored: repoNamesOf(raw.ignored) } : { order: [], ignored: [] };
}

/** The projects from the state file. An entry without an id or an absolute folder is dropped, as is a second one for the same folder. */
export function normalizeProjects(raw: unknown[]): Project[] {
  const projects: Project[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.dir !== 'string' || !isAbsolute(item.dir)) continue;
    const dir = item.dir;
    if (projects.some((project) => project.id === item.id || project.dir === dir)) continue;
    projects.push({
      id: item.id,
      dir,
      name: text(item.name, MAX_NAME) || basename(dir) || dir,
      logo: logoOf(item.logo, dir),
      links: linksOf(item.links),
      openedAt: time(item.openedAt),
      repoCount: count(item.repoCount),
      repos: repoSettingsOf(item.repos),
    });
    if (projects.length === MAX_PROJECTS) break;
  }
  return projects;
}

/** A project for a folder with what the folder alone says: its name, and its first letter on a color. */
export function defaultProject(dir: string, repoCount: number, openedAt: number, id: string = randomUUID()): Project {
  return { id, dir, name: basename(dir) || dir, logo: { kind: 'letter', color: colorFor(dir) }, links: [], openedAt, repoCount, repos: { order: [], ignored: [] } };
}

/**
 * The folders opened before projects existed (`recent`, `lastDir` of the old state file), as projects
 * named after their folder, in the same order. Only the last one opened gets a time (`now`): the
 * others' isn't known.
 */
export function fromRecent(recent: unknown, lastDir: unknown, now: number): Project[] {
  const items = (Array.isArray(recent) ? recent : []).filter(
    (item): item is Record<string, unknown> => isRecord(item) && typeof item.dir === 'string' && isAbsolute(item.dir),
  );
  const projects: Project[] = [];
  for (const item of items) {
    const dir = item.dir as string;
    if (projects.some((project) => project.dir === dir)) continue;
    projects.push(defaultProject(dir, count(item.repoCount), dir === lastDir ? now : 0));
  }
  if (typeof lastDir === 'string' && isAbsolute(lastDir) && !projects.some((project) => project.dir === lastDir)) {
    projects.unshift(defaultProject(lastDir, 0, now));
  }
  return projects.slice(0, MAX_PROJECTS);
}

/** Last opened first; the ones never opened keep their order, after the others. */
export function byOpened(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * The projects after the folder `dir` opened: its time and repo count. A folder without a project gets
 * one, made from `template` if given (the New project sheet's), else from the folder alone.
 */
export function markOpened(projects: Project[], dir: string, repoCount: number, now: number, template?: ProjectTemplate): Project[] {
  if (projects.some((project) => project.dir === dir)) {
    return projects.map((project) => (project.dir === dir ? { ...project, openedAt: now, repoCount } : project));
  }
  const added: Project = template ? { ...template, dir, openedAt: now, repoCount } : defaultProject(dir, repoCount, now);
  const next = [...projects, added];
  if (next.length <= MAX_PROJECTS) return next;
  const oldest = byOpened(projects).at(-1);
  return next.filter((project) => project !== oldest);
}

export type CleanInput = Pick<ProjectInput, 'dir' | 'name' | 'links' | 'logo' | 'repos'>;

/**
 * The sheet's input, checked: a name, an absolute folder, links that are web addresses (the first one
 * the main link, each once) and a logo choice. The page isn't trusted: anything else is refused.
 */
export function cleanInput(input: unknown): { ok: true; input: CleanInput } | { ok: false; error: string } {
  const invalid = { ok: false, error: 'Invalid request' } as const;
  if (!isRecord(input)) return invalid;
  const name = text(input.name, MAX_NAME);
  if (name === '') return { ok: false, error: 'The project needs a name' };
  if (typeof input.dir !== 'string' || !isAbsolute(input.dir)) return { ok: false, error: 'Folder not found' };
  const rawLinks: unknown[] = Array.isArray(input.links) ? input.links : [];
  if (rawLinks.length > MAX_LINKS) return { ok: false, error: `A project keeps at most ${MAX_LINKS} links` };
  const links: ProjectLink[] = [];
  for (const item of rawLinks) {
    if (!isRecord(item) || typeof item.url !== 'string') return invalid;
    const url = normalizeLink(item.url);
    if (url === null) return { ok: false, error: `Not a web address: ${item.url.trim().slice(0, 80)}` };
    if (!links.some((link) => link.url === url)) links.push({ url, label: text(item.label, MAX_LABEL) });
  }
  const logo = input.logo;
  if (!isRecord(logo)) return invalid;
  let choice: ProjectInput['logo'];
  if (logo.kind === 'candidate' && typeof logo.id === 'string' && logo.id.length <= 64) choice = { kind: 'candidate', id: logo.id };
  else if (logo.kind === 'keep') choice = { kind: 'keep' };
  else if (logo.kind === 'letter' && isLogoColor(logo.color)) choice = { kind: 'letter', color: logo.color };
  else return invalid;
  return { ok: true, input: { dir: input.dir, name, links, logo: choice, repos: repoSettingsOf(input.repos) } };
}
