import { describe, it, expect } from 'vitest';
import { getDiscovered, mergeDiscovered, syncDiscovered } from '../lib/storage/discovered';

describe('syncDiscovered', () => {
  it('旧库为 null：全部 added，无 removed', async () => {
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/b']);
    expect(diff.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    const got = await getDiscovered('example.com');
    expect(got?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(got?.sitemapUrl).toBe('https://example.com/sitemap.xml');
  });

  it('fetched 为空：全部 removed', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a', 'https://example.com/b']);
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', []);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(diff.unchanged).toEqual([]);
    expect((await getDiscovered('example.com'))?.urls).toEqual([]);
  });

  it('部分增删：added/removed/unchanged 各正确', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/b', 'https://example.com/d']);
    expect(diff.added).toEqual(['https://example.com/d']);
    expect(diff.removed).toEqual(['https://example.com/a', 'https://example.com/c']);
    expect(diff.unchanged).toEqual(['https://example.com/b']);
  });

  it('fetched 含重复：保序去重', async () => {
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/a', 'https://example.com/b']);
    expect(diff.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('写入后 urls 顺序 = fetched 顺序（不保留旧序）', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a']);
    await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/z', 'https://example.com/a']);
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/z', 'https://example.com/a']);
  });

  it('domain 隔离：A 域 sync 不影响 B 域', async () => {
    await mergeDiscovered('a.com', 'https://a.com/sitemap.xml', ['https://a.com/1']);
    await mergeDiscovered('b.com', 'https://b.com/sitemap.xml', ['https://b.com/1']);
    await syncDiscovered('a.com', 'https://a.com/sitemap.xml', ['https://a.com/2']);
    expect((await getDiscovered('a.com'))?.urls).toEqual(['https://a.com/2']);
    expect((await getDiscovered('b.com'))?.urls).toEqual(['https://b.com/1']);
  });
});
