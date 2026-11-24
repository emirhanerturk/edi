// The open files' editing state, by tab id. It outlives the file view, so edits and undo history
// survive switching tabs; it goes away when the tab closes.
import { useApp } from '../../store';
import { EditSession } from '../editSession';
import type { EditorDocument } from './monaco';

export interface EditEntry {
  doc: EditorDocument;
  session: EditSession;
  /** Scroll position and cursor from the last time the file was shown. */
  viewState: unknown;
}

const entries = new Map<string, EditEntry>();
const creating = new Map<string, Promise<EditEntry>>();

export function editEntry(id: string): EditEntry | null {
  return entries.get(id) ?? null;
}

/** The tab's entry, created from the loaded text the first time. */
export function ensureEditEntry(id: string, create: () => Promise<EditorDocument>, loaded: string): Promise<EditEntry> {
  const existing = entries.get(id);
  if (existing) return Promise.resolve(existing);
  let pending = creating.get(id);
  if (!pending) {
    pending = create().then((doc) => {
      creating.delete(id);
      const entry: EditEntry = { doc, session: new EditSession(doc, loaded), viewState: null };
      // The tab may have closed while Monaco was loading.
      if (!useApp.getState().center.tabs.some((tab) => tab.id === id)) {
        entry.session.dispose();
        doc.dispose();
        return entry;
      }
      entries.set(id, entry);
      return entry;
    });
    creating.set(id, pending);
  }
  return pending;
}

function drop(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  entry.session.dispose();
  entry.doc.dispose();
}

useApp.subscribe((state, prev) => {
  if (state.center.tabs === prev.center.tabs) return;
  const open = new Set(state.center.tabs.map((tab) => tab.id));
  for (const id of [...entries.keys()]) if (!open.has(id)) drop(id);
});
