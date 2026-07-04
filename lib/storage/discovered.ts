export interface DiscoveredLinks {
  domain: string;
  sitemapUrl: string;
  urls: string[];
  updatedAt: number;
}

const key = (domain: string) => `discovered:${domain}`;

export async function getDiscovered(domain: string): Promise<DiscoveredLinks | null> {
  const items = await chrome.storage.local.get(key(domain));
  return (items[key(domain)] as DiscoveredLinks | undefined) ?? null;
}

/**
 * 增量合并：fetched 与已有 urls 取并集（旧在前、保序），更新 sitemapUrl/updatedAt。
 */
export async function mergeDiscovered(
  domain: string,
  sitemapUrl: string,
  fetched: string[],
): Promise<DiscoveredLinks> {
  const cur = await getDiscovered(domain);
  const merged = new Set<string>(cur?.urls ?? []);
  for (const u of fetched) merged.add(u);
  const next: DiscoveredLinks = {
    domain,
    sitemapUrl,
    urls: [...merged],
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [key(domain)]: next });
  return next;
}

/**
 * 全量对齐：把 discovered.urls 替换为 fetched（保序去重），返回三段 diff。
 * 与 mergeDiscovered（只增并集）的区别——本函数会删除已不在 sitemap 的链接。
 * 用于「查询进度」流程对账最新 sitemap；提交流程仍用 mergeDiscovered。
 */
export interface DiscoveredSyncDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export async function syncDiscovered(
  domain: string,
  sitemapUrl: string,
  fetchedUrls: string[],
): Promise<DiscoveredSyncDiff> {
  const cur = await getDiscovered(domain);
  const oldUrls = cur?.urls ?? [];
  const oldSet = new Set(oldUrls);

  // fetched 保序去重
  const next: string[] = [];
  const nextSet = new Set<string>();
  for (const u of fetchedUrls) {
    if (!nextSet.has(u)) { nextSet.add(u); next.push(u); }
  }

  const added: string[] = [];
  const unchanged: string[] = [];
  for (const u of next) {
    if (oldSet.has(u)) unchanged.push(u);
    else added.push(u);
  }
  const removed = oldUrls.filter((u) => !nextSet.has(u));

  const record: DiscoveredLinks = {
    domain,
    sitemapUrl,
    urls: next,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [key(domain)]: record });
  return { added, removed, unchanged };
}
