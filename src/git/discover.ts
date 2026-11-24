import { access, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface Repo {
  name: string;
  path: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns just `dir` if it is a git repo; otherwise the repos one level below it, sorted by name.
 * `.git` can be a directory or a file (worktree, submodule).
 */
export async function discoverRepos(dir: string): Promise<Repo[]> {
  if (await exists(join(dir, '.git'))) return [{ name: basename(dir), path: dir }];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const repos: Repo[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return;
      const path = join(dir, entry.name);
      if (await exists(join(path, '.git'))) repos.push({ name: entry.name, path });
    }),
  );
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}
