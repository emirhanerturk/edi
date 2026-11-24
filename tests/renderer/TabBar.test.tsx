// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/bridge', () => ({ edi: { on: () => () => undefined } }));

const { useApp } = await import('../../src/renderer/store');
const { TabBar } = await import('../../src/renderer/terminals/TabBar');

afterEach(cleanup);

const tab = (id: number, title: string) => ({ id, title, claude: false, waiting: false, busy: false, exited: false, claudeUntil: 0, claudeState: null });

describe('TabBar kapatma düğmesi', () => {
  it('her sekmede yer tutar; etkin olmayanınki üzerine gelince görünür ve sekmeye geçmeden o sekmeyi kapatır', () => {
    const closeTab = vi.fn();
    const activate = vi.fn();
    useApp.setState({ tabs: [tab(1, 'zsh'), tab(2, 'npm run dev'), tab(3, 'claude')] as never, activeTab: 2, closeTab, activate });
    render(<TabBar />);
    const buttons = screen.getAllByRole('button', { name: 'Close tab' });
    expect(buttons.map((button) => button.dataset.reveal)).toEqual(['hover', 'always', 'hover']);
    fireEvent.mouseDown(buttons[0]!, { button: 0 });
    fireEvent.click(buttons[0]!);
    expect(closeTab).toHaveBeenCalledWith(1);
    expect(activate).not.toHaveBeenCalled();
  });
});
