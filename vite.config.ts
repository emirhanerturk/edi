import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * The packaged page loads only its own files: no remote scripts, fonts or requests.
 * Not applied on the dev server (live reload uses an inline script).
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // xterm writes inline styles to measure
    "font-src 'self'",
    // Images and videos in the file view come from the main process's `edi-media:` scheme.
    "img-src 'self' data: edi-media:",
    "media-src edi-media:",
    "connect-src 'none'",
    // The editor's background worker (Monaco) is a file of the app itself.
    "worker-src 'self'",
  ].join('; ');
  return {
    name: 'edi-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`),
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  // Monaco's deep modules and CSS by path; the package's exports map hides the CSS files.
  resolve: { alias: { 'monaco-esm': fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs', import.meta.url)) } },
  worker: { format: 'es' },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
