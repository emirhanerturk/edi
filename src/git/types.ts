// Types only: the page (which has no Node access) uses this file too.
import type { ParsedDiff } from './diffParse.js';

export interface FileChange {
  path: string;
  /** The file's old path in a rename entry. */
  origPath: string | null;
  /** Index (stage) status; '.' if unchanged. */
  x: string;
  /** Working tree status; '.' if unchanged. */
  y: string;
  kind: 'changed' | 'untracked' | 'conflicted';
}

export interface RepoStatus {
  /** Branch name; the short commit hash on a detached HEAD. */
  head: string;
  /** Full oid of the HEAD commit; null if there are no commits yet. */
  headOid: string | null;
  detached: boolean;
  /** The repo has no commits yet. */
  unborn: boolean;
  upstream: string | null;
  /** Null if there is no upstream or it was deleted. */
  ahead: number | null;
  behind: number | null;
  /** Number of stashes (`git stash list`); 0 if none. */
  stashes: number;
  files: FileChange[];
}

/**
 * `ignored`: files and folders caught by `.gitignore` (a folder ends with `/`, without its contents).
 * `dirs`: folders with nothing git lists inside them (git leaves empty folders out).
 */
export type FileList = { ok: true; files: string[]; ignored: string[]; dirs: string[] } | { ok: false; error: string };

/** One entry of a folder listing. */
export interface DirEntry {
  name: string;
  dir: boolean;
}
/** One level of a folder; `more`: the number of entries not shown because of the limit. */
export type DirList = { ok: true; entries: DirEntry[]; more: number } | { ok: false; error: string };

/** Saving a file. `conflict`: the disk changed since the edit started, or the file is gone. */
export type WriteResult = { ok: true } | { ok: false; error: string; conflict?: 'changed' | 'missing' };

/** The contents of large and binary files aren't sent to the page; only their kind and size are returned. */
export type FileContent =
  | { ok: true; kind: 'text'; text: string; size: number }
  | { ok: true; kind: 'binary'; size: number }
  | { ok: true; kind: 'tooLarge'; size: number }
  /** Image or video: the content is read from an `edi-media://` URL; `mtime` is for caching. */
  | { ok: true; kind: 'media'; media: 'image' | 'video'; size: number; mtime: number }
  | { ok: false; error: string };

/** The commit details the list needs. */
export interface CommitSummary {
  oid: string;
  short: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** The commit (committer) date, epoch ms. */
  date: number;
  /** Number of parents: 0 for a root, 2+ for a merge. */
  parents: number;
  tags: string[];
}

export type LogResult =
  | {
      ok: true;
      /** Newest first. */
      commits: CommitSummary[];
      /** There are more than requested: "Load 50 more" is useful. */
      hasMore: boolean;
      /** Ids of the loaded commits that haven't been pushed yet. */
      unpushed: string[];
      /** Like `origin/main`; null if there is none or it was deleted. */
      upstream: string | null;
      /** The repo's `user.email` value; null if not set. */
      userEmail: string | null;
    }
  | { ok: false; error: string };

export interface CommitFile {
  path: string;
  /** The old path for a rename or copy. */
  origPath: string | null;
  letter: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  diff: ParsedDiff;
  /** A stash's new file: it was untracked when stashed and comes back untracked (shown as `?`). */
  untracked?: true;
}

export interface CommitDetail extends CommitSummary {
  /** The diff exceeded the limit: no lines for the files, only added/removed counts. */
  tooLarge: boolean;
  /** The text after the subject line, with trailing whitespace trimmed. */
  body: string;
  files: CommitFile[];
  added: number;
  removed: number;
}

/** `webUrl`: the GitHub page if the commit was pushed; null otherwise (the field is absent if it wasn't read). */
export type CommitResult = { ok: true; commit: CommitDetail; webUrl?: string | null } | { ok: false; error: string };

export type HeadText = { ok: true; text: string | null } | { ok: false; error: string };

export interface BlameCommit {
  authorName: string;
  authorEmail: string;
  /** Author time, ms. */
  date: number;
  summary: string;
}

/** `lines[i]`: the commit oid of line i + 1, or null if it isn't committed yet. */
export type BlameResult = { ok: true; lines: (string | null)[]; commits: Record<string, BlameCommit> } | { ok: false; error: string };

/** Commits on the branch that its upstream doesn't have, newest first. `canUndo`: the newest can be undone. */
export type UnpushedResult = { ok: true; commits: CommitSummary[]; canUndo: boolean } | { ok: false; error: string };

/** The upstream's commits not pulled yet, newest first. */
export type IncomingResult = { ok: true; commits: CommitSummary[] } | { ok: false; error: string };

/** A local branch in the branch menu. */
export interface BranchInfo {
  name: string;
  /** Commits not on its upstream yet, and upstream commits it doesn't have, as of the last fetch. 0 without an upstream. */
  ahead: number;
  behind: number;
  /** Committer date of its last commit, in ms. */
  updatedAt: number;
}

/** Local branches, most recently committed to first. */
export type BranchList = { ok: true; branches: BranchInfo[]; current: string | null } | { ok: false; error: string };

/** A stash in the list. */
export interface StashEntry {
  /** The stash commit's full id. The page names a stash by it, never by its position, which shifts. */
  oid: string;
  /** Its position when the list was read (`stash@{index}`); 0 is the newest. */
  index: number;
  /** git's own line: "WIP on main: 1a2b3c4 subject" or "On main: message". */
  subject: string;
  /** The message given when stashing; null for git's default "WIP on …" line. */
  message: string | null;
  /** The branch it was made on; null on a detached HEAD or when the line doesn't say. */
  branch: string | null;
  /** For git's default line: the subject of the commit it was made on top of. */
  baseSubject: string | null;
  /** When it was made, epoch ms. */
  date: number;
  /** It holds new (untracked) files too. */
  untracked: boolean;
}

/** Stashes, newest first. */
export type StashList = { ok: true; stashes: StashEntry[] } | { ok: false; error: string };

export interface StashDetail {
  entry: StashEntry;
  /** The stash commit's short id. */
  short: string;
  /** The tracked changes against the commit it was made on (staged and unstaged together), then the new files (`untracked`). */
  files: CommitFile[];
  added: number;
  removed: number;
  /** The diff exceeded the limit: no lines for the files, only added/removed counts. */
  tooLarge: boolean;
}

/** `gone`: the stash is no longer in the list (popped or dropped). */
export type StashResult = { ok: true; stash: StashDetail } | { ok: false; error: string; gone?: true };
