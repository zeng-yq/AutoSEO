import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GoogleTrendsTool from '../entrypoints/sidepanel/pages/GoogleTrendsTool';

afterEach(() => { vi.restoreAllMocks(); });

describe('GoogleTrendsTool', () => {
  it('渲染标题与搜索按钮，关键词非空时可用', () => {
    render(<GoogleTrendsTool keyword="apple" />);
    expect(screen.getByText('Google Trends')).toBeInTheDocument();
    expect(screen.getByText('谷歌趋势')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeEnabled();
  });
  it('关键词为空时按钮禁用', () => {
    render(<GoogleTrendsTool keyword="" />);
    expect(screen.getByRole('button', { name: '搜索' })).toBeDisabled();
  });
  it('点击搜索以新标签打开趋势链接，含主词 apple', () => {
    const spy = vi.spyOn(chrome.tabs, 'create');
    render(<GoogleTrendsTool keyword="apple" />);
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const url = spy.mock.calls[0][0].url as string;
    expect(url.startsWith('https://trends.google.com/explore')).toBe(true);
    expect(url).toContain('q=apple');
  });
  it('挂载时从 storage 恢复上次的天数/对比词/地区', () => {
    chrome.storage.local.set({ 'kw-tools:trends': { date: 'now 7-d', compare: 'chatgpt', geo: 'US' } });
    render(<GoogleTrendsTool keyword="apple" />);
    // 天数/地区是原生 <select>，对比词是 <input>
    expect(screen.getByText('7 天')).toBeInTheDocument();           // date select 显示 "7 天"
    expect(screen.getByText('美国 (US)')).toBeInTheDocument();      // geo select 显示 "美国 (US)"
    expect(screen.getByDisplayValue('chatgpt')).toBeInTheDocument(); // compare combobox input 值
  });
});
