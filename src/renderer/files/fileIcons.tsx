// Monochrome file type icons for the Files tab (Lucide, ISC license).
import {
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideoCamera,
  Database,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { mediaOf } from '../../shared/media';

export type FileIconKind =
  | 'code'
  | 'data'
  | 'structured'
  | 'text'
  | 'image'
  | 'video'
  | 'archive'
  | 'shell'
  | 'sheet'
  | 'package'
  | 'lock'
  | 'secret'
  | 'config'
  | 'file';

const BY_EXTENSION: Record<string, FileIconKind> = {};
const add = (kind: FileIconKind, extensions: string) => {
  for (const extension of extensions.split(' ')) BY_EXTENSION[extension] = kind;
};
add('code', 'ts tsx mts cts js jsx mjs cjs py rb go rs java kt kts swift c h cc cpp hpp cs php vue svelte astro html htm css scss sass less graphql gql lua dart ex exs');
add('data', 'sql prisma db sqlite');
add('structured', 'json jsonc json5 yaml yml toml xml plist');
add('text', 'md mdx txt rst');
add('archive', 'zip tar gz tgz bz2 xz rar 7z');
add('shell', 'sh bash zsh fish');
add('sheet', 'csv tsv xls xlsx');
add('lock', 'lock lockb');

const LOCK_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json']);
const CONFIG_FILES = new Set(['dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile', 'justfile']);

/** Which icon a file gets, from its name. */
export function fileIconKind(name: string): FileIconKind {
  const lower = name.toLowerCase();
  if (lower === 'package.json') return 'package';
  if (LOCK_FILES.has(lower)) return 'lock';
  if (lower === '.env' || lower.startsWith('.env.')) return 'secret';
  if (CONFIG_FILES.has(lower) || /^tsconfig.*\.json$/.test(lower) || /\.config\.[a-z]+$/.test(lower) || /^\.[^.]+rc$/.test(lower)) return 'config';
  const media = mediaOf(lower);
  if (media) return media.media;
  const dot = lower.lastIndexOf('.');
  if (dot > 0) return BY_EXTENSION[lower.slice(dot + 1)] ?? 'file';
  // A dotfile with no other extension (.gitignore, .editorconfig) is configuration.
  return dot === 0 ? 'config' : 'file';
}

const ICONS: Record<FileIconKind, LucideIcon> = {
  code: FileCode,
  data: Database,
  structured: FileBraces,
  text: FileText,
  image: FileImage,
  video: FileVideoCamera,
  archive: FileArchive,
  shell: FileTerminal,
  sheet: FileSpreadsheet,
  package: Package,
  lock: FileLock,
  secret: FileKey,
  config: FileCog,
  file: File,
};

export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[fileIconKind(name)];
  return <Icon size={13} strokeWidth={1.6} className={className} aria-hidden="true" />;
}
