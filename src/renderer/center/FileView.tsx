import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BlameResult, RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { type Token, highlightLines } from '../highlight/highlight';
import { useApp } from '../store';
import type { EditState } from './editSession';
import { MAX_LINES, lineChanges } from './editor/lineChanges';
import { lineNote } from './editor/lineNote';
import type { EditorHandle } from './editor/monaco';
import { type EditEntry, editEntry, ensureEditEntry } from './editor/registry';
import { FilePane, fileInfo } from './FilePane';
import { tabId } from './tabs';
import { useView, useVersion } from './useView';

/** Last highlighting; when the text changes, the old one stays until the new one arrives (`Code` doesn't use it on a mismatched line). */
function useFileTokens(text: string | null, path: string): Token[][] | null {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  useEffect(() => {
    if (text === null) return;
    let current = true;
    void highlightLines(text, path).then((next) => {
      if (current) setTokens(next);
    });
    return () => {
      current = false;
    };
  }, [text, path]);
  return tokens;
}

type MonacoModule = typeof import('./editor/monaco');
let monacoModule: Promise<MonacoModule> | null = null;
/** Monaco loads once, the first time a text file opens. */
export const loadMonaco = () => (monacoModule ??= import('./editor/monaco'));

const noSubscribe = () => () => undefined;

/** The file's editing state: created once Monaco has loaded and the text has arrived. */
function useEditEntry(id: string, path: string, text: string | null): { entry: EditEntry | null; monaco: MonacoModule | null } {
  const [loaded, setLoaded] = useState<{ entry: EditEntry; monaco: MonacoModule } | null>(null);
  const hasText = text !== null;
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if (!hasText) return;
    let current = true;
    void loadMonaco()
      .then(async (monaco) => {
        const initial = textRef.current ?? '';
        const entry = editEntry(id) ?? (await ensureEditEntry(id, () => monaco.createDocument(initial, path), initial));
        if (current) setLoaded({ entry, monaco });
      })
      .catch(() => undefined); // Monaco failed to load: the read-only lines stay.
    return () => {
      current = false;
    };
  }, [id, path, hasText]);
  return loaded ? { entry: loaded.entry, monaco: loaded.monaco } : { entry: null, monaco: null };
}

interface EditorHostProps {
  entry: EditEntry;
  monaco: MonacoModule;
  repoPath: string;
  path: string;
  /** HEAD's commit: when it moves (a commit, a checkout), the changed lines and blame are read again. */
  headOid: string | null;
  onSave(): void;
  onOpenCommit(oid: string): void;
}

type Blame = Extract<BlameResult, { ok: true }>;

/**
 * Monaco mounted on the file's document, with the changed-line bars (against HEAD) and a muted note
 * at the end of the cursor's line saying who changed it. It saves its scroll position and cursor when
 * it goes away.
 */
function EditorHost({ entry, monaco, repoPath, path, headOid, onSave, onOpenCommit }: EditorHostProps) {
  const element = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  const callbacks = useRef<{ onSave(): void; onOpenCommit(oid: string): void; cursorLine(): void; noteClick(): void }>({
    onSave,
    onOpenCommit,
    cursorLine: () => undefined,
    noteClick: () => undefined,
  });
  callbacks.current.onSave = onSave;
  callbacks.current.onOpenCommit = onOpenCommit;

  useEffect(() => {
    const mounted = monaco.mountEditor(element.current!, entry.doc, {
      onSave: () => callbacks.current.onSave(),
      viewState: entry.viewState,
      onLeave: (viewState) => (entry.viewState = viewState),
      onCursorLine: () => callbacks.current.cursorLine(),
      onNoteClick: () => callbacks.current.noteClick(),
    });
    setHandle(mounted);
    return () => {
      mounted.dispose();
      setHandle(null);
    };
  }, [entry, monaco]);

  // Changed lines: the HEAD version, read again when HEAD moves; compared after each pause in typing.
  const [head, setHead] = useState<{ text: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    void edi.headText(repoPath, path).then(
      (result) => current && setHead(result.ok ? { text: result.text } : null),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [repoPath, path, headOid]);
  useEffect(() => {
    if (!handle) return;
    if (!head) return handle.setChanges([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => handle.setChanges(lineChanges(head.text, entry.doc.getValue()) ?? []);
    update();
    const stop = entry.doc.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [handle, head, entry]);

  // Who changed the cursor's line: blame of the current text, read again after edits and HEAD moves.
  useEffect(() => {
    if (!handle) return;
    let blame: (Blame & { version: number }) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const show = () => {
      const note = blame && blame.version === entry.doc.version() ? lineNote(blame, currentLine, Date.now()) : null;
      handle.setNote(note ? { line: currentLine, text: note.text, link: note.oid !== null } : null);
    };
    const request = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const version = entry.doc.version();
        const text = entry.doc.getValue();
        if (text.split('\n').length > MAX_LINES) return;
        void edi.blame(repoPath, path, text).then(
          (result) => {
            if (!alive || !result.ok || entry.doc.version() !== version) return;
            blame = { ...result, version };
            show();
          },
          () => undefined,
        );
      }, 400);
    };
    let currentLine = 0;
    callbacks.current.cursorLine = () => {
      currentLine = handle.cursorLine();
      show();
    };
    callbacks.current.noteClick = () => {
      const oid = blame?.lines[currentLine - 1];
      if (oid) callbacks.current.onOpenCommit(oid);
    };
    currentLine = handle.cursorLine();
    request();
    const stop = entry.doc.onChange(() => {
      handle.setNote(null);
      request();
    });
    return () => {
      alive = false;
      stop();
      clearTimeout(timer);
      callbacks.current.cursorLine = () => undefined;
      callbacks.current.noteClick = () => undefined;
    };
  }, [handle, entry, repoPath, path, headOid]);

  return <div ref={element} className="monaco-host" />;
}

/** The file view bound to app state. Reread on every status poll of the repo. */
export function FileView({ repo, path }: { repo: RepoView; path: string }) {
  const refreshedAt = useApp((s) => s.workspace.refreshedAt);
  const version = useVersion(refreshedAt, repo.status);
  const { data } = useView(`${repo.path}\n${path}`, () => edi.readFile(repo.path, path), version);
  const text = data?.ok && data.kind === 'text' ? data.text : null;
  const tokens = useFileTokens(text, path);
  const isNew = repo.status?.files.some((file) => file.path === path && file.kind === 'untracked') ?? false;
  // The text is split to count lines: only when the data changes.
  const info = useMemo(() => fileInfo(path, data), [path, data]);
  const id = tabId({ kind: 'file', repoPath: repo.path, path });
  const { entry, monaco } = useEditEntry(id, path, text);
  const session = entry?.session ?? null;
  const subscribe = useCallback((listener: () => void) => (session ? session.subscribe(listener) : () => undefined), [session]);
  const edit: EditState | null = useSyncExternalStore(session ? subscribe : noSubscribe, () => session?.state ?? null);

  useEffect(() => {
    useApp.getState().setCenterInfo(info);
  }, [info]);
  useEffect(() => () => useApp.getState().setCenterInfo(null), []);
  // Every disk read goes to the session: a new version is taken quietly or raises a conflict.
  useEffect(() => {
    if (session && data) session.disk(data);
  }, [session, data]);
  const dirty = edit?.dirty ?? false;
  useEffect(() => {
    if (session) useApp.getState().setUnsaved(id, dirty);
  }, [session, id, dirty]);

  const save = () => void session?.save((next, expected) => edi.writeFile(repo.path, path, next, expected));
  return (
    <FilePane
      repoName={repo.name}
      repoPath={repo.path}
      path={path}
      content={data}
      isNew={isNew}
      tokens={tokens}
      onOpenIn={(editor) => void useApp.getState().openIn(editor, repo.path, path)}
      editor={
        entry && monaco ? (
          <EditorHost
            entry={entry}
            monaco={monaco}
            repoPath={repo.path}
            path={path}
            headOid={repo.status?.headOid ?? null}
            onSave={save}
            onOpenCommit={(oid) => {
              // The file tab stays: the commit opens in the preview tab.
              const app = useApp.getState();
              app.pinCenterTab(id);
              app.openInCenter({ kind: 'commit', repoPath: repo.path, path: oid }, false);
            }}
          />
        ) : null
      }
      edit={edit}
      onSave={save}
      onKeepMine={() => session?.keepMine()}
      onLoadDisk={() => session?.loadDisk()}
      onClose={() => void useApp.getState().closeCenterTab(id)}
    />
  );
}
