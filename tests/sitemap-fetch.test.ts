import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSitemapTree } from '../lib/sitemap/fetch';

function res(body: string, ok = true) {
  return { ok, status: 200, text: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('fetchSitemapTree', () => {
  it('单层 urlset：返回同 host loc', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(
      `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`,
    ));
    const r = await fetchSitemapTree('https://example.com/sitemap.xml');
    expect(r.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(r.indexDepth).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it('两层 index→urlset：递归合并子 sitemap', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(res(`<sitemapindex><sitemap><loc>https://example.com/post.xml</loc></sitemap></sitemapindex>`));
    fetchMock.mockResolvedValueOnce(res(`<urlset><url><loc>https://example.com/p1</loc></url></urlset>`));
    const r = await fetchSitemapTree('https://example.com/sitemap.xml');
    expect(r.urls).toEqual(['https://example.com/p1']);
    expect(r.indexDepth).toBe(1);
  });

  it('同 host 过滤：丢弃跨域 loc', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(
      `<urlset>
        <url><loc>https://example.com/keep</loc></url>
        <url><loc>https://evil.com/drop</loc></url>
      </urlset>`,
    ));
    const r = await fetchSitemapTree('https://example.com/sitemap.xml');
    expect(r.urls).toEqual(['https://example.com/keep']);
  });

  it('maxUrls 截断：truncated=true', async () => {
    const urls = Array.from({ length: 5 }, (_, i) => `<url><loc>https://example.com/${i}</loc></url>`).join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(`<urlset>${urls}</urlset>`));
    const r = await fetchSitemapTree('https://example.com/sitemap.xml', { maxUrls: 3 });
    expect(r.urls).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it('循环/重复 index 防失控（visited 去重）：同一子 sitemap 被多 parent 指向只 fetch 一次', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      const url = typeof u === 'string' ? u : u.toString();
      if (url === 'https://example.com/sitemap.xml')
        return res(`<sitemapindex>
          <sitemap><loc>https://example.com/sub1.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sub2.xml</loc></sitemap>
        </sitemapindex>`);
      if (url === 'https://example.com/sub1.xml')
        return res(`<sitemapindex><sitemap><loc>https://example.com/sub2.xml</loc></sitemap></sitemapindex>`);
      // sub2.xml 同时被 sitemap.xml 和 sub1.xml 指向
      return res(`<urlset><url><loc>https://example.com/leaf</loc></url></urlset>`);
    });
    const r = await fetchSitemapTree('https://example.com/sitemap.xml');
    expect(r.urls).toEqual(['https://example.com/leaf']);
    // visited 保证 sub2.xml 只被 fetch 一次
    const sub2Calls = fetchMock.mock.calls.filter((c) => c[0] === 'https://example.com/sub2.xml');
    expect(sub2Calls).toHaveLength(1);
  });

  it('入口 fetch 非 2xx 抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') } as unknown as Response);
    await expect(fetchSitemapTree('https://example.com/sitemap.xml')).rejects.toThrow();
  });

  it('入口 URL 无效抛错', async () => {
    await expect(fetchSitemapTree('not-a-url')).rejects.toThrow();
  });
});
