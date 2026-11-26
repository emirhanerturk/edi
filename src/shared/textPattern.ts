// The Search tab's pattern and file filter. Pure: both sides build them the same way.

export interface PatternOptions {
  pattern: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The regular expression the options describe, global; a reason for a pattern that isn't valid. Building
 * it runs nothing: a slow pattern only shows when it runs.
 */
export function buildPattern(options: PatternOptions): { ok: true; re: RegExp } | { ok: false; error: string } {
  let source = options.regex ? options.pattern : escape(options.pattern);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return { ok: true, re: new RegExp(source, options.matchCase ? 'g' : 'gi') };
  } catch (error) {
    // "Invalid regular expression: /fetch(/gi: Unterminated group" → "unterminated group".
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.slice(message.lastIndexOf(': ') + 2);
    return { ok: false, error: `Not a valid regular expression: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` };
  }
}

/** A glob as a regular expression: `**` any folders, `*` and `?` within a name; it matches a path's end, from a folder boundary. */
function globToRe(glob: string): RegExp {
  let source = '';
  for (let at = 0; at < glob.length; at++) {
    const c = glob[at]!;
    if (c === '*' && glob[at + 1] === '*') {
      source += '.*';
      at++;
      if (glob[at + 1] === '/') at++;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += escape(c);
  }
  return new RegExp(`(^|/)${source}$`);
}

/**
 * Which paths "Files to include" lets through: comma-separated parts, `!` before a part leaves its files
 * out. A part with `*` or `?` is a glob; one without is found anywhere in the path ("src/", ".ts").
 */
export function includeFilter(filter: string): (path: string) => boolean {
  const parts = filter
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '!');
  if (parts.length === 0) return () => true;
  const test = (part: string): ((path: string) => boolean) => {
    if (!/[*?]/.test(part)) return (path) => path.includes(part);
    const re = globToRe(part);
    return (path) => re.test(path);
  };
  const keep = parts.filter((part) => !part.startsWith('!')).map(test);
  const drop = parts.filter((part) => part.startsWith('!')).map((part) => test(part.slice(1)));
  return (path) => !drop.some((hit) => hit(path)) && (keep.length === 0 || keep.some((hit) => hit(path)));
}

