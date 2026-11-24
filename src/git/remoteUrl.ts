// The commit's GitHub page. No network access: it looks only at local remote-tracking branches and the remote's URL.
import { runGit } from './exec.js';

const NAME = /^[A-Za-z0-9._-]+$/;

/**
 * The commit's page if the remote's URL is on GitHub; null otherwise. The user name and token in the URL
 * aren't carried into the link: only the owner and repo name are used.
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
 * The GitHub commit page of a remote that has a branch containing the commit (i.e. it was pushed).
 * `origin` comes first. An unpushed commit has no page on GitHub: null.
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
    // The longest match, for remote names that contain "/".
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
