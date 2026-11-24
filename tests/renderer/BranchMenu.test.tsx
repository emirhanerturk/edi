// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BranchList } from '../../src/shared/api';
import { BranchMenu } from '../../src/renderer/git/BranchMenu';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = new Date(2026, 10, 25, 12, 0).getTime();
const HOUR = 3_600_000;

const list: BranchList = {
  ok: true,
  current: 'feat/ranking-filter',
  branches: [
    { name: 'fix/score-rounding', ahead: 1, behind: 0, updatedAt: NOW - 20 * 60_000 },
    { name: 'feat/ranking-filter', ahead: 0, behind: 2, updatedAt: NOW - 3 * HOUR },
    { name: 'main', ahead: 0, behind: 0, updatedAt: NOW - 5 * 24 * HOUR },
  ],
};

describe('BranchMenu', () => {
  it('lists the current branch first, then each with its counts and the age of its last commit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const onSwitch = vi.fn();
    render(<BranchMenu current="feat/ranking-filter" load={async () => list} onSwitch={onSwitch} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('branch-button'));
    await screen.findByRole('menuitem', { name: /main/ });
    const items = screen.getAllByRole('menuitem').filter((item) => item.classList.contains('branch-item'));
    expect(items.map((item) => item.textContent)).toEqual(['feat/ranking-filter↓23h ago', 'fix/score-rounding↑120m ago', 'main5d ago']);
    expect(items[0]!.querySelector('.menu-check svg')).not.toBeNull();
    expect(items[0]!.title).toBe('feat/ranking-filter · 2 to pull · last commit 3h ago');
    expect(items[1]!.title).toBe('fix/score-rounding · 1 to push · last commit 20m ago');
    fireEvent.click(items[2]!);
    expect(onSwitch).toHaveBeenCalledWith('main');
  });
});
