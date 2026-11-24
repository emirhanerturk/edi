import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitWebUrl, githubCommitUrl } from '../src/git/remoteUrl.js';
import { addBareRemote, git, initRepo, makeTmpDir } from './helpers/tmpRepo.js';

const OID = 'a'.repeat(40);

describe('githubCommitUrl', () => {
  it("GitHub'ın ssh ve https adreslerinden commit sayfası", () => {
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

  it('adresteki kullanıcı adı ve token bağlantıya taşınmaz', () => {
    expect(githubCommitUrl('https://me:ghp_secret@github.com/quizei/app.git', OID)).toBe(`https://github.com/quizei/app/commit/${OID}`);
  });

  it("GitHub olmayan, eksik ya da tuhaf adreslerde null", () => {
    for (const url of ['git@gitlab.com:quizei/app.git', 'https://github.com/quizei', '/tmp/origin.git', 'https://github.com.evil.dev/a/b', 'https://github.com/a/b/c', 'https://github.com/a/b?x', '']) {
      expect(githubCommitUrl(url, OID), url).toBeNull();
    }
  });
});

describe('commitWebUrl', () => {
  it("push edilmiş commit için uzak reponun commit sayfası; push edilmemiş ya da uzak yoksa null", async () => {
    const repo = await initRepo(await makeTmpDir(), 'a', { commit: true });
    const first = (await git(repo, 'rev-parse', 'HEAD')).trim();
    expect(await commitWebUrl(repo, first)).toBeNull();

    await addBareRemote(repo);
    await git(repo, 'push', '-q', '-u', 'origin', 'main');
    await writeFile(join(repo, 'b.txt'), 'b\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feat: b');
    const local = (await git(repo, 'rev-parse', 'HEAD')).trim();
    // Yerel bir bare repo GitHub değildir.
    expect(await commitWebUrl(repo, first)).toBeNull();

    // Ağa çıkmadan: adres GitHub'a çevrilir, uzak dallar olduğu gibi kalır.
    await git(repo, 'remote', 'set-url', 'origin', 'git@github.com:quizei/app.git');
    expect(await commitWebUrl(repo, first)).toBe(`https://github.com/quizei/app/commit/${first}`);
    expect(await commitWebUrl(repo, local)).toBeNull();
  });
});
