import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RepoView } from '../../shared/api';
import { edi } from '../bridge';
import { type Token, highlightLines } from '../highlight/highlight';
import { useApp } from '../store';
import type { EditState } from './editSession';
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
const loadMonaco = () => (monacoModule ??= import('./editor/monaco'));

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

/** Monaco mounted on the file's document; it saves its scroll position and cursor when it goes away. */
function EditorHost({ entry, monaco, onSave }: { entry: EditEntry; monaco: MonacoModule; onSave(): void }) {
  const element = useRef<HTMLDivElement>(null);
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    const handle = monaco.mountEditor(element.current!, entry.doc, {
      onSave: () => save.current(),
      viewState: entry.viewState,
      onLeave: (viewState) => (entry.viewState = viewState),
    });
    return () => handle.dispose();
  }, [entry, monaco]);
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
      onOpenInZed={() => void useApp.getState().openInZed(repo.path, path)}
      editor={entry && monaco ? <EditorHost entry={entry} monaco={monaco} onSave={save} /> : null}
      edit={edit}
      onSave={save}
      onKeepMine={() => session?.keepMine()}
      onLoadDisk={() => session?.loadDisk()}
      onClose={() => void useApp.getState().closeCenterTab(id)}
    />
  );
}
