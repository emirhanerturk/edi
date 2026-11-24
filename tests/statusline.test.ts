import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTmpDir } from './helpers/tmpRepo.js';

const script = join(import.meta.dirname, '..', 'resources', 'edi-statusline');

/** Runs the script the way Claude Code does: the status arrives as JSON on stdin. */
function runBridge(input: string, file: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile('/bin/sh', [script], { env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', EDI_USAGE_FILE: file } }, (error, stdout) =>
      resolve({ code: error ? Number(error.code) : 0, stdout }),
    );
    child.stdin!.end(input);
  });
}

const status = {
  session_id: 'abc',
  cwd: '/Users/x/secret-project',
  model: { id: 'claude-opus-5-5' },
  rate_limits: { five_hour: { used_percentage: 42, resets_at: 1764000000 }, seven_day: { used_percentage: 18, resets_at: 1764500000 } },
};

describe('edi-statusline bridge', () => {
  it('writes only the rate_limits field to the file (creating its folder) and prints nothing to the status line', async () => {
    const file = join(await makeTmpDir(), 'alt klasör', 'claude-usage.json');
    expect(await runBridge(JSON.stringify(status), file)).toEqual({ code: 0, stdout: '' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(status.rate_limits);
  });

  it('leaves the old file alone and still exits quietly when rate_limits is missing or the input is broken', async () => {
    const file = join(await makeTmpDir(), 'claude-usage.json');
    await writeFile(file, 'old');
    expect(await runBridge(JSON.stringify({ ...status, rate_limits: undefined }), file)).toEqual({ code: 0, stdout: '' });
    expect(await runBridge('broken', file)).toEqual({ code: 0, stdout: '' });
    expect(await readFile(file, 'utf8')).toBe('old');
  });
});
