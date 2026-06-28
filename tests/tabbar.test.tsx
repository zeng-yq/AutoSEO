// tests/tabbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from '../entrypoints/sidepanel/components/TabBar';

describe('TabBar', () => {
  it('渲染两个 tab，点击切换', () => {
    const onChange = vi.fn();
    render(<TabBar tab="site" onChange={onChange} />);
    fireEvent.click(screen.getByText('关键词工具'));
    expect(onChange).toHaveBeenCalledWith('keyword');
  });
  it('当前 tab 标记 is-active', () => {
    const { container } = render(<TabBar tab="keyword" onChange={() => {}} />);
    const active = container.querySelector('.tab.is-active');
    expect(active?.textContent).toBe('关键词工具');
  });
});
