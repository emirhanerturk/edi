// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: {} }));
vi.mock('../../src/renderer/terminals/terminals', () => ({}));

const { applyTabStates } = await import('../../src/renderer/store');
type Tab = import('../../src/renderer/store').Tab;

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 1,
  title: 'zsh',
  claude: false,
  waiting: false,
  busy: false,
  exited: false,
  claudeUntil: 0,
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
