// A project's snippets: read from the state file and checked when saved. Every field is validated on its
// own, as for the rest of a project. Doesn't depend on Electron.
import { randomUUID } from 'node:crypto';
import type { Snippet, SnippetInput } from '../shared/api.js';

export const MAX_SNIPPETS = 200;
export const MAX_SNIPPET_NAME = 80;
export const MAX_GROUP = 40;
export const MAX_COMMAND = 10_000;
const ID = /^[a-z0-9-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** One line, trimmed, at most `max` characters. */
const line = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
/** A repo's folder name, as the project's repo settings keep them; '' for the project folder. */
const folderName = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name === '') return '';
  return name === '.' || name === '..' || /[/\\\0]/.test(name) ? null : name;
};

/** The command as kept: Unix line endings, no blank lines at the end. */
export const commandOf = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');

/** The snippets in the state file; a malformed one is dropped, as is a second one with the same id. */
export function snippetsOf(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  const snippets: Snippet[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || snippets.some((other) => other.id === item.id)) continue;
    const name = line(item.name, MAX_SNIPPET_NAME);
    const where = folderName(item.where);
    const command = typeof item.command === 'string' ? commandOf(item.command).slice(0, MAX_COMMAND) : '';
    if (name === '' || where === null || command.trim() === '') continue;
    snippets.push({ id: item.id, name, group: line(item.group, MAX_GROUP), where, command, ask: item.ask === true });
    if (snippets.length === MAX_SNIPPETS) break;
  }
  return snippets;
}

/**
 * The sheet's input, checked against the project's snippets and repositories (`repos`: their folder
 * names). A new snippet gets an id; an edited one keeps its place.
 */
export function saveSnippet(snippets: Snippet[], input: unknown, repos: string[]): { ok: true; snippets: Snippet[]; id: string } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: 'Invalid request' };
  const name = line(input.name, MAX_SNIPPET_NAME);
  if (name === '') return { ok: false, error: 'The snippet needs a name' };
  if (typeof input.command !== 'string' || input.command.length > MAX_COMMAND) return { ok: false, error: `A command has at most ${MAX_COMMAND.toLocaleString('en-US')} characters` };
  const command = commandOf(input.command);
  if (command.trim() === '') return { ok: false, error: 'The snippet needs a command' };
  const where = folderName(input.where);
  if (where === null || (where !== '' && !repos.includes(where))) return { ok: false, error: 'That repository is not in the project' };
  if (typeof input.group !== 'undefined' && typeof input.group !== 'string') return { ok: false, error: 'Invalid request' };
  const fields = { name, group: line(input.group, MAX_GROUP), where, command, ask: input.ask === true };
  if (input.id === undefined) {
    if (snippets.length >= MAX_SNIPPETS) return { ok: false, error: `A project keeps at most ${MAX_SNIPPETS} snippets` };
    const id = randomUUID();
    return { ok: true, snippets: [...snippets, { id, ...fields }], id };
  }
  if (typeof input.id !== 'string' || !snippets.some((snippet) => snippet.id === input.id)) return { ok: false, error: 'Snippet not found' };
  const id = input.id;
  return { ok: true, snippets: snippets.map((snippet) => (snippet.id === id ? { id, ...fields } : snippet)), id };
}

/** "Seed copy", then "Seed copy 2": a name no other snippet has. */
export function copyName(snippets: Snippet[], name: string): string {
  const taken = new Set(snippets.map((snippet) => snippet.name));
  const base = `${name.slice(0, MAX_SNIPPET_NAME - 8)} copy`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A copy of the snippet right after it. */
export function duplicateSnippet(snippets: Snippet[], id: string): { ok: true; snippets: Snippet[]; id: string } | { ok: false; error: string } {
  const index = snippets.findIndex((snippet) => snippet.id === id);
  if (index === -1) return { ok: false, error: 'Snippet not found' };
  if (snippets.length >= MAX_SNIPPETS) return { ok: false, error: `A project keeps at most ${MAX_SNIPPETS} snippets` };
  const copy = { ...snippets[index]!, id: randomUUID(), name: copyName(snippets, snippets[index]!.name) };
  return { ok: true, snippets: [...snippets.slice(0, index + 1), copy, ...snippets.slice(index + 1)], id: copy.id };
}

/** What is typed into the new terminal: the lines one by one, each ended with Return (the last one by the terminal's own). */
export const typedCommand = (command: string) => command.split('\n').join('\r');

/** Where a snippet runs: the project folder `dir`, or its repository (by folder name) while that is still in the project. */
export function placeOf(snippet: Snippet, dir: string, repos: { name: string; path: string }[]): { ok: true; cwd: string; label: string } | { ok: false; error: string } {
  if (snippet.where === '') return { ok: true, cwd: dir, label: 'the project folder' };
  const repo = repos.find((candidate) => candidate.name === snippet.where && candidate.path !== dir);
  return repo ? { ok: true, cwd: repo.path, label: repo.name } : { ok: false, error: `${snippet.where} is not in the project any more` };
}
