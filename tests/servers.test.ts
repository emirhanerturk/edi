import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { PsRow } from '../src/procs.js';
import { listServers, parseListening, readListening, serverCandidates, serversFor } from '../src/servers.js';

const row = (pid: number, tty: string, pgid = pid, tpgid = pid, args = 'node'): PsRow => ({ pid, pgid, tpgid, tty, args });

describe('parseListening', () => {
  it("yalnız localhost'tan erişilebilen dinlemeler, pid başına sıralı ve tekrarsız", () => {
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

  it('işletim sisteminin rastgele verdiği portlar (49152 ve üstü) sunucu sayılmaz', () => {
    // vite + Cloudflare eklentisi: 5173 asıl adres, diğerleri listen(0) ile alınmış iç portlar.
    const out = ['p100', 'n*:5173', 'n127.0.0.1:54487', 'p101', 'n127.0.0.1:54488', 'n127.0.0.1:49152', 'n127.0.0.1:49151', ''].join('\n');
    expect([...parseListening(out)]).toEqual([
      [100, [5173]],
      [101, [49151]],
    ]);
  });

  it('bozuk satırları atlar', () => {
    expect([...parseListening('pabc\nn*:1\np5\nn*:\nnfoo\nn*:70000\n')]).toEqual([]);
  });
});

describe('serverCandidates', () => {
  it('edi terminallerindeki kabuk dışı süreçler; arka plandakiler de', () => {
    const ptys = [
      { id: 1, pid: 10, tty: 'ttys001' },
      { id: 2, pid: 20, tty: '' },
    ];
    const ps = [
      row(10, 'ttys001'),
      row(11, 'ttys001', 11, 11, 'npm run dev'),
      row(12, 'ttys001', 11, 11, 'node vite'),
      row(13, 'ttys001', 13, 11, 'node server.js'), // `&` ile arka planda
      row(20, 'ttys002'),
      row(21, 'ttys002', 21, 21),
      row(30, 'ttys009'), // edi dışı terminal
      row(40, ''),
    ];
    expect([...serverCandidates(ptys, ps)]).toEqual([
      [11, 1],
      [12, 1],
      [13, 1],
      [21, 2],
    ]);
  });

  it('Claude Code sürecinin kendisi aday değil; başlattığı alt süreçler aday', () => {
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
  it('port sırasıyla; aynı sekmede aynı port tek; cwd yoksa null', () => {
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
  it('kabuk dışı süreç yoksa lsof çalışmaz', async () => {
    const calls: string[][] = [];
    const run = async (_cmd: string, args: string[]) => (calls.push(args), '');
    expect(await listServers([{ id: 1, pid: 10, tty: 'ttys001' }], [row(10, 'ttys001')], run)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('adayların portlarını ve çalışma dizinlerini okur', async () => {
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

  it('lsof hata verirse boş liste', async () => {
    const run = async () => Promise.reject(new Error('lsof yok'));
    expect(await listServers([{ id: 1, pid: 10, tty: 'ttys001' }], [row(10, 'ttys001'), row(11, 'ttys001', 11, 11)], run)).toEqual([]);
  });
});

describe('readListening', () => {
  it('gerçek lsof ile bu sürecin dinlediği portu bulur', async () => {
    // Rastgele verilen portlar (listen(0)) sayılmadığı için 40000–48999 arasında boş bir port denenir.
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
