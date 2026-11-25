import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { PsRow } from '../src/procs.js';
import { listServers, parseListening, readListening, serverCandidates, serversFor } from '../src/servers.js';

const row = (pid: number, tty: string, pgid = pid, tpgid = pid, args = 'node'): PsRow => ({ pid, pgid, tpgid, tty, args });

describe('parseListening', () => {
  it('keeps only listeners reachable from localhost, sorted and deduplicated per pid', () => {
    const out = [
      'p100', 'f20', 'n*:5173', 'f21', 'n[::1]:5173', 'f22', 'n127.0.0.1:24678',
      'p200', 'f5', 'n[::]:8080', 'f6', 'n0.0.0.0:4000', 'f7', 'n127.0.1.1:3001',
      'p300', 'f9', 'n192.168.1.5:9000', 'f10', 'n[fe80::1]:9001',
      '',
    ].join('\n');
    expect([...parseListening(out)]).toEqual([
      [100, [5173, 24678]],
      [200, [3001, 4000, 8080]],
    ]);
  });

  it('leaves out a last line cut short', () => {
    expect([...parseListening('p100\nf20\nn*:3000\nf21\nn*:51')]).toEqual([[100, [3000]]]);
    expect([...parseListening('p100\nf20\nn*:3000\n')]).toEqual([[100, [3000]]]);
  });

  it('does not count OS-assigned ephemeral ports (49152 and up) as servers', () => {
    // vite + the Cloudflare plugin: 5173 is the real address; the others are internal ports from listen(0).
    const out = ['p100', 'n*:5173', 'n127.0.0.1:54487', 'p101', 'n127.0.0.1:54488', 'n127.0.0.1:49152', 'n127.0.0.1:49151', ''].join('\n');
    expect([...parseListening(out)]).toEqual([
      [100, [5173]],
      [101, [49151]],
    ]);
  });

  it('skips malformed lines', () => {
    expect([...parseListening('pabc\nn*:1\np5\nn*:\nnfoo\nn*:70000\n')]).toEqual([]);
  });
});

describe('serverCandidates', () => {
  it('picks non-shell processes in edi terminals, background ones included', () => {
    const ptys = [
      { id: 1, pid: 10, tty: 'ttys001' },
      { id: 2, pid: 20, tty: '' },
    ];
    const ps = [
      row(10, 'ttys001'),
      row(11, 'ttys001', 11, 11, 'npm run dev'),
      row(12, 'ttys001', 11, 11, 'node vite'),
      row(13, 'ttys001', 13, 11, 'node server.js'), // in the background via `&`
      row(20, 'ttys002'),
      row(21, 'ttys002', 21, 21),
      row(30, 'ttys009'), // a terminal outside edi
      row(40, ''),
    ];
    expect([...serverCandidates(ptys, ps)]).toEqual([
      [11, 1],
      [12, 1],
      [13, 1],
      [21, 2],
    ]);
  });

  it('excludes the Claude Code process itself but includes the child processes it starts', () => {
    const ptys = [{ id: 1, pid: 10, tty: 'ttys001' }];
    const ps = [
      row(10, 'ttys001'),
      row(11, 'ttys001', 11, 11, 'claude'),
      row(12, 'ttys001', 11, 11, '/Users/x/.local/bin/claude --resume'),
      row(13, 'ttys001', 13, 11, 'npm run dev'),
      row(14, 'ttys001', 13, 11, 'node claude-tools.js'),
    ];
    expect([...serverCandidates(ptys, ps).keys()]).toEqual([13, 14]);
  });
});

describe('serversFor', () => {
  it('sorts by port, lists a port once per tab and uses null when the cwd is unknown', () => {
    const candidates = new Map([[11, 1], [12, 1], [21, 2]]);
    const listening = new Map([[12, [5173, 24678]], [11, [5173]], [21, [3000]], [99, [1]]]);
    const cwds = new Map([[12, '/w/web']]);
    expect(serversFor(candidates, listening, cwds)).toEqual([
      { tabId: 2, port: 3000, pid: 21, cwd: null },
      { tabId: 1, port: 5173, pid: 11, cwd: null },
      { tabId: 1, port: 24678, pid: 12, cwd: '/w/web' },
    ]);
  });
});

describe('listServers', () => {
  it('does not run lsof when there are no non-shell processes', async () => {
    const calls: string[][] = [];
    const run = async (_cmd: string, args: string[]) => (calls.push(args), '');
    expect(await listServers([{ id: 1, pid: 10, tty: 'ttys001' }], [row(10, 'ttys001')], run)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads the candidates' ports and working directories", async () => {
    const calls: string[][] = [];
    const run = async (_cmd: string, args: string[]) => {
      calls.push(args);
      return args.includes('cwd') ? 'p11\nfcwd\nn/w/web\n' : 'p11\nf20\nn*:5173\n';
    };
    const servers = await listServers([{ id: 1, pid: 10, tty: 'ttys001' }], [row(10, 'ttys001'), row(11, 'ttys001', 11, 11)], run);
    expect(servers).toEqual([{ tabId: 1, port: 5173, pid: 11, cwd: '/w/web' }]);
    expect(calls).toEqual([
      ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', '11', '-Fpn'],
      ['-a', '-d', 'cwd', '-p', '11', '-Fpn'],
    ]);
  });

  it('returns an empty list when lsof fails', async () => {
    const run = async () => Promise.reject(new Error('no lsof'));
    expect(await listServers([{ id: 1, pid: 10, tty: 'ttys001' }], [row(10, 'ttys001'), row(11, 'ttys001', 11, 11)], run)).toEqual([]);
  });
});

describe('readListening', () => {
  it('finds the port this process listens on with the real lsof', async () => {
    // Randomly assigned ports (listen(0)) are not counted, so try a free port between 40000 and 48999.
    const server = createServer();
    let port = 0;
    for (let attempt = 0; attempt < 20 && port === 0; attempt++) {
      const candidate = 40000 + Math.floor(Math.random() * 9000);
      port = await new Promise<number>((resolve) => {
        server.once('error', () => resolve(0));
        server.listen(candidate, '127.0.0.1', () => resolve(candidate));
      });
    }
    try {
      expect(port).toBeGreaterThan(0);
      expect((await readListening([process.pid])).get(process.pid)).toContain(port);
    } finally {
      server.close();
    }
  });
});
