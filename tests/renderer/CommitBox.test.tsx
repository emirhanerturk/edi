// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitBox } from '../../src/renderer/git/CommitBox';
import type { CommitTarget } from '../../src/renderer/git/model';

afterEach(cleanup);

const staged: CommitTarget = { all: false, count: 2, label: 'Commit · 2 files', enabled: true };
const everything: CommitTarget = { all: true, count: 3, label: 'Commit all · 3 files', enabled: true };

function renderBox(over: Partial<Parameters<typeof CommitBox>[0]> = {}) {
  const onCommit = vi.fn();
  const onChange = vi.fn();
  render(<CommitBox target={staged} message="feat: x" busy={false} canPush onChange={onChange} onCommit={onCommit} {...over} />);
  return { onCommit, onChange, button: screen.getByTestId('commit-button') as HTMLButtonElement, input: screen.getByTestId('commit-message') };
}

describe('CommitBox', () => {
  it('mesaj boşken ya da yalnız boşlukken düğme pasiftir', () => {
    expect(renderBox({ message: '' }).button.disabled).toBe(true);
    cleanup();
    expect(renderBox({ message: '  \n ' }).button.disabled).toBe(true);
    cleanup();
    expect(renderBox().button.disabled).toBe(false);
  });

  it("stage'li dosya varsa yalnız onları, yoksa hepsini commit edeceğini söyler", () => {
    expect(renderBox().button.textContent).toBe('Commit · 2 files');
    expect(screen.queryByText(/Nothing is staged/)).toBeNull();
    cleanup();
    expect(renderBox({ target: everything }).button.textContent).toBe('Commit all · 3 files');
    expect(screen.getByText('Nothing is staged. This commits every change, new files included.')).toBeTruthy();
  });

  it('düğme ve Cmd+Enter commit eder', () => {
    const { onCommit, button, input } = renderBox({ target: everything });
    fireEvent.click(button);
    expect(onCommit).toHaveBeenLastCalledWith({ all: true, push: false });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: 'Enter' }); // düz Enter yeni satırdır
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('mesaj boşken Cmd+Enter commit etmez', () => {
    const { onCommit, input } = renderBox({ message: '' });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ok menüsündeki Commit and push, push ile commit eder', () => {
    const { onCommit } = renderBox();
    fireEvent.click(screen.getByLabelText('Commit options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Commit and push' }));
    expect(onCommit).toHaveBeenLastCalledWith({ all: false, push: true });
    expect(screen.queryByRole('menuitem')).toBeNull(); // menü kapandı
  });

  it('süren işlemde ve commit edilecek şey yokken pasiftir', () => {
    expect(renderBox({ busy: true }).button.disabled).toBe(true);
    cleanup();
    const { button } = renderBox({ target: { all: false, count: 0, label: 'Commit', enabled: false } });
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText('Commit options') as HTMLButtonElement).disabled).toBe(true);
  });

  it("remote'u olmayan repoda Commit and push seçilemez", () => {
    renderBox({ canPush: false });
    fireEvent.click(screen.getByLabelText('Commit options'));
    expect((screen.getByRole('menuitem', { name: 'Commit and push' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('yazılan metni bildirir', () => {
    const { onChange, input } = renderBox();
    fireEvent.change(input, { target: { value: 'fix: y' } });
    expect(onChange).toHaveBeenCalledWith('fix: y');
  });
});
