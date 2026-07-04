import { describe, it, expect } from 'vitest';
import { getDiscovered, mergeDiscovered } from '../lib/storage/discovered';

describe('discovered 存储', () => {
  it('merge 后可读回，且记录 sitemapUrl/updatedAt', async () => {
    const d = await mergeDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/b']);
    expect(d.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(d.sitemapUrl).toBe('https://example.com/sitemap.xml');
    expect(d.updatedAt).toBeGreaterThan(0);
    const got = await getDiscovered('example.com');
    expect(got?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('增量 merge 取并集、保序（旧在前）', async () => {
    await mergeDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a']);
    const d = await mergeDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/b']);
    expect(d.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('未写入时 getDiscovered 返回 null', async () => {
    expect(await getDiscovered('not-exist.com')).toBeNull();
  });

  it('domain 隔离：不同 domain 互不干扰', async () => {
    await mergeDiscovered('a.com', 'https://a.com/sitemap.xml', ['https://a.com/1']);
    await mergeDiscovered('b.com', 'https://b.com/sitemap.xml', ['https://b.com/1']);
    expect((await getDiscovered('a.com'))?.urls).toEqual(['https://a.com/1']);
    expect((await getDiscovered('b.com'))?.urls).toEqual(['https://b.com/1']);
  });
});
