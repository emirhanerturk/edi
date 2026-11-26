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
  it('the button is disabled when the message is empty or only whitespace', () => {
    expect(renderBox({ message: '' }).button.disabled).toBe(true);
    cleanup();
    expect(renderBox({ message: '  \n ' }).button.disabled).toBe(true);
    cleanup();
    expect(renderBox().button.disabled).toBe(false);
  });

  it('says it commits only the staged files, or everything when nothing is staged', () => {
    expect(renderBox().button.textContent).toBe('Commit · 2 files');
    expect(screen.queryByText(/Nothing is staged/)).toBeNull();
    cleanup();
    expect(renderBox({ target: everything }).button.textContent).toBe('Commit all · 3 files');
    expect(screen.getByText('Nothing is staged. This commits every change, new files included.')).toBeTruthy();
  });

  it('the button and Cmd+Enter commit', () => {
    const { onCommit, button, input } = renderBox({ target: everything });
    fireEvent.click(button);
    expect(onCommit).toHaveBeenLastCalledWith({ all: true, push: false });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: 'Enter' }); // plain Enter is a new line
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('Cmd+Enter does not commit an empty message', () => {
    const { onCommit, input } = renderBox({ message: '' });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('"Commit and push" in the arrow menu commits and pushes', () => {
    const { onCommit } = renderBox();
    fireEvent.click(screen.getByLabelText('Commit options'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Commit and push' }));
    expect(onCommit).toHaveBeenLastCalledWith({ all: false, push: true });
    expect(screen.queryByRole('menuitem')).toBeNull(); // the menu closed
  });

  it('disabled while an operation runs and when there is nothing to commit', () => {
    expect(renderBox({ busy: true }).button.disabled).toBe(true);
    cleanup();
    const { button } = renderBox({ target: { all: false, count: 0, label: 'Commit', enabled: false } });
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText('Commit options') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Commit and push" is disabled in a repo without a remote', () => {
    renderBox({ canPush: false });
    fireEvent.click(screen.getByLabelText('Commit options'));
    expect((screen.getByRole('menuitem', { name: 'Commit and push' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports the typed text', () => {
    const { onChange, input } = renderBox();
    fireEvent.change(input, { target: { value: 'fix: y' } });
    expect(onChange).toHaveBeenCalledWith('fix: y');
  });
});

describe('CommitBox with nothing to commit', () => {
  const nothing: CommitTarget = { all: false, count: 0, label: 'Commit', enabled: false };
  const pull = { kind: 'pull' as const, label: 'Pull · 4 commits', title: 'Pull 4 commits from origin/main' };

  it('pulls, pushes or publishes in place of committing, without the commit options', () => {
    const onNext = vi.fn();
    render(<CommitBox target={nothing} message="" busy={false} canPush onChange={vi.fn()} onCommit={vi.fn()} next={pull} onNext={onNext} />);
    const button = screen.getByTestId('next-action') as HTMLButtonElement;
    expect(button.textContent).toBe('Pull · 4 commits');
    expect(button.title).toBe('Pull 4 commits from origin/main');
    expect(screen.queryByTestId('commit-button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commit options' })).toBeNull();
    fireEvent.click(button);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('waits while the repository is busy, and commits as usual once something changed', () => {
    render(<CommitBox target={nothing} message="" busy canPush onChange={vi.fn()} onCommit={vi.fn()} next={pull} onNext={vi.fn()} />);
    expect((screen.getByTestId('next-action') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<CommitBox target={staged} message="feat: x" busy={false} canPush onChange={vi.fn()} onCommit={vi.fn()} next={pull} onNext={vi.fn()} />);
    expect(screen.getByTestId('commit-button').textContent).toBe('Commit · 2 files');
    expect(screen.queryByTestId('next-action')).toBeNull();
  });
});
