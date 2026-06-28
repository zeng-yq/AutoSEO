# 关键词工具扩展：Google Trends + 快捷搜索

- **日期**：2026-06-28
- **状态**：已确认（待实现）
- **主题**：keyword-tools-expansion

## 背景与目标

当前「关键词工具」板块（`KeywordTools.tsx`）只是 `AhrefsTool` 的薄包装：国家下拉 + 关键词输入 + 打开 `ahrefs.com/keyword-difficulty`。存在三个问题：

1. **工具单一且标识不明**：只有一个 Ahrefs 关键词难度查询工具，但没有标明它是「关键词难度查询」，未来集成更多 Ahrefs 或同类工具时容易混淆。
2. **关键词输入重复**：关键词是所有关键词工具的公共输入，却写死在 Ahrefs 工具内部，无法跨工具复用。
3. **缺少高频工具**：实际 SEO 工作流里常用的「Google Trends 趋势对比」和「Google/Bing 快捷搜索」都没有。

**目标**：在关键词工具板块顶部引入一个公共关键词输入，下方堆叠多张工具卡片（每张带品牌 logo、明确来源标识、各自特有的选项控件），新增 Google Trends 趋势查询与 Google/Bing 快捷搜索两个工具，并把现有 Ahrefs 工具改造为复用公共关键词、标明「关键词难度查询」。

## 已确认的关键决策

经澄清确认，以下为本次扩展的定调决策：

1. **公共关键词 = 板块级状态**：`KeywordTools` 持有 `keyword` state 并持久化到 `chrome.storage.local`，以 prop 下传给三张工具卡片；卡片不再各自有关键词输入。
2. **快捷搜索走纯 URL**：用 `google.com/search?q=`、`cn.bing.com/search?q=` 直接打开结果页（非 CDP 模拟输入）。三张卡片均为 `chrome.tabs.create({ url })`，不触碰 background / messaging / CDP。
3. **每张卡片带真实品牌 logo**：用内联 SVG（新增 `components/brand-logos.tsx`），彩色品牌 logo 放在卡片 header 左侧，便于一眼识别。
4. **特有选项归各卡片**：关键词是公共的，但国家 / 天数 / 对比词等是各工具特有的，分别放在各自卡片内，不跨卡片共享。

## 组件结构

```
KeywordTools.tsx（板块壳，持有公共 keyword state + 持久化）
├─ <h2>关键词工具</h2>
├─ 公共关键词 TextInput（持久化到 storage）
└─ 三张 ToolPanel 卡片（垂直堆叠，gap 间距）
   ├─ <AhrefsTool keyword={kw}>        logo + "Ahrefs · 关键词难度查询" + 国家下拉 + 〔打开查询〕
   ├─ <GoogleTrendsTool keyword={kw}>  logo + "Google Trends · 谷歌趋势" + 天数/对比词/地区 + 〔搜索〕
   └─ <QuickSearchTool keyword={kw}>   logo + "快捷搜索"               + 〔用 Google 搜〕〔用 Bing 搜〕
```

### 新增 / 改动文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `entrypoints/sidepanel/components/ToolPanel.tsx` | 新增 | 共享卡片壳：props `logo` / `title` / `subtitle?` / `children`，统一 header 样式。 |
| `entrypoints/sidepanel/components/brand-logos.tsx` | 新增 | 内联 SVG：`AhrefsLogo` / `GoogleTrendsLogo` / `GoogleLogo` / `BingLogo`，彩色。 |
| `entrypoints/sidepanel/pages/GoogleTrendsTool.tsx` | 新增 | 趋势工具卡片。 |
| `entrypoints/sidepanel/pages/QuickSearchTool.tsx` | 新增 | 快捷搜索卡片。 |
| `entrypoints/sidepanel/pages/AhrefsTool.tsx` | 改造 | 删除内部关键词输入与 `keyword` state；改为接收 `keyword: string` prop；用 `ToolPanel` 包裹并加 logo + 副标题「关键词难度查询」。 |
| `entrypoints/sidepanel/pages/KeywordTools.tsx` | 改造 | 持有公共 `keyword` state + 持久化；渲染公共输入框 + 三张卡片。 |
| `lib/trends/url.ts` | 新增 | `buildTrendsUrl` + 常量 + 校验。 |
| `lib/quicksearch/url.ts` | 新增 | `buildGoogleSearchUrl` / `buildBingSearchUrl` + 校验。 |
| `lib/ahrefs/url.ts` | 不动 | 保留现有 `buildAhrefsUrl` / `COUNTRIES` / `isValidCountryCode`。 |

## URL 规格

### 工具一：Google Trends

`https://trends.google.com/explore?q={主词},{对比词}&date={date}&geo={geo}`

- **`q`**：主词 + 对比词，逗号分隔后整体 `encodeURIComponent`（逗号编码为 `%2C`）。对比词为空（清空）时只用主词，不带逗号。例：主词 `apple` + 对比词 `gpts` → `q=apple%2Cgpts`。
- **`date`**（天数下拉，三选一）：

  | UI 选项 | `date` 值 |
  |---|---|
  | 7 天 | `now 7-d` |
  | 30 天 | `today 1-m` |
  | 1 年 | `today 1-y` |

- **`geo`**（地区下拉）：默认 `Worldwide`（全球）；主流国家用两位**大写** ISO 代码（`US` / `GB` / `JP` / `DE` / `FR` / `IN` / `BR` / `CA` / `AU`）。注意 Trends 用大写，与 Ahrefs 的小写不同。

### 工具二：快捷搜索（直接打开结果页）

- Google：`https://www.google.com/search?q={关键词}`
- Bing：`https://cn.bing.com/search?q={关键词}`

关键词经 `encodeURIComponent`。两个按钮分别对应两个引擎，各自 `chrome.tabs.create`。

### 工具三：Ahrefs（保持不变）

`https://ahrefs.com/keyword-difficulty/?country={cc}&input={关键词}`

## url builder 接口

### `lib/trends/url.ts`

```ts
export const TRENDS_DATE_RANGES = [
  { value: 'now 7-d',  label: '7 天' },
  { value: 'today 1-m', label: '30 天' },
  { value: 'today 1-y', label: '1 年' },
] as const;

export const TRENDS_GEOS = [
  { code: 'Worldwide', label: '全球' },
  { code: 'US', label: '美国 (US)' },
  { code: 'GB', label: '英国 (UK)' },
  { code: 'JP', label: '日本 (JP)' },
  { code: 'DE', label: '德国 (DE)' },
  { code: 'FR', label: '法国 (FR)' },
  { code: 'IN', label: '印度 (IN)' },
  { code: 'BR', label: '巴西 (BR)' },
  { code: 'CA', label: '加拿大 (CA)' },
  { code: 'AU', label: '澳洲 (AU)' },
] as const;

// compare 为空字符串时不带逗号；date/geo 取上述常量值。
export function buildTrendsUrl(keyword: string, compare: string, date: string, geo: string): string;
```

- 空主词抛 `Error('keyword required')`。
- `compare` trim 后为空 → `q` 只编码主词；否则编码 `主词,对比词`。
- `date` / `geo` 直接取常量值拼入（UI 是受限下拉，值即常量）。

### `lib/quicksearch/url.ts`

```ts
export function buildGoogleSearchUrl(keyword: string): string;
export function buildBingSearchUrl(keyword: string): string;
```

- 空关键词抛 `Error('keyword required')`。
- 返回 `https://www.google.com/search?q=${encodeURIComponent(kw)}` / `https://cn.bing.com/search?q=${encodeURIComponent(kw)}`。

## 卡片交互细节

### Google Trends 卡片

- **天数**：`Select`，默认 `30 天`（`today 1-m`），记忆上次选择。
- **对比词**：`Combobox`（下拉建议 + 自由输入），默认值 `gpts`；预设选项 `gpts` / `chatgpt` / `ai` / `ai tools`；可清空（清空则只查主词）。记忆上次输入。
- **地区**：`Select`，默认 `全球`（`Worldwide`），记忆上次选择。
- **搜索按钮**：主词为空时 disabled；点击 `buildTrendsUrl` → `chrome.tabs.create`。

### 快捷搜索卡片

- 无特有选项，只用公共关键词。
- 两个按钮：〔用 Google 搜〕〔用 Bing 搜〕，各自 `buildXxxSearchUrl` → `chrome.tabs.create`。
- 公共关键词为空时两按钮均 disabled。
- 不记忆（无特有选项）。

### Ahrefs 卡片（改造后）

- 接收 `keyword` prop（来自公共输入），不再自带关键词输入。
- 国家下拉（`COUNTRIES` + 自定义两位代码）保留，记忆上次选择（`ahrefs:last` 仅存 country）。
- 副标题「关键词难度查询」标明用途。
- 主词为空或国家码非法时 disabled + 错误提示（沿用现有逻辑）。

## 公共关键词与持久化

- `KeywordTools` 持有 `const [keyword, setKeyword] = useState('')`。
- `useEffect` 初次挂载从 `chrome.storage.local` 读取 `kw-tools:keyword` 回填。
- `onChange` 时 `chrome.storage.local.set({ 'kw-tools:keyword': kw })`。
- 持久化键汇总：

  | 键 | 内容 |
  |---|---|
  | `kw-tools:keyword` | 公共关键词 |
  | `kw-tools:trends` | `{ date, compare, geo }` |
  | `ahrefs:last` | `{ country }`（沿用现有键，去掉 keyword 字段） |

## 错误处理

- 公共关键词为空 → 三张卡片的执行按钮全部 disabled（与现有 Ahrefs `disabled={!keyword.trim()}` 一致）。
- Ahrefs 自定义国家码非法 → 按钮 disabled + 错误提示（现有逻辑）。
- url builder 抛错 → try/catch 捕获，显示 `error.message`（现有模式）。

## logo 资源

- 新增 `components/brand-logos.tsx`，导出彩色内联 SVG 组件：`AhrefsLogo` / `GoogleTrendsLogo` / `GoogleLogo` / `BingLogo`，均接收 `{ size?: number }`。
- Google / Bing：取官方品牌色填充（Google 的 G 四色、Bing 青绿色）。
- **Google Trends / Ahrefs** 在 simple-icons 无现成图标，需从官网抓取或描摹其真实 logo（Trends 官方趋势图标、Ahrefs 橙色 logo）。实现阶段获取最接近的真实资源；若无法取得精确彩色版，退化为品牌色单色 SVG，但保持可识别。
- logo 与卡片背景（`--color-canvas` 浅色）保证对比度。

## manifest 权限（预期无需改动）

- 三张卡片均为 `chrome.tabs.create({ url })` 纯打开新标签。`tabs.create` 可打开任意 http(s) URL，**不需要**新增 host_permissions（现有 `ahrefs.com` 那条对纯打开亦非必需）。
- 预期 `wxt.config.ts` 不动。实现时验证：若打开目标域无障碍则不改 manifest。

## 测试

延续现有 `tests/` 目录与 vitest 模式，新增：

- `tests/lib/trends/url.test.ts`：
  - 三个 `date` 映射各一例（7 天 / 30 天 / 1 年）。
  - `geo` 为 `Worldwide` 与某国家代码（如 `US`）各一例。
  - 对比词为空 → `q` 不含逗号；对比词有值 → `q=apple%2Cgpts`。
  - 主词含特殊字符（如空格、`&`）→ 正确编码。
  - 空主词 → 抛错。
- `tests/lib/quicksearch/url.test.ts`：
  - Google / Bing 各生成正确 URL。
  - 关键词含空格/特殊字符 → 正确编码。
  - 空关键词 → 抛错。

UI 组件不新增单测（与现有 AhrefsTool 一致，无组件测试约定）。

## 范围外

- 不引入 CDP 自动化、不修改 background / messaging。
- 不新增 host_permissions（除非实现验证发现 `tabs.create` 受阻）。
- 不做关键词历史下拉（公共输入是单一 `TextInput`，非 Combobox）。
- 不做工具的启用/禁用配置或排序，三张卡片固定顺序：Ahrefs → Trends → 快捷搜索。
