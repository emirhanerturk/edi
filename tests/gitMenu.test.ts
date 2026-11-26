import { describe, expect, it } from 'vitest';
import { gitFileMenuItems, gitFileMenuState } from '../src/main/gitMenu.js';
import type { GitFileMenuState } from '../src/shared/api.js';

const state = (over: Partial<GitFileMenuState> = {}): GitFileMenuState => ({ group: 'changes', deleted: false, untracked: false, canDiscard: true, ...over });
const labels = (over: Partial<GitFileMenuState> = {}) => gitFileMenuItems(state(over)).map((item) => (item.enabled === false ? `(${item.label})` : item.label));

describe('gitFileMenuItems', () => {
  it('a changed file: open it, stage or discard it, copy its path, show it in Finder', () => {
    expect(labels()).toEqual(['Open Changes', 'Open File', 'Open in', '-', 'Stage', 'Discard Changes…', '-', 'Copy Path', 'Copy Relative Path', '-', 'File History', 'Reveal in Finder']);
    expect(gitFileMenuItems(state())[2]!.submenu?.map((item) => item.id)).toEqual(['openIn:antigravity', 'openIn:zed']);
  });

  it('staged: Unstage and no Discard; a new file has no change to open; a deleted one cannot be opened or shown', () => {
    expect(labels({ group: 'staged' })).toEqual(['Open Changes', 'Open File', 'Open in', '-', 'Unstage', '-', 'Copy Path', 'Copy Relative Path', '-', 'File History', 'Reveal in Finder']);
    expect(labels({ untracked: true })[0]).toBe('Open File');
    expect(labels({ untracked: true })).toContain('(File History)');
    expect(labels({ deleted: true })).toEqual(['Open Changes', '(Open File)', '-', 'Stage', 'Discard Changes…', '-', 'Copy Path', 'Copy Relative Path', '-', 'File History', '(Reveal in Finder)']);
  });

  it('a conflict: no Stage, and Discard greyed out', () => {
    expect(labels({ group: 'conflicts', canDiscard: false })).toEqual([
      'Open Changes',
      'Open File',
      'Open in',
      '-',
      '(Discard Changes…)',
      '-',
      'Copy Path',
      'Copy Relative Path',
      '-',
      'File History',
      'Reveal in Finder',
    ]);
  });
});

describe('gitFileMenuState', () => {
  it('takes only a known group and true booleans', () => {
    expect(gitFileMenuState({ group: 'staged', deleted: true, untracked: 'yes', canDiscard: 1 })).toEqual({ group: 'staged', deleted: true, untracked: false, canDiscard: false });
    expect(gitFileMenuState({ group: 'stash' })).toBeNull();
    expect(gitFileMenuState(null)).toBeNull();
  });
});
