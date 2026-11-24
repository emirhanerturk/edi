import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach } from 'vitest';

const run = promisify(execFile);
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Gerçek yolu çözülmüş geçici klasör; test bitince silinir. */
export async function makeTmpDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'edi-')));
  created.push(dir);
  return dir;
}

/** Sıfır dışı çıkışta throw eder. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd });
  return stdout;
}

/** `main` dalında, yerel kullanıcı adı ayarlı repo. `commit: true` ise README ile ilk commit atılır. */
export async function initRepo(parent: string, name: string, opts: { commit?: boolean } = {}): Promise<string> {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  await git(path, 'init', '-q', '-b', 'main');
  await git(path, 'config', 'user.name', 'Test');
  await git(path, 'config', 'user.email', 'test@example.com');
  if (opts.commit) {
    await writeFile(join(path, 'README.md'), 'readme\n');
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', 'chore: init');
  }
  return path;
}

/** Yerel bir bare repo oluşturur, `origin` olarak ekler ve yolunu döner. */
export async function addBareRemote(repoPath: string): Promise<string> {
  const bare = join(await makeTmpDir(), 'origin.git');
  await git(repoPath, 'init', '-q', '--bare', '-b', 'main', bare);
  await git(repoPath, 'remote', 'add', 'origin', bare);
  return bare;
}
