import { useEffect, useRef, useState } from 'react';
import { edi } from '../bridge';
import { useApp } from '../store';
import { type EditEntry, ensureEditEntry } from './editor/registry';
import { loadMonaco } from './FileView';
import type { CenterTab } from './tabs';

type MonacoModule = Awaited<ReturnType<typeof loadMonaco>>;

/**
 * A new file not saved yet: an empty editor. It counts as unsaved once it has text. The first save
 * asks where to put it (the Save panel), then the tab becomes that file's tab.
 */
export function UntitledView({ tab }: { tab: CenterTab }) {
  const [loaded, setLoaded] = useState<{ entry: EditEntry; monaco: MonacoModule } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasText, setHasText] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let current = true;
    void loadMonaco()
      .then(async (monaco) => {
        const entry = await ensureEditEntry(tab.id, () => monaco.createDocument('', tab.path), '');
        if (current) setLoaded({ entry, monaco });
      })
      .catch(() => setError('The editor could not load'));
    return () => {
      current = false;
    };
  }, [tab.id, tab.path]);

  const save = async () => {
    if (!loaded || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await edi.saveNew(loaded.entry.doc.getValue(), tab.repoPath === '' ? null : tab.repoPath);
      if (result.ok) useApp.getState().replaceCenterTab(tab.id, { kind: 'file', repoPath: result.repoPath, path: result.path });
      else if (!result.cancelled) setError(result.error);
    } catch {
      setError('Could not save the file');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!loaded) return;
    const { entry, monaco } = loaded;
    const handle = monaco.mountEditor(element.current!, entry.doc, {
      onSave: () => void saveRef.current(),
      viewState: entry.viewState,
      onLeave: (viewState) => (entry.viewState = viewState),
      onCursorLine: () => undefined,
      onNoteClick: () => undefined,
    });
    handle.focus();
    const update = () => {
      const text = entry.doc.getValue() !== '';
      setHasText(text);
      useApp.getState().setUnsaved(tab.id, text);
    };
    update();
    const stop = entry.doc.onChange(update);
    return () => {
      stop();
      handle.dispose();
    };
  }, [loaded, tab.id]);

  return (
    <div className="center-view" data-testid="center-view" data-kind="untitled">
      <div className="view-header" data-testid="view-header">
        <span className="view-path mono">
          <span className="view-name">{tab.path}</span>
        </span>
        <div className="spacer" />
        {hasText && <span className="unsaved-mark">Unsaved</span>}
        <button className="zed-button save-button" title="Save (⌘S)" disabled={saving || !loaded} onClick={() => void save()}>
          Save…
        </button>
      </div>
      {error && (
        <div className="edit-bar error" role="alert">
          Could not save: {error}
        </div>
      )}
      <div className="file-editor" data-testid="file-editor">
        <div ref={element} className="monaco-host" />
      </div>
    </div>
  );
}
