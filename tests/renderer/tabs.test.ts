// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: {} }));
vi.mock('../../src/renderer/terminals/terminals', () => ({}));

const { applyTabStates, applyTitle, removeTab } = await import('../../src/renderer/store');
type Tab = import('../../src/renderer/store').Tab;

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 1,
  title: 'zsh',
  claude: false,
  waiting: false,
  busy: false,
  exited: false,
  claudeUntil: 0,
  titleState: null,
  ...over,
});

describe('applyTabStates', () => {
  it('başlığı, türü ve meşguliyeti günceller', () => {
    const tabs = [tab(), tab({ id: 2 })];
    const next = applyTabStates(tabs, [{ id: 1, title: 'npm run dev', claude: false, busy: true }], 0);
    expect(next[0]).toMatchObject({ title: 'npm run dev', busy: true });
    expect(next[1]).toBe(tabs[1]); // durumu gelmeyen sekme aynı nesne kalır
  });

  it('değişiklik yoksa aynı nesneyi döner', () => {
    const tabs = [tab()];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toBe(tabs[0]);
  });

  it('kapanmış sekmeye dokunmaz', () => {
    const tabs = [tab({ exited: true, title: 'vim' })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toBe(tabs[0]);
  });

  it('Claude Code açılırken gelen "yalnız kabuk" bilgisini yok sayar, süre dolunca kabul eder', () => {
    const tabs = [tab({ title: 'claude', claude: true, claudeUntil: 5000 })];
    const shell = [{ id: 1, title: 'zsh', claude: false, busy: false }];
    expect(applyTabStates(tabs, shell, 1000)[0]).toBe(tabs[0]);
    expect(applyTabStates(tabs, shell, 6000)[0]).toMatchObject({ title: 'zsh', claude: false });
    // Claude gerçekten başladıysa süre beklenmez.
    expect(applyTabStates(tabs, [{ id: 1, title: 'claude', claude: true, busy: true }], 1000)[0]).toMatchObject({ busy: true });
  });

  it("Claude Code'dan çıkılınca bekleme işareti kalkar", () => {
    const tabs = [tab({ title: 'claude', claude: true, waiting: true, busy: true })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toMatchObject({ waiting: false, claude: false });
    expect(applyTabStates(tabs, [{ id: 1, title: 'claude', claude: true, busy: true }], 0)[0]).toBe(tabs[0]);
  });
});

describe('applyTitle', () => {
  const claudeTab = (over: Partial<Tab> = {}) => tab({ title: 'claude', claude: true, ...over });

  it('arka plandaki Claude sekmesi çalışırken beklemeye geçince zil yanar', () => {
    const working = applyTitle(claudeTab(), '◐ Görev', false);
    expect(working).toMatchObject({ titleState: 'working', waiting: false });
    expect(applyTitle(working, '✳ Görev', false)).toMatchObject({ titleState: 'waiting', waiting: true });
  });

  it('etkin sekmede zil yanmaz; sonradan başka sekmeye geçmek de yakmaz', () => {
    const done = applyTitle(applyTitle(claudeTab(), '◑ Görev', true), '✳ Görev', true);
    expect(done).toMatchObject({ titleState: 'waiting', waiting: false });
    // Arka plana geçtikten sonra aynı başlık yinelense de yeni bir şey olmamıştır.
    expect(applyTitle(done, '✳ Görev', false).waiting).toBe(false);
  });

  it('yeni açılmış, hiç çalışmamış oturum zil yakmaz', () => {
    expect(applyTitle(claudeTab(), '✳ Claude Code', false)).toMatchObject({ titleState: 'waiting', waiting: false });
  });

  it('yeniden çalışmaya başlayınca zil söner', () => {
    const waiting = claudeTab({ titleState: 'waiting', waiting: true });
    expect(applyTitle(waiting, '◐ Görev', false)).toMatchObject({ titleState: 'working', waiting: false });
  });

  it("Claude Code'un olmayan başlık durumu değiştirmez", () => {
    const working = claudeTab({ titleState: 'working' });
    expect(applyTitle(working, 'zsh', false)).toBe(working);
    const waiting = claudeTab({ titleState: 'waiting', waiting: true });
    expect(applyTitle(waiting, '', false)).toBe(waiting);
  });

  it('Claude sekmesi olmayan sekmede zil yanmaz', () => {
    const working = applyTitle(tab(), '◐ sahte', false);
    expect(applyTitle(working, '✳ sahte', false).waiting).toBe(false);
  });

  it('kapanmış sekmeye dokunmaz', () => {
    const exited = claudeTab({ exited: true, titleState: 'working' });
    expect(applyTitle(exited, '✳ Görev', false)).toBe(exited);
  });
});

describe('applyTabStates ve zil', () => {
  it('Claude Code kapanınca zil ve başlık durumu sıfırlanır', () => {
    const tabs = [tab({ title: 'claude', claude: true, waiting: true, titleState: 'waiting' })];
    expect(applyTabStates(tabs, [{ id: 1, title: 'zsh', claude: false, busy: false }], 0)[0]).toMatchObject({
      claude: false,
      waiting: false,
      titleState: null,
    });
  });
});

describe('removeTab', () => {
  it('etkin sekme kapanınca sağındaki, yoksa solundaki öne gelir', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 })];
    expect(removeTab(tabs, 2, 2)).toMatchObject({ activeTab: 3, tabs: [{ id: 1 }, { id: 3 }] });
    expect(removeTab(tabs, 3, 3)).toMatchObject({ activeTab: 2 });
    expect(removeTab([tab({ id: 1 })], 1, 1)).toEqual({ tabs: [], activeTab: null });
  });

  it('arka plandaki sekme kapanınca etkin sekme değişmez', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, waiting: true })];
    expect(removeTab(tabs, 1, 2)).toEqual({ tabs: [tabs[0]], activeTab: 1 });
  });

  it('öne gelen sekmenin zili söner: kullanıcı artık ona bakıyor', () => {
    const tabs = [tab({ id: 1 }), tab({ id: 2, claude: true, waiting: true, titleState: 'waiting' })];
    const next = removeTab(tabs, 1, 1);
    expect(next.activeTab).toBe(2);
    expect(next.tabs[0]).toMatchObject({ id: 2, waiting: false, titleState: 'waiting' });
  });
});
