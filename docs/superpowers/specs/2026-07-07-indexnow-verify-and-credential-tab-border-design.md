# IndexNow 测试连接 + 凭证 Tab 边框

> 日期：2026-07-07
> 状态：设计待评审

## 背景

QuickSEO 提交面板的「凭证设置」折叠区用 Tab 在 IndexNow 与 GSC 两套配置间切换（`entrypoints/sidepanel/components/CredentialsSection.tsx`）。当前存在两个问题：

1. **非激活 Tab 与背景相融**：`global.css` 的 `.tab` 非激活态是 `border: 1px solid transparent` + `background: transparent`，文字为 `--color-muted`。凭证折叠区展开后底色是 `--color-canvas`（cream 系），非激活 Tab 在其上没有任何轮廓，用户看不出那里还有一个可点的按钮。
2. **IndexNow 缺少测试连接功能**：GSC 已有「测试连接」按钮（`useGscCredentials.testConnection`，验证密钥格式 + private_key 有效），而 IndexNow 只有「生成 / 下载 / 刷新」密钥，用户无法在提交前确认 `<key>.txt` 是否已正确上传到目标站点根目录。一旦文件缺失或内容不匹配，真实提交会返回 403，用户只能事后从提交日志里发现。

## 目标

1. 非激活 Tab 拥有浅边框轮廓，与背景区分清晰；激活态保持现状不变。
2. IndexNow 配置区增加「测试连接」功能：用当前选中的站点域名，验证 `<host>/<key>.txt` 可访问且内容与密钥匹配，在不产生真实提交的前提下定位 403 根因。

## 非目标（YAGNI）

- 不新增 host 输入框：测试只用 SubmitPanel 顶部选中的 `site.domain`，多站点时切换选中站点再测。
- 不做 IndexNow API 端到端提交测试（避免真实提交副作用与 429 风险）。
- 不引入 Context/全局 store 传递域名：用 prop drilling（仅 3 层）即可，不为此新增抽象。
- 不改 GSC Tab 的任何行为。

## 设计

### 1. Tab 非激活态加浅边框

改动一处：`entrypoints/sidepanel/styles/global.css` 的 `.tab` 规则。

```diff
 .tab {
   flex: 1;
   height: 32px;
-  border: 1px solid transparent;
+  border: 1px solid var(--color-hairline);
   border-radius: var(--radius-md);
   background: transparent;
   color: var(--color-muted);
   ...
 }
```

效果：

| 状态 | 边框 | 背景 | 文字 |
|---|---|---|---|
| 非激活 | `--color-hairline` | 透明 | `--color-muted` |
| 非激活 hover | `--color-hairline` | `--color-surface-card`（已有） | `--color-ink`（已有） |
| 激活（已有 `.tab.is-active`，不变） | `--color-hairline` | `--color-surface-cream-strong` | `--color-primary` |

该类为全局共享（凭证 Tab 与顶部双 Tab 共用），统一获得边框，视觉一致。

### 2. IndexNow 测试连接：验证 `<host>/<key>.txt`

#### 机制

直接 GET `https://<host>/<key>.txt`，校验 HTTP 200 且响应体 `trim() === key`。这复刻了 IndexNow 协议本身的验证方式——搜索引擎收到提交后正是用同样的请求验证密钥，因此等价于"配置是否生效"。

扩展已在 `wxt.config.ts` 声明 `host_permissions: ['<all_urls>', ...]`，sidepanel 内的 `fetch` 可跨域读取任意站点响应体，无 CORS 阻塞。参考：`lib/indexnow/submit.ts` 中 `submitUrls` 已在 sidepanel 直接跨域 POST IndexNow 端点。

#### 数据流（域名透传）

```
SubmitPanel (site.domain)
  └→ CredentialsSection ({ domain })
       └→ IndexNowKeySection ({ domain })
            └→ useIndexNowKey.testConnection(domain)
                 └→ lib/indexnow/submit.ts verifyKeyFile(key, host)
```

#### 改动清单

| 文件 | 改动 |
|---|---|
| `lib/indexnow/submit.ts` | 新增 `verifyKeyFile(key, host)` 与 `VerifyResult` 类型 |
| `entrypoints/sidepanel/hooks/useIndexNowKey.ts` | 增加 `testConnection(host)` + `testStatus` / `testMessage`，复用 GSC 的 `TestStatus` 类型语义 |
| `entrypoints/sidepanel/components/IndexNowKeySection.tsx` | 接收 `domain` prop；按钮组增加「测试连接」；新增结果消息区；按 key/domain 状态控制禁用 |
| `entrypoints/sidepanel/components/CredentialsSection.tsx` | 接收 `domain` prop，透传给 `IndexNowKeySection`（GSC Tab 不传） |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | `<CredentialsSection domain={site.domain.trim()} />` |

#### `verifyKeyFile` 结果映射

```ts
export interface VerifyResult { ok: boolean; status: number; reason?: string }
export async function verifyKeyFile(key: string, host: string): Promise<VerifyResult>
```

URL 构造：`const origin = normalizeOrigin(host); const url = \`${origin}/${key}.txt\`;`（`normalizeOrigin` 已存在于 `@lib/seo-files/url`，能容忍 `example.com` / `https://example.com/...` 等输入）。

| 情况 | 返回 |
|---|---|
| `fetch` 抛错（DNS/网络/超时） | `{ ok: false, status: 0, reason: '无法访问 <host>：网络错误或域名无效' }` |
| HTTP 200 且 `body.trim() === key` | `{ ok: true, status: 200 }` |
| HTTP 200 但内容不符 | `{ ok: false, status: 200, reason: '密钥文件内容与密钥不匹配' }` |
| HTTP 404 | `{ ok: false, status: 404, reason: '站点根目录未找到 <key>.txt，请先上传密钥文件' }` |
| 其他 HTTP 状态 | `{ ok: false, status, reason: \`<host> 返回 HTTP ${status}\` }` |

`useIndexNowKey.testConnection(host)` 用结果决定 `testStatus`（`ok` → `'ok'`，否则 `'fail'`），与 GSC 的 `useGscCredentials.testConnection` 完全对称。`testMessage` 文案：成功时固定为 `密钥文件已正确部署到 <host>，可正常提交`；失败时直接用返回的 `reason`。

#### UI（`IndexNowKeySection`）

- props：`{ domain: string }`。
- 现有按钮组（`生成密钥` / `下载密钥文件` / `刷新`）之后追加：「测试连接」（`variant="secondary"`）。
- 禁用条件：`!key || testStatus === 'testing'`。
- 测试中按钮文案：`测试中…`。
- 当 `!domain` 或 `!isValidDomain(domain)`：按钮额外禁用，并在按钮组下方显示一行 muted 提示「请先在上方选择有效站点」（避免用户点了没反应却不知为何）。`isValidDomain` 已从 `@lib/storage/projects` 导出，`SubmitPanel` 同款用法。
- 结果消息区（`testMessage`）：颜色按 `testStatus`（`ok` → `--color-success`、`fail` → `--color-error`），与 GSC 一致。

## 边界情况

- **key 未生成**：测试按钮不渲染（按钮组本身以 `key` 为条件），自然不触发。
- **domain 为空或无效**：按钮禁用 + 提示选择站点。
- **domain 带协议/路径**：`normalizeOrigin` 规整为 `https://<host>`，再拼 `/<key>.txt`。
- **网络错误 / DNS 失败**：`fetch` 抛错被 catch，归为"无法访问"。
- **`<all_urls>` 权限缺失的兜底**（当前不会发生）：任意 fetch 失败统一归为"无法访问"，不暴露 CORS 实现细节。

## 测试（TDD）

先写测试再实现：

1. **`tests/indexnow-submit.test.ts`**（已有文件，追加）：mock 全局 `fetch`，覆盖 `verifyKeyFile` 全部分支——200 匹配 / 200 不匹配 / 404 / 其他状态 / fetch 抛错。校验 URL 构造（`normalizeOrigin` 对裸域名与带协议输入的处理）。
2. **`tests/useIndexNowKey.test.tsx`**（已有文件，追加）：`testConnection` 的状态流转 `idle → testing → ok` 与 `idle → testing → fail`，校验 `testMessage` 文案。
3. **`tests/indexnow-key-section.test.tsx`**（已有文件，更新）：传入 `domain` prop；断言「测试连接」按钮在 key 存在时渲染、在 testing 时禁用、在 domain 无效时禁用并出现提示文案。
4. **`tests/credentials-section.test.tsx`**（已有文件，更新）：渲染时透传 `domain` 到 `IndexNowKeySection`。
5. CSS 改动无单测，手动目视验证凭证 Tab 与顶部双 Tab 的非激活态边框。

## 验收

- 展开凭证设置，非激活 Tab 有清晰浅边框；激活 Tab 外观不变。
- IndexNow 已生成密钥且选中有效站点时，点「测试连接」：
  - 站点已正确上传 `<key>.txt` → 绿色"已正确部署"。
  - 未上传 / 内容不符 / 站点不可达 → 红色对应原因。
- 未选有效站点 → 按钮禁用 + 提示。
- GSC Tab 行为完全不变。
- 既有测试全部通过。
