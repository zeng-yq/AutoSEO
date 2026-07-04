import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { appendSubmissions } from '../lib/storage/submissions';

const gscStart = vi.fn();
const bingStart = vi.fn();
const fetchSitemap = vi.fn();
const baseRunner = (start: ReturnType<typeof vi.fn>) => ({
  start, cancel: vi.fn(),
  state: { running: false, total: 0, done: 0 },
  results: [], logs: [],
});

vi.mock('../entrypoints/sidepanel/hooks/useGscRunner', () => ({ useGscRunner: () => baseRunner(gscStart) }));
vi.mock('../entrypoints/sidepanel/hooks/useBingRunner', () => ({ useBingRunner: () => baseRunner(bingStart) }));

import { useSubmitOrchestrator } from '../entrypoints/sidepanel/hooks/useSubmitOrchestrator';

const SITEMAP = 'https://example.com/sitemap.xml';

beforeEach(() => {
  gscStart.mockReset(); bingStart.mockReset(); fetchSitemap.mockReset();
  fetchSitemap.mockResolvedValue({ urls: ['https://example.com/a', 'https://example.com/b'], stats: { indexDepth: 0, truncated: false } });
  gscStart.mockResolvedValue([{ url: 'https://example.com/a', status: 'ok' }, { url: 'https://example.com/b', status: 'ok' }]);
  bingStart.mockResolvedValue([{ url: 'https://example.com/a', status: 'ok' }, { url: 'https://example.com/b', status: 'ok' }]);
});

describe('useSubmitOrchestrator（sitemap 流程）', () => {
  it('fetch 失败时不调用 runner', async () => {
    fetchSitemap.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: false }, 'example.com', SITEMAP, { fetchSitemap }); });
    expect(gscStart).not.toHaveBeenCalled();
  });

  it('候选池排除已 ok 的 URL', async () => {
    // 预置 a 在 gsc 已 ok
    await appendSubmissions('example.com', [{ url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'old' }]);
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: false }, 'example.com', SITEMAP, { fetchSitemap }); });
    expect(gscStart).toHaveBeenCalledWith('example.com', ['https://example.com/b']);
  });

  it('不足 10 全选（这里 pool=2）', async () => {
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: false }, 'example.com', SITEMAP, { fetchSitemap }); });
    const picked = gscStart.mock.calls[0][1] as string[];
    expect(picked).toHaveLength(2);
  });

  it('results 落库带 platform/batchId', async () => {
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: true }, 'example.com', SITEMAP, { fetchSitemap }); });
    const { getSubmissions } = await import('../lib/storage/submissions');
    const all = await getSubmissions('example.com');
    expect(all.filter(r => r.platform === 'gsc')).toHaveLength(2);
    expect(all.filter(r => r.platform === 'bing')).toHaveLength(2);
    const ids = new Set(all.map(r => r.batchId));
    expect(ids.size).toBe(1); // 同一批次同一 batchId
  });

  it('report 汇总 gsc+bing', async () => {
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: true }, 'example.com', SITEMAP, { fetchSitemap }); });
    await waitFor(() => expect(result.current.report).toHaveLength(4));
    expect(result.current.report.filter(r => r.status === 'ok')).toHaveLength(4);
  });

  it('池空时不提交', async () => {
    await appendSubmissions('example.com', [
      { url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'old' },
      { url: 'https://example.com/b', platform: 'gsc', status: 'ok', ts: 1, batchId: 'old' },
    ]);
    const { result } = renderHook(() => useSubmitOrchestrator());
    await act(async () => { await result.current.run({ gsc: true, bing: false }, 'example.com', SITEMAP, { fetchSitemap }); });
    expect(gscStart).not.toHaveBeenCalled();
  });
});
