import { Replace, ReplaceAll } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { TextLine } from '../../shared/api';
import { buildPattern } from '../../shared/textPattern';
import { CheckIcon, ChevronDown, ChevronRight, CloseIcon, FolderIcon, Spinner } from '../components/icons';
import { menuKeys } from '../components/keys';
import { usePopover } from '../components/usePopover';
import { FileTypeIcon } from '../files/fileIcons';
import { fileLetter, letterColor } from '../git/model';
import { useApp } from '../store';
import { LISTED, type ListedFile, type ListedRepo, fileKey, lineKey, listing, useSearch } from './searchStore';
import './search.css';

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export interface Segment {
  text: string;
  kind: 'plain' | 'match' | 'old' | 'new' | 'more';
}

/**
 * A result line as shown: from its first non-blank (or a little before the first match on a long line),
 * the matches marked; with `replacement`, each match struck through and followed by what replaces it.
 */
export function lineSegments(line: TextLine, replacement: string | null, options: { pattern: string; regex: boolean; matchCase: boolean; wholeWord: boolean }): Segment[] {
  const { text, ranges } = line;
  const lead = text.length - text.trimStart().length;
  let from = lead;
  if (ranges[0] && ranges[0][0] - from > 34) from = ranges[0][0] - 14;
  const out: Segment[] = [];
  if (from > lead || line.from > 0) out.push({ text: '…', kind: 'more' });
  let single: RegExp | null = null;
  if (replacement !== null && options.regex) {
    const built = buildPattern(options);
    // The preview runs on the match alone, without the global flag: what replaces it, as String.replace makes it.
    if (built.ok) single = new RegExp(built.re.source, built.re.flags.replace('g', ''));
  }
  let at = from;
  for (const [start, end] of ranges) {
    if (end <= at) continue;
    const begin = Math.max(start, at);
    if (begin > at) out.push({ text: text.slice(at, begin), kind: 'plain' });
    const old = text.slice(begin, end);
    if (replacement === null) out.push({ text: old, kind: 'match' });
    else {
      out.push({ text: old, kind: 'old' });
      const next = single ? old.replace(single, replacement) : replacement;
      if (next !== '') out.push({ text: next, kind: 'new' });
    }
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: 'plain' });
  if (line.cut) out.push({ text: '…', kind: 'more' });
  return out;
}

function Toggle({ label, title, on, onClick, children }: { label: string; title: string; on: boolean; onClick(): void; children: string }) {
  return (
    <button className={`search-toggle mono${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** "All repositories ▾": the repository searched. */
function RepoFilter() {
  const repos = useApp((s) => s.workspace.repos);
  const current = useSearch((s) => s.form.repo);
  const setForm = useSearch.getState().setForm;
  const menu = usePopover<HTMLDivElement>();
  const picked = repos.find((repo) => repo.path === current) ?? null;
  const pick = (repo: string | null) => {
    menu.setOpen(false);
    setForm({ repo });
  };
  return (
    <div className="search-repo" ref={menu.ref} onKeyDown={menuKeys}>
      <button className={`search-repo-button${picked ? ' picked' : ''}`} aria-haspopup="menu" aria-expanded={menu.open} title={picked?.path} onClick={() => menu.setOpen(!menu.open)}>
        <FolderIcon size={13} />
        <span className="search-repo-label">{picked ? picked.name : 'All repositories'}</span>
        <ChevronDown size={11} />
      </button>
      {menu.open && (
        <div className="menu search-repo-menu" role="menu" aria-label="Repositories">
          {[null, ...repos].map((repo) => (
            <button key={repo?.path ?? ''} className="menu-item" role="menuitem" aria-checked={(repo?.path ?? null) === (picked?.path ?? null)} onClick={() => pick(repo?.path ?? null)}>
              <span className="menu-check">{(repo?.path ?? null) === (picked?.path ?? null) && <CheckIcon size={12} />}</span>
              <span className="menu-item-text">{repo ? repo.name : 'All repositories'}</span>
              {repo?.status && <span className="menu-item-hint mono">{repo.status.head}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Search tab: find in every repository's files, grouped by repository and file, and replace. */
export function SearchPanel() {
  const form = useSearch((s) => s.form);
  const results = useSearch((s) => s.results);
  const order = useSearch((s) => s.order);
  const dismissed = useSearch((s) => s.dismissed);
  const ran = useSearch((s) => s.ran);
  const done = useSearch((s) => s.done);
  const notice = useSearch((s) => s.notice);
  const busy = useSearch((s) => s.busy);
  const focus = useSearch((s) => s.focus);
  const repos = useApp((s) => s.workspace.repos);
  const { setForm, run, replaceAll } = useSearch.getState();
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => listing(results, order, repos, dismissed), [results, order, repos, dismissed]);
  const pattern = useMemo(
    () => (form.pattern === '' ? null : buildPattern(form)),
    // Only what the pattern is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.pattern, form.regex, form.matchCase, form.wholeWord],
  );
  const error = pattern && !pattern.ok ? pattern.error : null;

  useEffect(() => {
    if (focus === 0) return;
    input.current?.focus();
    input.current?.select();
  }, [focus]);

  const searched = form.repo !== null && repos.some((repo) => repo.path === form.repo) ? 1 : repos.length;
  const where = form.repo !== null ? (repos.find((repo) => repo.path === form.repo)?.name ?? 'the repository') : repos.length === 1 ? 'the repository' : `the ${repos.length} repositories`;
  let summary: string;
  if (done) summary = '';
  else if (error) summary = 'Nothing searched yet.';
  else if (form.pattern === '') summary = repos.length === 1 ? 'Searches the repository. Files ignored by git are left out.' : 'Searches every repository in the project. Files ignored by git are left out.';
  else if (!ran) summary = '';
  else if (list.searching > 0 && list.count === 0) summary = `Searching ${plural(searched, 'repository', 'repositories')}…`;
  else if (list.count === 0 && list.repos.length === 0) summary = 'No results';
  else
    summary = `${list.truncated ? `${LISTED.toLocaleString('en-US')}+ results` : plural(list.count, 'result', 'results')} in ${plural(list.files, 'file', 'files')} · ${plural(
      list.repos.filter((repo) => repo.files.length > 0).length,
      'repository',
      'repositories',
    )}`;
  const replacing = form.showReplace && ran !== null;
  const nothingFound = ran !== null && !done && list.searching === 0 && list.repos.length === 0;

  return (
    <div className="search" data-testid="search-panel">
      <div className="search-form">
        <div className="search-row">
          <button
            className="search-expand"
            aria-label="Toggle Replace"
            aria-expanded={form.showReplace}
            title="Toggle Replace"
            onClick={() => setForm({ showReplace: !form.showReplace })}
          >
            {form.showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <label className={`search-field${error ? ' invalid' : ''}`}>
            <input
              ref={input}
              className="mono"
              aria-label="Search"
              placeholder="Search"
              spellCheck={false}
              autoComplete="off"
              value={form.pattern}
              data-testid="search-input"
              onChange={(event) => setForm({ pattern: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') run();
              }}
            />
            <Toggle label="Match Case" title="Match Case" on={form.matchCase} onClick={() => setForm({ matchCase: !form.matchCase })}>
              Aa
            </Toggle>
            <Toggle label="Match Whole Word" title="Match Whole Word" on={form.wholeWord} onClick={() => setForm({ wholeWord: !form.wholeWord })}>
              ab
            </Toggle>
            <Toggle label="Use Regular Expression" title="Use Regular Expression" on={form.regex} onClick={() => setForm({ regex: !form.regex })}>
              .*
            </Toggle>
          </label>
        </div>
        {error && (
          <div className="search-error" role="alert" data-testid="search-error">
            {error}
          </div>
        )}
        {form.showReplace && (
          <div className="search-row indented">
            <label className="search-field">
              <input
                className="mono"
                aria-label="Replace"
                placeholder="Replace"
                spellCheck={false}
                autoComplete="off"
                value={form.replacement}
                data-testid="replace-input"
                onChange={(event) => setForm({ replacement: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.metaKey && event.shiftKey) void replaceAll();
                }}
              />
            </label>
            <button
              className="search-replace-all"
              title="Replace every result below (⇧⌘↵)"
              disabled={busy || list.count === 0 || list.searching > 0}
              onClick={() => void replaceAll()}
            >
              <ReplaceAll size={14} strokeWidth={1.7} aria-hidden="true" />
              <span>Replace all</span>
            </button>
          </div>
        )}
        <div className="search-row indented">
          <RepoFilter />
          <label className="search-field small">
            <input
              className="mono"
              aria-label="Files to include"
              placeholder="Files to include: src/**, !*.test.ts"
              spellCheck={false}
              autoComplete="off"
              value={form.include}
              onChange={(event) => setForm({ include: event.target.value })}
            />
          </label>
        </div>
      </div>
      <div className="search-summary" data-testid="search-summary">
        {list.searching > 0 && <Spinner size={12} />}
        <span>{summary}</span>
      </div>
      {list.truncated && !done && <div className="search-note">Only the first {LISTED.toLocaleString('en-US')} are listed. Narrow the search, or pick one repository.</div>}
      {notice && (
        <div className="search-note warning" role="status">
          {notice}
        </div>
      )}
      <div className="search-results">
        {done ? (
          <ReplacedNote />
        ) : nothingFound ? (
          <div className="search-empty">
            Nothing found in {where}
            {form.include.trim() !== '' ? ' for these files' : ''}. Files ignored by git are not searched.
          </div>
        ) : (
          list.repos.map((repo, index) => <RepoResults key={repo.repoPath} repo={repo} first={index === 0} replacing={replacing} />)
        )}
      </div>
    </div>
  );
}

function ReplacedNote() {
  const done = useSearch((s) => s.done)!;
  return (
    <div className="search-done" data-testid="search-done">
      <div className="search-done-title">
        <CheckIcon size={13} />
        <span>
          {plural(done.count, 'occurrence', 'occurrences')} replaced in {plural(done.files, 'file', 'files')}
        </span>
      </div>
      {done.skipped.map((line) => (
        <div key={line} className="search-done-skipped">
          {line}
        </div>
      ))}
      <div className="search-done-text">The changes are in the Git tab, where you can look them over, commit them or discard them.</div>
      <button className="button-outline" onClick={() => useApp.getState().setRightTab('git')}>
        Show in the Git tab
      </button>
    </div>
  );
}

function RepoResults({ repo, first, replacing }: { repo: ListedRepo; first: boolean; replacing: boolean }) {
  const open = useSearch((s) => !s.collapsed[repo.repoPath]);
  const status = useApp((s) => s.workspace.repos.find((candidate) => candidate.path === repo.repoPath)?.status ?? null);
  const letters = useMemo(() => new Map((status?.files ?? []).map((file) => [file.path, fileLetter(file)])), [status]);
  return (
    <div className={`search-repo-group${first ? ' first' : ''}`} data-testid="search-repo">
      <button className="search-repo-row" aria-expanded={open} onClick={() => useSearch.getState().toggle(repo.repoPath)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="search-repo-name">{repo.name}</span>
        {repo.branch !== null && <span className="search-repo-branch mono">{repo.branch}</span>}
        <div className="spacer" />
        {repo.error === null && <span className="search-repo-count">{repo.count.toLocaleString('en-US')}</span>}
      </button>
      {open && repo.error !== null && <div className="search-repo-error">{repo.error}</div>}
      {open && repo.files.map((file) => <FileResults key={file.path} file={file} letter={letters.get(file.path) ?? ''} replacing={replacing} />)}
    </div>
  );
}

function FileResults({ file, letter, replacing }: { file: ListedFile; letter: string; replacing: boolean }) {
  const key = fileKey(file.repoPath, file.path);
  const open = useSearch((s) => !s.collapsed[key]);
  const active = useSearch((s) => s.active);
  const busy = useSearch((s) => s.busy);
  const form = useSearch((s) => s.form);
  const { toggle, dismiss, replaceLines, openLine } = useSearch.getState();
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  return (
    <>
      <div className="search-file" data-testid="search-file" data-path={file.path}>
        <button className="search-file-main" aria-expanded={open} title={file.path} onClick={() => toggle(key)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FileTypeIcon name={name} className="search-file-icon" />
          <span className="search-file-name" style={letter ? { color: letterColor(letter) } : undefined}>
            {name}
          </span>
          <span className="search-file-dir">{slash === -1 ? '' : file.path.slice(0, slash)}</span>
        </button>
        <span className="search-actions">
          {replacing && (
            <button className="icon-button tiny" aria-label="Replace all in this file" title="Replace all in this file" disabled={busy} onClick={() => void replaceLines(file.repoPath, file.path, null)}>
              <ReplaceAll size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
          )}
          <button className="icon-button tiny" aria-label="Dismiss this file" title="Dismiss" onClick={() => dismiss(key)}>
            <CloseIcon size={11} />
          </button>
        </span>
        <span className="search-count">{file.count.toLocaleString('en-US')}</span>
      </div>
      {open &&
        file.lines.map((line) => {
          const id = lineKey(file.repoPath, file.path, line.line);
          return (
            <div key={line.line} className={`search-line${active === id ? ' active' : ''}`} data-testid="search-line">
              <button
                className="search-line-main mono"
                title={line.text.trim()}
                onClick={() => openLine(file.repoPath, file.path, line, false)}
                onDoubleClick={() => openLine(file.repoPath, file.path, line, true)}
              >
                <span className="search-line-text">
                  {lineSegments(line, replacing ? form.replacement : null, form).map((segment, index) => (
                    <span key={index} className={`seg-${segment.kind}`}>
                      {segment.text}
                    </span>
                  ))}
                </span>
              </button>
              <span className="search-actions">
                {replacing && (
                  <button className="icon-button tiny" aria-label="Replace" title="Replace" disabled={busy} onClick={() => void replaceLines(file.repoPath, file.path, [line.line])}>
                    <Replace size={13} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                )}
                <button className="icon-button tiny" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(id)}>
                  <CloseIcon size={11} />
                </button>
              </span>
              <span className="search-line-number mono">{line.line}</span>
            </div>
          );
        })}
    </>
  );
}
