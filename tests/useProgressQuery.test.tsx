import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mergeDiscovered, getDiscovered } from '../lib/storage/discovered';
import { appendSubmissions } from '../lib/storage/submissions';

const fetchSitemap = vi.fn();

import { useProgressQuery } from '../entrypoints/sidepanel/hooks/useProgressQuery';

beforeEach(() => {
  fetchSitemap.mockReset();
  fetchSitemap.mockResolvedValue({ urls: ['https://example.com/a', 'https://example.com/b'], stats: { indexDepth: 0, truncated: false } });
});

describe('useProgressQuery', () => {
  it('load 读本地算 report（不抓取、不填 diff）', async () => {
    await mergeDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a']);
    await appendSubmissions('example.com', [{ url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' }]);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    expect(fetchSitemap).not.toHaveBeenCalled();
    expect(result.current.state.diff).toBeUndefined();
    expect(result.current.state.report?.total).toBe(1);
    expect(result.current.state.report?.platforms[0]).toMatchObject({ platform: 'gsc', done: 1, total: 1 });
  });

  it('refresh 成功：抓取→对齐→report，diff 填充', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/old']);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    await act(async () => {
      await result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap });
    });
    expect(fetchSitemap).toHaveBeenCalledWith('https://example.com/sitemap.xml');
    expect(result.current.state.diff?.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.current.state.diff?.removed).toEqual(['https://example.com/old']);
    expect(result.current.state.report?.total).toBe(2);
    // discovered 已对齐为新 sitemap
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.current.state.error).toBeUndefined();
  });

  it('refresh 抓取失败：设 error、不动 discovered、保留旧 report', async () => {
    fetchSitemap.mockRejectedValue(new Error('boom'));
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/old']);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    const prevReport = result.current.state.report;
    await act(async () => {
      await result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap });
    });
    expect(result.current.state.error).toBe('boom');
    expect(result.current.state.loading).toBe(false);
    // discovered 未变（未对齐）
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/old']);
    // 旧 report 保留
    expect(result.current.state.report).toBe(prevReport);
    // diff 不被填充
    expect(result.current.state.diff).toBeUndefined();
  });

  it('refresh 期间 loading 翻转', async () => {
    let resolveFetch!: (v: any) => void;
    fetchSitemap.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    let p!: Promise<void>;
    act(() => { p = result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap }); });
    await waitFor(() => expect(result.current.state.loading).toBe(true));
    resolveFetch({ urls: ['https://example.com/a'], stats: { indexDepth: 0, truncated: false } });
    await act(async () => { await p; });
    expect(result.current.state.loading).toBe(false);
  });
});
