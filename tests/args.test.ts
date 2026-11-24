import { describe, expect, it } from 'vitest';
import { folderArg } from '../src/main/args.js';

describe('folderArg', () => {
  it('finds --open=<absolute path> even when Chromium moves it', () => {
    expect(folderArg(['/Applications/edi.app/Contents/MacOS/edi', '--open=/Users/u/boş luk/ç'])).toBe('/Users/u/boş luk/ç');
    expect(folderArg(['edi', '--open=/w=x', '--allow-file-access-from-files'])).toBe('/w=x');
  });

  it('ignores the flag when it is missing, empty or relative', () => {
    expect(folderArg(['edi'])).toBeUndefined();
    expect(folderArg(['edi', '--open='])).toBeUndefined();
    expect(folderArg(['edi', '--open=relative/path'])).toBeUndefined();
    expect(folderArg(['edi', '--open', '/w'])).toBeUndefined();
  });
});
