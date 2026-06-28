// tests/toolcard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCard from '../entrypoints/sidepanel/components/ToolCard';
import { IconSubmit } from '../entrypoints/sidepanel/components/icons';

describe('ToolCard', () => {
  it('点击触发 onClick', () => {
    const onClick = vi.fn();
    render(<ToolCard icon={<IconSubmit />} title="网站提交" subtitle="GSC · Bing" onClick={onClick} />);
    fireEvent.click(screen.getByText('网站提交'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('disabled 时不触发 onClick，Enter 仍可达性触发', () => {
    const onClick = vi.fn();
    render(<ToolCard icon={<IconSubmit />} title="robots.txt" onClick={onClick} disabled />);
    fireEvent.click(screen.getByText('robots.txt'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
