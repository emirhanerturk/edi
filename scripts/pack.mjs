// What goes into edi.app: shared by `npm run dist` and its tests.

/**
 * Whether the packager leaves `path` out (relative to the project, starting with `/`). Only the compiled
 * code, package.json and the runtime dependencies go in; tool caches inside node_modules (.vite,
 * .vitest-cache, .bin) stay out. Of node-pty, only what runs on this Mac: its JavaScript and the
 * prebuilt binary for `arch`, not the other platforms' binaries (some 60 MB for Windows) or the sources
 * it is built from.
 */
export function leftOut(path, arch) {
  if (path === '' || path === '/package.json') return false;
  if (!/^\/(dist|node_modules)(\/|$)/.test(path) || /^\/node_modules\/\./.test(path)) return true;
  const pty = /^\/node_modules\/node-pty\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (!pty) return false;
  const [, top, below] = pty;
  if (top === 'prebuilds') return below !== undefined && below !== `darwin-${arch}`;
  return !['package.json', 'LICENSE', 'lib'].includes(top);
}
