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
  it('disabled 时点击与 Enter 均不触发 onClick', () => {
    const onClick = vi.fn();
    render(<ToolCard icon={<IconSubmit />} title="robots.txt" onClick={onClick} disabled />);
    fireEvent.click(screen.getByText('robots.txt'));
    fireEvent.keyDown(screen.getByText('robots.txt'), { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });
  it('传 logo 时渲染 <img>,不再渲染 icon', () => {
    const { container } = render(
      <ToolCard logo="/fake/logo.svg" title="Backlink Checker" onClick={() => {}} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/fake/logo.svg');
  });
  it('传 icon 时不渲染 <img>(向后兼容)', () => {
    const { container } = render(
      <ToolCard icon={<IconSubmit />} title="网站提交" onClick={() => {}} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('网站提交')).toBeInTheDocument();
  });
});
