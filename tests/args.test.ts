import { describe, expect, it } from 'vitest';
import { folderArg } from '../src/main/args.js';

describe('folderArg', () => {
  it('--open=<mutlak yol>; yerini Chromium değiştirse de bulunur', () => {
    expect(folderArg(['/Applications/edi.app/Contents/MacOS/edi', '--open=/Users/u/boş luk/ç'])).toBe('/Users/u/boş luk/ç');
    expect(folderArg(['edi', '--open=/w=x', '--allow-file-access-from-files'])).toBe('/w=x');
  });

  it('bayrak yoksa, boşsa ya da yol göreliyse yok sayılır', () => {
    expect(folderArg(['edi'])).toBeUndefined();
    expect(folderArg(['edi', '--open='])).toBeUndefined();
    expect(folderArg(['edi', '--open=goreli/yol'])).toBeUndefined();
    expect(folderArg(['edi', '--open', '/w'])).toBeUndefined();
  });
});
