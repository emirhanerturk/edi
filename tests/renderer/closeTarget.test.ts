// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { areaOf, closeTarget, leavesQuickOpen } from '../../src/renderer/components/keys';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('areaOf', () => {
  it('names the panel an element is in, and nothing outside the three', () => {
    document.body.innerHTML = `
      <section class="terminals"><div class="term-host"><textarea></textarea></div></section>
      <section class="center"><div class="center-tab"></div><div class="diff-body"><span>a</span></div></section>
      <section class="git"><div class="git-tabs"></div><div class="tree-row"></div></section>
      <footer class="statusbar"><span>4 repositories</span></footer>`;
    expect(areaOf(document.querySelector('.term-host textarea'))).toBe('terminals');
    expect(areaOf(document.querySelector('.center-tab'))).toBe('center');
    expect(areaOf(document.querySelector('.diff-body span'))).toBe('center');
    expect(areaOf(document.querySelector('.tree-row'))).toBe('side');
    expect(areaOf(document.querySelector('.git-tabs'))).toBe('side');
    expect(areaOf(document.querySelector('.statusbar span'))).toBeNull();
    expect(areaOf(null)).toBeNull();
    expect(areaOf(window)).toBeNull();
  });
});

describe('closeTarget', () => {
  const open = { open: true, active: 'file-1' };

  it('closes the active terminal while the user works in the terminals', () => {
    expect(closeTarget('terminals', open, 2)).toEqual({ kind: 'terminal', id: 2 });
    expect(closeTarget('terminals', open, null)).toBeNull();
  });

  it('closes the center tab from the center panel, and from the side panel where files are opened', () => {
    expect(closeTarget('center', open, 2)).toEqual({ kind: 'center', id: 'file-1' });
    expect(closeTarget('side', open, 2)).toEqual({ kind: 'center', id: 'file-1' });
  });

  it('closes nothing, never a terminal, when the center panel is closed', () => {
    expect(closeTarget('center', { open: false, active: 'file-1' }, 2)).toBeNull();
    expect(closeTarget('side', { open: false, active: null }, 2)).toBeNull();
  });
});

describe('leavesQuickOpen', () => {
  it("closes Quick open for the app's other shortcuts, not for ⌘P or its own ⌘↵", () => {
    expect(['t', 'n', 'w', 'o', 'f', '1', '9'].every(leavesQuickOpen)).toBe(true);
    expect(['p', 'enter', 'arrowdown', 'a', 'c', 'v'].some(leavesQuickOpen)).toBe(false);
  });
});
