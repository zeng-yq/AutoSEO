# AutoSEO —— SEO 快捷工具集合插件设计

- **状态**：已确认，待生成实现计划
- **日期**：2026-06-27
- **基线**：现有 WXT + React 19 + TypeScript 模板（仅含计数器 demo，单次 first commit）
- **UI 规范**：项目根 `DESIGN.md`（Claude.com 暖奶油 + 珊瑚 + 衬线编辑型风格）

## 1. 目标

把现有空模板改造成一个**集合多个 SEO 快捷工具**的浏览器扩展，以**侧边栏面板（side panel）**形式承载。首发两个工具：

1. **GSC 批量提交**：选定一个网站项目，粘贴一批页面 URL，扩展用 CDP（`chrome.debugger`）模拟人工操作，逐条在 Google Search Console 完成「URL 检查 → 请求编入索引」，大幅提升批量提交效率。
2. **Ahrefs KD 查询**：通过国家下拉 + 关键词输入，一键在新标签页打开 Ahrefs 关键词难度查询页。

## 2. 决策记录

| # | 决策点 | 结论 |
|---|---|---|
| D1 | GSC 执行引擎 | `chrome.debugger` API（真·CDP）。接受其固有的"⚠️ 正在被调试"横幅与 `debugger` 权限。参考 `web-access` skill 的 CDP 用法 |
| D2 | 项目（域名）列表来源 | 手动维护：做一个项目管理页，增删改域名，存 `chrome.storage.local` |
| D3 | 单条失败处理 | 跳过并记入日志，继续下一条；检测到"配额已满"等全局性失败则熔断整批 |
| D4 | Ahrefs 国家选项 | 预置常用国家列表 + 允许自定义两位代码 |
| D5 | 编排引擎位置 | 放 background（service worker），任务在后台跑，侧边栏关闭不中断；侧边栏用 port 长连接订阅状态 |
| D6 | CDP 执行方式 | 纯 `chrome.debugger`（`Runtime.evaluate` 查 DOM/读状态 + `Input.*` 输入/点击/回车），不引入 content script |
| D7 | 标签页策略 | 复用单个后台标签页跑完整批，不每条新开 |
| D8 | 侧边栏导航 | 首页工具卡片网格，点击进入子页（带返回），贴合 `DESIGN.md` 的 `feature-card` 美学 |

## 3. 参考资源（已研读）

- **`web-access` skill**（`~/.agents/skills/web-access`，符号链于 `~/.claude/skills/web-access`）：Node 脚本经 WebSocket 连 Chrome 的 CDP 通道，与本扩展的 `chrome.debugger` 通道不同，但 **CDP 命令/域完全一致**，用法可直接搬用。已提炼关键原语：
  - `waitForLoad`：`Page.enable` + 轮询 `Runtime.evaluate('document.readyState')` 等到 `complete`（带超时）
  - `eval`：`Runtime.evaluate` + `returnByValue` + `awaitPromise`
  - **真实鼠标点击 `clickAt`**：先 `eval` 取元素中心坐标 → `Input.dispatchMouseEvent` 按下+释放，算真实用户手势、能绕反自动化
  - 反风控技巧：拦截页面对调试端口的探测（`Fetch.enable`）
- **`submit-agent` 插件**（`~/Documents/CODE/浏览器插件/submit-agent`）：**名不副实**——它是「AI 自动填表」扩展（content script + DOM + LLM），**无 `debugger` 权限、零 GSC 代码**，不提供 CDP 参考。但其工程模式可直接复用：WXT+React+sidePanel 脚手架（`wxt.config.ts` 的 manifest 写法、`sidePanel.setPanelBehavior`）、background 消息路由协议、结构化日志协议、健壮的 `waitForTabLoad`、测试栈（vitest + jsdom + fake-indexeddb）。

## 4. 模块结构

```
entrypoints/
  sidepanel/
    main.tsx · App.tsx              # 路由：首页 / GSC / Ahrefs / 项目管理
    pages/  Home · GscTool · AhrefsTool · Projects
    components/                     # Button / TextInput / Select / Textarea / Card / LogPanel / Badge（套 DESIGN.md 令牌）
    hooks/useGscRunner.ts           # 建立 port、订阅 GSC_STATE/GSC_LOG/GSC_DONE
  background.ts                     # 编排引擎入口：消息路由 + sidePanel 行为 + GSC 批量流程驱动
lib/
  cdp/
    client.ts                       # chrome.debugger 封装：attach / detach / sendCommand（target={tabId}, '1.3'）
    actions.ts                      # 高层原语：waitForLoad / eval / click / clickReal / typeText / pressEnter / waitForSelector
  gsc/
    selectors.ts                    # GSC 页面探测表达式常量（文本优先；⚠️ 首版需 CDP 探测校准）
    flow.ts                         # 单条 URL 步骤机 + 批量循环 + 配额熔断
    url.ts                          # GSC URL 拼接
  ahrefs/
    url.ts                          # Ahrefs URL 拼接 + 预置国家列表常量
  storage/
    projects.ts                     # 项目 CRUD（chrome.storage.local，key 'projects'）
    settings.ts                     # 设置（账号索引等，key 'settings'）
  messaging/
    types.ts · protocol.ts          # 消息类型 + port 长连接封装
```

## 5. 职责划分（运行态只在 background）

| 层 | 职责 | 不做什么 |
|---|---|---|
| **sidepanel** | UI、收集输入、订阅进度/日志 | 不持有任务运行态（关闭不影响任务） |
| **background (SW)** | 持有运行态（批次、游标、运行标志）、驱动 CDP、推送事件 | 不渲染 UI |
| **lib/cdp** | 纯 `chrome.debugger` 封装，无业务 | 不知道 GSC |
| **lib/gsc** | GSC 业务流程（选择器 + 步骤机） | 不管 CDP 细节，只调 cdp 原语 |

**service worker 休眠对策**：MV3 的 SW 会闲置休眠，但每条 CDP 命令（`Runtime.evaluate`）都重置存活计时器。等待类原语用「轮询 eval」而非纯 `setTimeout`，使 SW 在批量循环中保持活跃；运行游标额外写入 `chrome.storage.session` 作为兜底。

## 6. 通信协议

GSC 是长任务 → **port 长连接**（`chrome.runtime.connect({ name: 'gsc-runner' })`）；Ahrefs / 项目管理是瞬时操作 → 普通 `chrome.runtime.sendMessage`。

```
sidepanel → background:
  GSC_START  { projectId, urls: string[] }
  GSC_CANCEL

background → sidepanel (port.postMessage):
  GSC_STATE  { state: 'running'|'done'|'canceled', total, done, currentUrl, results: [{url, status: 'ok'|'skipped', reason}] }
  GSC_LOG    { level: 'info'|'warn'|'error', phase: 'attach'|'input'|'inspect'|'submit'|'reset'|'system', message, ts }
  GSC_DONE   { ok, failed, skipped }

普通消息（瞬时，sendMessage）:
  PROJECTS_CHANGED     广播：项目列表变更，GSC 页下拉框刷新
  （Ahrefs 工具无需消息：sidepanel 直接调 chrome.tabs.create 打开新标签）
```

## 7. 工具一：GSC 批量提交

### 7.1 URL 拼接（`lib/gsc/url.ts`）
```
https://search.google.com/u/{accountIndex}/search-console?resource_id=sc-domain:{domain}
  accountIndex 默认 0（设置可改 u/0/u/1…，应对多 Google 账号）
  domain 取自所选项目根域名（如 bottleneck-checker.com）
```

### 7.2 单条 URL 步骤机（`lib/gsc/flow.ts`）
```
① 输入   focus(检查框) → insertText(url) → dispatchKeyEvent(Enter)
② 等检查 轮询 eval（≤30s）：等 loading 消失 + 结果区出现
         超时 → skipped(检查超时)，进入下一条
③ 判定   eval 读结果区文本/按钮，分支：
         · 有"请求编入索引"按钮且可点     → 进入 ④
         · "网址已位于 Google 上"          → skipped(已索引)
         · "不属于此资源"/域名不匹配       → skipped(不属于此域名)
         · 配额类提示                      → skipped(配额) + 配额计数+1
④ 提交   clickReal(请求编入索引) → 等弹窗 → 点弹窗内确认 → 等成功提示
         读到成功标志 → ok；否则 skipped(提交未确认)
⑤ 重置   清空检查框，回到可输入态，推 GSC_STATE/GSC_LOG
```

### 7.3 选择器策略 = 文本优先 + 结构兜底（关键健壮性设计）
Google 的 class 名是动态哈希，CSS 选择器极易失效；按钮**文本**相对稳定。探测全部以文本匹配为主：
```js
// 例：定位"请求编入索引"按钮（比 querySelector('.xxx-yyy') 健壮）
Runtime.evaluate(`
  [...document.querySelectorAll('button,[role=button]')]
    .find(b => /请求编入索引|Request indexing/.test(b.textContent) && !b.disabled)
`)
```
`lib/gsc/selectors.ts` 集中存放所有探测表达式（含中英文 fallback），一处维护。**这些表达式是首版实现必须先用 CDP 在真实 GSC 页校准的点**（见第 12 节）。

### 7.4 配额熔断
连续 3 条命中"配额"类信号 → 终止批次，剩余标记 `skipped`，避免空跑。

## 8. 工具二：Ahrefs KD 查询（纯前端，无 background）

| 项 | 说明 |
|---|---|
| 国家下拉 | 预置常用列表（US/GB/AU/CA/IN/DE/FR/JP…显示国名）+「自定义」输入两位代码 |
| 关键词输入 | 单行文本框 |
| 「打开查询」按钮 | `chrome.tabs.create({ url })` 新标签打开 |
| URL | `https://ahrefs.com/keyword-difficulty/?country={cc小写}&input={encodeURIComponent(kw)}` |
| 记忆 | 上次 country/input 存 `chrome.storage.local`，下次回填 |

## 9. 项目管理与存储

**数据结构**（`chrome.storage.local`）：
```ts
interface Project { id: string; domain: string; label?: string; createdAt: number }  // key 'projects': Project[]
interface Settings { accountIndex: number }                                            // key 'settings'，默认 { accountIndex: 0 }
```

**项目管理页**：域名列表（每条带删除）+ 新增表单（输入域名 → 正则校验合法域名 → 保存）+ 内联编辑。`lib/storage/projects.ts` 提供 `get/add/update/remove`，变更后广播 `PROJECTS_CHANGED`。

## 10. UI 落地（DESIGN.md 令牌映射）

| UI 元素 | DESIGN.md 令牌 |
|---|---|
| 面板底色 | `canvas` #faf9f5 |
| 工具卡片（首页） | `feature-card`：`surface-card` #efe9de、`rounded.lg` 12px、padding 24px |
| 页面标题 | 衬线 `display-sm`/窄面板降级 `title-lg`，负字距 |
| 主按钮（开始/打开） | `button-primary`：`primary` 珊瑚 #cc785c、`on-primary` 白、`rounded.md` 8px、h40 |
| 次按钮（取消/返回） | `button-secondary`：`canvas` + `hairline` 边 |
| 输入/下拉/textarea | `text-input`：`canvas` 底 + `hairline` 边、`rounded.md`、h40；聚焦态 `primary` 描边 |
| 返回/链接 | `text-link`：`primary` 珊瑚 |
| 进度徽章「3/10」 | `badge-pill`：`surface-card` |
| 日志/进度面板 | `code-window-card` 风格：`surface-dark` #181715、`on-dark`、`JetBrains Mono` |
| 结果标记 | `success` #5db872 / `error` #c64545 / `warning` #d4a017 |
| 品牌 | 顶部 `✲ AutoSEO`（spike-mark + wordmark） |

**字体打包**：`Inter` + `JetBrains Mono` 经 `@fontsource` 本地打包（MV3 extension 页 `font-src` 默认仅 `'self'`，远程字体会被 CSP 拦）；衬线标题用开源 `EB Garamond` 或 `Cormorant Garamond`（`@fontsource` 打包）近似 DESIGN.md 的 Copernicus/Tiempos（授权字体，不可用）。不依赖系统默认无衬线，保留编辑型衬线气质。

## 11. manifest 权限（最小化）
```ts
manifest: {
  permissions: ['debugger', 'tabs', 'sidePanel', 'storage'],
  host_permissions: ['https://search.google.com/*', 'https://ahrefs.com/*'],
  side_panel: { default_path: 'sidepanel/index.html' },
  action: { default_title: 'AutoSEO' },
}
// background: chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
```
不申请 `<all_urls>`；不需要 `scripting`（用 CDP，不注入 content script）。

## 12. 实现策略：CDP 探测先行

在写 `flow.ts`/`selectors.ts` 之前，先用 **web-access skill 的 CDP** 在真实 GSC 页交互式探出可行路径，再固化：

- **测试资源**：项目 `bottleneck-checker.com`（`sc-domain`）、测试 URL `https://bottleneck-checker.com/es/`
- **探测点**：检查框定位与清空、回车后 loading→结果区等待条件、"请求编入索引"按钮的文本探测、点击后弹窗内确认按钮、成功提示文本
- **产出**：每个步骤的稳定探测表达式 → 固化进 `selectors.ts`，作为 `flow.ts` 步骤机依据
- **前提**：浏览器已登录对应 Google 账号且在 GSC 拥有 `bottleneck-checker.com` 资源权限；web-access proxy 已启动

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| GSC 选择器随 Google UI 变更失效 | 文本优先探测 + `selectors.ts` 集中维护 + CDP 探测先行校准 |
| `chrome.debugger` 调试横幅 | 已确认接受（D1）；用真实手势 `clickReal` 降低被风控 |
| 未登录 / 无该资源权限 | 流程开始前 `eval` 检测登录态，未登录则提示并停 |
| service worker 休眠 | 轮询式 `eval` 保持活跃 + `storage.session` 存游标兜底 |
| 配额限制 | 连续 3 条配额信号 → 熔断 |
| reCAPTCHA / 人工验证 | 检测到则该条 `skipped(需人工)`，不阻塞批次 |
| MV3 远程字体 CSP | 字体本地打包（`@fontsource`） |

## 14. 测试策略

- **单元**（沿用 submit-agent 的 vitest + jsdom + fake-indexeddb）：URL 拼接、`storage` CRUD、选择器探测函数（测试生成的 JS 探测表达式）、CDP 原语（mock `chrome.debugger`）。
- **CDP 探测先行**（手动/探索，第 12 节）→ **端到端**：扩展内对真实项目跑 2–3 条 URL 验证全流程。

## 15. 范围外（YAGNI）

- 不处理 Google 登录 / OAuth（依赖浏览器已登录）
- 不抓取/解析 Ahrefs 结果（仅打开查询页）
- 不做多账号自动切换（仅 `u/0..u/n` URL 索引可在设置改）
- 不做定时 / 计划提交
- 不做提交历史持久化报告（仅会话内日志）
- 不保留 popup 入口（统一用 sidepanel）
- 不引入 content script（纯 CDP）
