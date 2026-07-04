import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KeywordTools from '../entrypoints/sidepanel/pages/KeywordTools';

describe('KeywordTools', () => {
  it('不再渲染重复的「关键词工具」标题(TabBar 已有该 tab)', () => {
    render(<KeywordTools />);
    expect(screen.queryByRole('heading', { name: '关键词工具' })).toBeNull();
  });

  it('仍渲染关键词输入与三个工具面板标题', () => {
    render(<KeywordTools />);
    expect(screen.getByText('关键词')).toBeTruthy();
    expect(screen.getByText('Ahrefs')).toBeTruthy();
    expect(screen.getByText('Google Trends')).toBeTruthy();
    expect(screen.getByText('快捷搜索')).toBeTruthy();
  });
});
