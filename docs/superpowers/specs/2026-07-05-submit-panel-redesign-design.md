# 网站提交面板 UI 重设计：状态驱动的「提交中心」

- **日期**：2026-07-05
- **状态**：已确认（待编写实现计划）
- **主题**：submit-panel-redesign
- **关联**：`SubmitPanel` / `ProgressPanel` / `LogPanel` / `useSubmitOrchestrator` / `useProgressQuery`；前置 spec `2026-07-04-sitemap-batch-submit-design.md`、`2026-07-04-query-progress-design.md`

## 背景与目标

「网站提交」面板（`entrypoints/sidepanel/pages/SubmitPanel.tsx`）目前用页面内 tab 切换「提交 / 查询进度」，存在一组体验问题（经代码核查确认）：

1. **未提交就显示两个空的深色日志面板**：`SubmitPanel.tsx:88/94` 用 `(gsc || orch.gsc.logs.length > 0)` 控制渲染，而 GSC / Bing 平台默认勾选（`useState(true)`），导致一进面板就渲染两个「暂无日志」的深色 `LogPanel`，纯占垂直空间。
2. **三套日志 filter 重复**：系统 / GSC / Bing 三个 `LogPanel` 各带一套「全部/info/warn/error」共 12 个按钮，控件嘈杂。
3. **进行中没有「进度感」**：`orch.active`（`'sitemap' | 'gsc' | 'bing' | null`）从未在 UI 上体现，用户只能盯着日志滚，不知道当前在第几步。
4. **报告区是纯文字列表**：成功（灰）/失败（红）视觉区分弱，没有结果导向的清晰反馈。
5. **查询进度 tab 的「刷新进度」全宽按钮顶在最上面**，抢了进度数据的视觉焦点。
6. **明细列表 `· url GSC✓ Bing✗`** 信息密度低、视觉单调。
7. **页面内 tab 复用 `platform-chip` 样式**，与下方平台选择 chip 视觉撞车、语义混淆。
8. 风格上与刚完成紧凑化重设计的关键词工具面板（`2026-07-05-keyword-tools-ui-redesign-design.md`）不一致。

### 目标

**激进重设计**：删除「提交 / 查询进度」tab 划分，改为**状态驱动的单一「提交中心」视图**——把「查询进度」作为默认首页（仪表盘），「一次提交」作为底部常驻动作；提交进行时全屏覆盖主区展示进度感与统一时间流日志；完成后在仪表盘顶部浮现一张常驻报告卡。

**日志改为统一时间流**：系统 / GSC / Bing 三路日志在视图层合并为一个面板，每条带平台色标签，共用一套 filter。

> 复用现有 `useSubmitOrchestrator` / `useProgressQuery` / `lib/submit/*` / `lib/storage/*` / background，**不改提交流程、对账逻辑与存储**；日志合并在视图层完成，不动 hook 接口。

## 已确认的关键决策

经澄清确认，以下为本次改造的定调决策：

1. **信息架构（方案 B）**：空闲态主区 = 进度仪表盘（进度条 + 对账 + 筛选 + 明细）；提交配置压成底部固定条；点提交进入全屏「进行中态」；完成后回仪表盘并在顶部浮现报告卡。
2. **状态机 = 两态 + 报告卡**：`idle`（仪表盘）/ `running`（进行中覆盖主区）；「完成」不是独立态，是 `idle` 顶部的一张常驻卡，至「下次提交」或「× 手动关闭」消失。
3. **日志形态 = 统一时间流**：三路日志在视图层合并排序，每条带平台色标签（SYS / GSC / BING），一套 filter。`idle` 态不显示日志（失败明细在报告卡），`running` 态全屏日志。
4. **状态来源复用现有 hook**：`phase = orch.active !== null ? 'running' : 'idle'`；报告卡可见性 = `!running && orch.report.length > 0`。不新增状态机。
5. **sitemap 输入放顶部**：两动作（刷新对账 / 提交抓取）共享同一 `sitemapUrl` state，不再在每个 tab 重复。
6. **底部固定提交条**：放平台 `PlatformChip` × 2 + 「一次提交」按钮。`PlatformChip` 回归本职（不再被页面内 tab 复用）。
7. **「刷新」与「一次提交」语义保留**：刷新 = 抓 sitemap + `syncDiscovered` 全量对账（查询，仅 `useProgressQuery.refresh`）；提交 = 抓 sitemap + `mergeDiscovered` 增量 + 选候选 + 提交（仅 `useSubmitOrchestrator.run`）。两者共用 `sitemapUrl`，互不混淆。
8. **日志合并在视图层**：新增纯函数 `mergeLogs(sys, gsc, bing)`；不改 `useSubmitOrchestrator` 的 `logs` / `gsc.logs` / `bing.logs` 暴露形式。
9. **进行中禁返回**：`running` 态顶部「‹ 返回」隐藏，只留「取消」（避免提交中途离开）。取消走现有 `orch.cancel`。
10. **明细列表容量不变**：筛选 chips + 默认前 100 条 + 「加载更多」；v1 不上虚拟滚动。

## 架构与数据流

```
SubmitPanel（状态驱动单视图）
├─ phase = orch.active !== null ? 'running' : 'idle'
├─ sitemapUrl state（顶部输入，两动作共享）+ dirtyRef 保护
│
├─ phase === 'idle':
│   ├─ <ProgressDashboard domain sitemapUrl>           ← 仪表盘主体
│   │     └─ useProgressQuery(domain)
│   │          · mount load()：读本地 → computeProgress → 立即显示上次进度
│   │          · refresh(sitemapUrl)：抓 sitemap → syncDiscovered → 重读 → computeProgress
│   ├─ {showReport} && <BatchReportCard report onClose={clearReport}>   ← 完成报告卡(可选)
│   └─ <SubmitBar>  ← 底部固定(绝对/粘性定位)
│         · 平台 PlatformChip × 2 → gsc / bing state
│         · 「一次提交」→ orch.run({gsc,bing}, domain, sitemapUrl) → 进入 running
│
└─ phase === 'running':
    └─ <RunningOverlay orch onCancel={orch.cancel}>   ← 全屏覆盖主区
          · 步骤指示：由 orch.active + gsc.state + bing.state 推算
          · 本批进度条：当前活跃平台的 done/total
          · <UnifiedLogPanel logs={mergeLogs(orch.logs, gsc.logs, bing.logs)}>
          · 完成或取消 → orch.active 归 null → 自动回 idle（报告卡浮现）
```

- **不改 `useSubmitOrchestrator`**：`run` / `cancel` / `clearReport` / `active` / `report` / `logs` / `gsc` / `bing` 接口完全不动。
- **不改 `useProgressQuery`**：`state` / `refresh` 接口不动，由 `ProgressDashboard` 直接消费。
- **不改 background / lib**：sitemap 抓取、GSC/Bing CDP 提交、`syncDiscovered` / `mergeDiscovered` / `computeProgress` 全部沿用。

## 状态机

| phase | 判定 | 主区内容 | 顶部 sitemap | 底部条 | 报告卡 |
|---|---|---|---|---|---|
| `idle` | `orch.active === null` | 进度仪表盘（`ProgressDashboard`） | 显示 | 显示 | `orch.report.length > 0` 时在仪表盘上方显示 |
| `running` | `orch.active !== null` | `RunningOverlay`（全屏覆盖） | 隐藏 | 隐藏 | 不显示（运行中） |

- `running → idle` 自动发生：`orch.run` 的 `finally` 把 `active` 置 `null`（现有逻辑）；React 重渲染 → `phase` 回 `idle`，此时 `orch.report` 已填充 → 报告卡浮现。
- `cancel`：调 `orch.cancel()`；已产生的 `results` 仍会落库（现有行为），`active` 最终归 `null` 回 `idle`。

## 组件结构

```
SubmitPanel.tsx（重构）
├─ 返回按钮 + <h2>网站提交</h2>                      —— running 时隐藏返回
├─ sitemap TextInput（顶部，两动作共享）+ 低价值过滤说明
├─ phase === 'idle':
│   ├─ {showReport} → <BatchReportCard>               —— 新增
│   └─ <ProgressDashboard domain sitemapUrl>           —— 新增（由 ProgressPanel 演化）
│        ├─ 进度卡：分平台进度条 + done/total/% + 〔刷新进度〕+ 对账摘要
│        ├─ 筛选 chips
│        └─ 明细列表（前 100 + 〔加载更多〕）+ 空态
│   └─ <SubmitBar>                                     —— 新增（底部固定）
│        ├─ PlatformChip GSC / Bing
│        └─ 〔一次提交 10 个〕
└─ phase === 'running':
    └─ <RunningOverlay orch onCancel>                  —— 新增（全屏覆盖主区）
         ├─ 顶部：当前步骤 + 本批进度 + 〔取消〕
         ├─ 步骤指示：抓取 → GSC(x/y) → Bing(x/y)
         └─ <UnifiedLogPanel logs={mergeLogs(...)}>    —— 新增（由 LogPanel 演化）
```

## 新增 / 改动文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/submit/logs.ts` | 新增 | `mergeLogs()` 纯函数：三路日志 → 统一时间流（按 `ts` 稳定升序）。 |
| `entrypoints/sidepanel/components/ProgressDashboard.tsx` | 新增（由 `ProgressPanel` 演化） | 仪表盘主体：进度卡 + 筛选 + 明细列表 + 空态。 |
| `entrypoints/sidepanel/components/RunningOverlay.tsx` | 新增 | 进行中态：步骤指示 + 本批进度条 + `UnifiedLogPanel` + 取消。 |
| `entrypoints/sidepanel/components/BatchReportCard.tsx` | 新增 | 完成报告卡：汇总条 + 失败明细 + 关闭按钮。 |
| `entrypoints/sidepanel/components/SubmitBar.tsx` | 新增 | 底部固定提交条：平台 chip + 提交按钮。 |
| `entrypoints/sidepanel/components/UnifiedLogPanel.tsx` | 新增（由 `LogPanel` 演化） | 接收 `UnifiedLogEntry[]` + 平台色标签，一套 filter，自动滚底。 |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 重构 | 状态机编排；挂载上述组件；`sitemapUrl` / `gsc` / `bing` state。 |
| `entrypoints/sidepanel/components/ProgressPanel.tsx` | 删除 | 功能迁入 `ProgressDashboard`。 |
| `entrypoints/sidepanel/components/LogPanel.tsx` | 保留 | 不再被 SubmitPanel 引用；如无其他引用，实现阶段核查后可删（保守先保留）。 |
| `hooks/useSubmitOrchestrator.ts` / `useProgressQuery.ts` | 不动 | 日志合并在视图层。 |
| `lib/storage/*` / `lib/submit/{progress,filter,pick,reasons}.ts` / `lib/sitemap/*` / background | 不动 | —— |
| `tests/submitpanel.test.tsx` | 重写 | 覆盖新状态机与新组件挂载。 |
| `tests/progresspanel.test.tsx` | 重写（或更名 `progressdashboard.test.tsx`） | 覆盖 `ProgressDashboard`。 |
| `tests/merge-logs.test.ts` | 新增 | `mergeLogs` 纯函数用例。 |

## 布局规格

### `idle` 态

```
┌────────────────────────────────────┐
│ ‹ 返回          网站提交            │
├────────────────────────────────────┤
│ sitemap [https://x.com/sitemap.xml] │ ← 顶部紧凑输入(两动作共享)
│ 自动过滤登录/注册/隐私/条款/账号等   │
├────────────────────────────────────┤
│ ▌本批报告  10·成8·败1·跳1       [×] │ ← 完成报告卡(可选,仅完成后)
│ ✗ /p/2  GSC: 配额已满               │
├────────────────────────────────────┤
│ 提交进度                    [⟳ 刷新]│ ← 进度卡(对账语义)
│ GSC  ████████░░░░  80/100  80%     │
│ Bing██████░░░░░░░░  40/100  40%    │
│ 本次对账 +3 新增 · -1 清理 · 2h前   │
│ ──────────────────────────────      │
│ 筛选 [全部][GSC缺][Bing缺][失效 3] │
│ · /p/1   GSC✓  Bing✗               │
│ · /p/3   GSC✗  Bing✗   (待提交)    │
│ …                                   │
│ [加载更多 · 剩余 97]                │
├────────────────────────────────────┤
│ [GSC ✓] [Bing ✓]   [一次提交 10 个]│ ← 底部固定提交条
└────────────────────────────────────┘
```

### `running` 态（覆盖主区，顶部 sitemap 与底部条隐藏）

```
┌────────────────────────────────────┐
│      提交中 GSC 7/10        [取消]  │ ← 无返回按钮
├────────────────────────────────────┤
│ ███████░░░  7 / 10                 │
│ 抓取 ✓  →  GSC › (7/10)  →  Bing   │ ← 步骤指示
│ ──────────────────────────────      │
│ [全部][info][warn][error]          │ ← 统一一套 filter
│ 09:01  SYS   抓取 sitemap… 142 条  │
│ 09:01  GSC   ✓ /p/1 已提交          │ ← 平台色标签
│ 09:02  GSC   ⚠ /p/2 配额已满        │
│ 09:02  BING  待开始                 │
└────────────────────────────────────┘
```

## 统一日志流规格

### `mergeLogs`（纯函数）

```ts
// lib/submit/logs.ts
export type LogPlatform = 'sys' | 'gsc' | 'bing';

export interface UnifiedLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
  platform: LogPlatform;
}

interface SrcLog { level: 'info' | 'warn' | 'error'; phase: string; message: string; ts: number; }

/** 三路日志按 ts 稳定升序合并；同 ts 保持 sys → gsc → bing 的输入相对顺序。 */
export function mergeLogs(sys: SrcLog[], gsc: SrcLog[], bing: SrcLog[]): UnifiedLogEntry[];
```

**算法**：三路归并，比较 `ts`；`ts` 相等时按 `sys → gsc → bing` 优先级稳定输出（不引入 `Math.random` / `Date.now`，纯函数）。给每条打 `platform` 标签。

**边界**：任一路为空数组正常工作；全空 → 返回 `[]`。

### `UnifiedLogPanel`

- props：`{ logs: UnifiedLogEntry[] }`。
- 复用现有 `LogPanel` 的视觉（深色底、等宽字体、`maxHeight: 260`、自动滚底、warn/error 可点击展开详情）。
- 顶部 filter 一套：`全部 / info / warn / error`（不再三套）。
- 每行前缀：`HH:MM:SS  <PLATFORM>  message`；`PLATFORM` 用色标区分（SYS 灰、GSC 蓝、Bing 青——具体色用 `tokens.css` 既有变量，不引新色）。
- filter 切换时清空展开状态（沿用现 `LogPanel` 行为）。

## 各组件规格

### `SubmitPanel`（重构）

- 顶层 state：`sitemapUrl`（带 `dirtyRef` 保护，沿用现状）、`gsc` / `bing`（默认 `true`）、`error`。
- `phase = orch.active !== null ? 'running' : 'idle'`。
- `showReport = phase === 'idle' && orch.report.length > 0`。
- `busy = orch.gsc.state.running || orch.bing.state.running || orch.active !== null`（等价于 `phase === 'running'`，但保留各 runner 判据以兼容语义）。
- `ready = (gsc || bing) && !busy && isValidDomain(site.domain) && !!sitemapUrl.trim()`。
- `submit()`：校验 → `orch.run({ gsc, bing }, domain, sitemapUrl)`。
- 顶部「‹ 返回」：`phase === 'running'` 时隐藏；否则显示。
- 渲染分支：
  - `phase === 'idle'`：`<BatchReportCard>`（若 `showReport`）+ `<ProgressDashboard>` + 底部 `<SubmitBar>`。
  - `phase === 'running'`：`<RunningOverlay orch={orch} onCancel={orch.cancel} />`。
- 报告卡 `onClose = orch.clearReport`（已有方法）。

### `ProgressDashboard`（由 `ProgressPanel` 演化）

- props：`{ domain: string; sitemapUrl: string }`。
- 内部：`useProgressQuery(domain)` + 本地 `filter` / `visible` state（沿用 `ProgressPanel` 现有逻辑）。
- 与现 `ProgressPanel` 的差异：
  - 移除顶部全宽「刷新进度」按钮 → 改为进度卡右上角的小「⟳ 刷新」按钮（`Button` `variant="secondary"` 紧凑款），不再抢主视觉。
  - 进度卡新增「对账摘要」行：`state.diff` 存在时显示 `本次新增 X · 清理 Y · 未变 Z`；附 `updatedAt` 相对时间（如「2h前」，由组件用 `Date.now() - updatedAt` 计算，渲染时格式化）。
  - 其余（分平台进度条、筛选 chips、明细前 100 + 加载更多、stale 标灰、空态）沿用 `ProgressPanel` 现有行为。

### `RunningOverlay`

- props：`{ orch: ReturnType<typeof useSubmitOrchestrator>; onCancel: () => void }`。
- 顶部行：`提交中 {activeLabel} {done}/{total` + 〔取消〕。
  - `activeLabel`：`orch.active === 'sitemap'` → `抓取 sitemap`；`'gsc'` → `GSC`；`'bing'` → `Bing`。
  - `done/total` 取当前活跃平台的 `orch.{active}.state.done/total`；`active === 'sitemap'` 时显示「抓取中…」。
- 本批进度条：宽度 = 当前活跃平台 `done/total`（`total === 0` 时满条「等待开始」占位）。
- 步骤指示：三段 `抓取 → GSC → Bing`（仅展示勾选平台）：
  - `抓取`：`orch.active === 'sitemap'` 时 `›`（进行）；其后阶段 `✓`（完成）。
  - `GSC`：`active === 'gsc'` → `› (done/total)`；`active === 'bing'` → `✓`；未勾选则不渲染。
  - `Bing`：`active === 'bing'` → `› (done/total)`；未勾选则不渲染。
- 统一日志流：`<UnifiedLogPanel logs={mergeLogs(orch.logs, orch.gsc.logs, orch.bing.logs)} />`，占满剩余高度。
- 取消按钮：调 `onCancel`；提交中 `disabled={false}`（始终可取消）。

### `BatchReportCard`

- props：`{ report: ReportItem[]; onClose: () => void }`。
- 用 `classifyResult`（`lib/submit/reasons`）分类为 `ok / failed / skipped`。
- 汇总条：`本批 {N} · 成功 {X} · 失败 {Y} · 跳过 {Z}` + 右侧 `×` 关闭按钮（`onClose`）。
- 失败明细（`failures.length > 0` 时）：每行 `✗ {url}（{platform}{：reason}）`，红色，`text-overflow: ellipsis`。
- 跳过：仅计数，不列详情（沿用现有口径）。
- 成功：仅计数（不再列成功 URL 清单，减少视觉噪声——失败才是用户关心的）。

### `SubmitBar`

- props：`{ gsc; bing; onToggleGsc; onToggleBing; onSubmit; busy; ready }`。
- 布局：左侧 `PlatformChip GSC` + `PlatformChip Bing`；右侧（`flex: 1`）`Button`「一次提交 10 个」。
- `Button` `disabled={!ready}`；`busy` 时文案 `提交中…`，并追加「取消」次按钮（`variant="secondary"`）。
- 样式：底部固定（`position: sticky; bottom: 0`，背景 `var(--color-surface)` + 上边框分隔），保证主区滚动时始终可见。

## 错误处理

| 场景 | 行为 |
|---|---|
| `isValidDomain` 失败 / `sitemapUrl` 空 | `SubmitBar` 提交按钮禁用；`error` 文案在顶部输入下方显示（沿用现状） |
| sitemap 抓取失败（提交中） | `orch.logs` 推 error → `UnifiedLogPanel` 红色显示；不进入 GSC/Bing 阶段；`active` 归 `null` 回 `idle` |
| sitemap 抓取失败（查询刷新） | `useProgressQuery` 设 `state.error` → `ProgressDashboard` 错误条显示；不动 `discovered`；保留旧 `report` |
| 候选池空（全部已提交） | `orch.logs` 推 info「无可提交链接，全部已提交」；`active` 归 `null` 回 `idle`；不显示报告卡（`report` 为空） |
| 某平台 runner 抛错 | 现有 `try/catch` 吞错不中断另一平台；该平台日志承载错误信号 |
| refresh 中再次点刷新 | 进度卡「刷新」按钮 `disabled={state.loading}`，不并发 |
| 进行中点返回 | `running` 态无返回按钮；只有「取消」 |
| 进行中再次点提交 | `SubmitBar` 在 `running` 态不渲染（主区被 `RunningOverlay` 覆盖），不会并发 |

## 测试策略

沿用 vitest + TDD（对齐 `tests/` 现有范式）；`chrome.storage.local` 用 `tests/setup.ts` 的 mock。

| 模块 | 用例 |
|---|---|
| `mergeLogs`（新） | ① 三路均非空按 `ts` 升序 ② 同 `ts` 稳定顺序 sys→gsc→bing ③ 任一路为空正常 ④ 全空 → `[]` ⑤ 每条带正确 `platform` 标签 |
| `ProgressDashboard` | ① 刷新按钮触发 `refresh` ② loading 时禁用 ③ 分平台进度渲染 ④ 筛选 chips 切换明细 ⑤ 加载更多 ⑥ stale 标灰 ⑦ 空态 ⑧ 对账摘要渲染（`diff` 存在时） |
| `RunningOverlay` | ① `active='sitemap'/'gsc'/'bing'` 各步骤指示正确 ② 取消按钮触发 `onCancel` ③ `UnifiedLogPanel` 收到 `mergeLogs` 结果 ④ 未勾选平台步骤不渲染 |
| `BatchReportCard` | ① 汇总条计数（成功/失败/跳过）② 失败明细带 `reason` ③ `×` 触发 `onClose` ④ 跳过不列详情 ⑤ 成功仅计数 |
| `SubmitBar` | ① 平台 chip toggle ② `ready=false` 时提交禁用 ③ `busy` 文案「提交中…」+ 取消按钮 ④ 提交点击触发 `onSubmit` |
| `SubmitPanel`（重写） | ① `idle` 渲染 `ProgressDashboard` + `SubmitBar` ② `running` 渲染 `RunningOverlay` 且隐藏 sitemap/底部条/返回 ③ 完成后 `showReport` 渲染报告卡 ④ 报告卡 `onClose` 调 `clearReport` ⑤ 两态共享 `sitemapUrl` ⑥ `running` 时顶部无返回按钮 |
| `UnifiedLogPanel` | ① filter 切换 ② warn/error 可展开 ③ 平台标签渲染 ④ 自动滚底 |

> 现有 `tests/progresspanel.test.tsx` 改名/重写为 `progressdashboard.test.tsx`；`tests/submitpanel.test.tsx` 按新状态机重写。`tests/useSubmitOrchestrator.test.tsx` / `tests/useProgressQuery.test.tsx` / `tests/progress.test.ts` **不动**（hook 与纯函数未改）。

## 范围与非目标（YAGNI）

v1 不做：

- 改 `useSubmitOrchestrator` / `useProgressQuery` / `lib/*` / background 的逻辑（日志合并在视图层）。
- 引入 CSS-in-JS / Tailwind / 新依赖（延续 inline-style + `tokens.css`）。
- 明细列表虚拟滚动（前 100 + 加载更多兜底）。
- 历史批次回看 / CSV 导出 / 自动定时刷新。
- 成功 URL 清单展示（报告卡只列失败，成功仅计数）。
- 改顶部路由级 `TabBar`、`tokens.css`、`Select` / `Button` / `TextInput` 默认样式。
- URL 规范化（沿用全项目字符串相等）。
- 新增 sitemap 输入历史 / 多 sitemap 入口。
