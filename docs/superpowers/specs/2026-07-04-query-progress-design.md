# 查询提交进度：sitemap 对账 + 分平台进度统计

- **日期**：2026-07-04
- **状态**：已确认（待实现）
- **主题**：query-progress

## 背景与目标

当前「网站提交」面板（`SubmitPanel.tsx`）只有「提交」动作，无法回答「我这个站点提交到什么程度了」。更关键的是，本地链接库 `discovered` 由 `mergeDiscovered` 维护，是**只增不减**的并集——当站点页面增删后，本地会与现实漂移：

- 已下线的页面仍留在 `discovered.urls` 里，被永久当作「未提交」，进度被低估、误判。
- 已提交但后来下线的页面记录（`submissions`）无法与「当前真实 sitemap」对账。

**目标**：在 SubmitPanel 新增「查询进度」tab。点「刷新」→ 经现有 `sitemap-fetcher` port 抓最新 sitemap → `discovered` 与最新 sitemap **全量对齐**（新增入、消失删）→ 基于对齐后的 `discovered` × 本地 `submissions` 统计 **GSC / Bing 分平台进度**，并展示带筛选的明细列表。`submissions` 历史记录**保留不删**，但「已不在 sitemap」的提交在进度视图标灰、排除出统计。

> 复用现有 `chrome.storage.local`（按 `domain` 隔离）与 `sitemap-fetcher` port；不引入新存储、不新增 port、不改提交流程。

## 已确认的关键决策

经澄清确认，以下为本次改造的定调决策：

1. **清理范围**：`discovered.urls` 与最新 sitemap **全量对齐**（新增入、消失删）；`submissions` 历史记录**保留不动**，「已不在 sitemap」的提交**运行时计算**（不落库标记）、在视图里标灰并排除出进度统计。
2. **UI 入口**：`SubmitPanel` 顶部加页面内 tab「提交 / 查询进度」，互斥展示；不新增导航层级、不开新页面。
3. **进度口径**：**分平台独立统计**——GSC / Bing 各一行 `done / total / 百分比`；明细列表按平台 × 状态筛选。
4. **对账交互**：**静默对账 + 结果报告**——点刷新直接抓取并对齐 `discovered`（不弹确认），完成后展示「本次新增 X · 清理 Y · 未变 Z」。
5. **sitemap URL**：查询 tab **复用**提交 tab 的 `sitemapUrl` 输入（同一 state），查询 tab 顶部小字显示当前值；不重复放输入框。
6. **明细列表容量**：筛选 chips + 默认渲染前 100 条 + 「加载更多」分批；v1 不上虚拟滚动。
7. **URL 相等口径**：沿用全项目**字符串相等**（与 `mergeDiscovered` / `fetchSitemapTree` 一致），不引入 URL 规范化。已知限制：`/a` 与 `/a/` 视为不同——全项目一致行为，本次不改。
8. **discovered 是 single source of truth**：「当前有效链接集合」始终以 `discovered.urls` 为准；`submissions` 的「是否过期」由它反查得出，无冗余字段。

## 架构与数据流

```
SubmitPanel（页面内 tab 切换）
├─ tab === 'submit'   → 现有提交 UI（不动）
└─ tab === 'progress' → <ProgressPanel domain sitemapUrl>
                         └─ useProgressQuery(domain)
                              · mount 时 load()：读本地 → computeProgress → 立即显示上次进度
                              · refresh(sitemapUrl):
                                  ① port → background: SITEMAP_FETCH { sitemapUrl }
                                       （复用现有 sitemap-fetcher port + fetchSitemapTree）
                                    ← SITEMAP_RESULT { urls, stats } | SITEMAP_ERROR { message }
                                  ② syncDiscovered(domain, sitemapUrl, urls)   // 全量对齐，返回 diff
                                  ③ getDiscovered + getSubmissions             // 重读对齐后数据
                                  ④ computeProgress(discovered, submissions)   // 纯函数算 report
                                  ⑤ set { report, diff, updatedAt }
```

- **不新增 port**：复用 `lib/messaging/sitemap-client.ts` 的 `fetchSitemapViaBackground`。
- **不改提交流程**：`useSubmitOrchestrator` 继续用只增的 `mergeDiscovered`；全量 `syncDiscovered` 仅查询流程使用。两者并存、语义不同（提交时保守只增，查询时全量对齐）。
- **不改 background**：`entrypoints/background.ts` 的 sitemap-fetcher port 监听已就绪，直接复用。

## 组件结构

```
SubmitPanel.tsx（改造）
├─ 返回按钮 + <h2>网站提交</h2>
├─ 〔提交 | 查询进度〕页面内 tab                  —— 新增（两个按钮，选中态用现有样式）
├─ sitemap TextInput（默认 <origin>/sitemap.xml）—— 保留，state 提升为两 tab 共享
├─ tab === 'submit':
│   ├─ 目标平台 PlatformChip × 2                   —— 保留
│   ├─ 〔一次提交〕 / 〔取消〕                      —— 保留
│   ├─ GSC / Bing LogPanel                         —— 保留
│   └─ 本批报告区                                   —— 保留
└─ tab === 'progress':
    └─ <ProgressPanel>                              —— 新增
       ├─ 当前 sitemap 小字 + 〔刷新进度〕
       ├─ 错误条（抓取失败时）
       ├─ 对账报告条  本次新增 X · 清理 Y · 未变 Z
       ├─ 分平台进度  GSC ██████░░ 80/100 (80%)
       │              Bing ████░░░░ 40/100 (40%)
       ├─ 筛选 chips  [全部] [GSC未提交] [Bing未提交] [已不在sitemap]
       └─ 明细列表（前 100 + 〔加载更多〕）
```

## 新增 / 改动文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/storage/discovered.ts` | 改造 | 新增 `syncDiscovered()`（全量对齐，返回 diff）。现有 `mergeDiscovered` **保留不动**（提交流程仍用）。 |
| `lib/submit/progress.ts` | 新增 | `computeProgress()` 纯函数：`discovered × submissions` → 分平台进度 + 明细 items + stale 列表。 |
| `entrypoints/sidepanel/hooks/useProgressQuery.ts` | 新增 | 编排 hook：`load()`（读本地）+ `refresh(sitemapUrl)`（抓取→对齐→重读→算）。 |
| `entrypoints/sidepanel/components/ProgressPanel.tsx` | 新增 | 查询 tab UI：刷新 + 报告条 + 分平台进度 + 筛选 + 明细列表。 |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 改造 | 加页面内 tab state；`progress` tab 挂载 `<ProgressPanel>`；`sitemapUrl` state 升为两 tab 共享。 |
| `lib/messaging/sitemap-client.ts` | 不动 | 复用 `fetchSitemapViaBackground`。 |
| `lib/sitemap/*` / `entrypoints/background.ts` | 不动 | 复用现有抓取链路。 |
| `lib/storage/submissions.ts` | 不动 | 存储不变，「已不在 sitemap」运行时计算。 |
| `useSubmitOrchestrator.ts` / 提交流程 | 不动 | 继续用 `mergeDiscovered`（只增）。 |

## 数据模型变化

### discovered：新增 `syncDiscovered`（全量对齐）

```ts
// lib/storage/discovered.ts（在现有 getDiscovered / mergeDiscovered 之外新增）
export interface DiscoveredSyncDiff {
  added: string[];      // 新 sitemap 有、旧库没有
  removed: string[];    // 旧库有、新 sitemap 没有（将被删除）
  unchanged: string[];  // 两者都有
}

export function syncDiscovered(
  domain: string,
  sitemapUrl: string,
  fetchedUrls: string[],
): Promise<DiscoveredSyncDiff>;
```

**语义**（区别于只增的 `mergeDiscovered`）：

1. 读旧 `discovered`（可能为 `null`）。
2. 对 `fetchedUrls` 做一次**保序去重**（防御性，即使调用方传重复也安全）。
3. 算 diff：`added = fetched - old`、`removed = old - fetched`、`unchanged = fetched ∩ old`（字符串相等）。
4. 写新 `discovered`：`urls = fetched`（**按抓取顺序**，不保留旧序）、`sitemapUrl`、`updatedAt = Date.now()`。
5. 返回 diff（供 UI 展示「新增 X · 清理 Y · 未变 Z」）。

> `mergeDiscovered`（只增并集）**保留**——`useSubmitOrchestrator` 提交流程仍用它（提交中途不应删链接）。`syncDiscovered` 仅查询流程用。

### submissions：不变

`SubmissionRecord` 结构、`getSubmissions` / `isSubmittedOk` / `appendSubmissions` **完全不动**。「已不在 sitemap」**不落库**——运行时用 `discovered.urls` 反查（见下 `computeProgress` 的 `stale`）。

## computeProgress 规格（纯函数）

```ts
// lib/submit/progress.ts
import type { DiscoveredLinks } from '../storage/discovered';
import type { SubmissionRecord, Platform } from '../storage/submissions';

export interface PlatformProgress {
  platform: Platform;
  done: number;      // discovered.urls 中该平台有 status==='ok' 记录的数量
  total: number;     // = discovered.urls.length
  pending: number;   // total - done
}

export interface ProgressItem {
  url: string;
  gsc: 'done' | 'pending';
  bing: 'done' | 'pending';
}

export interface StaleSubmission {
  url: string;
  platform: Platform;   // 该 url 在哪个平台有 ok 记录但 url 已不在 discovered
}

export interface ProgressReport {
  total: number;                   // discovered.urls.length（当前有效链接数）
  platforms: PlatformProgress[];   // [{ gsc, ... }, { bing, ... }]
  items: ProgressItem[];           // discovered 每条 url 一项
  stale: StaleSubmission[];        // submissions 里 url ∉ discovered 的 ok 记录（去重）
}

export function computeProgress(
  discovered: DiscoveredLinks | null,
  submissions: SubmissionRecord[],
): ProgressReport;
```

**算法**：

1. `okGsc = Set(submissions.filter(s => s.platform === 'gsc' && s.status === 'ok').map(s => s.url))`；`okBing` 同理。
   - **只看 `ok`**：与现有去重口径一致，`skipped`（配额 / 已索引 / …）不计入「已提交」。
2. `urls = discovered?.urls ?? []`；`urlSet = Set(urls)`；`total = urls.length`。
3. `items = urls.map(url => ({ url, gsc: okGsc.has(url) ? 'done' : 'pending', bing: okBing.has(url) ? 'done' : 'pending' }))`。
4. 平台计数：`gsc.done = items.filter(i => i.gsc === 'done').length`，`pending = total - done`；`bing` 同理。
5. `stale`：遍历 `submissions`，取 `status === 'ok'` 且 `!urlSet.has(s.url)` 的 `(url, platform)`，按 `platform|url` 去重收集。
6. 返回 `{ total, platforms: [{gsc}, {bing}], items, stale }`。

**边界**：
- `discovered === null` 或 `urls` 为空 → `total = 0`、`items = []`、各平台 `done = 0`；`stale` 仍按 submissions 正常算（此时所有 ok 提交都是 stale）。
- `submissions === []` → 所有 url 双平台 `pending`，`stale = []`。

## useProgressQuery 规格

```ts
// entrypoints/sidepanel/hooks/useProgressQuery.ts
export interface ProgressState {
  loading: boolean;            // refresh 抓取+对账中
  error?: string;              // 抓取失败信息
  report?: ProgressReport;     // 当前进度（load 或 refresh 后填充）
  diff?: DiscoveredSyncDiff;   // 最近一次 refresh 的增删（仅 refresh 填充，load 不填）
  updatedAt?: number;          // report 对应时刻
}

export function useProgressQuery(domain: string): {
  state: ProgressState;
  refresh: (sitemapUrl: string) => Promise<void>;
};
```

**行为**：

- **mount 时 `load()`**：`getDiscovered(domain)` + `getSubmissions(domain)` → `computeProgress` → 填 `report` / `updatedAt`。**不抓取**——切到 tab 立即看到上次进度。`diff` 不填（load 不对账）。
  - `domain` 为空 → 不 load（UI 由 SubmitPanel 保证已选站点）。
- **`refresh(sitemapUrl)`**：
  1. `loading = true`、清 `error`。
  2. `fetched = await fetchSitemapViaBackground(sitemapUrl)`。
     - reject（`SITEMAP_ERROR` / port 断开）→ `error = message`、`loading = false`、**不动 `discovered`**、**保留旧 `report`**（不破坏已查到的进度）。`return`。
  3. `diff = await syncDiscovered(domain, sitemapUrl, fetched.urls)`。
  4. `discovered = await getDiscovered(domain)`、`submissions = await getSubmissions(domain)`。
  5. `report = computeProgress(discovered, submissions)`。
  6. 填 `report` / `diff` / `updatedAt = Date.now()`、`loading = false`。
- **依赖注入**：`refresh` 接受可选 `deps?: { fetchSitemap?: typeof fetchSitemapViaBackground }`（测试注入点，对齐 `useSubmitOrchestrator` 范式）。

## UI 规格

### SubmitPanel 改造

- 新增页面内 tab state：`tab: 'submit' | 'progress'`，默认 `'submit'`。
- `h2` 下方渲染两个切换按钮「提交 / 查询进度」，选中态复用现有按钮 / chip 样式；**不引入新 TabBar 组件**（顶层 `TabBar` 是路由级，不复用）。
- `sitemapUrl` state 已在 SubmitPanel 顶层（带 `dirtyRef` 保护）——两 tab **共享**，无需提升。
- `tab === 'submit'`：渲染现有提交 UI（平台 chip / 按钮 / LogPanel / 报告区）。
- `tab === 'progress'`：渲染 `<ProgressPanel domain={domain} sitemapUrl={sitemapUrl} />`。

### ProgressPanel

- 顶部：当前 `sitemapUrl` 小字（只读，`text-overflow: ellipsis`）+ 〔刷新进度〕按钮。
  - `state.loading` → 按钮禁用 + 文案「抓取中…」。
  - `sitemapUrl` 为空 / `domain` 无效 → 按钮禁用。
- 错误条：`state.error` 存在时显示。
- 对账报告条：`state.diff` 存在时显示 `本次新增 {added} · 清理 {removed} · 未变 {unchanged}`。
- 分平台进度（`state.report` 存在且 `total > 0`）：
  - GSC 行：进度条 + `done/total` + `(百分比%)`。
  - Bing 行：同上。
  - 进度条宽度 = `done / total`；`total === 0` 时不渲染该区。
- 筛选 chips（本地 state `filter: 'all' | 'gsc-pending' | 'bing-pending' | 'stale'`）：
  - `all` → `items`（每行：`url` + `GSC✓/✗` + `Bing✓/✗`）。
  - `gsc-pending` → `items.filter(i => i.gsc === 'pending')`。
  - `bing-pending` → `items.filter(i => i.bing === 'pending')`。
  - `stale` → `state.report.stale`（每行：`url` + `platform`，**标灰**）。
- 明细列表：渲染筛选结果的**前 `visible` 条**（`visible` 初始 100），剩余时显示〔加载更多〕（`visible += 100`）。
- 空态（`state.report` 不存在，**或** `state.report.total === 0`）：统一显示「还没有进度数据，点「刷新进度」抓取最新 sitemap 并对账」+ 刷新按钮。
  - 注：refresh 时若 sitemap 抓到 0 链接会走 `SITEMAP_ERROR`（错误条），**不会**落到 `total === 0` 空态；`total === 0` 仅在本地无 `discovered` 数据（load 时）出现。

## 错误处理

| 场景 | 行为 |
|---|---|
| sitemap 404 / 非 2xx / 超时 / 非 XML | `fetchSitemapViaBackground` reject → 错误条提示；**不动 `discovered`**；保留旧 `report` |
| sitemap 抓取成功但 0 同站链接 | 现有 `fetchSitemapTree` 对 0 链接走 `SITEMAP_ERROR` → 同上（错误条，不对账） |
| `host_permissions` 拦截 fetch | fetch reject → 同 404 路径 |
| `domain` 无效 / `sitemapUrl` 为空 | SubmitPanel 已限制；ProgressPanel 禁用刷新按钮 |
| refresh 中再次点刷新 | 按钮 `disabled`，不会并发 |
| 对账后 `discovered` 为空（极端） | `total = 0` 空态；`stale` 反映全部历史 ok 提交 |
| load 时无任何本地数据 | 空态提示「点刷新」 |

## 测试策略

沿用 vitest + TDD（对齐 `tests/` 现有范式）；`chrome.storage.local` 用 `tests/setup.ts` 的 `chromeMock`。

| 模块 | 用例 |
|---|---|
| `syncDiscovered` | ① 全新增（旧为 null）② 全删除（新为空）③ 部分增删 ④ `fetched` 含重复时保序去重 ⑤ `domain` 隔离（A 域 sync 不影响 B 域）⑥ 返回 diff 三段计数正确 ⑦ 写入后 `urls` 顺序 = `fetched` 顺序 |
| `computeProgress` | ① 双平台 `done/pending` 计数正确 ② `skipped` 不计入 done ③ `stale` 识别（submissions 的 url ∉ discovered）④ `stale` 按 `platform\|url` 去重 ⑤ `discovered === null` → `total=0`、stale 含全部 ok ⑥ `submissions === []` → 全 pending、stale 空 ⑦ 同一 url 双平台都 ok |
| `useProgressQuery` | ① `load` 读本地算 report（不抓取、不填 diff）② `refresh` 成功：抓取→sync→重读→report，diff 填充 ③ `refresh` 抓取失败：设 error、**不动 discovered**、保留旧 report（用 spy 断言 `syncDiscovered` 未被调用）④ `loading` 状态正确翻转 |
| `ProgressPanel` | ① 刷新按钮触发 `refresh` ② loading 时禁用 ③ 分平台进度渲染（mock report）④ 筛选 chips 切换明细 ⑤ 加载更多 ⑥ stale 标灰 ⑦ 空态 |
| `SubmitPanel`（扩） | ① tab 切换渲染对应区 ② `progress` tab 挂载 `ProgressPanel` 并传 `domain` / `sitemapUrl` ③ 两 tab 共享同一 `sitemapUrl`（在 submit 改后切到 progress 顶部小字一致） |

## 范围与非目标（YAGNI）

v1 不做：

- 历史批次回看 UI（`submissions` 仍只用于去重 + 审计 + 本次进度统计）。
- 进度 / 明细 CSV 导出。
- 明细列表虚拟滚动（万级 sitemap 先用「前 100 + 加载更多」兜底，等真有性能问题再上）。
- 自动定时刷新（手动点刷新即可）。
- 「已不在 sitemap」的持久化标记字段（运行时用 `discovered.urls` 反查，single source of truth）。
- URL 规范化（沿用全项目字符串相等）。
- 按 `batchId` 分组的提交历史视图。
- 查询 tab 内独立 sitemap 输入框（复用提交 tab 的输入）。
