import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitWebUrl, githubCommitUrl, remoteWebUrl, repoWebUrl } from '../src/git/remoteUrl.js';
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

describe('repoWebUrl', () => {
  it("builds the repository's page on a known host, named after the host", () => {
    for (const url of ['git@github.com:quizei/app.git', 'ssh://git@github.com/quizei/app.git', 'https://github.com/quizei/app', 'https://token@github.com/quizei/app.git']) {
      expect(repoWebUrl(url), url).toEqual({ url: 'https://github.com/quizei/app', label: 'GitHub' });
    }
    expect(repoWebUrl('git@gitlab.com:group/sub/app.git')).toEqual({ url: 'https://gitlab.com/group/sub/app', label: 'GitLab' });
    expect(repoWebUrl('https://bitbucket.org/team/app.git')).toEqual({ url: 'https://bitbucket.org/team/app', label: 'Bitbucket' });
    expect(repoWebUrl('https://codeberg.org/me/app')).toEqual({ url: 'https://codeberg.org/me/app', label: 'Codeberg' });
  });

  it('returns null for an unknown host, a local path or an odd URL', () => {
    for (const url of ['git@git.example.com:team/app.git', '/srv/git/app.git', 'file:///srv/app.git', 'https://github.com/quizei', 'https://github.com/a/b/c', 'https://github.com/a/b?x=1', 'git@github.com:a/..']) {
      expect(repoWebUrl(url), url).toBeNull();
    }
  });
});

describe('remoteWebUrl', () => {
  it("reads origin's URL; null without a remote or for one on an unknown host", async () => {
    const repo = await initRepo(await makeTmpDir(), 'app');
    expect(await remoteWebUrl(repo)).toBeNull();
    await git(repo, 'remote', 'add', 'upstream', 'git@github.com:other/app.git');
    expect(await remoteWebUrl(repo)).toEqual({ url: 'https://github.com/other/app', label: 'GitHub' });
    await git(repo, 'remote', 'add', 'origin', 'git@github.com:quizei/app.git');
    expect(await remoteWebUrl(repo)).toEqual({ url: 'https://github.com/quizei/app', label: 'GitHub' });
    await addBareRemote(await initRepo(await makeTmpDir(), 'local'));
    const local = await initRepo(await makeTmpDir(), 'local-only');
    await addBareRemote(local);
    expect(await remoteWebUrl(local)).toBeNull();
  });
});
