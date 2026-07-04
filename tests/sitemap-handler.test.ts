import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSitemapRequest } from '../lib/sitemap/handler';

beforeEach(() => { vi.restoreAllMocks(); });

describe('handleSitemapRequest', () => {
  it('成功 → SITEMAP_RESULT', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('<urlset><url><loc>https://example.com/a</loc></url></urlset>'),
    } as unknown as Response);
    const e = await handleSitemapRequest({ type: 'SITEMAP_FETCH', sitemapUrl: 'https://example.com/sitemap.xml' });
    expect(e.type).toBe('SITEMAP_RESULT');
    if (e.type === 'SITEMAP_RESULT') {
      expect(e.urls).toEqual(['https://example.com/a']);
      expect(e.stats.indexDepth).toBe(0);
    }
  });

  it('失败 → SITEMAP_ERROR（含 message）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') } as unknown as Response);
    const e = await handleSitemapRequest({ type: 'SITEMAP_FETCH', sitemapUrl: 'https://example.com/sitemap.xml' });
    expect(e.type).toBe('SITEMAP_ERROR');
    if (e.type === 'SITEMAP_ERROR') expect(e.message).toMatch(/404/);
  });
});
