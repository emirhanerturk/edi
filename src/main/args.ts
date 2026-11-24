import { isAbsolute } from 'node:path';

const FLAG = '--open=';

/**
 * The folder passed by the `edi <folder>` command: `--open=<absolute path>`. It is a single argument because Chromium
 * may reorder the second instance's arguments. The script always passes an absolute path.
 */
export function folderArg(argv: string[]): string | undefined {
  const dir = argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length);
  return dir !== undefined && isAbsolute(dir) ? dir : undefined;
}
