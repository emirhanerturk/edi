import { describe, expect, it } from 'vitest';
import { leftOut } from '../scripts/pack.mjs';

describe('leftOut', () => {
  it('keeps the compiled code, package.json and runtime dependencies; leaves out the rest and tool caches', () => {
    for (const kept of ['', '/package.json', '/dist', '/dist/main/main.js', '/node_modules', '/node_modules/@xterm/xterm/lib/xterm.js']) {
      expect(leftOut(kept, 'arm64')).toBe(false);
    }
    for (const out of ['/src', '/tests/a.test.ts', '/README.md', '/node_modules/.vite', '/node_modules/.bin/tsc']) {
      expect(leftOut(out, 'arm64')).toBe(true);
    }
  });

  it("keeps of node-pty only its JavaScript and this Mac's prebuilt binary", () => {
    const pty = (path: string) => leftOut(`/node_modules/node-pty${path}`, 'arm64');
    for (const kept of ['', '/package.json', '/LICENSE', '/lib/index.js', '/prebuilds', '/prebuilds/darwin-arm64/pty.node', '/prebuilds/darwin-arm64/spawn-helper']) {
      expect(pty(kept)).toBe(false);
    }
    for (const out of ['/prebuilds/darwin-x64/pty.node', '/prebuilds/win32-x64/conpty.dll', '/deps/winpty', '/third_party/conpty', '/src/unix/pty.cc', '/binding.gyp', '/typings/node-pty.d.ts', '/scripts/post-install.js']) {
      expect(pty(out)).toBe(true);
    }
  });
});
