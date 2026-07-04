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
