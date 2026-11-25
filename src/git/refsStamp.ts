// When a repo's tags or remote branches last changed, read from the file system: no git process per poll.
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { runGit } from './exec.js';

/** The folder holding the refs: `.git`, or the main repo's for a worktree. Null if git can't say. */
export async function commonDir(repo: string): Promise<string | null> {
  const result = await runGit(repo, ['rev-parse', '--git-common-dir']);
  if (!result.ok) return null;
  const dir = result.stdout.trim();
  return isAbsolute(dir) ? dir : join(repo, dir);
}

/**
 * The latest change time among the tags, the remote branches and the packed refs. Creating, moving or
 * deleting a ref renames a file in its folder, which changes that folder's time; `git pack-refs`
 * rewrites `packed-refs`. 0 when none of them exists.
 */
export async function refsStamp(common: string): Promise<number> {
  let latest = 0;
  const note = async (path: string) => {
    const info = await stat(path).catch(() => null);
    if (info) latest = Math.max(latest, info.mtimeMs);
  };
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    await note(dir);
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => walk(join(dir, entry.name))));
  };
  await Promise.all([
    note(join(common, 'packed-refs')),
    // The reftable format keeps every ref in one table list.
    note(join(common, 'reftable', 'tables.list')),
    walk(join(common, 'refs', 'tags')),
    walk(join(common, 'refs', 'remotes')),
  ]);
  return latest;
}
