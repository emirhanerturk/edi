import { isAbsolute } from 'node:path';

const FLAG = '--open=';

/**
 * `edi <klasör>` komutunun verdiği klasör: `--open=<mutlak yol>`. Tek parçadır, çünkü Chromium
 * ikinci kopyanın argümanlarını yeniden sıralayabilir. Betik yolu her zaman mutlak verir.
 */
export function folderArg(argv: string[]): string | undefined {
  const dir = argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length);
  return dir !== undefined && isAbsolute(dir) ? dir : undefined;
}
