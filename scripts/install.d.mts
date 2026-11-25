export declare const BUNDLE_ID: string;
export declare function commandIn(appPath: string): string;
export declare function checkTarget(appPath: string): Promise<'missing' | 'ours' | 'foreign'>;
export declare function checkLink(linkPath: string, target: string): Promise<'missing' | 'ours' | 'foreign'>;
export declare function isRunning(appPath: string): Promise<boolean>;
export declare function install(opts: {
  built: string;
  appPath: string;
  linkPath: string;
  isRunning?: (appPath: string) => Promise<boolean>;
  /** Copies the built app (`ditto` by default); tests pass one that fails. */
  copy?: (from: string, to: string) => Promise<unknown>;
}): Promise<string[]>;
export declare function preflight(opts: {
  appPath: string;
  linkPath: string;
  isRunning?: (appPath: string) => Promise<boolean>;
}): Promise<undefined>;
