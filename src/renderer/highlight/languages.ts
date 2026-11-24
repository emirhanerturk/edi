// Dosya adından dil: renklendirme ve durum çubuğundaki etiket için.

export interface Language {
  /** Shiki'deki dil adı. */
  id: string;
  /** Durum çubuğunda görünen ad. */
  label: string;
}

const lang = (id: string, label: string): Language => ({ id, label });

const TS = lang('typescript', 'TypeScript');
const JS = lang('javascript', 'JavaScript');
const SHELL = lang('shellscript', 'Shell');
const YAML = lang('yaml', 'YAML');
const XML = lang('xml', 'XML');
const C = lang('c', 'C');
const CPP = lang('cpp', 'C++');
const ENV = lang('dotenv', 'Environment');

const BY_EXTENSION: Record<string, Language> = {
  ts: TS,
  mts: TS,
  cts: TS,
  tsx: lang('tsx', 'TypeScript JSX'),
  js: JS,
  mjs: JS,
  cjs: JS,
  jsx: lang('jsx', 'JavaScript JSX'),
  json: lang('json', 'JSON'),
  jsonc: lang('jsonc', 'JSON with Comments'),
  css: lang('css', 'CSS'),
  scss: lang('scss', 'SCSS'),
  html: lang('html', 'HTML'),
  htm: lang('html', 'HTML'),
  md: lang('markdown', 'Markdown'),
  mdx: lang('mdx', 'MDX'),
  yml: YAML,
  yaml: YAML,
  toml: lang('toml', 'TOML'),
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  py: lang('python', 'Python'),
  rb: lang('ruby', 'Ruby'),
  go: lang('go', 'Go'),
  rs: lang('rust', 'Rust'),
  swift: lang('swift', 'Swift'),
  kt: lang('kotlin', 'Kotlin'),
  kts: lang('kotlin', 'Kotlin'),
  java: lang('java', 'Java'),
  c: C,
  h: C,
  cpp: CPP,
  cc: CPP,
  hpp: CPP,
  sql: lang('sql', 'SQL'),
  graphql: lang('graphql', 'GraphQL'),
  gql: lang('graphql', 'GraphQL'),
  xml: XML,
  svg: XML,
  plist: XML,
  prisma: lang('prisma', 'Prisma'),
  ini: lang('ini', 'INI'),
};

const BY_NAME: Record<string, Language> = {
  dockerfile: lang('dockerfile', 'Dockerfile'),
  makefile: lang('makefile', 'Makefile'),
  '.zshrc': SHELL,
  '.bashrc': SHELL,
  '.zprofile': SHELL,
  '.profile': SHELL,
};

/** Bilinmeyen ya da uzantısız dosyada `null`: düz metin olarak gösterilir. */
export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (name === '') return null;
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return BY_NAME.dockerfile!;
  if (name === '.env' || name.startsWith('.env.')) return ENV;
  const dot = name.lastIndexOf('.');
  // Baştaki nokta uzantı değildir (.gitignore).
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

type Loader = () => Promise<{ default: unknown }>;

/** Diller ilk kullanıldıklarında yüklenir; her biri ayrı bir parça olarak paketlenir. */
export const LOADERS: Record<string, Loader> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
};
