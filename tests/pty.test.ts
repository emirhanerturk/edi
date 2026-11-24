import { afterEach, describe, expect, it } from 'vitest';
import { PtyManager, shellEnv } from '../src/main/pty.js';
import { makeTmpDir } from './helpers/tmpRepo.js';

const managers: PtyManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.killAll();
});

function makeManager() {
  const output = new Map<number, string>();
  const exited: number[] = [];
  const manager = new PtyManager({
    shell: '/bin/sh',
    onData: (id, data) => output.set(id, (output.get(id) ?? '') + data),
    onExit: (id) => exited.push(id),
  });
  managers.push(manager);
  return { manager, output, exited };
}

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('shellEnv', () => {
  it('Claude Code ve Electron izlerini siler, terminali tanıtır', () => {
    const env = shellEnv({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '1234',
      ELECTRON_RUN_AS_NODE: '1',
      EDI_USER_DATA: '/tmp/x',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-is',
      BOS: undefined,
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-is', // kullanıcının kendi ayarı: dokunulmaz
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'edi',
    });
  });
});

describe('PtyManager', () => {
  it('komut çıktısını verir ve çıkışı bildirir', async () => {
    const { manager, output, exited } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    manager.write(id, 'echo edi-$((40+2)); exit\n');

    await until(() => exited.includes(id));
    expect(output.get(id)).toContain('edi-42');
    expect(manager.ids()).toEqual([]);
    expect(manager.info(id)).toBeNull();
  });

  it('kabuğu verilen klasörde ve temizlenmiş ortamla başlatır', async () => {
    process.env.CLAUDECODE = '1';
    try {
      const { manager, output } = makeManager();
      const cwd = await makeTmpDir();
      const id = manager.create({ cols: 80, rows: 24, cwd });
      manager.write(id, 'echo "cwd=$(pwd -P) cc=[${CLAUDECODE-yok}] tp=$TERM_PROGRAM"\n');
      await until(() => (output.get(id) ?? '').includes('tp=edi'));
      expect(output.get(id)).toContain(`cwd=${cwd} cc=[yok] tp=edi`);
    } finally {
      delete process.env.CLAUDECODE;
    }
  });

  it('başlangıç komutunu kabuğun içinde çalıştırır', async () => {
    const { manager, output } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir(), command: 'echo basla-$((1+1))' });
    await until(() => (output.get(id) ?? '').includes('basla-2'));
    expect(manager.ids()).toEqual([id]); // komut bitince kabuk açık kalır
  });

  it("ölü ya da bilinmeyen pty'ye yazmak, boyutlandırmak ve kapatmak hata vermez", async () => {
    const { manager, exited } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    manager.write(id, 'exit\n');
    await until(() => exited.includes(id));

    expect(() => {
      manager.write(id, 'x');
      manager.resize(id, 100, 30);
      manager.kill(id);
      manager.write(999, 'x');
      manager.resize(999, 0, 0);
      manager.kill(999);
    }).not.toThrow();
  });

  it('bir sekmenin çıkışı diğerini etkilemez', async () => {
    const { manager, output, exited } = makeManager();
    const cwd = await makeTmpDir();
    const a = manager.create({ cols: 80, rows: 24, cwd });
    const b = manager.create({ cols: 80, rows: 24, cwd });
    manager.write(a, 'exit\n');
    await until(() => exited.includes(a));

    manager.write(b, 'echo hala-$((2+3))\n');
    await until(() => (output.get(b) ?? '').includes('hala-5'));
    expect(manager.ids()).toEqual([b]);
  });

  it('info tty adını /dev öneki olmadan verir', async () => {
    const { manager } = makeManager();
    const id = manager.create({ cols: 80, rows: 24, cwd: await makeTmpDir() });
    const info = manager.info(id);
    expect(info?.tty).toMatch(/^ttys\d+$/);
    expect(info?.shell).toBe('/bin/sh');
    expect(info?.pid).toBeGreaterThan(0);
  });

  it('killAll hepsini kapatır ve çıkış bildirmez', async () => {
    const { manager, exited } = makeManager();
    const cwd = await makeTmpDir();
    manager.create({ cols: 80, rows: 24, cwd });
    manager.create({ cols: 80, rows: 24, cwd });
    manager.killAll();
    expect(manager.ids()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(exited).toEqual([]);
  });

  it('geçersiz boyutu en küçük boyuta çeker', async () => {
    const { manager } = makeManager();
    const id = manager.create({ cols: 0, rows: Number.NaN, cwd: await makeTmpDir() });
    expect(manager.ids()).toEqual([id]);
    expect(() => manager.resize(id, -5, 0)).not.toThrow();
  });
});
