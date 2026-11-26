import { GripVertical } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import type { RepoSettings } from '../../shared/api';
import { orderRepos } from '../../shared/projects';

/** A repo in the sheet's list: shown in the project, or ignored. */
export interface RepoRow {
  name: string;
  kept: boolean;
}

/** The rows for the repos found, in the project's order, the ignored ones unticked. */
export function rowsFor(names: string[], settings: RepoSettings): RepoRow[] {
  const ignored = new Set(settings.ignored);
  return orderRepos(
    names.map((name) => ({ name })),
    settings.order,
  ).map(({ name }) => ({ name, kept: !ignored.has(name) }));
}

/** What the sheet sends: every row's name in the list's order, and the unticked ones. */
export function settingsOf(rows: RepoRow[]): RepoSettings {
  return { order: rows.map((row) => row.name), ignored: rows.filter((row) => !row.kept).map((row) => row.name) };
}

const move = (rows: RepoRow[], from: number, to: number): RepoRow[] => {
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
};

/**
 * The REPOSITORIES section of the project sheet: the repos found in the folder, in the project's order.
 * The handle drags a row, ⌥↑ and ⌥↓ move the focused one; an unticked repo is ignored (left out of edi).
 */
export function RepoList({ rows, onChange }: { rows: RepoRow[]; onChange(rows: RepoRow[]): void }) {
  const list = useRef<HTMLDivElement>(null);
  const dragged = useRef<number | null>(null);
  /** A row moved from the keyboard: its checkbox keeps the focus once it is in its new place. */
  const [moved, setMoved] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (moved === null) return;
    list.current?.querySelector<HTMLInputElement>(`input[data-repo="${CSS.escape(moved)}"]`)?.focus();
    setMoved(null);
  }, [moved]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows.length) return;
    onChange(move(rows, index, to));
    setMoved(rows[index]!.name);
  };

  return (
    <div className="sheet-field">
      <span className="sheet-label" id="sheet-repos">
        REPOSITORIES
      </span>
      <div className="repo-rows" role="group" aria-labelledby="sheet-repos" ref={list}>
        {rows.map((row, index) => (
          <div
            key={row.name}
            className={`repo-pick${row.kept ? '' : ' is-ignored'}`}
            data-testid="repo-row"
            onKeyDown={(event) => onKeyDown(event, index)}
            onDragOver={(event) => {
              if (dragged.current !== null) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragged.current;
              dragged.current = null;
              if (from !== null && from !== index) onChange(move(rows, from, index));
            }}
          >
            <button
              type="button"
              className="repo-handle"
              aria-label={`Move ${row.name}`}
              title="Drag to reorder (⌥↑ ⌥↓)"
              draggable
              onDragStart={(event) => {
                dragged.current = index;
                event.dataTransfer?.setData('text/plain', row.name);
              }}
              onDragEnd={() => {
                dragged.current = null;
              }}
            >
              <GripVertical size={14} strokeWidth={1.8} />
            </button>
            <input
              type="checkbox"
              className="repo-keep"
              aria-label={`Keep ${row.name}`}
              data-repo={row.name}
              checked={row.kept}
              onChange={() => onChange(rows.map((other, at) => (at === index ? { ...other, kept: !other.kept } : other)))}
            />
            <span className="repo-pick-name mono">{row.name}</span>
            {!row.kept && <span className="repo-pick-tag">ignored</span>}
          </div>
        ))}
      </div>
      <span className="sheet-note">Drag to reorder. An unticked repository is left out of edi.</span>
    </div>
  );
}
