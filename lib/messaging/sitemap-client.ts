import { createSitemapPort } from './protocol';
import type { SitemapEvent } from './types';

export interface SitemapFetched {
  urls: string[];
  stats: { indexDepth: number; truncated: boolean };
}

/**
 * 经 sitemap-fetcher port 请求 background 抓取并解析 sitemap。
 * 收到 RESULT resolve；收到 ERROR 或 port 意外断开 reject。任一结束都 disconnect 释放 port。
 */
export function fetchSitemapViaBackground(sitemapUrl: string): Promise<SitemapFetched> {
  return new Promise<SitemapFetched>((resolve, reject) => {
    const port = createSitemapPort();
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; try { port.disconnect(); } catch { /* ignore */ } fn(); };
    port.onMessage.addListener((e: SitemapEvent) => {
      if (e.type === 'SITEMAP_RESULT') done(() => resolve({ urls: e.urls, stats: e.stats }));
      else if (e.type === 'SITEMAP_ERROR') done(() => reject(new Error(e.message)));
    });
    port.onDisconnect.addListener(() => done(() => reject(new Error('sitemap 连接中断'))));
    port.postMessage({ type: 'SITEMAP_FETCH', sitemapUrl });
  });
}
