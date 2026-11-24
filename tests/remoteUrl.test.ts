import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitWebUrl, githubCommitUrl } from '../src/git/remoteUrl.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const OID = 'a'.repeat(40);

describe('githubCommitUrl', () => {
  it('builds the commit page from GitHub ssh and https URLs', () => {
    for (const url of [
      'git@github.com:quizei/app.git',
      'git@github.com:quizei/app',
      'ssh://git@github.com/quizei/app.git',
      'https://github.com/quizei/app.git',
      'https://github.com/quizei/app/',
      'https://GitHub.com/quizei/app',
    ]) {
      expect(githubCommitUrl(url, OID), url).toBe(`https://github.com/quizei/app/commit/${OID}`);
    }
  });

  it('does not carry the user name or token from the URL into the link', () => {
    expect(githubCommitUrl('https://me:ghp_secret@github.com/quizei/app.git', OID)).toBe(`https://github.com/quizei/app/commit/${OID}`);
  });

  it('returns null for non-GitHub, incomplete or odd URLs', () => {
    for (const url of ['git@gitlab.com:quizei/app.git', 'https://github.com/quizei', '/tmp/origin.git', 'https://github.com.evil.dev/a/b', 'https://github.com/a/b/c', 'https://github.com/a/b?x', '']) {
      expect(githubCommitUrl(url, OID), url).toBeNull();
    }
  });
});

describe('commitWebUrl', () => {
  it("returns the remote's commit page for a pushed commit; null when unpushed or without a remote", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const first = (await git(repo, 'rev-parse', 'HEAD')).trim();
    expect(await commitWebUrl(repo, first)).toBeNull();

    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await writeFile(join(repo, 'b.txt'), 'b\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: b');
    const local = (await git(repo, 'rev-parse', 'HEAD')).trim();
    // A local bare repo is not GitHub.
    expect(await commitWebUrl(repo, first)).toBeNull();

    // Without going online: the URL is switched to GitHub and the remote branches stay as they are.
    await git(repo, 'remote', 'set-url', 'origin', 'git@github.com:quizei/app.git');
    expect(await commitWebUrl(repo, first)).toBe(`https://github.com/quizei/app/commit/${first}`);
    expect(await commitWebUrl(repo, local)).toBeNull();
  });
});
