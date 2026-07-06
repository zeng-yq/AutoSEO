# GSC 提交链路：CDP → Indexing API 迁移设计

> 日期：2026-07-06
> 状态：设计待审阅
> 先例：`docs/superpowers/specs/2026-07-06-indexnow-api-migration-design.md`（Bing 的 CDP→IndexNow 迁移，本设计的直接模板）

## 1. 背景与目标

QuickSEO 的「网址提交」功能包含两个并列平台：GSC 与 Bing。Bing 已于 2026-07-06 从 CDP 迁移到 IndexNow API（`lib/indexnow/submit.ts`，一个 `fetch` POST）。GSC 目前仍是完整 CDP 链路：开后台 tab → `chrome.debugger.attach` → 逐条 `Runtime.evaluate` 操控 Search Console SPA DOM（8 步）→ 等「请求编入索引」成功 toast（单条最长 180s）→ detach。

**目标**：把 GSC 也迁移到 Google Indexing API，与 Bing/IndexNow 模式对称——一次 OAuth2 鉴权的 HTTP 调用，秒级完成，无需登录态、无需 `debugger` 权限、无 DOM 依赖。

**成功标准**：
- GSC 提交走 `https://indexing.googleapis.com/v3/urlNotifications:publish`，服务账号 JSON 密钥鉴权。
- 提交面板新增 GSC 服务账号密钥配置区（textarea 粘贴整段 JSON + 测试连接）。
- 删除 `lib/cdp/*`、`lib/gsc/{flow,selectors,url}.ts` 及对应测试，移除 `debugger` 权限。
- `useGscRunner` / `useSubmitOrchestrator` / `SubmitBar` / 消息协议**零改动**，UI 侧接口不变。
- 现有 IndexNow/Bing 提交、sitemap、报告、落库逻辑不受影响。

## 2. 关键约束（必须知情）

Google 官方在「使用 API」「快速入门」「配额」三页反复声明：

> 「Indexing API **只能用于**抓取包含 `JobPosting` 或 `BroadcastEvent`（嵌套于 `VideoObject`）的网页。」

**普通网页（博客/文章/产品页）不在官方支持范围**。调用仍返回 HTTP 200（请求被接受），但 Google 不保证抓取，且官方将「超出类型/配额使用」视为可能撤销权限的滥用行为。Google 未提供普通网页「请求编入索引」的官方 API（URL Inspection API 只读）。

**用户已知情并选择仍迁移**：摆脱 CDP 的脆弱/慢/登录态依赖，与 Bing 模式对称，接受对普通网页「提交成功但不保证抓取」的现实。本设计如实呈现此约束，不在 UI 上误导用户「已编入索引」。

## 3. 架构对比

```
【当前 · CDP】
UI(GSC_START) → background: tabs.create → debugger.attach
  → 等 SPA（href + 输入框，30s）→ 登录/权限前置检查
  → runBatch（逐条 evalJs 操控 DOM 8 步，单条等 toast 最长 180s）→ detach → GSC_DONE
  ↑ ~610 行，10 条耗时 2-5 分钟，脆弱、需登录态、要 debugger 权限

【目标 · API】
UI(GSC_START) → background: 读 settings.gscCredentials → parseServiceAccount
  → getAccessToken（命中缓存或 JWT 换 token）→ 逐条 POST urlNotifications:publish
  → 按状态码映射 SubmitResult（ok / skipped+reason）→ GSC_STATE/GSC_LOG/GSC_DONE
  ↑ 与 handleBingStart 对称，10 条 3-5 秒，无登录态、无 DOM 依赖
```

## 4. 文件改动清单

### 新增
| 文件 | 职责 |
|---|---|
| `lib/gsc/auth.ts` | 服务账号 JSON 解析、JWT 签名（Web Crypto）、access_token 缓存换取 |
| `lib/gsc/submit.ts` | `publishUrl(token, url)` 单条提交、`getMetadata(token, url)` 探活、`reasonFor(status)` |
| `entrypoints/sidepanel/hooks/useGscCredentials.ts` | 凭证状态管理（对应 `useIndexNowKey`） |
| `entrypoints/sidepanel/components/GscCredentialsSection.tsx` | 凭证配置区（对应 `IndexNowKeySection`，含 textarea + 测试连接） |
| `tests/gsc-auth.test.ts` | JWT 构造、`parseServiceAccount` 容错、token 缓存命中/过期 |
| `tests/gsc-submit.test.ts` | `publishUrl` 状态码分类、`reasonFor`、`getMetadata` |
| `tests/useGscCredentials.test.tsx` | hook：读写、跨视图同步、测试连接 |
| `tests/gsc-credentials-section.test.tsx` | 组件：textarea、按钮、测试结果反馈 |

### 修改
| 文件 | 改动 |
|---|---|
| `lib/storage/settings.ts` | `Settings` 加 `gscCredentials?: string`（整段 JSON 文本）、`gscToken?: { accessToken: string; expiresAt: number }`（缓存）；删 `accountIndex`（确认无其他引用后）；新增 `parseServiceAccount` 与格式校验 |
| `entrypoints/background.ts` | 重写 `handleStart`：删 CDP 编排（attach/detach/evalJs/runBatch/buildGscUrl/PROBES），换成「读 credentials → parse → getAccessToken → 逐条 publishUrl → 映射结果」；清理对应 import；**`GSC_*` 消息协议字段不变** |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 在 `<IndexNowKeySection />` 旁插入 `<GscCredentialsSection />` |
| `wxt.config.ts` | 移除 `permissions: ['debugger']`、`host_permissions` 中的 `https://search.google.com/*`（`<all_urls>` 已覆盖 `googleapis.com`，无需新增） |

### 删除
- `lib/gsc/flow.ts`、`lib/gsc/selectors.ts`、`lib/gsc/url.ts`（CDP 操控）
- `lib/cdp/client.ts`、`lib/cdp/actions.ts`（GSC 是唯一现存用户，Bing 已迁走）
- `tests/gsc-flow.test.ts`、`tests/gsc-url.test.ts`、`tests/cdp.test.ts`、`tests/cdp-actions.test.ts`

### 不动
- `lib/messaging/types.ts`、`lib/messaging/protocol.ts`（`GscStart`/`GscCancel`/`GscState`/`GscLog`/`GscDone`/`SubmitResult`/`SubmitStatus` 完全复用）
- `entrypoints/sidepanel/hooks/useGscRunner.ts`、`useSubmitOrchestrator.ts`
- `entrypoints/sidepanel/components/SubmitBar.tsx`、`RunningOverlay.tsx`、`BatchReportCard.tsx`、`ProgressDashboard.tsx`、`icons.tsx`
- `lib/storage/submissions.ts`（落库去重）
- `lib/submit/reasons.ts`（`SKIP_REASONS` 保留「已索引」无害；GSC 失败 reason 不列入，归 failed）
- `lib/indexnow/*`、Bing 全链路、sitemap、quicksearch

## 5. 核心模块设计

### 5.1 `lib/gsc/auth.ts`（最关键，~100 行，零依赖）

```ts
export interface ServiceAccount {
  clientEmail: string;
  privateKeyPem: string;   // PKCS#8 PEM 文本
  tokenUri: string;        // 通常 https://oauth2.googleapis.com/token
}

const SCOPE = 'https://www.googleapis.com/auth/indexing';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** 解析并校验服务账号 JSON 文本。失败抛错（供 UI 测试连接/保存时反馈）。 */
export function parseServiceAccount(jsonText: string): ServiceAccount { ... }

/** 取 access_token：命中缓存（settings.gscToken 未过期）则直接返回，否则签 JWT 换新并缓存。 */
export async function getAccessToken(creds: ServiceAccount): Promise<string> { ... }
```

**JWT 签名流程（Web Crypto，MV3 service worker 可用）**：
1. `header = base64url({ alg: 'RS256', typ: 'JWT' })`
2. `payload = base64url({ iss: clientEmail, scope: SCOPE, aud: tokenUri, iat: now_sec, exp: now_sec + 3600 })`
3. `signInput = header + '.' + payload`
4. PEM → DER：剥离 `-----BEGIN/END PRIVATE KEY-----` 与换行，`atob` 解码为字节序列 → `Uint8Array`
5. `key = await crypto.subtle.importKey('pkcs8', derBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])`
6. `sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(signInput))` → `base64url(sig)`
7. `assertion = signInput + '.' + signature`

**换取 token**：
- `POST tokenUri`，`Content-Type: application/x-www-form-urlencoded`
- body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<assertion>`
- 响应 `{ access_token, expires_in }`，写 `settings.gscToken = { accessToken, expiresAt: Date.now() + expires_in*1000 }`（经 `updateSettings`）

**`base64url`**：`btoa` 后把 `+`→`-`、`/`→`_`、去掉尾部 `=`（手写，因 SW 无 `Buffer`）。

**缓存判定**：`settings.gscToken` 存在且 `expiresAt > Date.now() + 60_000`（提前 60s 边界）则命中。

### 5.2 `lib/gsc/submit.ts`（~60 行，仿 `indexnow/submit.ts`）

```ts
const PUBLISH_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const METADATA_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications/metadata';

export interface GscResult { ok: boolean; status: number; reason?: string; }

/** 单条提交。fetch 抛错透传（调用方 catch 兜底「网络错误」）。 */
export async function publishUrl(token: string, url: string): Promise<GscResult> {
  const res = await fetch(PUBLISH_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type: 'URL_UPDATED' }),
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

/** 探活（测试连接用）：GET metadata，仅看鉴权/权限是否通过，不关心返回体。 */
export async function getMetadata(token: string, url: string): Promise<GscResult> { ... }

export function reasonFor(status: number): string {
  switch (status) {
    case 403: return 'GSC：密钥无效，或服务账号未加为站点所有者';
    case 429: return 'GSC：超出每日 200 次配额，请明日重试';
    case 400: return 'GSC：请求格式或网址错误';
    case 404: return 'GSC：端点未找到';
    default: return `GSC：返回 ${status}`;
  }
}
```

### 5.3 `lib/storage/settings.ts` 扩展

```ts
export interface Settings {
  indexnowKey?: string;
  gscCredentials?: string;                                    // 服务账号 JSON 整段文本
  gscToken?: { accessToken: string; expiresAt: number };      // access_token 缓存
}
const DEFAULT: Settings = {};   // 删除 accountIndex
```

- 删除 `accountIndex` 字段与 `DEFAULT.accountIndex = 0`（实现时 `grep accountIndex` 确认仅 background `handleStart` 旧实现引用，迁移后无引用）。
- `parseServiceAccount` 放在 `lib/gsc/auth.ts`（更内聚），settings.ts 不变职责。

### 5.4 `useGscCredentials` hook（对应 `useIndexNowKey`）

```ts
export function useGscCredentials() {
  // state: credentials (string | undefined), testStatus ('idle'|'testing'|'ok'|'fail'), testMessage
  // 初次读 settings.gscCredentials；storage.onChanged 跨视图同步
  // save(jsonText): updateSettings({ gscCredentials: jsonText, gscToken: undefined })  // 换密钥即作废旧 token
  // clear(): updateSettings({ gscCredentials: undefined, gscToken: undefined })
  // testConnection(): 经 background（或直接 fetch）调 getMetadata，回写 testStatus/testMessage
  return { credentials, save, clear, testConnection, testStatus, testMessage };
}
```

测试连接需访问 `googleapis.com`——sidepanel UI 也可直接 `fetch`（host_permissions 含 `<all_urls>`），无需绕道 background。若担心 CORS，可经 background port 走（与提交同路径）。**初定 UI 直接 fetch**（getMetadata 是简单 GET，CORS 友好；实现时验证）。

### 5.5 `GscCredentialsSection` 组件（对应 `IndexNowKeySection`）

- 容器样式复用 `IndexNowKeySection` 的内联 style（`--color-surface-card` / `--radius-md` / hairline border）。
- 标题：「GSC 服务账号密钥（Indexing API）」。
- `textarea`（`fontFamily: var(--font-mono)`, `fontSize: 12`, rows≈4, 占位「粘贴从 Google Cloud 下载的服务账号 JSON 文件内容」）。
- 按钮行：`[保存]` `[测试连接]` `[清空]`。
- 测试结果行：`ok` → 绿色「✓ 密钥有效（服务账号：xxx@…）」；`fail` → 红色显示 `reason`。
- 折叠的配置说明（外链到 `prereqs` 文档）：简述「创建服务账号 → 下载 JSON → 把 client_email 加为 GSC 站点所有者」。

### 5.6 `background.handleStart` 重写（仿 `handleBingStart`）

```ts
async function handleStart(port, msg: { domain: string; urls: string[] }, shouldStop) {
  const { gscCredentials } = await getSettings();
  if (!gscCredentials) {
    emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: '未配置 GSC 服务账号密钥，请在下方粘贴' });
    emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
    return;
  }
  let creds;
  try { creds = parseServiceAccount(gscCredentials); }
  catch (e) {
    emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `密钥解析失败：${(e as Error).message}` });
    emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
    return;
  }
  let token;
  try { token = await getAccessToken(creds); }
  catch (e) {
    emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `换取访问令牌失败：${(e as Error).message}` });
    emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
    return;
  }

  emit(port, { type: 'GSC_STATE', state: 'running', total: msg.urls.length, done: 0, results: [] });
  emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: `提交 ${msg.urls.length} 条到 Indexing API…` });

  const results: SubmitResult[] = msg.urls.map((u) => ({ url: u, status: 'skipped', reason: '未执行' }));
  let quotaHit = false;

  for (let i = 0; i < msg.urls.length; i++) {
    if (shouldStop()) break;
    const u = msg.urls[i];
    if (quotaHit) { /* 剩余保持 skipped，reason 改为「未执行（批次终止）」 */ continue; }
    let r;
    try { r = await publishUrl(token, u); }
    catch (e) { r = { ok: false, status: 0, reason: `网络错误：${(e as Error).message}` }; }
    const row = results[i];
    if (r.ok) { row.status = 'ok'; row.reason = undefined; }
    else { row.reason = r.reason; if (r.status === 429) quotaHit = true; }
    emit(port, { type: 'GSC_LOG', level: r.ok ? 'info' : 'error', phase: 'submit',
      message: r.ok ? `✓ ${u}` : `✗ ${u}：${r.reason}` });
    emit(port, { type: 'GSC_STATE', state: 'running', total: msg.urls.length, done: i + 1, currentUrl: u, results: [...results] });
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  emit(port, { type: 'GSC_DONE', ok, failed: 0, skipped: msg.urls.length - ok });
}
```

**关键差异于 `handleBingStart`**：GSC 逐条提交（Bing 按 host 分组整批），每条推一次 `GSC_STATE`（`done` 逐条递增 1→2→…→10，进度平滑，与原 CDP 版体验一致）；遇 429 设 `quotaHit`，剩余标 `skipped` 不再请求。

**取消语义**：重写为与 `handleBingStart` 一致的**闭包 `shouldStop` 注入**——GSC port 监听改为 `let gscStop = false; ... handleStart(port, msg, () => gscStop)`，`GSC_CANCEL` 置 `gscStop = true`。一并删除 module-scope 的 `stopRequested` 与 `currentPort`（旧 CDP 编排遗留，API 版不需要跨消息持有 port 引用）。

## 6. 数据流

```
SubmitPanel.submit()
  └─ orch.run({ gsc, bing }, domain, sitemapUrl)
       └─ gsc.start(domain, picked)                    # useGscRunner
            └─ port.postMessage({ type:'GSC_START', domain, urls })
[background]
       handleStart(port, msg, shouldStop)
        ├─ getSettings() → gscCredentials
        ├─ parseServiceAccount → creds（失败：日志 + GSC_DONE 全 skipped）
        ├─ getAccessToken(creds) → token（命中缓存或 JWT 换取；失败：日志 + 全 skipped）
        └─ for u in urls: publishUrl(token, u) → 映射 SubmitResult
             每条 → GSC_STATE(done++) + GSC_LOG
        → GSC_DONE(ok, failed=0, skipped)
[UI]
       GSC_STATE → setState({ running, total, done, currentUrl }) + setResults
       GSC_LOG  → setLogs(append)
       GSC_DONE → setState(IDLE) + doneRef.resolve(latestResults)
[orchestrator]
       └─ appendSubmissions(domain, results.map → {platform:'gsc',...})  # 落库
```

## 7. 错误码 → reason → 分类

| 状态 | reason（写入 SubmitResult.reason / 日志） | 分类（classifyResult） |
|---|---|---|
| 200 | — | ok |
| 403 | `GSC：密钥无效，或服务账号未加为站点所有者` | failed |
| 429 | `GSC：超出每日 200 次配额，请明日重试` | failed（且触发 `quotaHit`，剩余 skipped） |
| 400 | `GSC：请求格式或网址错误` | failed |
| 404 | `GSC：端点未找到` | failed |
| 其他 | `GSC：返回 <status>` | failed |
| 网络异常（fetch 抛错） | `网络错误：<msg>` | failed |
| token 换取失败 | 整批 skipped + error 日志（不归 failed，与 IndexNow「未配密钥」语义一致） | skipped |
| 取消/批次终止 | `未执行（批次终止）` | skipped（在 SKIP_REASONS 白名单内） |

`SKIP_REASONS = ['已索引', '不属于此域名', '配额', '未执行（批次终止）']` 不变。GSC API 失败 reason（403/429/...）刻意不列入 → 归 failed，在报告中醒目提示。

## 8. 配额与并发策略

**配额事实**（官方文档）：
- 每分钟 380 次（所有端点）——瞬时上限，10 条/批远低于此。
- **每天 200 次 publish**（太平洋时间零点重置）——**真正的运营瓶颈**。
- 价格：免费。

**并发策略：串行逐条，无人为 sleep**。
- `for` 循环 `await publishUrl`，一条完成再发下一条。每条网络往返几百 ms，10 条约 3-5 秒。
- 与 `handleBingStart` 的串行风格一致；进度逐条 `done++`，与原 CDP 版体验一致。
- **不加固定 sleep**：Indexing API 是给机器用的官方 API，380/分 配额充裕；sleep 是 CDP 时代防反自动化的遗留，API 时代无益且拖慢。
- **429 即止**：任一条返回 429（日配额耗尽）→ 置 `quotaHit`，剩余条目保持 `skipped` 不再发请求，避免浪费配额与刷无效请求。

## 9. 测试策略

- `tests/gsc-auth.test.ts`：
  - `parseServiceAccount`：合法 JSON → 正确字段；非法 JSON / 缺 `client_email` / 缺 `private_key` → 抛错。
  - `base64url`：标准向量。
  - JWT 构造：`header.payload` 拼接、payload 字段（iss/scope/aud/iat/exp）正确（mock `crypto.subtle` 验证 importKey 入参）。
  - `getAccessToken`：缓存命中（`gscToken` 未过期）不换；过期则签 JWT 换新并写缓存；mock `fetch` 返回 token。
- `tests/gsc-submit.test.ts`：`publishUrl` 的 200/403/429/400 分类、`reasonFor` 文案、`getMetadata` 探活（mock `globalThis.fetch`）。
- `tests/useGscCredentials.test.tsx`：`renderHook`，测 save/clear/testConnection、storage.onChanged 同步。
- `tests/gsc-credentials-section.test.tsx`：RTL，textarea 输入、按钮点击、测试结果渲染。
- **删除** `tests/gsc-flow.test.ts`、`tests/gsc-url.test.ts`、`tests/cdp.test.ts`、`tests/cdp-actions.test.ts`。
- **保留** `tests/useGscRunner.test.tsx`（协议不变）。
- 复用 `vitest.config.ts`（globals + chrome types），mock 模式仿 `tests/indexnow-submit.test.ts`。

## 10. 清理（CDP 残留）

- 删 `lib/cdp/client.ts`、`lib/cdp/actions.ts`（GSC 是唯一用户）。
- 删 `lib/gsc/flow.ts`、`lib/gsc/selectors.ts`、`lib/gsc/url.ts`。
- 删 `tests/cdp.test.ts`、`tests/cdp-actions.test.ts`、`tests/gsc-flow.test.ts`、`tests/gsc-url.test.ts`。
- `wxt.config.ts`：移除 `permissions` 中的 `'debugger'`、`host_permissions` 中的 `'https://search.google.com/*'`。
- `lib/storage/settings.ts`：删 `accountIndex` 字段（`grep accountIndex` 确认无其他引用）。
- 删 `docs/superpowers/notes/gsc-probe.md` 中关于 CDP 探测的过时内容（若存在；保留历史记录也可，加 deprecated 标注）。

## 11. 非目标（YAGNI）

- **不做** Indexing API 的 `URL_DELETED`（移除）通知——QuickSEO 场景是「请求编入索引」，非删除。
- **不做** 批量端点 `/batch`——逐条已足够（10 条/批），且能精确追踪每条结果；multipart 构造与响应解析复杂度不值得。
- **不做** 本地配额计数/预判——依赖 429 返回码引导（与 IndexNow 不预校验 key 可达性同理）。
- **不做** token 失效后自动重试单条——access_token 缓存命中/过期由 `getAccessToken` 统一处理；若提交途中 token 恰好过期（极小概率，60s 边界），该条记 failed 由用户重试。
- **不做** 私钥加密存储——与 `indexnowKey` 明文存储一致（项目当前无加密层）；服务账号私钥更敏感，标注为已知风险（§12），不引入加密以免增加复杂度。
- **不实现** 普通「网页类型检测」——不试图判断 URL 是否含 JobPosting/BroadcastEvent（API 也不要求，由 Google 后端判定）。

## 12. 风险与已知限制

1. **类型限制（§2）**：普通网页提交返回 200 但 Google 不保证抓取。UI 不显示「已编入索引」，只显示「已通知/已提交」。
2. **日配额 200**：每批 10 条，一天最多 20 批。高频用户会频繁撞 429。UI 日志会明确提示「超出每日配额，请明日重试」。
3. **私钥明文存储**：`chrome.storage.local` 明文存服务账号 JSON。风险：本地恶意扩展/物理访问可读取。缓解：扩展本地存储，不联网传输密钥本身（只传 JWT）；未来可考虑加密（非本次范围）。
4. **Web Crypto JWT 兼容性**：MV3 service worker 支持 `crypto.subtle`（RSASSA-PKCS1-v1_5 + SHA-256）。PEM→DER 解码用 `atob` 手写，需单测覆盖。
5. **CORS（测试连接）**：UI 直接 `fetch` getMetadata 可能受 CORS 影响；若实测受阻，回退方案是经 background port 走（与提交同路径）。
6. **`accountIndex` 删除**：需确认无其他模块引用（预期仅旧 `handleStart`）。删除前 `grep`。

## 13. 实现顺序（建议）

1. `lib/gsc/auth.ts` + `tests/gsc-auth.test.ts`（JWT 流程是核心难点，先打通）→ verify: 单测过
2. `lib/gsc/submit.ts` + `tests/gsc-submit.test.ts` → verify: 单测过
3. `lib/storage/settings.ts` 加 `gscCredentials` / `gscToken` 字段（**暂保留 `accountIndex`**，其删除并入 step 7）→ verify: `tsc` 过
4. `entrypoints/background.ts` 重写 `handleStart` → verify: 手动触发 GSC 提交，日志与结果正确
5. `useGscCredentials` + `GscCredentialsSection` + 测试 → verify: 配置区可粘贴/保存/测试连接
6. `SubmitPanel.tsx` 插入 `<GscCredentialsSection />` → verify: UI 渲染正常
7. 清理：删 `lib/cdp/*`、`lib/gsc/{flow,selectors,url}.ts`、对应测试；`wxt.config.ts` 移除 `debugger` 权限与 `search.google.com/*` host；`settings.ts` 删 `accountIndex` 字段（先 `grep accountIndex` 确认仅旧 `handleStart` 引用，已随 step 4 重写消失） → verify: `npm run build` / `tsc` 无报错、全量测试过
