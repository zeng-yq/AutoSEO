// tests/platformchip.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlatformChip from '../entrypoints/sidepanel/components/PlatformChip';
import { GscMark } from '../entrypoints/sidepanel/components/icons';

describe('PlatformChip', () => {
  it('点击切换 onToggle', () => {
    const onToggle = vi.fn();
    render(<PlatformChip label="GSC" icon={<GscMark />} checked onToggle={onToggle} />);
    fireEvent.click(screen.getByText('GSC'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
  it('checked 时带 is-active 类', () => {
    const { container } = render(<PlatformChip label="Bing" icon={<span />} checked onToggle={() => {}} />);
    expect(container.querySelector('.platform-chip.is-active')).toBeTruthy();
  });
});
