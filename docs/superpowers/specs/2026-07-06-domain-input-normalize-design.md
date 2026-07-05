# 域名输入自动清洗与校验提示

- 日期：2026-07-06
- 状态：已确认，待制定实现计划

## 1. 背景与问题

sidepanel 有两个域名输入入口，当前都用 `isValidDomain`（`lib/storage/projects.ts`）对原始输入一刀切校验，既不清洗也不解释失败原因：

1. **`SiteTools` 顶部「网站」Combobox**：输入 `https://example.com/path` 之类带 scheme/路径的值，`isValidDomain` 不通过 → `hasSite=false` → 整页工具按钮全部 `disabled`，且只有底部一行灰字「请先选择或填写网站以使用工具」，不告诉用户「为什么我输了域名它还灰」。
2. **`ProjectModal`「项目管理」添加框**：同样的输入让「添加」按钮 `disabled`，无任何提示。

校验正则 `/^([a-z0-9-]+\.)+[a-z]{2,}$/i` 本身合理，但用户输入带 `https://` 前缀、路径、端口是常态，应能自动截取出域名主机部分。

## 2. 目标 / 非目标

**目标：**
- 输入框失焦时，自动把脏值清洗为裸域名主机并回填显示。
- 清洗后仍无效时，给出具体、可操作的校验提示。
- 两个入口（Combobox、ProjectModal 添加框）行为统一，共用同一套清洗 + 校验逻辑。

**非目标：**
- 不改 `isValidDomain` 的正则语义（保持其他调用方行为不变）。
- 不支持 IDN / 中文域名（见 §8 已知限制）。
- 不在输入过程中实时清洗回填（避免打断打字，见 §6 交互决策）。

## 3. 方案概览

新增纯函数 `normalizeDomain(input): string`，与 `isValidDomain` 同文件 `lib/storage/projects.ts`。调用处把原本的 `isValidDomain(x)` 改为 `isValidDomain(normalizeDomain(x))`——清洗是新增前置层，校验规则不变，改动最小。

清洗函数用浏览器原生 `new URL()` 解析，复用平台稳健性，自动剥离 scheme / path / query / fragment / userinfo / 端口，并转小写。

## 4. 清洗函数定义

```ts
/**
 * 把用户输入清洗为裸域名主机名（小写）。剥离 scheme / path / query / fragment /
 * userinfo / 端口。输入含非 ASCII（中文域名 / IDN）或解析失败时返回空串，
 * 交由 isValidDomain 判定无效并触发提示。
 *
 * 实现：补 https:// 前缀让 URL 解析，取 hostname（不含端口）。
 */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // 含非 ASCII → 暂不支持 IDN（避免 URL 转成 xn-- Punycode 显示丑陋）
  if (/[^\x00-\x7F]/.test(trimmed)) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}
```

要点：
- `new URL('https://example.com:8080/p?x=1').hostname` → `'example.com'`（`hostname` 不含端口，`host` 才含）。
- `new URL('https://notadomain').hostname` → `'notadomain'`（不抛错），随后由 `isValidDomain` 判定无效（无点），链路自洽。
- 非 ASCII 检测前置，避免 Punycode 透出。

## 5. 清洗规则（输入 → 清洗后 → 是否有效）

| 输入 | `normalizeDomain` | `isValidDomain` |
|---|---|---|
| `https://example.com/path?x=1` | `example.com` | ✓ |
| `http://user:pass@example.com` | `example.com` | ✓ |
| `example.com:8080` | `example.com` | ✓ |
| `HTTPS://WWW.Example.COM/` | `www.example.com` | ✓ |
| `  example.com  ` | `example.com` | ✓ |
| `www.example.com` | `www.example.com` | ✓（保留 www） |
| `notadomain` | `notadomain` | ✗ |
| `192.168.1.1` | `192.168.1.1` | ✗（末段非 `[a-z]{2,}`） |
| `例子.中国` | `''`（非 ASCII） | ✗ |

决策说明：
- **端口必去**：保留则正则不过，且 SEO 工具针对公网域名，端口无意义。
- **www 保留**：GSC 等把 `www.example.com` 与裸域 `example.com` 当不同资源，主动去 www 会改变语义。
- **中文域名 / IDN 暂不支持**：避免 Punycode 显示，含非 ASCII 字符直接判无效并提示。

## 6. 交互：失焦清洗 + 失焦校验

**为何失焦而非实时：** 输入过程中（如刚敲完 `https://` 还没敲域名）实时清洗会解析失败、回填闪烁，打断打字。失焦（Tab / 点别处 / 选下拉项后）才清洗，过程零打扰。

### 6.1 Combobox（网站选择框）

- `Combobox` 新增可选 `onBlur?: () => void`，在 input `onBlur` 时**立即触发**（先于关下拉的 `setTimeout`）。点下拉项不会触发它：下拉项 `onMouseDown` 调 `preventDefault` 阻止了 input 失焦，故 `onBlur` 不触发，不会误清洗选中项。
- `SiteTools`：
  - `onBlur` 内：`const n = normalizeDomain(site.domain); setSite({ domain: n });`
  - 提示状态由 `n` 决定：`isValidDomain(n)` → 不显示；为空 → 灰字引导「请先选择或填写网站以使用工具」；非空但无效 → 红字「请输入有效域名，如 example.com」。
- `hasSite` 改为 `isValidDomain(normalizeDomain(site.domain))`。前置 `normalizeDomain` 的意义在于让**输入过程中**（未失焦、`site.domain` 仍是脏值时）按钮启用态也按清洗后的值判定——否则用户敲到 `https://example.com` 时按钮仍是灰的，非得等失焦才亮，体验割裂。失焦回填只是把"显示"对齐到清洗值，判启用态从一开始就该用清洗值。

### 6.2 ProjectModal 添加框

- `TextInput` 已支持透传原生 `onBlur`（`rest` 展开），无需改组件。
- `ProjectModal`：失焦时 `const n = normalizeDomain(domain); setDomain(n);`，若 `n` 非空且 `!isValidDomain(n)`，在现有 `error` 红字位显示「请输入有效域名，如 example.com」。
- 「添加」按钮 `disabled` 改为 `!isValidDomain(normalizeDomain(domain))`，`Enter` 提交判定同理。
- 已有的 `add()` 抛错 error（存储层重复域名等）维持不变，与本地校验提示共用同一渲染位（本地校验优先，二者不并存：本地无效时按钮已禁用，不会触发 add）。

## 7. 改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/storage/projects.ts` | 新增 `normalizeDomain` 导出 |
| `entrypoints/sidepanel/components/Combobox.tsx` | 新增 `onBlur?: () => void` 透传 |
| `entrypoints/sidepanel/pages/SiteTools.tsx` | `onBlur` 清洗回填 + 三态提示文案；`hasSite` 用 `normalizeDomain` 前置 |
| `entrypoints/sidepanel/components/ProjectModal.tsx` | 失焦清洗回填 + 本地校验提示；按钮 / Enter 判定用 `normalizeDomain` 前置 |
| `tests/domain-normalize.test.ts` | 新增，覆盖 §5 规则表 |

## 8. 已知限制

- **不支持 IDN / 中文域名**：含非 ASCII 字符的输入判无效并提示。SEO 场景以 ASCII 域名为主，暂不引入 Punycode 转换。
- **不校验公网后缀（PSL）**：`example.co.uk`、`example.com.cn` 等多级 TLD 由现有正则按字面匹配，足以满足 SEO 工具跳转需求，不引入公共后缀列表。

## 9. 测试计划

- **纯函数单测（必做）** `tests/domain-normalize.test.ts`：
  - `normalizeDomain` 覆盖 §5 全部输入→输出。
  - 组合 `isValidDomain(normalizeDomain(x))` 在边界用例的布尔结果。
- **组件交互（轻量）**：Combobox 失焦触发外部 `onBlur`、ProjectModal 失焦回填——按需补，优先级低于纯函数。
