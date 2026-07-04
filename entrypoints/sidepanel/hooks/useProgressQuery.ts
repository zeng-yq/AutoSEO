import { useCallback, useEffect, useState } from 'react';
import { fetchSitemapViaBackground } from '@lib/messaging/sitemap-client';
import { getDiscovered, syncDiscovered, type DiscoveredSyncDiff } from '@lib/storage/discovered';
import { getSubmissions } from '@lib/storage/submissions';
import { computeProgress, type ProgressReport } from '@lib/submit/progress';

export interface ProgressState {
  loading: boolean;
  error?: string;
  report?: ProgressReport;
  diff?: DiscoveredSyncDiff;
  updatedAt?: number;
}

/**
 * 查询提交进度编排 hook。
 * - mount 时 load（domain 非空）：读本地 discovered/submissions → computeProgress，立即可见上次进度。
 * - refresh(sitemapUrl)：经 sitemap-fetcher port 抓最新 sitemap → syncDiscovered 全量对齐 → 重读 → computeProgress。
 *   抓取失败：设 error、不动 discovered、保留旧 report。
 */
export function useProgressQuery(domain: string) {
  const [state, setState] = useState<ProgressState>({ loading: false });

  const load = useCallback(async () => {
    const discovered = await getDiscovered(domain);
    const submissions = await getSubmissions(domain);
    setState({ loading: false, report: computeProgress(discovered, submissions), updatedAt: Date.now() });
  }, [domain]);

  useEffect(() => {
    if (!domain) return;
    setState({ loading: false });
    void load();
  }, [domain, load]);

  const refresh = useCallback(async (
    sitemapUrl: string,
    deps?: { fetchSitemap?: typeof fetchSitemapViaBackground },
  ) => {
    if (!sitemapUrl.trim()) return;
    const fetchSitemap = deps?.fetchSitemap ?? fetchSitemapViaBackground;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    let fetched;
    try {
      fetched = await fetchSitemap(sitemapUrl);
    } catch (e) {
      // 失败：保留旧 report（prev.report）、不动 discovered、不填 diff
      setState((prev) => ({ ...prev, loading: false, error: (e as Error).message ?? String(e) }));
      return;
    }
    const diff = await syncDiscovered(domain, sitemapUrl, fetched.urls);
    const discovered = await getDiscovered(domain);
    const submissions = await getSubmissions(domain);
    setState({ loading: false, report: computeProgress(discovered, submissions), diff, updatedAt: Date.now() });
  }, [domain]);

  return { state, refresh };
}
