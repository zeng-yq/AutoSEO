import { describe, it, expect } from 'vitest';
import { parseSitemapXml } from '../lib/sitemap/parse';

describe('parseSitemapXml', () => {
  it('解析 urlset，抽取所有 <loc>', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/a</loc></url>
      </urlset>`;
    expect(parseSitemapXml(xml)).toEqual({
      kind: 'urlset',
      locs: ['https://example.com/', 'https://example.com/a'],
    });
  });

  it('解析 sitemapindex，kind=index', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
      </sitemapindex>`;
    expect(parseSitemapXml(xml)).toEqual({
      kind: 'index',
      locs: ['https://example.com/post-sitemap.xml'],
    });
  });

  it('剥离 CDATA 与首尾空白', () => {
    const xml = `<urlset><url><loc>\n  <![CDATA[https://example.com/x]]>  </loc></url></urlset>`;
    expect(parseSitemapXml(xml).locs).toEqual(['https://example.com/x']);
  });

  it('空文档抛错', () => {
    expect(() => parseSitemapXml('   ')).toThrow();
  });

  it('无法识别根标签抛错', () => {
    expect(() => parseSitemapXml('<html><body>nope</body></html>')).toThrow();
  });
});
