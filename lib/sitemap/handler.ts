import { fetchSitemapTree } from './fetch';
import type { SitemapFetchRequest, SitemapEvent } from '@lib/messaging/types';

/**
 * 处理一条 SITEMAP_FETCH 请求 → 返回 RESULT 或 ERROR 事件。
 * 抽成纯函数便于单测；background 只做 port 绑定。
 */
export async function handleSitemapRequest(msg: SitemapFetchRequest): Promise<SitemapEvent> {
  try {
    const r = await fetchSitemapTree(msg.sitemapUrl);
    if (r.urls.length === 0) {
      return { type: 'SITEMAP_ERROR', message: 'sitemap 未包含任何同站链接' };
    }
    return {
      type: 'SITEMAP_RESULT',
      urls: r.urls,
      stats: { indexDepth: r.indexDepth, truncated: r.truncated },
    };
  } catch (e) {
    return { type: 'SITEMAP_ERROR', message: (e as Error).message ?? String(e) };
  }
}
