import { useCallback, useRef, useState } from 'react';
import { useGscRunner } from './useGscRunner';
import { useBingRunner } from './useBingRunner';
import { fetchSitemapViaBackground, type SitemapFetched } from '@lib/messaging/sitemap-client';
import { mergeDiscovered } from '@lib/storage/discovered';
import { getSubmissions, appendSubmissions, type Platform } from '@lib/storage/submissions';
import { pickRandom } from '@lib/submit/pick';
import type { SubmitResult } from '@lib/messaging/types';

export interface Platforms { gsc: boolean; bing: boolean; }

export interface ReportItem {
  url: string;
  platform: Platform;
  status: 'ok' | 'skipped';
  reason?: string;
}

export interface SysLogEntry { level: 'info' | 'warn' | 'error'; phase: string; message: string; ts: number; }

const BATCH_SIZE = 10;

export function useSubmitOrchestrator() {
  const gsc = useGscRunner();
  const bing = useBingRunner();
  const [active, setActive] = useState<'sitemap' | 'gsc' | 'bing' | null>(null);
  const [report, setReport] = useState<ReportItem[]>([]);
  const [logs, setLogs] = useState<SysLogEntry[]>([]);
  const runningRef = useRef(false);

  const pushLog = useCallback((level: SysLogEntry['level'], phase: string, message: string) => {
    setLogs((prev) => [...prev, { level, phase, message, ts: Date.now() }]);
  }, []);

  const run = useCallback(async (
    platforms: Platforms,
    domain: string,
    sitemapUrl: string,
    deps?: { fetchSitemap?: typeof fetchSitemapViaBackground },
  ) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setReport([]);
    const fetchSitemap = deps?.fetchSitemap ?? fetchSitemapViaBackground;

    try {
      // ① 抓 sitemap
      setActive('sitemap');
      pushLog('info', 'system', `抓取 sitemap: ${sitemapUrl}`);
      let fetched: SitemapFetched;
      try { fetched = await fetchSitemap(sitemapUrl); }
      catch (e) { pushLog('error', 'system', `sitemap 抓取失败: ${(e as Error).message}`); return; }
      pushLog('info', 'system', `发现 ${fetched.urls.length} 条链接（深度 ${fetched.stats.indexDepth}${fetched.stats.truncated ? '，已截断' : ''}）`);

      // ② 增量合并入库
      const discovered = await mergeDiscovered(domain, sitemapUrl, fetched.urls);

      // ③ 候选池：对所有勾选平台都未 ok 的 URL（批量 ok-set，避免逐条查）
      const selected: Platform[] = [];
      if (platforms.gsc) selected.push('gsc');
      if (platforms.bing) selected.push('bing');
      const subs = await getSubmissions(domain);
      const okSet = new Set(subs.filter((r) => r.status === 'ok').map((r) => `${r.platform}|${r.url}`));
      const pool = discovered.urls.filter((u) => selected.every((p) => !okSet.has(`${p}|${u}`)));

      // ④ 随机选 BATCH_SIZE
      const picked = pickRandom(pool, BATCH_SIZE);
      if (picked.length === 0) { pushLog('info', 'system', '无可提交链接，全部已提交'); return; }
      pushLog('info', 'system', `候选 ${pool.length}，本批选中 ${picked.length}`);

      // ⑤ 批次 id
      const batchId = crypto.randomUUID();
      const collected: ReportItem[] = [];

      // ⑥/⑦ 逐平台提交 + 落库
      if (platforms.gsc) {
        setActive('gsc');
        try {
          const results = await gsc.start(domain, picked);
          collected.push(...results.map((r) => ({ url: r.url, platform: 'gsc' as const, status: r.status, reason: r.reason })));
          await appendSubmissions(domain, results.map((r) => ({ url: r.url, platform: 'gsc' as const, status: r.status, reason: r.reason, ts: Date.now(), batchId })));
        } catch { /* 某平台失败不中断后续 */ }
      }
      if (platforms.bing) {
        setActive('bing');
        try {
          const results = await bing.start(domain, picked);
          collected.push(...results.map((r) => ({ url: r.url, platform: 'bing' as const, status: r.status, reason: r.reason })));
          await appendSubmissions(domain, results.map((r) => ({ url: r.url, platform: 'bing' as const, status: r.status, reason: r.reason, ts: Date.now(), batchId })));
        } catch { /* 同上 */ }
      }

      // ⑧ 报告
      setReport(collected);
      pushLog('info', 'system', `批次完成：${collected.length} 条结果`);
    } finally {
      setActive(null);
      runningRef.current = false;
    }
  }, [gsc.start, bing.start, pushLog]);

  const cancel = useCallback(() => { gsc.cancel(); bing.cancel(); }, [gsc.cancel, bing.cancel]);
  const clearReport = useCallback(() => setReport([]), []);

  return { gsc, bing, active, run, cancel, report, logs, clearReport };
}
