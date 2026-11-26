// Projects: a folder of git repositories with a name, a logo and links. Pure rules shared by the main
// process and the page; nothing here touches the disk or the network.
import type { RepoSettings } from './api.js';

/** The colors a letter logo can take, in the order the sheet offers them. */
export const LOGO_COLORS = ['purple', 'blue', 'cyan', 'green', 'orange', 'gray'] as const;
export type LogoColor = (typeof LOGO_COLORS)[number];

export const isLogoColor = (value: unknown): value is LogoColor => LOGO_COLORS.includes(value as LogoColor);

/** The scheme the page loads logos from; the main process serves only edi's own copies and the images it offered. */
export const LOGO_SCHEME = 'edi-logo';

/** The longest name, link label and link kept. */
export const MAX_NAME = 80;
export const MAX_LABEL = 40;
export const MAX_URL = 2048;
/** How many links a project keeps. */
export const MAX_LINKS = 12;

/** The first letter of the name, upper case; a question mark for an empty name. */
export function letterOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '?' : first.toLocaleUpperCase();
}

/** A color picked from the folder's path, so the projects made without a choice don't all share one. */
export function colorFor(seed: string): LogoColor {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return LOGO_COLORS[hash % LOGO_COLORS.length]!;
}

/** `localhost:3000`, `127.0.0.1`: a local address, which is http by default. */
const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
/** A scheme other than a port: `mailto:`, `javascript:`, `https://`. `quizei.com:8080` has none. */
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * A link as typed, as it is kept: https:// is added when no scheme is given (http:// for a local
 * address). Anything but a web address with a host is refused (null): a `file:`, `javascript:` or an
 * app's own scheme could run something other than the browser.
 */
export function normalizeLink(input: string): string | null {
  const text = input.trim();
  if (text === '' || text.length > MAX_URL || /\s/.test(text)) return null;
  const withScheme = SCHEME.test(text) ? text : `${LOCAL.test(text) ? 'http' : 'https'}://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null;
  // A password in a link would show in the title bar.
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** `quizei.com`, `admin.quizei.com`: the link's host without a leading `www.`. */
export function linkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

/** `quizei.com`, `github.com/emirhanerturk/edi`: the link as written out, without its scheme and a trailing slash. */
export function linkText(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (path.endsWith('/')) path = path.slice(0, -1);
  try {
    path = decodeURI(path);
  } catch {
    // Kept encoded.
  }
  return `${linkHost(url)}${path}`;
}

/** What a link is called in the menus: its label, or its address without one. */
export const linkName = (link: { url: string; label: string }): string => (link.label.trim() !== '' ? link.label.trim() : linkText(link.url));

/** No order set and nothing ignored: the repos alphabetically, all of them. */
export const NO_REPO_SETTINGS: RepoSettings = { order: [], ignored: [] };
/** At most this many names are kept in each list of a project's repo settings. */
export const MAX_REPO_NAMES = 500;

/** Every repo found: the ones named in `order` first, in that order (names gone are skipped), then the others alphabetically. */
export function orderRepos<T extends { name: string }>(found: T[], order: string[]): T[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  const ranked = found.filter((repo) => rank.has(repo.name)).sort((a, b) => rank.get(a.name)! - rank.get(b.name)!);
  const rest = found.filter((repo) => !rank.has(repo.name)).sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...rest];
}

/** The repos a project shows: in its order, without the ignored ones. */
export function arrangeRepos<T extends { name: string }>(found: T[], settings: RepoSettings): T[] {
  const ignored = new Set(settings.ignored);
  return orderRepos(found, settings.order).filter((repo) => !ignored.has(repo.name));
}
