import { afterEach, describe, expect, it } from 'vitest';
import { childEnv, setLoginEnv } from '../src/childEnv.js';
import { runGit } from '../src/git/exec.js';
import { initRepo, makeTmpDir } from './helpers/tmpRepo.js';

afterEach(() => setLoginEnv(null));

describe('childEnv', () => {
  it("adds the login shell's environment for child processes without touching the app's own", async () => {
    const path = process.env.PATH;
    setLoginEnv({ ELECTRON_RUN_AS_NODE: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'edi.probe', GIT_CONFIG_VALUE_0: 'yes' });
    expect(childEnv().GIT_CONFIG_COUNT).toBe('1');
    expect(childEnv().ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(process.env.PATH).toBe(path);
    // git sees it.
    const repo = await initRepo(await makeTmpDir(), 'a');
    const read = await runGit(repo, ['config', '--get', 'edi.probe']);
    expect(read.ok && read.stdout.trim()).toBe('yes');
  });

  it("is a copy of the app's environment until the login shell's arrives", () => {
    const env = childEnv();
    expect(env).toEqual({ ...process.env });
    env.X_EDI_CHANGED = '1';
    expect(process.env.X_EDI_CHANGED).toBeUndefined();
  });
});
