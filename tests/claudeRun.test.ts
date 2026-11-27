import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAUDE_ARGS, askClaude, claudeEnv, isLimitMessage, outcomeOf, parseResult, resetOf, runClaude } from '../src/main/claudeRun.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

/** A stand-in for `claude`: a shell script, given the environment it needs to run. */
async function fakeClaude(body: string): Promise<{ command: string; dir: string; env: NodeJS.ProcessEnv }> {
  const dir = await makeTmpDir();
  const command = join(dir, 'claude');
  await writeFile(command, `#!/bin/sh\n${body}\n`);
  await chmod(command, 0o755);
  return { command, dir, env: { PATH: process.env.PATH, HOME: dir } };
}

const success = (text: string) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'x' });

describe('parseResult', () => {
  it("reads Claude Code's result: one object, a list of messages, or one per line", () => {
    expect(parseResult(success('- Bir madde'))).toEqual({ isError: false, text: '- Bir madde' });
    expect(parseResult(JSON.stringify([{ type: 'system' }, { type: 'result', subtype: 'success', is_error: false, result: 'ok' }]))).toEqual({ isError: false, text: 'ok' });
    expect(parseResult(`{"type":"system"}\n${success('ok')}\n`)).toEqual({ isError: false, text: 'ok' });
  });

  it('an error result, and none at all', () => {
    expect(parseResult(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false, result: '' }))).toEqual({ isError: true, text: '' });
    expect(parseResult(JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' }))?.isError).toBe(true);
    expect(parseResult('')).toBeNull();
    expect(parseResult('not json')).toBeNull();
  });
});

describe('outcomeOf', () => {
  it('a usage limit, with the reset time an older message carries', () => {
    expect(isLimitMessage("You've hit your limit · resets 2pm (Europe/Istanbul)")).toBe(true);
    expect(isLimitMessage('5-hour limit reached ∙ resets 2pm')).toBe(true);
    expect(isLimitMessage('Invalid API key')).toBe(false);
    expect(resetOf('Claude AI usage limit reached|1760000000')).toBe(1_760_000_000_000);
    const out = JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1760000000' });
    expect(outcomeOf(0, out, '')).toEqual({ ok: false, reason: 'limit', error: 'Claude AI usage limit reached', resetsAt: 1_760_000_000_000 });
  });

  it("an unknown flag is told apart; otherwise stderr's telling line", () => {
    expect(outcomeOf(1, '', "error: unknown option '--tools'\n")).toEqual({ ok: false, reason: 'failed', error: "error: unknown option '--tools'", unknownOption: true });
    expect(outcomeOf(1, '', 'something\nerror: no such thing\n')).toEqual({ ok: false, reason: 'failed', error: 'error: no such thing' });
    expect(outcomeOf(2, '', '')).toEqual({ ok: false, reason: 'failed', error: 'Claude Code stopped (exit code 2)' });
    expect(outcomeOf(0, success('Merhaba'), '')).toEqual({ ok: true, text: 'Merhaba' });
  });
});

describe('claudeEnv', () => {
  it("drops a Claude Code session's marks and the app's own variables, keeps the user's settings", () => {
    const env = claudeEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_USE_BEDROCK: '1', ELECTRON_RUN_AS_NODE: '1', EDI_SHELL: 'x' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1' });
  });
});

describe('runClaude', () => {
  it('sends the prompt on stdin and the flags that leave Claude Code without tools', async () => {
    const fake = await fakeClaude('cat > "$(dirname "$0")/prompt.txt"; printf "%s\\n" "$@" > "$(dirname "$0")/args.txt"; echo \'{"type":"result","subtype":"success","is_error":false,"result":"- Tamam"}\'');
    const outcome = await runClaude({ cwd: fake.dir, prompt: 'Özetle', command: fake.command, env: fake.env, args: CLAUDE_ARGS });
    expect(outcome).toEqual({ ok: true, text: '- Tamam' });
    expect(await readFile(join(fake.dir, 'prompt.txt'), 'utf8')).toBe('Özetle');
    const args = (await readFile(join(fake.dir, 'args.txt'), 'utf8')).split('\n');
    expect(args.slice(0, 5)).toEqual(['-p', '--output-format', 'json', '--tools', '']);
    expect(args).toContain('--no-session-persistence');
  });

  it("missing: Claude Code isn't installed", async () => {
    const dir = await makeTmpDir();
    const outcome = await runClaude({ cwd: dir, prompt: 'x', command: join(dir, 'no-claude'), env: { PATH: dir }, args: CLAUDE_ARGS });
    expect(outcome).toEqual({ ok: false, reason: 'missing', error: "Claude Code isn't installed, or edi can't find it" });
  });

  it('stops when cancelled, and when it takes too long', async () => {
    const fake = await fakeClaude('sleep 30');
    const controller = new AbortController();
    const running = runClaude({ cwd: fake.dir, prompt: 'x', command: fake.command, env: fake.env, args: CLAUDE_ARGS, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await running).toEqual({ ok: false, reason: 'cancelled', error: 'Cancelled' });
    const slow = await runClaude({ cwd: fake.dir, prompt: 'x', command: fake.command, env: fake.env, args: CLAUDE_ARGS, timeoutMs: 100 });
    expect(slow).toEqual({ ok: false, reason: 'failed', error: 'Claude Code took too long and was stopped' });
  });

  it('runs again with fewer flags for a Claude Code too old for them', async () => {
    const fake = await fakeClaude(
      'for a in "$@"; do if [ "$a" = "--tools" ]; then echo "error: unknown option \'--tools\'" >&2; exit 1; fi; done\ncat > /dev/null\necho \'{"type":"result","subtype":"success","is_error":false,"result":"eski"}\'',
    );
    expect(await askClaude({ cwd: fake.dir, prompt: 'x', command: fake.command, env: fake.env })).toEqual({ ok: true, text: 'eski' });
  });
});
