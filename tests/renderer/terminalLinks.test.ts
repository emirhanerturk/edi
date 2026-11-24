import { describe, expect, it, vi } from 'vitest';
import { linkActivator } from '../../src/renderer/terminals/links';

describe('linkActivator', () => {
  it('yalnız Option basılıyken açar', () => {
    const open = vi.fn();
    const activate = linkActivator(open);
    activate({ altKey: false } as MouseEvent, 'http://localhost:5173/');
    expect(open).not.toHaveBeenCalled();
    activate({ altKey: true } as MouseEvent, 'http://localhost:5173/');
    expect(open).toHaveBeenCalledWith('http://localhost:5173/');
  });
});
