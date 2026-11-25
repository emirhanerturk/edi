import { describe, expect, it, vi } from 'vitest';
import { AUTO_FETCH_MS, AutoFetch, FOCUS_FETCH_MS } from '../src/main/autoFetch.js';
import type { RepoView } from '../src/shared/api.js';

const view = (name: string, hasRemote = true): RepoView => ({ name, path: `/w/${name}`, status: null, error: null, busy: null, claude: 0, hasRemote });

function setup(opts: { repos?: RepoView[]; enabled?: boolean; online?: boolean; ran?: (path: string) => boolean } = {}) {
  let now = 1_000_000;
  const state = { online: opts.online ?? true, repos: opts.repos ?? [view('a'), view('b'), view('local', false)] };
  const fetch = vi.fn(async (path: string) => opts.ran?.(path) ?? true);
  const auto = new AutoFetch({ repos: () => state.repos, fetch, isOnline: () => state.online, now: () => now }, opts.enabled ?? true);
  return { auto, fetch, state, advance: (ms: number) => (now += ms) };
}

const fetched = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([path]) => path);

describe('AutoFetch', () => {
  it('fetches every repo with a remote, then each again only once it is due', async () => {
    const { auto, fetch, advance } = setup();
    await auto.tick();
    expect(fetched(fetch)).toEqual(['/w/a', '/w/b']);
    fetch.mockClear();
    advance(AUTO_FETCH_MS - 1);
    await auto.tick();
    expect(fetch).not.toHaveBeenCalled();
    advance(1);
    await auto.tick();
    expect(fetched(fetch)).toEqual(['/w/a', '/w/b']);
  });

  it('coming back to the window fetches what was not fetched for a minute', async () => {
    const { auto, fetch, advance } = setup();
    await auto.tick();
    fetch.mockClear();
    advance(FOCUS_FETCH_MS - 1);
    await auto.focus();
    expect(fetch).not.toHaveBeenCalled();
    advance(1);
    await auto.focus();
    expect(fetched(fetch)).toEqual(['/w/a', '/w/b']);
  });

  it('a skipped repo (busy, failing) is tried again on the next round', async () => {
    let skip = true;
    const { auto, fetch } = setup({ ran: (path) => path !== '/w/a' || !skip });
    await auto.tick();
    fetch.mockClear();
    skip = false;
    await auto.tick();
    expect(fetched(fetch)).toEqual(['/w/a']);
  });

  it('does nothing while off or offline; turned back on, it fetches at once', async () => {
    const { auto, fetch, state } = setup({ enabled: false });
    await auto.tick();
    await auto.focus();
    expect(fetch).not.toHaveBeenCalled();
    state.online = false;
    auto.setEnabled(true);
    await auto.tick();
    expect(fetch).not.toHaveBeenCalled();
    state.online = true;
    auto.setEnabled(true);
    await vi.waitFor(() => expect(fetched(fetch)).toEqual(['/w/a', '/w/b']));
  });

  it('one repo at a time, and a round does not start while one runs', async () => {
    let release: () => void = () => undefined;
    let active = 0;
    let most = 0;
    const { auto, fetch } = setup();
    fetch.mockImplementation(async () => {
      most = Math.max(most, ++active);
      await new Promise<void>((resolve) => (release = resolve));
      active--;
      return true;
    });
    const round = auto.tick();
    await auto.tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    release();
    await round;
    expect(most).toBe(1);
  });
});
