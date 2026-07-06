# Bing 提交链路迁移到 IndexNow API 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 QuickSEO 插件的 Bing 网址提交链路从 CDP（chrome.debugger 驱动 Bing Webmaster 页面 DOM）整体替换为 IndexNow API（background service worker 直接 `fetch` POST 到 `api.indexnow.org`），并在提交面板内新增全局 IndexNow 密钥的自动生成/下载/刷新配置区。

**Architecture:** 删除 `lib/bing/*`（CDP flow + 选择器 + URL builder）与 background 中 Bing 的 CDP 编排段，新增薄 `lib/indexnow/submit.ts`（`submitUrls` + `groupByHost` + `reasonFor`）。background `handleBingStart` 改为：读 `settings.indexnowKey` 并校验 → 按 hostname 分组 → 逐组 POST → 按状态码映射 `SubmitResult` → 推 `BING_STATE/BING_LOG/BING_DONE`。密钥在 sidepanel 层用 `crypto.getRandomValues` 生成、落 `chrome.storage.local`、Blob 下载 `<key>.txt`。消息协议 `BING_*` 字段结构不变，`useBingRunner`/`RunningOverlay`/`SubmitBar` 零改动。**GSC 提交链路保持 CDP 不动。**

**Tech Stack:** WXT + React 19 + TypeScript；Vitest + jsdom + @testing-library/react（`renderHook`/`render`）；`chrome.storage.local`（`onChanged` 跨视图同步）；MV3 service worker `fetch`。

## Global Constraints

- **IndexNow endpoint 固定** `https://api.indexnow.org/IndexNow`，方法 `POST`，`Content-Type: application/json; charset=utf-8`，body `{ host, key, urlList }`，**不传 `keyLocation`**（协议规定引擎自动找 `https://<host>/<key>.txt`）。
- **密钥格式** `/^[a-zA-Z0-9-]{8,128}$/`；`generateIndexNowKey()` 产出 16 字节 → 32 位 hex，落在协议区间。
- **整批失败映射 `skipped` + reason**，**不新增 `'failed'` 状态**（`SubmitResult.status` 仍为 `'ok' | 'skipped'`，契合 `isSubmittedOk` 只看 `ok` 的去重语义——skipped 可重试）。`BING_DONE.failed` 恒为 0（与现有 GSC 一致，UI 不消费此字段）。
- **GSC 链路不动**：`lib/cdp/*`、`lib/gsc/*`、background 的 `handleStart`、`GSC_*` 协议、`useGscRunner` 均不触碰。
- **`BING_*` 消息协议字段结构不变**（`BingStart{domain,urls}` / `BingCancel` / `BingState{state,total,done,currentUrl?,results}` / `BingLog` / `BingDone{ok,failed,skipped}`）。`currentUrl` 不再推送（字段可选，合法）。
- **host 从 urlList 推导**（`new URL(u).hostname`），按 hostname 分组提交，**不取 `project.domain`**。
- **import 别名**：源码用 `@lib/*` `@components/*` `@hooks/*`；测试用相对路径 `../lib/...` `../entrypoints/...`（与现有代码一致）。
- **命令**：单测 `pnpm test <file>`（或 `pnpm test` 全跑），类型检查 `pnpm compile`（= `tsc --noEmit`）。
- **chrome mock** 在 `tests/setup.ts`：`storage.local` 内存实现含 `onChanged`（`set` 时自动 `fireOnChanged`），`tabs.create` 返回 `{id:1}`，`debugger` no-op；每测前 storage 自动重置。**`fetch` 未全局 mock**，需在测试内 `vi.spyOn(globalThis, 'fetch')`。
- **manifest 不改**：`wxt.config.ts` 的 `host_permissions` 已含 `<all_urls>`，MV3 service worker `fetch` 跨域到 `api.indexnow.org` 不受页面 CORS 限制。

## 文件结构

| 文件 | 动作 | 责任 |
|---|---|---|
| `lib/storage/settings.ts` | 修改 | `Settings` 加 `indexnowKey?`；新增 `isValidIndexNowKey` / `generateIndexNowKey` |
| `lib/indexnow/submit.ts` | 新增 | `submitUrls`(fetch POST) + `groupByHost` + `reasonFor` |
| `entrypoints/background.ts` | 修改 | 重写 `handleBingStart`(删 CDP 编排，换 IndexNow)；删 Bing CDP import + 常量 |
| `lib/bing/flow.ts` | 删除 | CDP 逐条 DOM 操控，被 fetch 取代 |
| `lib/bing/selectors.ts` | 删除 | Bing 页面 DOM 探测 |
| `lib/bing/url.ts` | 删除 | `buildBingUrl`，不再开 tab |
| `tests/bing-flow.test.ts` | 删除 | 测已删的 CDP flow |
| `tests/bing-url.test.ts` | 删除 | 测已删的 `buildBingUrl` |
| `tests/indexnow-key.test.ts` | 新增 | 密钥生成/校验单测 |
| `tests/indexnow-submit.test.ts` | 新增 | submitUrls / reasonFor / groupByHost 单测 |
| `entrypoints/sidepanel/hooks/useIndexNowKey.ts` | 新增 | key 状态 + generate/refresh/download + storage.onChanged 同步 |
| `tests/useIndexNowKey.test.tsx` | 新增 | hook 行为单测 |
| `entrypoints/sidepanel/components/IndexNowKeySection.tsx` | 新增 | 密钥配置区（readonly 输入 + 生成/下载/刷新） |
| `tests/indexnow-key-section.test.tsx` | 新增 | 组件渲染/交互单测 |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 修改 | 插入 `<IndexNowKeySection />` |
| `tests/submitpanel.test.tsx` | 修改 | mock 掉 `IndexNowKeySection`，避免 textbox 冲突 |

---

### Task 1: settings 扩展（indexnowKey + 生成 + 校验）

**Files:**
- Modify: `lib/storage/settings.ts`
- Test: `tests/indexnow-key.test.ts`（新增）

**Interfaces:**
- Produces: `isValidIndexNowKey(k: string): boolean`、`generateIndexNowKey(): string`；`Settings` 增 `indexnowKey?: string`。后续 Task 3/5 消费这些。

- [ ] **Step 1: 写失败测试**

创建 `tests/indexnow-key.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isValidIndexNowKey, generateIndexNowKey } from '../lib/storage/settings';

describe('isValidIndexNowKey', () => {
  it('合法 32 位 hex 通过', () => {
    expect(isValidIndexNowKey('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
  });
  it('含短横线通过', () => {
    expect(isValidIndexNowKey('abc-def-12345678')).toBe(true);
  });
  it('过短（<8）不通过', () => {
    expect(isValidIndexNowKey('abc123')).toBe(false);
  });
  it('超长（>128）不通过', () => {
    expect(isValidIndexNowKey('a'.repeat(129))).toBe(false);
  });
  it('非法字符（含下划线）不通过', () => {
    expect(isValidIndexNowKey('abc_defgh1234567')).toBe(false);
  });
  it('空串不通过', () => {
    expect(isValidIndexNowKey('')).toBe(false);
  });
});

describe('generateIndexNowKey', () => {
  it('输出合法（匹配协议正则）', () => {
    expect(isValidIndexNowKey(generateIndexNowKey())).toBe(true);
  });
  it('长度为 32（16 字节 hex）', () => {
    expect(generateIndexNowKey()).toHaveLength(32);
  });
  it('两次调用结果不同（随机性）', () => {
    expect(generateIndexNowKey()).not.toBe(generateIndexNowKey());
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/indexnow-key.test.ts`
Expected: FAIL，`isValidIndexNowKey is not a function`（尚未导出）。

- [ ] **Step 3: 实现**

在 `lib/storage/settings.ts` 顶部 `Settings` 接口加字段，并在 `KEY`/`DEFAULT` 之后加校验/生成函数（`getSettings`/`updateSettings` 已是 Partial 合并，**不改**）：

```ts
export interface Settings { accountIndex: number; indexnowKey?: string; }
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };

/** IndexNow 协议密钥格式：8-128 字符，仅 a-zA-Z0-9-。 */
const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function isValidIndexNowKey(k: string): boolean {
  return INDEXNOW_KEY_PATTERN.test(k);
}

/**
 * 生成符合 IndexNow 协议的随机密钥（16 字节 → 32 位 hex）。
 * hex 仅含 0-9a-f，天然满足协议「至少一个字母或数字」。
 */
export function generateIndexNowKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/indexnow-key.test.ts`
Expected: PASS（9 个用例全绿）。

- [ ] **Step 5: 回归 + 类型检查**

Run: `pnpm test tests/storage.test.ts && pnpm compile`
Expected: storage 既有测试仍绿（`indexnowKey?` 可选，不破坏旧用例）；compile 无错。

- [ ] **Step 6: 提交**

```bash
git add lib/storage/settings.ts tests/indexnow-key.test.ts
git commit -m "feat(storage): 新增 IndexNow 密钥生成与校验"
```

---

### Task 2: lib/indexnow/submit.ts（submitUrls + groupByHost + reasonFor）

**Files:**
- Create: `lib/indexnow/submit.ts`
- Test: `tests/indexnow-submit.test.ts`（新增）

**Interfaces:**
- Produces: `submitUrls(key: string, host: string, urls: string[]): Promise<IndexNowResult>`，其中 `IndexNowResult = { ok: boolean; status: number; reason?: string }`；`groupByHost(urls: string[]): Map<string, string[]>`；`reasonFor(status: number): string`。Task 3 消费。
- 注：`submitUrls` 在 `fetch` reject 时**透传抛出**（由 background 的 try/catch 兜底成 `网络错误`）。

- [ ] **Step 1: 写失败测试**

创建 `tests/indexnow-submit.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitUrls, reasonFor, groupByHost } from '../lib/indexnow/submit';

beforeEach(() => vi.restoreAllMocks());

describe('submitUrls', () => {
  it('POST 到 api.indexnow.org/IndexNow，body 含 host/key/urlList + 正确 header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const r = await submitUrls('abc123def456abc123def456', 'example.com', ['https://example.com/a']);
    expect(r).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/IndexNow');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json; charset=utf-8' });
    expect(JSON.parse(init?.body as string)).toEqual({
      host: 'example.com',
      key: 'abc123def456abc123def456',
      urlList: ['https://example.com/a'],
    });
  });

  it('200 → ok:true，不带 reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const r = await submitUrls('k', 'h', ['https://h/x']);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('403 → ok:false + 密钥无效原因', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 403 } as Response);
    const r = await submitUrls('k', 'h', ['https://h/x']);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toMatch(/密钥无效/);
  });

  it('422 → URL 不属于该域名', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 422 } as Response);
    expect((await submitUrls('k', 'h', [])).reason).toMatch(/不属于该域名/);
  });

  it('429 → 频率限制', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 429 } as Response);
    expect((await submitUrls('k', 'h', [])).reason).toMatch(/频繁/);
  });

  it('400 → 格式错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 400 } as Response);
    expect((await submitUrls('k', 'h', [])).reason).toMatch(/格式错误/);
  });

  it('未知状态码（500）→ 兜底文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 500 } as Response);
    expect((await submitUrls('k', 'h', [])).reason).toBe('IndexNow 返回 500');
  });

  it('fetch 抛错 → 透传抛出（由 background catch 兜底）', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(submitUrls('k', 'h', [])).rejects.toThrow('network down');
  });
});

describe('reasonFor', () => {
  it('已知码均有文案', () => {
    expect(reasonFor(400)).toMatch(/格式/);
    expect(reasonFor(403)).toMatch(/密钥/);
    expect(reasonFor(422)).toMatch(/不属于/);
    expect(reasonFor(429)).toMatch(/频繁/);
  });
  it('未知码兜底', () => {
    expect(reasonFor(503)).toBe('IndexNow 返回 503');
  });
});

describe('groupByHost', () => {
  it('同 host 归一组', () => {
    const m = groupByHost(['https://example.com/a', 'https://example.com/b']);
    expect([...m.entries()]).toEqual([['example.com', ['https://example.com/a', 'https://example.com/b']]]);
  });
  it('www 与裸域名分两组', () => {
    const m = groupByHost(['https://example.com/a', 'https://www.example.com/b']);
    expect(m.size).toBe(2);
    expect(m.get('example.com')).toEqual(['https://example.com/a']);
    expect(m.get('www.example.com')).toEqual(['https://www.example.com/b']);
  });
  it('非法 URL 跳过', () => {
    const m = groupByHost(['not-a-url', 'https://example.com/a', '']);
    expect(m.size).toBe(1);
    expect(m.get('example.com')).toEqual(['https://example.com/a']);
  });
  it('空列表 → 空 Map', () => {
    expect(groupByHost([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/indexnow-submit.test.ts`
Expected: FAIL，`Cannot find module '../lib/indexnow/submit'`。

- [ ] **Step 3: 实现**

创建 `lib/indexnow/submit.ts`：

```ts
/**
 * IndexNow API 提交。
 *
 * 实现依据：docs/superpowers/specs/2026-07-06-indexnow-api-migration-design.md §2/§5。
 * 一次 POST 把整批 URL 通知给 IndexNow 网络（Bing/Yandex/Naver/Seznam/Yeep 自动共享）。
 * 替代旧版 CDP 驱动 Bing Webmaster 页面的逐条提交链路。
 */

const ENDPOINT = 'https://api.indexnow.org/IndexNow';

export interface IndexNowResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * 按 IndexNow 协议整批提交。key 合法性由调用方负责。
 * 不传 keyLocation：协议规定引擎自动到 https://<host>/<key>.txt 找验证文件。
 * fetch 抛错时透传（调用方 catch 兜底成「网络错误」）。
 */
export async function submitUrls(key: string, host: string, urls: string[]): Promise<IndexNowResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, urlList: urls }),
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

/** 把 IndexNow HTTP 状态码映射为可读原因（供 UI 日志展示）。 */
export function reasonFor(status: number): string {
  switch (status) {
    case 400: return '请求格式错误';
    case 403: return '密钥无效：站点根目录未找到 <key>.txt，或文件内容与密钥不匹配';
    case 422: return 'URL 不属于该域名，或域名与密钥不匹配';
    case 429: return '提交过于频繁，请稍后再试';
    default: return `IndexNow 返回 ${status}`;
  }
}

/**
 * 按 hostname 分组 URL。IndexNow 要求 body.host 与 urlList 每条 URL 的 host 完全一致，
 * 否则 422；sitemap 可能混 www/裸域名，分组后逐组提交避免整批失败。
 * 非法 URL（new URL 抛错）跳过。
 */
export function groupByHost(urls: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const u of urls) {
    let h: string;
    try { h = new URL(u).hostname; } catch { continue; }
    if (!m.has(h)) m.set(h, []);
    m.get(h)!.push(u);
  }
  return m;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/indexnow-submit.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错。

- [ ] **Step 6: 提交**

```bash
git add lib/indexnow/submit.ts tests/indexnow-submit.test.ts
git commit -m "feat(indexnow): 新增 IndexNow API 提交与按 host 分组"
```

---

### Task 3: background 重写 handleBingStart（删 CDP 编排，换 IndexNow）

**Files:**
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: Task 1 的 `isValidIndexNowKey`、`getSettings`（已 import）；Task 2 的 `submitUrls`、`groupByHost`；`messaging/types` 的 `SubmitResult`。
- 注：本任务**不删** `lib/bing/*` 文件（仍由 `tests/bing-flow.test.ts` 引用），只切断 background 对它们的依赖。文件删除在 Task 4。

**说明**：background 无单测（与现有 `handleStart` GSC 编排一致，靠 lib 层单测 + compile + 手动验证）。本任务是集成重构，不是 TDD。

- [ ] **Step 1: 改 import**

在 `entrypoints/background.ts` 顶部，**删除**这三行（第 26–28 行）：

```ts
import { runBatch as bingRunBatch } from '../lib/bing/flow';
import { buildBingUrl } from '../lib/bing/url';
import { PROBES as BING_PROBES } from '../lib/bing/selectors';
```

**新增**（紧挨已有 `import { getSettings } from '../lib/storage/settings';` 那行）：

```ts
import { getSettings, isValidIndexNowKey } from '../lib/storage/settings';
import { submitUrls, groupByHost } from '../lib/indexnow/submit';
```

并把已有的 type import 行补上 `SubmitResult`：

```ts
import type { GscRequest, GscEvent, BingRequest, BingEvent, SitemapRequest, SitemapEvent, SubmitResult } from '../lib/messaging/types';
```

- [ ] **Step 2: 删除 Bing CDP 专属常量**

删除 `BING_LOAD_TIMEOUT_MS`、`BING_LOAD_INTERVAL_MS`、`BING_LOGIN_CHECK_EXPR` 三个声明（位于 GSC 对应常量之后、`export default defineBackground` 之前）。**保留** GSC 的 `GSC_LOAD_TIMEOUT_MS`/`GSC_LOAD_INTERVAL_MS`/`LOGIN_CHECK_EXPR`。

- [ ] **Step 3: 重写 handleBingStart**

用下面这版**整体替换**现有 `handleBingStart` 函数（连同其上方注释）：

```ts
  /**
   * 编排一次 Bing 批量提交（IndexNow API 版）。
   *
   * 流程：读 settings.indexnowKey 并校验 → 按 hostname 分组 → 逐组 fetch POST 到 IndexNow
   *   → 按状态码把每条 URL 映射为 SubmitResult（ok / skipped+reason）→ 推 BING_STATE/BING_LOG/BING_DONE。
   * 未配 key / key 非法：推 error 日志 + BING_DONE(全 skipped)。
   * fetch 抛错（断网/DNS）：该组记 skipped + reason「网络错误:…」。
   *
   * 替代旧版 CDP 编排（开 tab / attach / 等 SPA / 检查登录 / 逐条 evalJs 操控 DOM / detach）。
   * 一次 POST 通常 1-3s，无 SW 回收风险；host_permissions(<all_urls>) 覆盖跨域 fetch。
   */
  async function handleBingStart(
    port: chrome.runtime.Port,
    msg: { domain: string; urls: string[] },
    shouldStop: () => boolean,
  ): Promise<void> {
    const { indexnowKey } = await getSettings();
    if (!indexnowKey || !isValidIndexNowKey(indexnowKey)) {
      emit(port, { type: 'BING_LOG', level: 'error', phase: 'system', message: '未配置有效的 IndexNow 密钥，请在下方生成' });
      emit(port, { type: 'BING_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
      return;
    }
    if (shouldStop()) return;

    emit(port, { type: 'BING_STATE', state: 'running', total: msg.urls.length, done: 0, results: [] });
    emit(port, { type: 'BING_LOG', level: 'info', phase: 'system', message: `提交 ${msg.urls.length} 条到 IndexNow…` });

    // 初始化全部 skipped(未执行)；成功者覆盖为 ok
    const results: SubmitResult[] = msg.urls.map((u): SubmitResult => ({ url: u, status: 'skipped', reason: '未执行' }));

    for (const [host, urls] of groupByHost(msg.urls)) {
      if (shouldStop()) break;
      let r: { ok: boolean; status: number; reason?: string };
      try {
        r = await submitUrls(indexnowKey, host, urls);
      } catch (e) {
        r = { ok: false, status: 0, reason: `网络错误：${(e as Error).message ?? String(e)}` };
      }
      for (const u of urls) {
        const row = results.find((x) => x.url === u);
        if (!row) continue;
        if (r.ok) { row.status = 'ok'; row.reason = undefined; }
        else { row.reason = r.reason; }
      }
      emit(port, {
        type: 'BING_LOG',
        level: r.ok ? 'info' : 'error',
        phase: 'submit',
        message: r.ok ? `→ ${host}：已提交 ${urls.length} 条` : `→ ${host}：${r.reason}`,
      });
    }

    emit(port, { type: 'BING_STATE', state: 'running', total: msg.urls.length, done: msg.urls.length, results });
    const ok = results.filter((r) => r.status === 'ok').length;
    emit(port, { type: 'BING_DONE', ok, failed: 0, skipped: msg.urls.length - ok });
  }
```

- [ ] **Step 4: 类型检查**

Run: `pnpm compile`
Expected: 无错。若报 `runBatch as bingRunBatch` / `buildBingUrl` / `BING_PROBES` 未使用——说明 Step 1 的删除未覆盖干净，回到 Step 1 确认三行 import 已删。

- [ ] **Step 5: 回归测试**

Run: `pnpm test`
Expected: 全绿。注意 `tests/bing-flow.test.ts` 仍通过（`lib/bing/*` 文件还在，只是 background 不再引用）；`tests/bing-messaging.test.ts` 协议结构未变，通过。

- [ ] **Step 6: 提交**

```bash
git add entrypoints/background.ts
git commit -m "refactor(background): Bing 提交改用 IndexNow API 替换 CDP 编排"
```

---

### Task 4: 删除旧 bing CDP 文件

**Files:**
- Delete: `lib/bing/flow.ts`、`lib/bing/selectors.ts`、`lib/bing/url.ts`、`tests/bing-flow.test.ts`、`tests/bing-url.test.ts`

**Interfaces:**
- 前置：Task 3 已让 `entrypoints/background.ts` 不再 import `lib/bing/*`。消费者 grep 确认仅剩两个待删测试。

- [ ] **Step 1: 再次确认无其它消费者**

Run: `grep -rn "lib/bing\|@lib/bing" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "\.output" | grep -v "\.wxt"`
Expected: 只剩 `tests/bing-flow.test.ts` 与 `tests/bing-url.test.ts` 两行（它们本步一并删除）。若有其它行——停止，先处理该消费者。

- [ ] **Step 2: 删除文件**

```bash
git rm lib/bing/flow.ts lib/bing/selectors.ts lib/bing/url.ts tests/bing-flow.test.ts tests/bing-url.test.ts
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `pnpm compile && pnpm test`
Expected: compile 无错；全测试绿（bing-messaging.test.ts 仍绿——它只测协议类型，不依赖 lib/bing）。

- [ ] **Step 4: 提交**

```bash
git commit -m "chore(bing): 删除废弃的 CDP 提交链路（flow/selectors/url）及测试"
```

---

### Task 5: useIndexNowKey hook

**Files:**
- Create: `entrypoints/sidepanel/hooks/useIndexNowKey.ts`
- Test: `tests/useIndexNowKey.test.tsx`（新增）

**Interfaces:**
- Consumes: Task 1 的 `getSettings`、`updateSettings`、`generateIndexNowKey`；`chrome.storage.onChanged`（setup.ts 已 mock）。
- Produces: `useIndexNowKey()` → `{ key: string | undefined; generate(): void; refresh(): void; download(): void }`。Task 6 消费。

- [ ] **Step 1: 写失败测试**

创建 `tests/useIndexNowKey.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIndexNowKey } from '../entrypoints/sidepanel/hooks/useIndexNowKey';
import { getSettings } from '../lib/storage/settings';

describe('useIndexNowKey', () => {
  it('初始无 key → key 为 undefined', async () => {
    const { result } = renderHook(() => useIndexNowKey());
    // 等 getSettings 的 useEffect 跑完
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.key).toBeUndefined();
  });

  it('generate 后 key 非空且合法（落库 + onChanged 回写）', async () => {
    const { result } = renderHook(() => useIndexNowKey());
    await act(async () => { result.current.generate(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.key).toBeTruthy();
    expect(result.current.key).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
    const s = await getSettings();
    expect(s.indexnowKey).toBe(result.current.key);
  });

  it('预置 key 后 hook 能读到', async () => {
    const { updateSettings } = await import('../lib/storage/settings');
    await updateSettings({ indexnowKey: 'preconfigured-key-1234567890' });
    const { result } = renderHook(() => useIndexNowKey());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.key).toBe('preconfigured-key-1234567890');
  });

  it('refresh 未确认（confirm=false）不换 key', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() => useIndexNowKey());
    await act(async () => { result.current.generate(); await Promise.resolve(); await Promise.resolve(); });
    const first = result.current.key;
    act(() => { result.current.refresh(); });
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(result.current.key).toBe(first);
    confirmSpy.mockRestore();
  });

  it('refresh 确认（confirm=true）换新 key', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() => useIndexNowKey());
    await act(async () => { result.current.generate(); await Promise.resolve(); await Promise.resolve(); });
    const first = result.current.key;
    await act(async () => { result.current.refresh(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.key).not.toBe(first);
    vi.restoreAllMocks();
  });

  it('download：无 key 时 no-op；有 key 时触发 <a>.click', async () => {
    const { result } = renderHook(() => useIndexNowKey());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // 无 key：不抛错
    act(() => { result.current.download(); });
    // 有 key
    await act(async () => { result.current.generate(); await Promise.resolve(); await Promise.resolve(); });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    act(() => { result.current.download(); });
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/useIndexNowKey.test.tsx`
Expected: FAIL，`Cannot find module '../entrypoints/sidepanel/hooks/useIndexNowKey'`。

- [ ] **Step 3: 实现**

创建 `entrypoints/sidepanel/hooks/useIndexNowKey.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings, generateIndexNowKey } from '@lib/storage/settings';

const SETTINGS_KEY = 'settings';

/**
 * IndexNow 全局密钥状态：读 settings.indexnowKey，跨视图同步（storage.onChanged）。
 * - generate：生成随机 key 并落库（onChanged 回写 state）。
 * - refresh：confirm 通过后 generate（覆盖旧 key → 各站需重新上传 <key>.txt）。
 * - download：用 Blob 触发浏览器下载 <key>.txt（内容=key），供用户上传到站点根目录。
 */
export function useIndexNowKey() {
  const [key, setKey] = useState<string | undefined>(undefined);

  // 初次读
  useEffect(() => {
    let active = true;
    getSettings().then((s) => { if (active) setKey(s.indexnowKey); });
    return () => { active = false; };
  }, []);

  // 跨视图同步
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const next = (changes[SETTINGS_KEY].newValue as { indexnowKey?: string } | undefined)?.indexnowKey;
      setKey(next);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const generate = useCallback(() => {
    void updateSettings({ indexnowKey: generateIndexNowKey() });  // onChanged 回写
  }, []);

  const refresh = useCallback(() => {
    if (!window.confirm('刷新会覆盖当前密钥，旧密钥文件立即作废，所有站点需重新上传。确认？')) return;
    generate();
  }, [generate]);

  const download = useCallback(() => {
    if (!key) return;
    const blob = new Blob([key], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [key]);

  return { key, generate, refresh, download };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/useIndexNowKey.test.tsx`
Expected: PASS（6 个用例绿）。若 `download` 用例因 jsdom 未实现 `URL.createObjectURL` 失败——在测试文件顶部加 polyfill：`beforeAll(() => { if (!('createObjectURL' in URL)) URL.createObjectURL = () => 'blob:mock'; URL.revokeObjectURL = () => {}; });`（jsdom 通常已实现，一般无需）。

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错。

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/hooks/useIndexNowKey.ts tests/useIndexNowKey.test.tsx
git commit -m "feat(hooks): 新增 useIndexNowKey 密钥管理 hook"
```

---

### Task 6: IndexNowKeySection 组件

**Files:**
- Create: `entrypoints/sidepanel/components/IndexNowKeySection.tsx`
- Test: `tests/indexnow-key-section.test.tsx`（新增）

**Interfaces:**
- Consumes: Task 5 的 `useIndexNowKey`；已有 `Button`、`TextInput` 组件。
- Produces：默认导出 `IndexNowKeySection`（无 props）。Task 7 在 SubmitPanel 渲染它。

- [ ] **Step 1: 写失败测试**

创建 `tests/indexnow-key-section.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockKey: string | undefined = undefined;
const mockGenerate = vi.fn();
const mockRefresh = vi.fn();
const mockDownload = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useIndexNowKey', () => ({
  useIndexNowKey: () => ({ key: mockKey, generate: mockGenerate, refresh: mockRefresh, download: mockDownload }),
}));

import IndexNowKeySection from '../entrypoints/sidepanel/components/IndexNowKeySection';

beforeEach(() => {
  mockKey = undefined;
  mockGenerate.mockReset();
  mockRefresh.mockReset();
  mockDownload.mockReset();
});

describe('IndexNowKeySection', () => {
  it('未配置：显示「生成密钥」，不显示下载/刷新', () => {
    render(<IndexNowKeySection />);
    expect(screen.getByText('生成密钥')).toBeInTheDocument();
    expect(screen.queryByText('下载密钥文件')).not.toBeInTheDocument();
    expect(screen.queryByText('刷新')).not.toBeInTheDocument();
  });

  it('未配置：点「生成密钥」调 generate', () => {
    render(<IndexNowKeySection />);
    fireEvent.click(screen.getByText('生成密钥'));
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('已配置：readonly 输入框显示 key，显示下载/刷新，不显示生成', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    expect((screen.getByLabelText('IndexNow 密钥') as HTMLInputElement).value).toBe(mockKey);
    expect((screen.getByLabelText('IndexNow 密钥') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('下载密钥文件')).toBeInTheDocument();
    expect(screen.getByText('刷新')).toBeInTheDocument();
    expect(screen.queryByText('生成密钥')).not.toBeInTheDocument();
  });

  it('已配置：点下载调 download、点刷新调 refresh', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    fireEvent.click(screen.getByText('下载密钥文件'));
    expect(mockDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('刷新'));
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('提示上传到每个站点根目录', () => {
    render(<IndexNowKeySection />);
    expect(screen.getByText(/上传到你【每个】站点的根目录/)).toBeInTheDocument();
  });

  it('已配置时文案含 <key>.txt 文件名', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    expect(screen.getByText(/abc123def456abc123def456abc123de\.txt/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/indexnow-key-section.test.tsx`
Expected: FAIL，`Cannot find module '../entrypoints/sidepanel/components/IndexNowKeySection'`。

- [ ] **Step 3: 实现**

创建 `entrypoints/sidepanel/components/IndexNowKeySection.tsx`：

```tsx
import Button from './Button';
import TextInput from './TextInput';
import { useIndexNowKey } from '../hooks/useIndexNowKey';

/**
 * IndexNow 密钥配置区（常驻提交面板）。
 * 未配置：显示「生成密钥」。
 * 已配置：readonly 输入框展示 key + 「下载密钥文件」「刷新」。
 * 文案提示用户把 <key>.txt 上传到每个站点根目录。
 */
export default function IndexNowKeySection() {
  const { key, generate, refresh, download } = useIndexNowKey();
  const fileName = key ? `${key}.txt` : '<key>.txt';
  return (
    <div style={{ marginTop: 'var(--space-md)', padding: 12, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>IndexNow 密钥（提交到 Bing/Yandex 等搜索引擎）</div>
      <TextInput
        value={key ?? ''}
        readOnly
        placeholder="未生成"
        aria-label="IndexNow 密钥"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {!key && <Button onClick={generate}>生成密钥</Button>}
        {key && <Button onClick={download}>下载密钥文件</Button>}
        {key && <Button variant="secondary" onClick={refresh}>刷新</Button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
        请将 <span style={{ fontFamily: 'var(--font-mono)' }}>{fileName}</span> 上传到你【每个】站点的根目录：
        <span style={{ fontFamily: 'var(--font-mono)' }}>https://&lt;你的域名&gt;/{fileName}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/indexnow-key-section.test.tsx`
Expected: PASS（6 个用例绿）。

- [ ] **Step 5: 类型检查**

Run: `pnpm compile`
Expected: 无错。

- [ ] **Step 6: 提交**

```bash
git add entrypoints/sidepanel/components/IndexNowKeySection.tsx tests/indexnow-key-section.test.tsx
git commit -m "feat(components): 新增 IndexNowKeySection 密钥配置区"
```

---

### Task 7: SubmitPanel 集成 + 修复现有测试

**Files:**
- Modify: `entrypoints/sidepanel/pages/SubmitPanel.tsx`
- Modify: `tests/submitpanel.test.tsx`

**Interfaces:**
- Consumes: Task 6 的 `IndexNowKeySection`。
- 说明：现有 `submitpanel.test.tsx` 用 `screen.getByRole('textbox')` 假设唯一 textbox；密钥区会引入第二个 textbox。在该测试里 `vi.mock` 掉 `IndexNowKeySection`（密钥区渲染由 `indexnow-key-section.test.tsx` 单独覆盖），保持 SubmitPanel 测试聚焦。

- [ ] **Step 1: 改 SubmitPanel 插入密钥区**

在 `entrypoints/sidepanel/pages/SubmitPanel.tsx` 顶部 import 区加（其它组件 import 旁）：

```ts
import IndexNowKeySection from '../components/IndexNowKeySection';
```

在 JSX 里，**低价值过滤说明 `<div>将自动过滤...</div>` 之后**、**`{showReport && ...}` 之前**，插入：

```tsx
          <IndexNowKeySection />
```

即上下文为：

```tsx
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
            将自动过滤登录 / 注册 / 隐私 / 条款 / 账号等低价值链接，不参与提交。
          </div>

          <IndexNowKeySection />

          {showReport && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <BatchReportCard report={orch.report} onClose={orch.clearReport} />
            </div>
          )}
```

- [ ] **Step 2: 修复 submitpanel.test.tsx（mock 掉密钥区）**

在 `tests/submitpanel.test.tsx` 顶部已有的 `vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', ...)` 与 `vi.mock('../entrypoints/sidepanel/hooks/useProgressQuery', ...)` 之后，新增：

```ts
vi.mock('../entrypoints/sidepanel/components/IndexNowKeySection', () => ({
  default: () => null,
}));
```

这样现有 `screen.getByRole('textbox')` 仍唯一指向 sitemap 输入框，既有断言无需改动。

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test tests/submitpanel.test.tsx`
Expected: PASS（既有用例全绿）。

- [ ] **Step 4: 全量回归 + 类型检查**

Run: `pnpm compile && pnpm test`
Expected: compile 无错；全部测试绿。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/pages/SubmitPanel.tsx tests/submitpanel.test.tsx
git commit -m "feat(submit-panel): 集成 IndexNow 密钥配置区"
```

---

### Task 8: 端到端手动验证（无自动化，清单式）

**Files:** 无（仅人工执行）

**说明**：IndexNow 真实提交需联网 + 真实站点的 `<key>.txt`，无法在单测覆盖。构建插件后在浏览器手动走一遍，确认整条链路。

- [ ] **Step 1: 构建**

Run: `pnpm build`
Expected: 构建产物生成于 `.output/`，无报错。

- [ ] **Step 2: 装载插件**

在 Edge/Chrome `edge://extensions`（或 `chrome://extensions`）加载 `.output/chrome-mv3`（或开发用 `pnpm dev`），打开 sidepanel。

- [ ] **Step 3: 验证密钥配置区**

- 进「网站工具 → 网站提交」，确认密钥配置区常驻显示，初始为「未生成」+「生成密钥」。
- 点「生成密钥」→ readonly 输入框出现 32 位 key，下方出现「下载密钥文件」「刷新」。
- 点「下载密钥文件」→ 浏览器下载 `<key>.txt`，打开确认内容 = key。
- 点「刷新」→ 弹二次确认；取消不换 key，确认换新 key（输入框值变化）。

- [ ] **Step 4: 验证真实提交（需自备一个你控制的站点）**

- 把下载的 `<key>.txt` 上传到该站点根目录（`https://<你的域名>/<key>.txt` 可公网访问，内容=key）。
- 选一个项目域名 + sitemap，**只勾 Bing**，点「一次提交 10 个」。
- 观察 LogPanel：应出现 `提交 N 条到 IndexNow…` → `→ <host>：已提交 N 条`（200 成功）。
- 报告卡显示本批 N 条全部 `ok`；再次提交相同 URL 应被去重跳过（`isSubmittedOk` 命中）。

- [ ] **Step 5: 验证错误分支**

- **未配 key**：清掉 `chrome.storage.local.settings.indexnowKey`（或刷新 key 后不上传新文件），勾 Bing 提交 → 日志报「未配置有效的 IndexNow 密钥」或「密钥无效：站点根目录未找到 <key>.txt…」，整批 skipped。
- **GSC 未受影响**：勾 GSC 提交，确认仍走 CDP（开 tab + 驱动 GSC 页面），与本改动无关。

- [ ] **Step 6: 收尾**

确认无误后，本计划完成。无需提交（本任务无代码变更）。

---

## Self-Review

**1. Spec coverage（逐节对照 spec）:**
- §4.1 settings 扩展 → Task 1 ✓
- §4.2 密钥文件下载 → Task 5 的 `download`（Blob + `<a download>`）✓
- §5.1 submit.ts → Task 2 ✓
- §5.2 host 分组 → Task 2 的 `groupByHost` + Task 3 调用 ✓
- §5.3 background 重写 → Task 3 ✓
- §5.4 进度语义（done 0→total 一次性）→ Task 3 的 BING_STATE 推送 ✓
- §6.1 IndexNowKeySection → Task 6 ✓
- §6.2 useIndexNowKey → Task 5 ✓
- §6.3 SubmitPanel 集成 → Task 7 ✓
- §7 错误处理矩阵 → Task 2（reasonFor）+ Task 3（key 校验 / fetch catch / 状态码映射）✓
- §8 测试策略 → Task 1/2/5/6 新增测试 + Task 4 删除旧测试 ✓
- §9 文件改动清单 → 文件结构表 + Task 1-7 全覆盖 ✓
- §10 风险与边界 → Global Constraints + Task 8 验证 ✓

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码；无「类似 Task N」「添加适当错误处理」等占位。✓

**3. Type consistency:**
- `IndexNowResult = { ok: boolean; status: number; reason?: string }`：Task 2 定义，Task 3 消费（`r: { ok; status; reason? }`），一致 ✓
- `submitUrls(key, host, urls)` / `groupByHost(urls)` / `reasonFor(status)`：Task 2 定义签名，Task 3 调用参数一致 ✓
- `isValidIndexNowKey(k: string)` / `generateIndexNowKey()`：Task 1 定义，Task 3/5 调用一致 ✓
- `useIndexNowKey()` → `{ key, generate, refresh, download }`：Task 5 定义，Task 6 解构一致 ✓
- `SubmitResult`（messaging/types 既有）+ `status: 'ok' | 'skipped'`：Task 3 用 `(u): SubmitResult` 收窄字面量，与 submissions 去重语义一致 ✓
- `BING_DONE.failed` 恒 0：Task 3 推送 `failed: 0`，与 spec §10 一致 ✓

无类型/签名不一致。
