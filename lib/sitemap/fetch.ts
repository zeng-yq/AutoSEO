import { parseSitemapXml } from './parse';

export interface FetchOpts { maxDepth?: number; maxUrls?: number; perReqTimeoutMs?: number; }
export interface FetchResult { urls: string[]; indexDepth: number; truncated: boolean; }

function safeHost(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

function sameHost(loc: string, host: string): boolean {
  return safeHost(loc) === host;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`sitemap 请求失败: HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * 递归抓取 sitemap 树。
 * - index：子 <loc> 入队（同 host + visited 去重）。
 * - urlset：<loc> 收入 urls（同 host + 去重）。
 * - 守卫：maxDepth（默认 3）、maxUrls（默认 50000）、单请求超时（默认 30s）。
 * - 入口（depth 0）fetch/解析失败直接抛；子 sitemap 失败则跳过（不中断整体）。
 */
export async function fetchSitemapTree(entryUrl: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxUrls = opts.maxUrls ?? 50000;
  const perReqTimeoutMs = opts.perReqTimeoutMs ?? 30000;

  const entryHost = safeHost(entryUrl);
  if (!entryHost) throw new Error('sitemap 入口 URL 无效');

  const visited = new Set<string>();
  const seen = new Set<string>();
  const urls: string[] = [];
  let indexDepth = 0;
  let truncated = false;
  const queue: Array<{ url: string; depth: number }> = [{ url: entryUrl, depth: 0 }];

  while (queue.length) {
    if (seen.size >= maxUrls) { truncated = true; break; }
    const { url, depth } = queue.shift()!;
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    let text: string;
    try { text = await fetchText(url, perReqTimeoutMs); }
    catch (e) { if (depth === 0) throw e; continue; }

    let parsed;
    try { parsed = parseSitemapXml(text); }
    catch { if (depth === 0) throw new Error('sitemap 解析失败'); continue; }

    if (parsed.kind === 'index') {
      indexDepth = Math.max(indexDepth, depth + 1);
      for (const loc of parsed.locs) {
        if (sameHost(loc, entryHost) && !visited.has(loc)) queue.push({ url: loc, depth: depth + 1 });
      }
    } else {
      for (const loc of parsed.locs) {
        if (!sameHost(loc, entryHost) || seen.has(loc)) continue;
        seen.add(loc);
        urls.push(loc);
        if (seen.size >= maxUrls) { truncated = true; break; }
      }
    }
  }
  return { urls, indexDepth, truncated };
}
