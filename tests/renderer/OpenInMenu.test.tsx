// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenInMenu } from '../../src/renderer/components/OpenInMenu';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const items = () => screen.queryAllByRole('menuitem').map((item) => item.textContent);

describe('OpenInMenu', () => {
  it('shows the editors on hover and opens the one picked', () => {
    const onOpen = vi.fn();
    render(<OpenInMenu onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Open in…' });
    expect(items()).toEqual([]);
    fireEvent.mouseEnter(button.parentElement!);
    expect(items()).toEqual(['Antigravity', 'Zed']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zed' }));
    expect(onOpen).toHaveBeenCalledWith('zed');
    expect(items()).toEqual([]);
  });

  it('stays open while the pointer crosses to the menu, and closes a moment after it leaves', () => {
    vi.useFakeTimers();
    render(<OpenInMenu onOpen={vi.fn()} />);
    const wrapper = screen.getByRole('button', { name: 'Open in…' }).parentElement!;
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.mouseEnter(wrapper);
    act(() => vi.advanceTimersByTime(500));
    expect(items()).toEqual(['Antigravity', 'Zed']);
    fireEvent.mouseLeave(wrapper);
    act(() => vi.advanceTimersByTime(500));
    expect(items()).toEqual([]);
  });

  it('opens on a click too, for the keyboard, and the click goes no further', () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <OpenInMenu onOpen={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open in…' }));
    expect(items()).toEqual(['Antigravity', 'Zed']);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('Down from the button goes into the menu; Up and Down move between the editors', () => {
    render(<OpenInMenu onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Open in…' });
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Antigravity');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Zed');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); // wraps around
    expect(document.activeElement?.textContent).toBe('Antigravity');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Zed');
  });
});
