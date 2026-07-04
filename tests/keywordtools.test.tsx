// tests/keywordtools.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KeywordTools from '../entrypoints/sidepanel/pages/KeywordTools';

describe('KeywordTools', () => {
  it('不再渲染重复的「关键词工具」h2(TabBar 已有该 tab)', () => {
    render(<KeywordTools />);
    expect(screen.queryByRole('heading', { name: '关键词工具' })).toBeNull();
  });

  it('渲染公共关键词输入与三张工具卡片', () => {
    render(<KeywordTools />);
    expect(screen.getByPlaceholderText('如 apple')).toBeInTheDocument();
    // Ahrefs
    expect(screen.getByText('Ahrefs')).toBeInTheDocument();
    expect(screen.getByText('关键词难度查询')).toBeInTheDocument();
    // Google Trends
    expect(screen.getByText('Google Trends')).toBeInTheDocument();
    expect(screen.getByText('谷歌趋势')).toBeInTheDocument();
    // 快捷搜索
    expect(screen.getByText('快捷搜索')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '用 Google 搜' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '用 Bing 搜' })).toBeInTheDocument();
  });
});
