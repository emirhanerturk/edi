import { describe, expect, it } from 'vitest';
import { fileIconKind } from '../../src/renderer/files/fileIcons';

describe('fileIconKind', () => {
  it('picks the icon from the file name', () => {
    const cases: [string, string][] = [
      ['play.tsx', 'code'],
      ['main.py', 'code'],
      ['styles.css', 'code'],
      ['schema.prisma', 'data'],
      ['query.SQL', 'data'],
      ['data.json', 'structured'],
      ['config.yml', 'structured'],
      ['Cargo.toml', 'structured'],
      ['README.md', 'text'],
      ['notes.txt', 'text'],
      ['logo.PNG', 'image'],
      ['icon.svg', 'image'],
      ['intro.mp4', 'video'],
      ['backup.tar.gz', 'archive'],
      ['run.sh', 'shell'],
      ['report.csv', 'sheet'],
      ['package.json', 'package'],
      ['package-lock.json', 'lock'],
      ['yarn.lock', 'lock'],
      ['pnpm-lock.yaml', 'lock'],
      ['.env', 'secret'],
      ['.env.local', 'secret'],
      ['.gitignore', 'config'],
      ['tsconfig.renderer.json', 'config'],
      ['vite.config.ts', 'config'],
      ['Dockerfile', 'config'],
      ['Makefile', 'config'],
      ['LICENSE', 'file'],
      ['archive', 'file'],
    ];
    expect(cases.map(([name]) => [name, fileIconKind(name)])).toEqual(cases);
  });
});
