import { describe, expect, it } from 'vitest';
import { languageOf } from '../../src/renderer/highlight/languages';

describe('languageOf', () => {
  it('uzantıdan dili bulur', () => {
    const cases: [string, string, string][] = [
      ['app/game/play.tsx', 'tsx', 'TypeScript JSX'],
      ['src/a.ts', 'typescript', 'TypeScript'],
      ['a.mts', 'typescript', 'TypeScript'],
      ['a.js', 'javascript', 'JavaScript'],
      ['a.cjs', 'javascript', 'JavaScript'],
      ['a.jsx', 'jsx', 'JavaScript JSX'],
      ['package.json', 'json', 'JSON'],
      ['tsconfig.jsonc', 'jsonc', 'JSON with Comments'],
      ['a.css', 'css', 'CSS'],
      ['a.scss', 'scss', 'SCSS'],
      ['index.html', 'html', 'HTML'],
      ['README.md', 'markdown', 'Markdown'],
      ['a.mdx', 'mdx', 'MDX'],
      ['ci.yml', 'yaml', 'YAML'],
      ['ci.yaml', 'yaml', 'YAML'],
      ['a.toml', 'toml', 'TOML'],
      ['run.sh', 'shellscript', 'Shell'],
      ['a.zsh', 'shellscript', 'Shell'],
      ['a.py', 'python', 'Python'],
      ['a.rb', 'ruby', 'Ruby'],
      ['a.go', 'go', 'Go'],
      ['a.rs', 'rust', 'Rust'],
      ['a.swift', 'swift', 'Swift'],
      ['a.kt', 'kotlin', 'Kotlin'],
      ['a.java', 'java', 'Java'],
      ['a.c', 'c', 'C'],
      ['a.h', 'c', 'C'],
      ['a.cpp', 'cpp', 'C++'],
      ['a.sql', 'sql', 'SQL'],
      ['a.graphql', 'graphql', 'GraphQL'],
      ['icon.svg', 'xml', 'XML'],
      ['Info.plist', 'xml', 'XML'],
      ['schema.prisma', 'prisma', 'Prisma'],
    ];
    for (const [path, id, label] of cases) expect(languageOf(path), path).toEqual({ id, label });
  });

  it('adından tanınan dosyalar', () => {
    expect(languageOf('docker/Dockerfile')).toEqual({ id: 'dockerfile', label: 'Dockerfile' });
    expect(languageOf('Dockerfile.dev')).toEqual({ id: 'dockerfile', label: 'Dockerfile' });
    expect(languageOf('Makefile')).toEqual({ id: 'makefile', label: 'Makefile' });
    expect(languageOf('.env')).toEqual({ id: 'dotenv', label: 'Environment' });
    expect(languageOf('apps/web/.env.local')).toEqual({ id: 'dotenv', label: 'Environment' });
    expect(languageOf('.zshrc')).toEqual({ id: 'shellscript', label: 'Shell' });
  });

  it('büyük harfli uzantıyı tanır', () => {
    expect(languageOf('A.TS')).toEqual({ id: 'typescript', label: 'TypeScript' });
    expect(languageOf('README.MD')).toEqual({ id: 'markdown', label: 'Markdown' });
  });

  it('bilinmeyen ya da uzantısız dosyada null', () => {
    expect(languageOf('.gitignore')).toBeNull();
    expect(languageOf('LICENSE')).toBeNull();
    expect(languageOf('a.xyz')).toBeNull();
    expect(languageOf('klasör.ts/dosya')).toBeNull();
    expect(languageOf('')).toBeNull();
  });
});
