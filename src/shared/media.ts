// Image and video types that can be previewed; shared by the main process and the page.

export type MediaKind = 'image' | 'video';

const TYPES: Record<string, { media: MediaKind; mime: string }> = {
  png: { media: 'image', mime: 'image/png' },
  jpg: { media: 'image', mime: 'image/jpeg' },
  jpeg: { media: 'image', mime: 'image/jpeg' },
  gif: { media: 'image', mime: 'image/gif' },
  webp: { media: 'image', mime: 'image/webp' },
  avif: { media: 'image', mime: 'image/avif' },
  bmp: { media: 'image', mime: 'image/bmp' },
  ico: { media: 'image', mime: 'image/x-icon' },
  svg: { media: 'image', mime: 'image/svg+xml' },
  mp4: { media: 'video', mime: 'video/mp4' },
  m4v: { media: 'video', mime: 'video/mp4' },
  webm: { media: 'video', mime: 'video/webm' },
  ogv: { media: 'video', mime: 'video/ogg' },
  mov: { media: 'video', mime: 'video/quicktime' },
};

/** Image or video based on the file name's extension; null otherwise. */
export function mediaOf(path: string): { media: MediaKind; mime: string } | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

export const MEDIA_SCHEME = 'edi-media';

/**
 * A commit to read a file at: its id, or one of its first three parents (`<id>^`, `<id>^3`: a stash keeps its
 * new files there). Never an option, a range or a ref name.
 */
export const MEDIA_REV = /^[0-9a-f]{7,64}(?:\^[1-3]?)?$/;

/**
 * The URL the page uses for `<img>`/`<video>`: the working tree's file, or with `rev` the file as it was in
 * that commit. Changing `version` bypasses the browser cache.
 */
export function mediaUrl(repoPath: string, path: string, version: number, rev?: string): string {
  const query = new URLSearchParams({ repo: repoPath, path, v: String(version) });
  if (rev !== undefined) query.set('rev', rev);
  return `${MEDIA_SCHEME}://file/?${query.toString()}`;
}
