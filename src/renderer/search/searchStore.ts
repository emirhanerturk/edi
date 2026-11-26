// The Search tab's state: the form, the results per repository, and replacing what was found.
import { create } from 'zustand';
import type { RepoView, TextFile, TextLine, TextQuery, TextSearchResult } from '../../shared/api';
import { buildPattern } from '../../shared/textPattern';
import { edi } from '../bridge';
import { tabId } from '../center/tabs';
import { useApp } from '../store';

/** At most this many results are listed, across repositories. */
export const LISTED = 2000;
/** Typing waits this long before searching. */
export const DEBOUNCE_MS = 250;

export interface SearchForm {
  pattern: string;
  replacement: string;
  showReplace: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  /** The one repository searched; null for all of them. */
  repo: string | null;
}

export type RepoSearch =
  | { state: 'searching' }
  | { state: 'done'; files: TextFile[]; count: number; truncated: boolean }
  | { state: 'error'; error: string };

/** After a replacement: how many were replaced where, and the files left alone with why. */
export interface ReplaceDone {
  count: number;
  files: number;
  skipped: string[];
}

export const fileKey = (repoPath: string, path: string) => `${repoPath}\n${path}`;
export const lineKey = (repoPath: string, path: string, line: number) => `${repoPath}\n${path}\n${line}`;

const EMPTY_FORM: SearchForm = { pattern: '', replacement: '', showReplace: false, matchCase: false, wholeWord: false, regex: false, include: '', repo: null };

export interface ListedFile {
  repoPath: string;
  path: string;
  stamp: string;
  lines: TextLine[];
  count: number;
}

export interface ListedRepo {
  repoPath: string;
  name: string;
  branch: string | null;
  files: ListedFile[];
  count: number;
  error: string | null;
}

export interface Listing {
  repos: ListedRepo[];
  count: number;
  files: number;
  /** More results exist than are listed. */
  truncated: boolean;
  /** Repositories still being searched. */
  searching: number;
}

/**
 * What the results list shows: the repositories in the project's order, without the dismissed files and
 * lines, cut at LISTED results (whole lines: a line is replaced whole).
 */
export function listing(results: Record<string, RepoSearch>, order: string[], repos: RepoView[], dismissed: Record<string, true>): Listing {
  const byPath = new Map(repos.map((repo) => [repo.path, repo]));
  const out: ListedRepo[] = [];
  let count = 0;
  let files = 0;
  let truncated = false;
  let searching = 0;
  for (const repoPath of order) {
    const repo = byPath.get(repoPath);
    const result = results[repoPath];
    if (!repo || !result) continue;
    if (result.state === 'searching') {
      searching++;
      continue;
    }
    const listed: ListedRepo = { repoPath, name: repo.name, branch: repo.status?.head ?? null, files: [], count: 0, error: null };
    if (result.state === 'error') {
      listed.error = result.error;
      out.push(listed);
      continue;
    }
    if (result.truncated) truncated = true;
    for (const file of result.files) {
      if (dismissed[fileKey(repoPath, file.path)]) continue;
      const lines: TextLine[] = [];
      let fileCount = 0;
      for (const line of file.lines) {
        if (dismissed[lineKey(repoPath, file.path, line.line)]) continue;
        if (count + fileCount >= LISTED) {
          truncated = true;
          break;
        }
        lines.push(line);
        fileCount += line.count;
      }
      if (lines.length === 0) continue;
      listed.files.push({ repoPath, path: file.path, stamp: file.stamp, lines, count: fileCount });
      listed.count += fileCount;
      count += fileCount;
      files++;
    }
    if (listed.files.length > 0) out.push(listed);
  }
  return { repos: out, count, files, truncated, searching };
}

interface SearchStore {
  form: SearchForm;
  /** The search's number, sent along: the results of an older one are dropped. */
  serial: number;
  /** The search the results are for; null before one ran (or for an empty or broken pattern). */
  ran: TextQuery | null;
  results: Record<string, RepoSearch>;
  /** The repositories searched, in the project's order. */
  order: string[];
  dismissed: Record<string, true>;
  /** Folded repositories (path) and files (`repo\npath`). */
  collapsed: Record<string, true>;
  /** The last line opened from the results (`repo\npath\nline`). */
  active: string | null;
  /** Replacing is in progress. */
  busy: boolean;
  /** Replace All's outcome, shown in place of the results. */
  done: ReplaceDone | null;
  /** Why a file was left alone by the last Replace. */
  notice: string | null;
  /** Grows to put the cursor in the search field. */
  focus: number;
  setForm(patch: Partial<SearchForm>): void;
  /** Searches now with the form as it is (Search again). */
  run(): void;
  toggle(key: string): void;
  collapseAll(): void;
  dismiss(key: string): void;
  openLine(repoPath: string, path: string, line: TextLine, pin: boolean): void;
  replaceLines(repoPath: string, path: string, lines: number[] | null): Promise<void>;
  replaceAll(): Promise<void>;
  /** The Search tab, the cursor in its field; `patch` sets where to search (Find in Folder…). */
  focusSearch(patch?: Partial<SearchForm>): void;
  reset(): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastSerial = 0;

/** Fields that change what is found: changing one searches again. */
const SEARCHED: (keyof SearchForm)[] = ['pattern', 'matchCase', 'wholeWord', 'regex', 'include', 'repo'];

const repoName = (repoPath: string) => useApp.getState().workspace.repos.find((repo) => repo.path === repoPath)?.name ?? repoPath;
const unsavedIn = (repoPath: string, path: string) => useApp.getState().unsaved[tabId({ kind: 'file', repoPath, path })] === true;

/** Tells the main process to stop the searches still running, if any. */
const stopRunning = (results: Record<string, RepoSearch>, serial: number) => {
  if (Object.values(results).some((result) => result.state === 'searching')) edi.stopSearch(serial);
};

const toRepoSearch = (result: TextSearchResult): RepoSearch =>
  result.ok ? { state: 'done', files: result.files, count: result.count, truncated: result.truncated } : { state: 'error', error: result.error };

export const useSearch = create<SearchStore>((set, get) => ({
  form: EMPTY_FORM,
  serial: 0,
  ran: null,
  results: {},
  order: [],
  dismissed: {},
  collapsed: {},
  active: null,
  busy: false,
  done: null,
  notice: null,
  focus: 0,

  setForm(patch) {
    const form = { ...get().form, ...patch };
    set({ form });
    if (!SEARCHED.some((key) => patch[key] !== undefined)) return;
    set({ done: null });
    clearTimeout(timer);
    timer = setTimeout(() => get().run(), DEBOUNCE_MS);
  },

  run() {
    clearTimeout(timer);
    const { form } = get();
    const serial = ++lastSerial;
    const repos = useApp.getState().workspace.repos.map((repo) => repo.path);
    const order = form.repo !== null && repos.includes(form.repo) ? [form.repo] : repos;
    const cleared = { serial, results: {}, order, dismissed: {}, done: null, notice: null, active: null };
    if (form.pattern === '' || !buildPattern(form).ok) {
      stopRunning(get().results, serial);
      set({ ...cleared, ran: null });
      return;
    }
    const query: TextQuery = { pattern: form.pattern, regex: form.regex, matchCase: form.matchCase, wholeWord: form.wholeWord, include: form.include };
    set({ ...cleared, ran: query, results: Object.fromEntries(order.map((path) => [path, { state: 'searching' } as RepoSearch])) });
    for (const repoPath of order) {
      void edi.searchText(repoPath, query, serial).then(
        (result) => {
          if (get().serial === serial) set((state) => ({ results: { ...state.results, [repoPath]: toRepoSearch(result) } }));
        },
        () => {
          if (get().serial === serial) set((state) => ({ results: { ...state.results, [repoPath]: { state: 'error', error: 'Could not search this repository' } } }));
        },
      );
    }
  },

  toggle: (key) =>
    set((state) => {
      const { [key]: open, ...rest } = state.collapsed;
      return { collapsed: open ? rest : { ...state.collapsed, [key]: true } };
    }),
  collapseAll: () => set((state) => ({ collapsed: Object.fromEntries(state.order.map((path) => [path, true as const])) })),
  dismiss: (key) => set((state) => ({ dismissed: { ...state.dismissed, [key]: true } })),

  openLine(repoPath, path, line, pin) {
    set({ active: lineKey(repoPath, path, line.line) });
    const app = useApp.getState();
    app.openInCenter({ kind: 'file', repoPath, path }, pin);
    const [start, end] = line.ranges[0] ?? [0, 0];
    app.revealInFile({ repoPath, path, line: line.line, column: line.from + start + 1, length: end - start });
  },

  async replaceLines(repoPath, path, lines) {
    const { ran, form, results, dismissed } = get();
    const result = results[repoPath];
    if (!ran || result?.state !== 'done' || get().busy) return;
    const file = result.files.find((candidate) => candidate.path === path);
    if (!file) return;
    const wanted = (lines ?? file.lines.map((line) => line.line)).filter((line) => !dismissed[lineKey(repoPath, path, line)]);
    if (wanted.length === 0) return;
    const where = `${repoName(repoPath)}/${path}`;
    if (unsavedIn(repoPath, path)) {
      set({ notice: `Not replaced in ${where}: it has unsaved edits in a tab.` });
      return;
    }
    set({ busy: true, notice: null });
    const done = await edi.replaceText(repoPath, path, ran, form.replacement, file.stamp, wanted).catch(() => ({ ok: false as const, error: 'Could not replace' }));
    set((state) => {
      if (!done.ok) {
        const why = 'changed' in done && done.changed ? 'it changed after the search. Search again to include it.' : `${done.error}.`;
        return { busy: false, notice: `Not replaced in ${where}: ${why}` };
      }
      const current = state.results[repoPath];
      if (current?.state !== 'done') return { busy: false };
      const gone = new Set(wanted);
      // The replaced lines leave the list; the file's other lines are still where they were.
      const files = current.files
        .map((candidate) => (candidate.path === path ? { ...candidate, stamp: done.stamp, lines: candidate.lines.filter((line) => !gone.has(line.line)) } : candidate))
        .filter((candidate) => candidate.lines.length > 0);
      return { busy: false, results: { ...state.results, [repoPath]: { ...current, files } } };
    });
  },

  async replaceAll() {
    const { ran, form, results, order, dismissed, busy, serial } = get();
    if (!ran || busy) return;
    const list = listing(results, order, useApp.getState().workspace.repos, dismissed);
    if (list.count === 0 || list.searching > 0) return;
    const asked = await edi.confirmReplaceAll({ count: list.count, pattern: ran.pattern, replacement: form.replacement, files: list.files, repos: list.repos.length });
    // A new search started while the question was up: what was asked about is gone.
    if (!asked || get().serial !== serial) return;
    set({ busy: true, notice: null });
    let count = 0;
    let files = 0;
    const skipped: string[] = [];
    for (const repo of list.repos) {
      for (const file of repo.files) {
        const where = `${repo.name}/${file.path}`;
        if (unsavedIn(file.repoPath, file.path)) {
          skipped.push(`Skipped ${where}: it has unsaved edits in a tab.`);
          continue;
        }
        const lines = file.lines.map((line) => line.line);
        const done = await edi.replaceText(file.repoPath, file.path, ran, form.replacement, file.stamp, lines).catch(() => ({ ok: false as const, error: 'Could not replace' }));
        if (done.ok) {
          count += done.count;
          if (done.count > 0) files++;
        } else if ('changed' in done && done.changed) skipped.push(`Skipped ${where}: it changed after the search. Search again to include it.`);
        else skipped.push(`Skipped ${where}: ${done.error}.`);
      }
    }
    set({ busy: false, done: { count, files, skipped }, results: {}, ran: null });
  },

  focusSearch(patch) {
    useApp.getState().setRightTab('search');
    if (patch) get().setForm(patch);
    set((state) => ({ focus: state.focus + 1 }));
  },

  reset() {
    clearTimeout(timer);
    stopRunning(get().results, ++lastSerial);
    set({ serial: lastSerial, ran: null, results: {}, order: [], dismissed: {}, collapsed: {}, active: null, busy: false, done: null, notice: null, form: { ...get().form, repo: null, include: '' } });
  },
}));

// Another project: the old results mean nothing there.
useApp.subscribe((state, prev) => {
  if (state.workspace.dir !== prev.workspace.dir) useSearch.getState().reset();
});
