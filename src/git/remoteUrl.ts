// Commit'in GitHub sayfası. Ağa çıkmaz: yalnız yerel uzak dallara ve uzak reponun adresine bakar.
import { runGit } from './exec.js';

const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Uzak reponun adresi GitHub'daysa commit'in sayfası; değilse null. Adresteki kullanıcı adı ve
 * token bağlantıya taşınmaz: yalnız sahip ve repo adı kullanılır.
 */
export function githubCommitUrl(remoteUrl: string, oid: string): string | null {
  let path: string;
  const scp = /^[^@/\s]+@github\.com:(.+)$/i.exec(remoteUrl);
  if (scp) path = scp[1]!;
  else {
    let url: URL;
    try {
      url = new URL(remoteUrl);
    } catch {
      return null;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com') return null;
    if (url.search !== '' || url.hash !== '') return null;
    path = url.pathname.replace(/^\/+/, '');
  }
  const parts = path.replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || !parts.every((part) => NAME.test(part) && part !== '.' && part !== '..')) return null;
  return `https://github.com/${parts[0]}/${parts[1]}/commit/${oid}`;
}

/**
 * Commit'i içeren bir uzak dal (push edilmiş) varsa o uzak reponun GitHub commit sayfası.
 * `origin` önce gelir. Push edilmemiş commit'in sayfası GitHub'da yoktur: null.
 */
export async function commitWebUrl(repo: string, oid: string): Promise<string | null> {
  const [refs, remotes] = await Promise.all([
    runGit(repo, ['for-each-ref', '--format=%(refname)', '--contains', oid, 'refs/remotes']),
    runGit(repo, ['remote']),
  ]);
  if (!refs.ok || !remotes.ok) return null;
  const names = remotes.stdout.split('\n').filter((name) => name !== '');
  const containing = new Set<string>();
  for (const ref of refs.stdout.split('\n')) {
    // Adında "/" olan uzak adlarında en uzun eşleşme.
    const remote = names.filter((name) => ref.startsWith(`refs/remotes/${name}/`)).sort((a, b) => b.length - a.length)[0];
    if (remote) containing.add(remote);
  }
  const ordered = [...containing].sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b)));
  for (const remote of ordered) {
    const url = await runGit(repo, ['remote', 'get-url', '--', remote]);
    const web = url.ok ? githubCommitUrl(url.stdout.trim(), oid) : null;
    if (web) return web;
  }
  return null;
}
