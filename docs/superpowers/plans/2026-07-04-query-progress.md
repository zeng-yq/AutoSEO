# 查询提交进度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「网站提交」面板顶部新增「查询进度」tab：点刷新 → 复用现有 sitemap-fetcher port 抓最新 sitemap → discovered 全量对齐（删旧增新）→ 基于 discovered × submissions 分平台（GSC/Bing）统计进度 + 带筛选的明细列表；submissions 不改存储，「已不在 sitemap」的提交运行时计算并标灰。

**Architecture:** 纯函数优先（`computeProgress`）+ 编排 hook（`useProgressQuery`：mount 读本地 / refresh 抓取对账）+ 展示组件（`ProgressPanel`）。存储层新增 `syncDiscovered`（全量对齐），与现有只增的 `mergeDiscovered` 并存（提交流程仍用 merge）。不新增 port、不改 background、不改 sitemap 抓取链路、不改 submissions 存储、不改提交流程。

**Tech Stack:** WXT + React 19 + TypeScript，vitest + @testing-library/react，chrome.storage.local。

## Global Constraints

（每个任务的需求都隐含包含本节）

- **存储**：`chrome.storage.local`，按 `domain` 隔离。沿用现有 key：`discovered:${domain}`（`DiscoveredLinks`）、`submissions:${domain}`（`SubmissionRecord[]`）。**不引入 IndexedDB**。
- **discovered 全量对齐**：`syncDiscovered(domain, sitemapUrl, fetchedUrls)` 把 `discovered.urls` 替换为 `fetchedUrls`（保序去重），返回 `{ added, removed, unchanged }`。现有 `mergeDiscovered`（只增并集）**保留不动**——`useSubmitOrchestrator` 提交流程仍用它。
- **submissions 不改**：`SubmissionRecord` 结构与 CRUD 完全不动。「已不在 sitemap」**不落库**，运行时用 `discovered.urls` 反查。
- **进度口径**：分平台独立统计；「已提交」= 该平台存在 `status === 'ok'` 记录（`skipped` 不计，与现有去重一致）。
- **URL 相等**：字符串相等（与 `mergeDiscovered` / `fetchSitemapTree` 一致），不引入 URL 规范化。
- **复用**：`fetchSitemapViaBackground`（`lib/messaging/sitemap-client.ts`，已就绪）；不新增 port、不改 `entrypoints/background.ts`。
- **测试**：vitest，`tests/setup.ts` 已内置 `chrome.storage.local` 内存实现（每测自动 reset）。alias：`@lib` / `@components` / `@hooks` / `@pages`。组件/hook 测试用 `@testing-library/react` 的 `renderHook` / `render` / `act` / `waitFor`。
- **命令**：`pnpm test`（全量）/ `pnpm test -- <file>`（单文件）/ `pnpm compile`（tsc --noEmit）/ `pnpm build`（wxt build）。
- **提交风格**：`feat(scope): …` / `refactor(scope): …`，每个任务末尾各 commit 一次。直接提交到 `main`（项目惯例，对齐 git log）。

---

## 文件结构总览

| 文件 | 责任 | 任务 |
|---|---|---|
| `lib/storage/discovered.ts` | 追加 `syncDiscovered`（全量对齐 + diff） | Task 1 |
| `lib/submit/progress.ts` | 新增 `computeProgress` 纯函数 | Task 2 |
| `entrypoints/sidepanel/hooks/useProgressQuery.ts` | 新增编排 hook（load + refresh） | Task 3 |
| `entrypoints/sidepanel/components/ProgressPanel.tsx` | 新增查询 tab UI | Task 4 |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 加页面内 tab + 挂载 ProgressPanel | Task 5 |
| `tests/discovered-sync.test.ts` | syncDiscovered 用例 | Task 1 |
| `tests/progress.test.ts` | computeProgress 用例 | Task 2 |
| `tests/useProgressQuery.test.tsx` | hook 用例 | Task 3 |
| `tests/progresspanel.test.tsx` | 组件用例 | Task 4 |
| `tests/submitpanel.test.tsx` | 扩：tab 切换 + 共享 sitemapUrl | Task 5 |

**不动**：`lib/messaging/*`、`lib/sitemap/*`、`entrypoints/background.ts`、`lib/storage/submissions.ts`、`useSubmitOrchestrator.ts`、GSC/Bing flow。

---

## Task 1: discovered 全量对齐（syncDiscovered）

**Files:**
- Modify: `lib/storage/discovered.ts`（追加 `syncDiscovered` + `DiscoveredSyncDiff`，不动现有 `getDiscovered` / `mergeDiscovered`）
- Test: `tests/discovered-sync.test.ts`（新建）

**Interfaces:**
- Produces:
  - `interface DiscoveredSyncDiff { added: string[]; removed: string[]; unchanged: string[]; }`
  - `syncDiscovered(domain, sitemapUrl, fetchedUrls): Promise<DiscoveredSyncDiff>` —— 把 `discovered.urls` 替换为 `fetchedUrls`（保序去重），返回三段 diff。storage key `discovered:${domain}`（沿用现有 `key`）。

- [ ] **Step 1: 写失败测试**

`tests/discovered-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getDiscovered, mergeDiscovered, syncDiscovered } from '../lib/storage/discovered';

describe('syncDiscovered', () => {
  it('旧库为 null：全部 added，无 removed', async () => {
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/b']);
    expect(diff.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    const got = await getDiscovered('example.com');
    expect(got?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(got?.sitemapUrl).toBe('https://example.com/sitemap.xml');
  });

  it('fetched 为空：全部 removed', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a', 'https://example.com/b']);
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', []);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(diff.unchanged).toEqual([]);
    expect((await getDiscovered('example.com'))?.urls).toEqual([]);
  });

  it('部分增删：added/removed/unchanged 各正确', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/b', 'https://example.com/d']);
    expect(diff.added).toEqual(['https://example.com/d']);
    expect(diff.removed).toEqual(['https://example.com/a', 'https://example.com/c']);
    expect(diff.unchanged).toEqual(['https://example.com/b']);
  });

  it('fetched 含重复：保序去重', async () => {
    const diff = await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a', 'https://example.com/a', 'https://example.com/b']);
    expect(diff.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('写入后 urls 顺序 = fetched 顺序（不保留旧序）', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/a']);
    await syncDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/z', 'https://example.com/a']);
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/z', 'https://example.com/a']);
  });

  it('domain 隔离：A 域 sync 不影响 B 域', async () => {
    await mergeDiscovered('a.com', 'https://a.com/sitemap.xml', ['https://a.com/1']);
    await mergeDiscovered('b.com', 'https://b.com/sitemap.xml', ['https://b.com/1']);
    await syncDiscovered('a.com', 'https://a.com/sitemap.xml', ['https://a.com/2']);
    expect((await getDiscovered('a.com'))?.urls).toEqual(['https://a.com/2']);
    expect((await getDiscovered('b.com'))?.urls).toEqual(['https://b.com/1']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/discovered-sync.test.ts`
Expected: FAIL（`syncDiscovered is not a function`）

- [ ] **Step 3: 实现**

在 `lib/storage/discovered.ts` 末尾追加（不动文件顶部已有的 `DiscoveredLinks` / `key` / `getDiscovered` / `mergeDiscovered`）：
```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/discovered-sync.test.ts`
Expected: PASS（6 用例全过）；同时 `pnpm test -- tests/discovered.test.ts` 仍 PASS（现有 merge 未受影响）。

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add lib/storage/discovered.ts tests/discovered-sync.test.ts
git commit -m "feat(storage): syncDiscovered 全量对齐（删旧增新 + diff）"
```

---

## Task 2: computeProgress 纯函数

**Files:**
- Create: `lib/submit/progress.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Consumes: `DiscoveredLinks` from `@lib/storage/discovered`；`SubmissionRecord` / `Platform` from `@lib/storage/submissions`。
- Produces:
  - `interface PlatformProgress { platform: Platform; done: number; total: number; pending: number; }`
  - `interface ProgressItem { url: string; gsc: 'done' | 'pending'; bing: 'done' | 'pending'; }`
  - `interface StaleSubmission { url: string; platform: Platform; }`
  - `interface ProgressReport { total: number; platforms: PlatformProgress[]; items: ProgressItem[]; stale: StaleSubmission[]; }`
  - `computeProgress(discovered: DiscoveredLinks | null, submissions: SubmissionRecord[]): ProgressReport`。`platforms` 固定顺序 `[gsc, bing]`。「已提交」只看 `status === 'ok'`。`stale` = submissions 中 `ok` 且 `url ∉ discovered.urls` 的 `(url, platform)`，按 `platform|url` 去重。

- [ ] **Step 1: 写失败测试**

`tests/progress.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeProgress } from '../lib/submit/progress';
import type { DiscoveredLinks } from '../lib/storage/discovered';
import type { SubmissionRecord } from '../lib/storage/submissions';

const disc = (urls: string[]): DiscoveredLinks => ({ domain: 'example.com', sitemapUrl: 'https://example.com/sitemap.xml', urls, updatedAt: 1 });

describe('computeProgress', () => {
  it('分平台 done/pending 计数正确', () => {
    const d = disc(['https://example.com/a', 'https://example.com/b']);
    const subs: SubmissionRecord[] = [
      { url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' },
      { url: 'https://example.com/a', platform: 'bing', status: 'ok', ts: 1, batchId: 'b1' },
    ];
    const r = computeProgress(d, subs);
    expect(r.total).toBe(2);
    expect(r.platforms).toEqual([
      { platform: 'gsc', done: 1, total: 2, pending: 1 },
      { platform: 'bing', done: 1, total: 2, pending: 1 },
    ]);
    expect(r.items[0]).toEqual({ url: 'https://example.com/a', gsc: 'done', bing: 'done' });
    expect(r.items[1]).toEqual({ url: 'https://example.com/b', gsc: 'pending', bing: 'pending' });
  });

  it('skipped 不计入 done', () => {
    const d = disc(['https://example.com/a']);
    const subs: SubmissionRecord[] = [
      { url: 'https://example.com/a', platform: 'gsc', status: 'skipped', reason: '配额', ts: 1, batchId: 'b1' },
    ];
    const r = computeProgress(d, subs);
    expect(r.platforms[0]).toMatchObject({ platform: 'gsc', done: 0, pending: 1 });
  });

  it('stale：submissions 中 url ∉ discovered 的 ok 记录', () => {
    const d = disc(['https://example.com/a']);
    const subs: SubmissionRecord[] = [
      { url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' },
      { url: 'https://example.com/gone', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' },
      { url: 'https://example.com/gone', platform: 'bing', status: 'ok', ts: 1, batchId: 'b1' },
    ];
    const r = computeProgress(d, subs);
    expect(r.stale).toEqual([
      { url: 'https://example.com/gone', platform: 'gsc' },
      { url: 'https://example.com/gone', platform: 'bing' },
    ]);
  });

  it('stale 按 platform|url 去重（同一组合多次 ok 只算一次）', () => {
    const d = disc(['https://example.com/a']);
    const subs: SubmissionRecord[] = [
      { url: 'https://example.com/gone', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' },
      { url: 'https://example.com/gone', platform: 'gsc', status: 'ok', ts: 2, batchId: 'b2' },
    ];
    const r = computeProgress(d, subs);
    expect(r.stale).toEqual([{ url: 'https://example.com/gone', platform: 'gsc' }]);
  });

  it('discovered === null：total=0，stale 含全部 ok', () => {
    const subs: SubmissionRecord[] = [
      { url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' },
      { url: 'https://example.com/a', platform: 'bing', status: 'skipped', reason: '配额', ts: 1, batchId: 'b1' },
    ];
    const r = computeProgress(null, subs);
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.platforms).toEqual([
      { platform: 'gsc', done: 0, total: 0, pending: 0 },
      { platform: 'bing', done: 0, total: 0, pending: 0 },
    ]);
    // bing 是 skipped 不进 stale；gsc 的 a 不在（空）discovered → stale
    expect(r.stale).toEqual([{ url: 'https://example.com/a', platform: 'gsc' }]);
  });

  it('submissions === []：全 pending，stale 空', () => {
    const r = computeProgress(disc(['https://example.com/a', 'https://example.com/b']), []);
    expect(r.platforms[0]).toMatchObject({ platform: 'gsc', done: 0, pending: 2 });
    expect(r.stale).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/progress.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`lib/submit/progress.ts`:
```ts
import type { DiscoveredLinks } from '@lib/storage/discovered';
import type { SubmissionRecord, Platform } from '@lib/storage/submissions';

export interface PlatformProgress {
  platform: Platform;
  done: number;
  total: number;
  pending: number;
}

export interface ProgressItem {
  url: string;
  gsc: 'done' | 'pending';
  bing: 'done' | 'pending';
}

export interface StaleSubmission {
  url: string;
  platform: Platform;
}

export interface ProgressReport {
  total: number;
  platforms: PlatformProgress[];
  items: ProgressItem[];
  stale: StaleSubmission[];
}

/**
 * 基于 discovered（当前有效链接）× submissions（历史提交）算分平台进度。
 * - 「已提交」只看 status === 'ok'（与现有去重口径一致；skipped 可重试，不计入）。
 * - stale = submissions 中 ok 且 url 已不在 discovered 的 (url, platform)，按 platform|url 去重。
 *   用于「已不在 sitemap」标灰展示，排除出 done/total 统计（它们不在 items 里）。
 * - discovered 是 single source of truth；submissions 的「是否过期」由它反查，不落库。
 */
export function computeProgress(
  discovered: DiscoveredLinks | null,
  submissions: SubmissionRecord[],
): ProgressReport {
  const okGsc = new Set<string>();
  const okBing = new Set<string>();
  for (const s of submissions) {
    if (s.status !== 'ok') continue;
    if (s.platform === 'gsc') okGsc.add(s.url);
    else if (s.platform === 'bing') okBing.add(s.url);
  }

  const urls = discovered?.urls ?? [];
  const urlSet = new Set(urls);
  const total = urls.length;

  const items: ProgressItem[] = urls.map((url) => ({
    url,
    gsc: okGsc.has(url) ? 'done' : 'pending',
    bing: okBing.has(url) ? 'done' : 'pending',
  }));

  const gscDone = items.filter((i) => i.gsc === 'done').length;
  const bingDone = items.filter((i) => i.bing === 'done').length;

  const stale: StaleSubmission[] = [];
  const staleSeen = new Set<string>();
  for (const s of submissions) {
    if (s.status !== 'ok') continue;
    if (urlSet.has(s.url)) continue;
    const k = `${s.platform}|${s.url}`;
    if (staleSeen.has(k)) continue;
    staleSeen.add(k);
    stale.push({ url: s.url, platform: s.platform });
  }

  const platforms: PlatformProgress[] = [
    { platform: 'gsc', done: gscDone, total, pending: total - gscDone },
    { platform: 'bing', done: bingDone, total, pending: total - bingDone },
  ];

  return { total, platforms, items, stale };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/progress.test.ts`
Expected: PASS（6 用例全过）

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add lib/submit/progress.ts tests/progress.test.ts
git commit -m "feat(submit): computeProgress 分平台进度纯函数（stale 运行时计算）"
```

---

## Task 3: useProgressQuery 编排 hook

**Files:**
- Create: `entrypoints/sidepanel/hooks/useProgressQuery.ts`
- Test: `tests/useProgressQuery.test.tsx`

**Interfaces:**
- Consumes: `fetchSitemapViaBackground` from `@lib/messaging/sitemap-client`；`getDiscovered` / `syncDiscovered` / `DiscoveredSyncDiff` from `@lib/storage/discovered`；`getSubmissions` from `@lib/storage/submissions`；`computeProgress` / `ProgressReport` from `@lib/submit/progress`。
- Produces:
  - `interface ProgressState { loading: boolean; error?: string; report?: ProgressReport; diff?: DiscoveredSyncDiff; updatedAt?: number; }`
  - `useProgressQuery(domain: string): { state: ProgressState; refresh: (sitemapUrl: string, deps?: { fetchSitemap?: typeof fetchSitemapViaBackground }) => Promise<void>; }`
  - 行为：mount 时（`domain` 非空）`load()` 读本地算 report（不抓取、不填 diff）；`refresh` 抓 sitemap → `syncDiscovered` → 重读 → `computeProgress`；抓取失败设 error、**不动 discovered**、**保留旧 report**。

- [ ] **Step 1: 写失败测试**

`tests/useProgressQuery.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mergeDiscovered, getDiscovered } from '../lib/storage/discovered';
import { appendSubmissions } from '../lib/storage/submissions';

const fetchSitemap = vi.fn();

import { useProgressQuery } from '../entrypoints/sidepanel/hooks/useProgressQuery';

beforeEach(() => {
  fetchSitemap.mockReset();
  fetchSitemap.mockResolvedValue({ urls: ['https://example.com/a', 'https://example.com/b'], stats: { indexDepth: 0, truncated: false } });
});

describe('useProgressQuery', () => {
  it('load 读本地算 report（不抓取、不填 diff）', async () => {
    await mergeDiscovered('example.com', 'https://example.com/sitemap.xml', ['https://example.com/a']);
    await appendSubmissions('example.com', [{ url: 'https://example.com/a', platform: 'gsc', status: 'ok', ts: 1, batchId: 'b1' }]);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    expect(fetchSitemap).not.toHaveBeenCalled();
    expect(result.current.state.diff).toBeUndefined();
    expect(result.current.state.report?.total).toBe(1);
    expect(result.current.state.report?.platforms[0]).toMatchObject({ platform: 'gsc', done: 1, total: 1 });
  });

  it('refresh 成功：抓取→对齐→report，diff 填充', async () => {
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/old']);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    await act(async () => {
      await result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap });
    });
    expect(fetchSitemap).toHaveBeenCalledWith('https://example.com/sitemap.xml');
    expect(result.current.state.diff?.added).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.current.state.diff?.removed).toEqual(['https://example.com/old']);
    expect(result.current.state.report?.total).toBe(2);
    // discovered 已对齐为新 sitemap
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(result.current.state.error).toBeUndefined();
  });

  it('refresh 抓取失败：设 error、不动 discovered、保留旧 report', async () => {
    fetchSitemap.mockRejectedValue(new Error('boom'));
    await mergeDiscovered('example.com', 'https://example.com/old.xml', ['https://example.com/old']);
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    const prevReport = result.current.state.report;
    await act(async () => {
      await result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap });
    });
    expect(result.current.state.error).toBe('boom');
    expect(result.current.state.loading).toBe(false);
    // discovered 未变（未对齐）
    expect((await getDiscovered('example.com'))?.urls).toEqual(['https://example.com/old']);
    // 旧 report 保留
    expect(result.current.state.report).toBe(prevReport);
    // diff 不被填充
    expect(result.current.state.diff).toBeUndefined();
  });

  it('refresh 期间 loading 翻转', async () => {
    let resolveFetch!: (v: any) => void;
    fetchSitemap.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useProgressQuery('example.com'));
    await waitFor(() => expect(result.current.state.report).toBeDefined());
    let p!: Promise<void>;
    act(() => { p = result.current.refresh('https://example.com/sitemap.xml', { fetchSitemap }); });
    await waitFor(() => expect(result.current.state.loading).toBe(true));
    resolveFetch({ urls: ['https://example.com/a'], stats: { indexDepth: 0, truncated: false } });
    await act(async () => { await p; });
    expect(result.current.state.loading).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/useProgressQuery.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`entrypoints/sidepanel/hooks/useProgressQuery.ts`:
```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/useProgressQuery.test.tsx`
Expected: PASS（4 用例全过）

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/hooks/useProgressQuery.ts tests/useProgressQuery.test.tsx
git commit -m "feat(hooks): useProgressQuery 查询进度编排（load + refresh 对账）"
```

---

## Task 4: ProgressPanel 组件

**Files:**
- Create: `entrypoints/sidepanel/components/ProgressPanel.tsx`
- Test: `tests/progresspanel.test.tsx`

**Interfaces:**
- Consumes: `useProgressQuery` from `../hooks/useProgressQuery`（Task 3）；`ProgressItem` from `@lib/submit/progress`（Task 2）；`Button` from `./Button`（现有）。
- Produces: 默认导出 `ProgressPanel`，props `{ domain: string; sitemapUrl: string }`。内部用 `useProgressQuery(domain)`，刷新按钮调 `refresh(sitemapUrl.trim())`。

- [ ] **Step 1: 写失败测试**

`tests/progresspanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const refresh = vi.fn();
const mock: { state: any; refresh: typeof refresh } = { state: { loading: false }, refresh };

vi.mock('../entrypoints/sidepanel/hooks/useProgressQuery', () => ({
  useProgressQuery: () => mock,
}));

import ProgressPanel from '../entrypoints/sidepanel/components/ProgressPanel';

const REPORT = {
  total: 2,
  platforms: [
    { platform: 'gsc' as const, done: 1, total: 2, pending: 1 },
    { platform: 'bing' as const, done: 0, total: 2, pending: 2 },
  ],
  items: [
    { url: 'https://example.com/a', gsc: 'done' as const, bing: 'pending' as const },
    { url: 'https://example.com/b', gsc: 'pending' as const, bing: 'pending' as const },
  ],
  stale: [] as Array<{ url: string; platform: 'gsc' | 'bing' }>,
};

beforeEach(() => {
  refresh.mockReset();
  mock.state = { loading: false };
});

describe('ProgressPanel', () => {
  it('点击「刷新进度」调用 refresh(sitemapUrl)', () => {
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    fireEvent.click(screen.getByText('刷新进度'));
    expect(refresh).toHaveBeenCalledWith('https://example.com/sitemap.xml');
  });

  it('loading 时按钮禁用且文案为「抓取中…」', () => {
    mock.state = { loading: true };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('抓取中…')).toBeDisabled();
  });

  it('sitemapUrl 为空时按钮禁用', () => {
    render(<ProgressPanel domain="example.com" sitemapUrl="" />);
    expect(screen.getByText('刷新进度')).toBeDisabled();
  });

  it('有 report 时显示分平台进度与百分比', () => {
    mock.state = { loading: false, report: REPORT };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('GSC')).toBeInTheDocument();
    expect(screen.getByText(/1\/2（50%/)).toBeInTheDocument();
    expect(screen.getByText(/0\/2（0%/)).toBeInTheDocument();
  });

  it('diff 存在时显示对账报告条', () => {
    mock.state = { loading: false, report: REPORT, diff: { added: ['x'], removed: ['y'], unchanged: ['z'] } };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/本次新增 1 · 清理 1 · 未变 1/)).toBeInTheDocument();
  });

  it('error 存在时显示错误条', () => {
    mock.state = { loading: false, error: '抓取失败' };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('抓取失败')).toBeInTheDocument();
  });

  it('无 report 时显示空态', () => {
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/还没有进度数据/)).toBeInTheDocument();
  });

  it('筛选「GSC未提交」只显示 gsc=pending 的子集', () => {
    mock.state = { loading: false, report: REPORT };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    // 默认「全部」：a 和 b 都在
    expect(screen.getByText(/example\.com\/a/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('GSC未提交'));
    // a 的 gsc=done，被滤掉；只剩 b
    expect(screen.queryByText(/example\.com\/a/)).not.toBeInTheDocument();
    expect(screen.getByText(/example\.com\/b/)).toBeInTheDocument();
  });

  it('超过 100 条时显示「加载更多」并追加', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ url: `https://example.com/p${i}`, gsc: 'pending' as const, bing: 'pending' as const }));
    mock.state = { loading: false, report: { ...REPORT, items } };
    render(<ProgressPanel domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/加载更多（剩余 50）/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/加载更多/));
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/progresspanel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`entrypoints/sidepanel/components/ProgressPanel.tsx`:
```tsx
import { useState } from 'react';
import Button from './Button';
import { useProgressQuery } from '../hooks/useProgressQuery';
import type { ProgressItem } from '@lib/submit/progress';

const PAGE = 100;

type Filter = 'all' | 'gsc-pending' | 'bing-pending' | 'stale';

export interface ProgressPanelProps {
  domain: string;
  sitemapUrl: string;
}

interface Row { key: string; left: string; right: string; stale?: boolean; }

export default function ProgressPanel({ domain, sitemapUrl }: ProgressPanelProps) {
  const { state, refresh } = useProgressQuery(domain);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE);

  const report = state.report;
  const canRefresh = sitemapUrl.trim().length > 0 && domain.trim().length > 0 && !state.loading;

  let rows: Row[] = [];
  if (report) {
    if (filter === 'stale') {
      rows = report.stale.map((s) => ({ key: `${s.platform}|${s.url}`, left: s.url, right: s.platform, stale: true }));
    } else {
      let items: ProgressItem[] = report.items;
      if (filter === 'gsc-pending') items = items.filter((i) => i.gsc === 'pending');
      else if (filter === 'bing-pending') items = items.filter((i) => i.bing === 'pending');
      rows = items.map((i) => ({
        key: i.url,
        left: i.url,
        right: `GSC${i.gsc === 'done' ? '✓' : '✗'} Bing${i.bing === 'done' ? '✓' : '✗'}`,
      }));
    }
  }

  const filters: Array<[Filter, string]> = [
    ['all', '全部'],
    ['gsc-pending', 'GSC未提交'],
    ['bing-pending', 'Bing未提交'],
    ['stale', `已不在sitemap(${report?.stale.length ?? 0})`],
  ];

  return (
    <div>
      <Button onClick={() => void refresh(sitemapUrl.trim())} disabled={!canRefresh} style={{ width: '100%' }}>
        {state.loading ? '抓取中…' : '刷新进度'}
      </Button>

      {state.error && (
        <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 8 }}>{state.error}</div>
      )}

      {state.diff && (
        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-muted)' }}>
          本次新增 {state.diff.added.length} · 清理 {state.diff.removed.length} · 未变 {state.diff.unchanged.length}
        </div>
      )}

      {report && report.total > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.platforms.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <div key={p.platform}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{p.platform.toUpperCase()}</span>
                    <span>{p.done}/{p.total}（{pct}%）</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-canvas)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
            {filters.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); setVisible(PAGE); }}
                className={`platform-chip${filter === key ? ' is-active' : ''}`}
              >{label}</button>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
            {rows.slice(0, visible).map((r) => (
              <div key={r.key} style={{ color: r.stale ? 'var(--color-muted)' : 'var(--color-ink)', opacity: r.stale ? 0.6 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {r.left} <span style={{ color: 'var(--color-muted)' }}>{r.right}</span>
              </div>
            ))}
            {rows.length === 0 && (
              <div style={{ color: 'var(--color-muted)' }}>无符合条件的链接</div>
            )}
            {visible < rows.length && (
              <button type="button" onClick={() => setVisible((v) => v + PAGE)} style={{ marginTop: 8, border: 'none', background: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                加载更多（剩余 {rows.length - visible}）
              </button>
            )}
          </div>
        </>
      )}

      {(!report || report.total === 0) && !state.error && (
        <div style={{ marginTop: 'var(--space-md)', fontSize: 12, color: 'var(--color-muted)' }}>
          还没有进度数据，点「刷新进度」抓取最新 sitemap 并对账。
        </div>
      )}
    </div>
  );
}
```

> 说明：sitemap 输入由 SubmitPanel 共享区承担（两 tab 都可见），ProgressPanel 内只放刷新按钮，不重复显示 sitemap（与 spec ProgressPanel 顶部小字相比省去重复展示）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/progresspanel.test.tsx`
Expected: PASS（9 用例全过）

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/components/ProgressPanel.tsx tests/progresspanel.test.tsx
git commit -m "feat(sidepanel): ProgressPanel 查询进度组件（分平台进度 + 筛选明细）"
```

---

## Task 5: SubmitPanel 加「提交 / 查询进度」tab

**Files:**
- Modify: `entrypoints/sidepanel/pages/SubmitPanel.tsx`
- Modify: `tests/submitpanel.test.tsx`（扩：mock useProgressQuery + 新增 tab 用例）

**Interfaces:**
- Consumes: `ProgressPanel` from `../components/ProgressPanel`（Task 4）；其余沿用现有（`useSubmitOrchestrator` / `TextInput` / `PlatformChip` / `LogPanel` / `classifyResult` / `normalizeOrigin` / `isValidDomain`）。
- 产出：SubmitPanel 顶部新增页面内 tab（默认 `'submit'`）；sitemap `TextInput` 提到 tab 下方共享区（两 tab 都可见可改，同一 state）；`tab === 'progress'` 渲染 `<ProgressPanel domain sitemapUrl />`。

- [ ] **Step 1: 改测试（mock useProgressQuery + 新增 tab 用例）**

`tests/submitpanel.test.tsx`（整体替换）：
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const run = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', () => ({
  useSubmitOrchestrator: () => ({
    run,
    cancel: vi.fn(),
    active: null,
    report: [],
    logs: [],
    clearReport: vi.fn(),
    gsc: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
    bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  }),
}));

const refresh = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useProgressQuery', () => ({
  useProgressQuery: () => ({ state: { loading: false }, refresh }),
}));

import SubmitPanel from '../entrypoints/sidepanel/pages/SubmitPanel';

describe('SubmitPanel', () => {
  it('默认 sitemapUrl = origin + /sitemap.xml', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('https://example.com/sitemap.xml');
  });

  it('非法域名提交时显示错误且不调 run', () => {
    render(<SubmitPanel site={{ domain: 'not a domain' }} onBack={() => {}} />);
    fireEvent.click(screen.getByText('一次提交'));
    expect(screen.getByText(/请先选择或填写有效网站/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it('有效域名点击提交：用 sitemapUrl 调 run', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.click(screen.getByText('一次提交'));
    expect(run).toHaveBeenCalledWith({ gsc: true, bing: true }, 'example.com', 'https://example.com/sitemap.xml');
  });

  it('手改 sitemapUrl 后用新值提交', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/sitemap-index.xml' } });
    fireEvent.click(screen.getByText('一次提交'));
    expect(run).toHaveBeenCalledWith({ gsc: true, bing: true }, 'example.com', 'https://example.com/sitemap-index.xml');
  });

  it('返回按钮触发 onBack', () => {
    const onBack = vi.fn();
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={onBack} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('默认在提交 tab，不渲染查询刷新按钮', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect(screen.queryByText('刷新进度')).not.toBeInTheDocument();
  });

  it('切到「查询进度」tab 渲染 ProgressPanel', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.click(screen.getByText('查询进度'));
    expect(screen.getByText('刷新进度')).toBeInTheDocument();
  });

  it('两 tab 共享 sitemapUrl：submit 改值后切 progress 用新值刷新', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/sitemap-index.xml' } });
    fireEvent.click(screen.getByText('查询进度'));
    fireEvent.click(screen.getByText('刷新进度'));
    expect(refresh).toHaveBeenCalledWith('https://example.com/sitemap-index.xml');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/submitpanel.test.tsx`
Expected: FAIL（新 tab 用例：找不到「查询进度」按钮 / 找不到「刷新进度」）

- [ ] **Step 3: 重写 SubmitPanel**

`entrypoints/sidepanel/pages/SubmitPanel.tsx`（整体替换）：
```tsx
import { useEffect, useRef, useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import LogPanel from '../components/LogPanel';
import PlatformChip from '../components/PlatformChip';
import ProgressPanel from '../components/ProgressPanel';
import { IconBack, GscMark, BingMark } from '../components/icons';
import { useSubmitOrchestrator } from '../hooks/useSubmitOrchestrator';
import { isValidDomain } from '@lib/storage/projects';
import { normalizeOrigin } from '@lib/seo-files/url';
import { classifyResult } from '@lib/submit/reasons';
import type { Site } from '../hooks/useSite';

function defaultSitemapUrl(domain: string): string {
  try { return `${normalizeOrigin(domain)}/sitemap.xml`; } catch { return ''; }
}

type Tab = 'submit' | 'progress';

export default function SubmitPanel({ site, onBack }: { site: Site; onBack: () => void }) {
  const orch = useSubmitOrchestrator();
  const [tab, setTab] = useState<Tab>('submit');
  const [sitemapUrl, setSitemapUrl] = useState(() => defaultSitemapUrl(site.domain));
  const [gsc, setGsc] = useState(true);
  const [bing, setBing] = useState(true);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);

  // domain 变化时重置默认值（除非用户手改过）
  useEffect(() => {
    if (!dirtyRef.current) setSitemapUrl(defaultSitemapUrl(site.domain));
  }, [site.domain]);

  const busy = orch.gsc.state.running || orch.bing.state.running || orch.active === 'sitemap';
  const ready = (gsc || bing) && !busy;

  function submit() {
    if (!isValidDomain(site.domain)) { setError('请先选择或填写有效网站（如 example.com）'); return; }
    if (!sitemapUrl.trim()) { setError('请填写站点地图 URL（如 https://example.com/sitemap.xml）'); return; }
    setError('');
    void orch.run({ gsc, bing }, site.domain.trim(), sitemapUrl.trim());
  }

  const successes = orch.report.filter((r) => classifyResult(r) === 'ok');
  const failures = orch.report.filter((r) => classifyResult(r) === 'failed');
  const skips = orch.report.filter((r) => classifyResult(r) === 'skipped');

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
        <IconBack size={14} /> 返回
      </button>
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>网站提交</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
        <button type="button" className={`platform-chip${tab === 'submit' ? ' is-active' : ''}`} onClick={() => setTab('submit')}>提交</button>
        <button type="button" className={`platform-chip${tab === 'progress' ? ' is-active' : ''}`} onClick={() => setTab('progress')}>查询进度</button>
      </div>

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>站点地图（sitemap.xml）</label>
      <TextInput value={sitemapUrl} placeholder="https://example.com/sitemap.xml" onChange={(e) => { dirtyRef.current = true; setSitemapUrl(e.target.value); }} />

      {tab === 'submit' && (
        <>
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}

          <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginTop: 'var(--space-md)', marginBottom: 6 }}>目标平台</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
            <PlatformChip label="GSC" icon={<GscMark />} checked={gsc} onToggle={() => setGsc((v) => !v)} />
            <PlatformChip label="Bing" icon={<BingMark />} checked={bing} onToggle={() => setBing((v) => !v)} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={submit} disabled={!ready} style={{ flex: 1 }}>{busy ? '提交中…' : '一次提交'}</Button>
            {busy && <Button variant="secondary" onClick={orch.cancel}>取消</Button>}
          </div>

          <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orch.logs.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>▍系统</div>
                <LogPanel logs={orch.logs} />
              </div>
            )}
            {(gsc || orch.gsc.logs.length > 0) && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>▍GSC{orch.gsc.state.total > 0 ? `  ${orch.gsc.state.done}/${orch.gsc.state.total}` : ''}</div>
                <LogPanel logs={orch.gsc.logs} />
              </div>
            )}
            {(bing || orch.bing.logs.length > 0) && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>▍Bing{orch.bing.state.total > 0 ? `  ${orch.bing.state.done}/${orch.bing.state.total}` : ''}</div>
                <LogPanel logs={orch.bing.logs} />
              </div>
            )}
          </div>

          {orch.report.length > 0 && (
            <div style={{ marginTop: 'var(--space-md)', fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                本批 {orch.report.length} 个 · 成功 {successes.length} · 失败 {failures.length} · 跳过 {skips.length}
              </div>
              {failures.length > 0 && (
                <div style={{ color: 'var(--color-error)', marginBottom: 6 }}>
                  <div style={{ fontWeight: 600 }}>失败：</div>
                  {failures.map((r) => (<div key={`${r.platform}-${r.url}`}>· {r.url}（{r.platform}{r.reason ? `：${r.reason}` : ''}）</div>))}
                </div>
              )}
              {successes.length > 0 && (
                <div style={{ color: 'var(--color-muted)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-ink)' }}>成功：</div>
                  {successes.map((r) => (<div key={`${r.platform}-${r.url}`}>· {r.url}（{r.platform}）</div>))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'progress' && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <ProgressPanel domain={site.domain.trim()} sitemapUrl={sitemapUrl.trim()} />
        </div>
      )}
    </div>
  );
}
```

> 改动相对旧版：① 新增 `tab` state + tab 切换按钮（复用 `platform-chip` class）；② `sitemap` `TextInput` 与 label 提到 tab 下方共享区（两 tab 都可见）；③ submit 流程整体包进 `{tab === 'submit' && (...)}`，error 提示移到 submit tab 内；④ 新增 `{tab === 'progress' && <ProgressPanel .../>}`。`ready` 去掉了 `sitemapUrl.trim().length > 0` 条件（改为 submit 函数内显式校验 + error，与原版一致）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/submitpanel.test.tsx`
Expected: PASS（8 用例全过：原 5 + 新 3）

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/pages/SubmitPanel.tsx tests/submitpanel.test.tsx
git commit -m "feat(sidepanel): SubmitPanel 加「提交/查询进度」tab（共享 sitemap 输入）"
```

---

## Task 6: 全量回归 + 构建

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 所有测试 PASS（新增 discovered-sync / progress / useProgressQuery / progresspanel + 改造的 submitpanel，以及现有全部 42+ 用例）。重点确认无回归：`tests/discovered.test.ts`（merge 仍 OK）、`tests/useSubmitOrchestrator.test.tsx`（提交流程未动）、`tests/submissions.test.ts`。

- [ ] **Step 2: 类型检查**

Run: `pnpm compile`
Expected: 无错误

- [ ] **Step 3: 构建**

Run: `pnpm build`
Expected: 成功产出 `.output/chrome-mv3/`，无构建错误。

- [ ] **Step 4: 手测清单（人工，构建产物加载到 Chrome）**

加载 `.output/chrome-mv3`，打开 sidepanel → 网站 → 选一个已登录 GSC/Bing 的站点 → 进入「网站提交」：

- [ ] 顶部出现「提交 / 查询进度」两个 tab，默认在「提交」
- [ ] sitemap 输入框在 tab 下方，两 tab 都可见；默认 `https://<domain>/sitemap.xml`
- [ ] 切到「查询进度」：显示「刷新进度」按钮；首次（本地无数据）显示空态「还没有进度数据…」
- [ ] 点「刷新进度」：按钮变「抓取中…」→ 完成后显示分平台进度（GSC/Bing 各一行 `done/total（%）` + 进度条）+ 筛选 chips + 明细列表（每行 url + `GSC✓/✗ Bing✓/✗`）
- [ ] 「本次新增 X · 清理 Y · 未变 Z」对账报告条出现且数字合理
- [ ] 切换筛选：全部 / GSC未提交 / Bing未提交 / 已不在sitemap 各自正确过滤
- [ ] 明细 > 100 条时出现「加载更多（剩余 N）」，点击追加后按钮消失
- [ ] 先在「提交」tab 跑一次「一次提交」→ 切回「查询进度」点刷新：GSC/Bing 已提交数上升、未提交数下降
- [ ] 在 sitemap 里下线一个页面（用一个不包含某旧链接的 sitemap）刷新：该旧链接从明细消失；其历史提交出现在「已不在sitemap」筛选里（标灰）
- [ ] 故意填错 sitemap URL 点刷新：显示错误条，discovered 未被改动（切回「提交」再查进度，旧数据仍在）
- [ ] 提交流程未受影响：切回「提交」tab，「一次提交」仍正常抓取/提交/出报告
