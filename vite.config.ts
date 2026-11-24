import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * Paketlenmiş sayfa yalnız kendi dosyalarını yükler: uzak betik, yazı tipi ya da istek yok.
 * Geliştirme sunucusunda uygulanmaz (anında yenileme satır içi betik kullanır).
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // xterm ölçüm için satır içi stil yazar
    "font-src 'self'",
    // Dosya görünümündeki görsel ve videolar ana sürecin `edi-media:` adresinden gelir.
    "img-src 'self' data: edi-media:",
    "media-src edi-media:",
    "connect-src 'none'",
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
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
