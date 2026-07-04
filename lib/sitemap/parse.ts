/**
 * sitemap XML 解析（纯函数）。
 *
 * MV3 service worker 无 DOM API（DOMParser 不可用），用正则解析。
 * sitemap 结构规整：<sitemapindex> 含 <sitemap><loc>；<urlset> 含 <url><loc>。
 * <loc> 可能被 <![CDATA[…]]> 包裹，一并剥离。
 */
export type SitemapKind = 'index' | 'urlset';
export interface ParsedSitemap { kind: SitemapKind; locs: string[]; }

const LOC_RE = /<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/loc>/gi;

export function parseSitemapXml(text: string): ParsedSitemap {
  const src = text.trim();
  if (!src) throw new Error('sitemap 为空');
  let kind: SitemapKind;
  if (/<sitemapindex[\s>]/i.test(src)) kind = 'index';
  else if (/<urlset[\s>]/i.test(src)) kind = 'urlset';
  else throw new Error('sitemap 根元素无法识别（非 sitemapindex/urlset）');

  const locs: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(src)) !== null) {
    const v = (m[1] ?? m[2] ?? '').trim();
    if (v) locs.push(v);
  }
  return { kind, locs };
}
