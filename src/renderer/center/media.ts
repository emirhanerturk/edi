// Which versions of an image or video a diff compares: the one before and the one after, or only one.
import type { CommitFile, FileChange } from '../../shared/api';
import { type MediaKind, mediaOf } from '../../shared/media';

export interface MediaSide {
  repoPath: string;
  path: string;
  /** The commit it is read from (`id^` is its parent); null for the working tree. */
  rev: string | null;
  /** Changes when the working tree's file may have: the browser doesn't show an old copy. */
  version: number;
}

export interface MediaPair {
  media: MediaKind;
  /** Null when the file was added: there was none before. */
  before: MediaSide | null;
  /** Null when the file was deleted. */
  after: MediaSide | null;
}

/**
 * A commit's (or a stash's) image or video: the parent's version against the commit's. `after`: where the
 * new version is (a stash keeps the files that were new in its third parent).
 */
export function commitMedia(repoPath: string, oid: string, file: CommitFile, after = oid): MediaPair | null {
  const media = mediaOf(file.path)?.media;
  if (!media || !file.diff.binary) return null;
  const added = file.letter === 'A' || file.untracked === true;
  return {
    media,
    before: added ? null : { repoPath, path: file.origPath ?? file.path, rev: `${oid}^`, version: 0 },
    after: file.letter === 'D' ? null : { repoPath, path: file.path, rev: after, version: 0 },
  };
}

/** A changed image or video in the working tree: HEAD's version against the one on disk. */
export function workingMedia(repoPath: string, headOid: string | null, file: FileChange, version: number): MediaPair | null {
  const media = mediaOf(file.path)?.media;
  if (!media) return null;
  const added = headOid === null || file.kind === 'untracked' || file.x === 'A';
  const deleted = file.y === 'D' || (file.y === '.' && file.x === 'D');
  return {
    media,
    before: added ? null : { repoPath, path: file.origPath ?? file.path, rev: headOid, version: 0 },
    after: deleted ? null : { repoPath, path: file.path, rev: null, version },
  };
}
