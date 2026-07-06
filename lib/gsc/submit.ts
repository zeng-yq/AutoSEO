/**
 * Google Indexing API 提交。
 *
 * 端点：POST https://indexing.googleapis.com/v3/urlNotifications:publish
 * 鉴权：Authorization: Bearer <access_token>（token 由 lib/gsc/auth.ts 提供）。
 * 依据：docs/superpowers/specs/2026-07-06-gsc-indexing-api-migration-design.md §5.2/§5.6
 */

import type { SubmitResult } from '../messaging/types';

const PUBLISH_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const METADATA_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications/metadata';

export interface GscResult {
  ok: boolean;
  status: number;
  reason?: string;
}

export interface SubmitBatchProgress {
  total: number;
  done: number;
  currentUrl: string;
  results: SubmitResult[];
}

export interface SubmitBatchLog {
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
}

/** 单条提交（URL_UPDATED）。fetch 抛错透传（调用方 catch 兜底「网络错误」）。 */
export async function publishUrl(token: string, url: string): Promise<GscResult> {
  const res = await fetch(PUBLISH_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type: 'URL_UPDATED' }),
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

/** 探活（测试连接用）：GET metadata，仅看鉴权是否通过。 */
export async function getMetadata(token: string, url: string): Promise<GscResult> {
  const res = await fetch(`${METADATA_ENDPOINT}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

export function reasonFor(status: number): string {
  switch (status) {
    case 403: return 'GSC：密钥无效，或服务账号未加为站点所有者';
    case 429: return 'GSC：超出每日 200 次配额，请明日重试';
    case 400: return 'GSC：请求格式或网址错误';
    case 404: return 'GSC：端点未找到';
    default: return `GSC：返回 ${status}`;
  }
}

/**
 * 串行逐条提交一批 URL。
 * - 串行（非并发）：与 handleBingStart 风格一致，进度逐条递增（done 1→2→…→N）。
 * - 遇 429 设 quotaHit：剩余条目保持 skipped(reason「未执行（批次终止）」)，不再请求。
 * - shouldStop() 为 true 即在下一条前中止。
 */
export async function submitBatch(
  token: string,
  urls: string[],
  hooks: {
    shouldStop?: () => boolean;
    onProgress?: (p: SubmitBatchProgress) => void;
    onLog?: (e: SubmitBatchLog) => void;
  } = {},
): Promise<{ results: SubmitResult[]; ok: number; skipped: number }> {
  const results: SubmitResult[] = urls.map((u) => ({ url: u, status: 'skipped', reason: '未执行' }));
  let quotaHit = false;

  for (let i = 0; i < urls.length; i++) {
    if (hooks.shouldStop?.()) break;
    const url = urls[i];
    const row = results[i];

    if (quotaHit) {
      row.reason = '未执行（批次终止）';
      continue;
    }

    let r: GscResult;
    try {
      r = await publishUrl(token, url);
    } catch (e) {
      r = { ok: false, status: 0, reason: `网络错误：${(e as Error).message ?? String(e)}` };
    }

    if (r.ok) {
      row.status = 'ok';
      row.reason = undefined;
    } else {
      row.reason = r.reason;
      if (r.status === 429) quotaHit = true;
    }

    hooks.onLog?.({
      level: r.ok ? 'info' : 'error',
      phase: 'submit',
      message: r.ok ? `✓ ${url}` : `✗ ${url}：${r.reason}`,
    });
    hooks.onProgress?.({
      total: urls.length,
      done: i + 1,
      currentUrl: url,
      results: [...results],
    });
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  return { results, ok, skipped: urls.length - ok };
}
