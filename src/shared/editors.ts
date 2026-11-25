// The editors a file or repo can be opened in ("Open in…"), in the order the menu lists them.

export const EDITORS = [
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'zed', name: 'Zed' },
] as const;

export type EditorId = (typeof EDITORS)[number]['id'];

export const isEditorId = (value: unknown): value is EditorId => EDITORS.some((editor) => editor.id === value);

export const editorName = (id: EditorId): string => EDITORS.find((editor) => editor.id === id)!.name;
