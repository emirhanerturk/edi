import { describe, expect, it } from 'vitest';
import {
  type CenterState,
  type CenterTarget,
  EMPTY_CENTER,
  activateCenterTab,
  closeCenterTab,
  openTarget,
  pinCenterTab,
  setPanelOpen,
  syncCenter,
  tabId,
} from '../../src/renderer/center/tabs';

const diff = (path: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'diff', repoPath, path });
const file = (path: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'file', repoPath, path });
const brief = (s: CenterState) => s.tabs.map((t) => `${t.kind}:${t.path}${t.pinned ? '*' : ''}${t.id === s.active ? '<' : ''}`);

describe('openTarget', () => {
  it('ilk tık paneli açar ve önizleme sekmesi oluşturur', () => {
    const s = openTarget(EMPTY_CENTER, diff('a.ts'), false);
    expect(s.open).toBe(true);
    expect(brief(s)).toEqual(['diff:a.ts<']);
    expect(s.active).toBe(tabId(diff('a.ts')));
  });

  it('ikinci tek tık aynı önizleme sekmesini yeniden kullanır', () => {
    const s = openTarget(openTarget(EMPTY_CENTER, diff('a.ts'), false), diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:b.ts<']);
  });

  it('çift tık sekmeyi kalıcı yapar; sonraki tek tık yeni sekme açar', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    expect(brief(s)).toEqual(['diff:a.ts*<']);
    s = openTarget(s, diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts<']);
    s = openTarget(s, diff('c.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:c.ts<']);
  });

  it('önizleme sekmesi yerinde değişir, sona taşınmaz', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), false);
    s = openTarget(s, diff('b.ts'), true);
    // a önizlemeydi: b onun yerine geçti ve kalıcı oldu.
    expect(brief(s)).toEqual(['diff:b.ts*<']);
    s = openTarget(s, diff('c.ts'), false);
    s = openTarget(s, diff('d.ts'), true);
    s = openTarget(s, diff('e.ts'), false);
    s = activateCenterTab(s, tabId(diff('b.ts')));
    s = openTarget(s, diff('f.ts'), false);
    expect(brief(s)).toEqual(['diff:b.ts*', 'diff:d.ts*', 'diff:f.ts<']);
  });

  it('açık olan bir şeye tıklamak sekmesine geçer; çift tık onu kalıcı yapar', () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    s = openTarget(s, diff('b.ts'), false);
    s = openTarget(s, diff('a.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*<', 'diff:b.ts']);
    s = openTarget(s, diff('b.ts'), true);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*<']);
    // Tek tık kalıcı sekmeyi önizlemeye çevirmez.
    s = openTarget(s, diff('b.ts'), false);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*<']);
  });

  it("aynı dosyanın diff'i ve içeriği ayrı sekmelerdir; başka repodaki aynı yol da", () => {
    let s = openTarget(EMPTY_CENTER, diff('a.ts'), true);
    s = openTarget(s, file('a.ts'), true);
    s = openTarget(s, file('a.ts', '/w/b'), true);
    expect(s.tabs).toHaveLength(3);
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(3);
  });
});

describe('closeCenterTab', () => {
  const three = () => [diff('a.ts'), diff('b.ts'), diff('c.ts')].reduce((s, t) => openTarget(s, t, true), EMPTY_CENTER);

  it('etkin sekme kapanınca sağındaki, yoksa solundaki öne gelir', () => {
    let s = activateCenterTab(three(), tabId(diff('b.ts')));
    s = closeCenterTab(s, tabId(diff('b.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:c.ts*<']);
    s = closeCenterTab(s, tabId(diff('c.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*<']);
  });

  it('arka plandaki sekme kapanınca etkin sekme değişmez', () => {
    const s = closeCenterTab(three(), tabId(diff('a.ts')));
    expect(brief(s)).toEqual(['diff:b.ts*', 'diff:c.ts*<']);
  });

  it('son sekme kapanınca panel kapanır', () => {
    const s = closeCenterTab(openTarget(EMPTY_CENTER, diff('a.ts'), false), tabId(diff('a.ts')));
    expect(s).toEqual(EMPTY_CENTER);
  });

  it('olmayan sekme için durum aynen kalır', () => {
    const s = three();
    expect(closeCenterTab(s, 'yok')).toBe(s);
    expect(activateCenterTab(s, 'yok')).toBe(s);
    expect(pinCenterTab(s, 'yok')).toBe(s);
  });
});

describe('panel', () => {
  it('kapatınca sekmeler durur; bir şeye tıklayınca eskileriyle birlikte geri gelir', () => {
    let s = openTarget(openTarget(EMPTY_CENTER, diff('a.ts'), true), diff('b.ts'), true);
    s = setPanelOpen(s, false);
    expect(s.open).toBe(false);
    expect(s.tabs).toHaveLength(2);
    s = openTarget(s, diff('c.ts'), false);
    expect(s.open).toBe(true);
    expect(brief(s)).toEqual(['diff:a.ts*', 'diff:b.ts*', 'diff:c.ts<']);
  });

  it('sekme yokken açılamaz', () => {
    expect(setPanelOpen(EMPTY_CENTER, true)).toEqual(EMPTY_CENTER);
  });

  it('pinCenterTab önizlemeyi kalıcı yapar', () => {
    const s = pinCenterTab(openTarget(EMPTY_CENTER, diff('a.ts'), false), tabId(diff('a.ts')));
    expect(brief(s)).toEqual(['diff:a.ts*<']);
  });
});

describe('syncCenter', () => {
  const s = () => {
    let state = openTarget(EMPTY_CENTER, diff('a.ts', '/w/a'), true);
    state = openTarget(state, diff('b.ts', '/w/b'), true);
    return openTarget(state, file('c.ts', '/w/a'), true);
  };

  it('klasör değişince bütün sekmeler kapanır', () => {
    expect(syncCenter(s(), '/w', '/başka', ['/w/a', '/w/b'])).toEqual(EMPTY_CENTER);
    expect(syncCenter(s(), '/w', null, [])).toEqual(EMPTY_CENTER);
  });

  it('kaybolan reponun sekmeleri kapanır, etkin sekme düzeltilir', () => {
    const next = syncCenter(s(), '/w', '/w', ['/w/b']);
    expect(brief(next)).toEqual(['diff:b.ts*<']);
    expect(next.open).toBe(true);
  });

  it('hiç sekme kalmazsa panel kapanır', () => {
    expect(syncCenter(s(), '/w', '/w', [])).toEqual(EMPTY_CENTER);
  });

  it('değişen bir şey yoksa aynı nesneyi döner', () => {
    const state = s();
    expect(syncCenter(state, '/w', '/w', ['/w/a', '/w/b', '/w/c'])).toBe(state);
  });
});

describe('commit sekmeleri', () => {
  const commit = (oid: string, repoPath = '/w/a'): CenterTarget => ({ kind: 'commit', repoPath, path: oid });

  it('önizleme, kalıcı yapma ve kapatma kuralları aynıdır; aynı yoldaki dosyayla karışmaz', () => {
    let s = openTarget(EMPTY_CENTER, commit('a'.repeat(40)), false);
    s = openTarget(s, commit('b'.repeat(40)), false);
    expect(brief(s)).toEqual([`commit:${'b'.repeat(40)}<`]);
    s = openTarget(s, commit('b'.repeat(40)), true);
    s = openTarget(s, file('b'.repeat(40)), false);
    expect(brief(s)).toEqual([`commit:${'b'.repeat(40)}*`, `file:${'b'.repeat(40)}<`]);
    s = closeCenterTab(s, tabId(file('b'.repeat(40))));
    s = closeCenterTab(s, tabId(commit('b'.repeat(40))));
    expect(s.open).toBe(false);
  });

  it('repo kaybolunca commit sekmesi de kapanır', () => {
    const s = openTarget(EMPTY_CENTER, commit('a'.repeat(40), '/w/gitti'), true);
    expect(syncCenter(s, '/w', '/w', ['/w/a']).tabs).toEqual([]);
  });
});
