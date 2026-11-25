// The operation a repo is in the middle of, read from the files git leaves in its folder while it runs.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoOperation } from './types.js';

/** What git leaves in the repo's own git folder while each operation waits, in the order they are checked. */
const MARKS: [string, RepoOperation][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
];

/**
 * The merge, rebase, cherry-pick or revert waiting to be finished; null if none. A stash applied with
 * conflicts leaves none of these: its conflicts are not part of an operation.
 */
export async function operationIn(gitDir: string): Promise<RepoOperation | null> {
  const found = await Promise.all(MARKS.map(([name]) => stat(join(gitDir, name)).then(() => true, () => false)));
  const at = found.indexOf(true);
  return at === -1 ? null : MARKS[at]![1];
}
