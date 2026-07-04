# 关键词工具面板 UI 紧凑化重设计

- 日期:2026-07-05
- 状态:已通过设计评审,待编写实现计划
- 作者:zengyq
- 关联:`KeywordTools` / `AhrefsTool` / `GoogleTrendsTool` / `QuickSearchTool` / `ToolPanel` / `brand-logos`

## 1. 背景与目标

关键词工具面板(`KeywordTools`,通过顶部「关键词工具」tab 进入)当前存在四个体验问题:

1. **重复标题**:tab 按钮已写「关键词工具」,内容首行又有一行 `<h2>关键词工具</h2>`,重复占位。
2. **控件过宽、纵向过长**:`Select` / `Button` 普遍 `width:100%` 且单列纵向堆叠,其中 `GoogleTrendsTool` 一张卡就有 4 个全宽控件 + 4 个标签。三张卡片合计约 18 行可视高度,sidepanel 320px 宽下必须滚动才能看全。
3. **geo(搜索位置)有歧义**:`QuickSearchTool` 的「搜索位置」下拉放在面板顶部、又位于 Google/Bing 两个按钮之上,视觉上像同时影响两个引擎;但 `geo.ts` 的 `GEO_HOST_FILTER = 'google.com'`,规则只改 Google 请求头,**Bing 完全不受影响**。
4. **logo 是手绘 SVG**:`brand-logos.tsx` 用简易几何图形拼凑 Google/Bing/Ahrefs/Google Trends 的标志,识别度低、不规范。

### 目标

- 删除重复标题,腾出顶部空间。
- 重排三张卡片的表单控件:主按钮上提到卡片 header、相关下拉并排、标签与控件同行,把整体可视高度从 ~18 行压到 ~11 行(一屏可见)。
- 让「搜索位置」在视觉上明确归属于「用 Google 搜」,消除对 Bing 的歧义。
- 用真实品牌 logo 图片替换手绘 SVG,四张图统一规范为 128×128 PNG。

### 非目标(YAGNI)

- ❌ 改 `Select` / `Button` 组件的默认 `width:100%`(其他 tab 仍在复用,保持向后兼容)。紧凑全靠各页面外层 flex 容器实现。
- ❌ 触碰 `SiteTools` / `SubmitPanel` / `tokens.css` / 顶部 `TabBar`(本次只动关键词工具面板)。
- ❌ 给 logo 加统一白色圆角底(会改变 Trends/Bing 原有带色外观;用户选择保留各自品牌原貌)。
- ❌ 引入 CSS-in-JS 或新样式体系(延续项目现有 inline-style 风格)。

## 2. 现状分析

### 2.1 组件结构与调用关系

```
KeywordTools (pages/KeywordTools.tsx)
 ├─ <h2>关键词工具</h2>          ← 重复,删
 ├─ TextInput(关键词)
 └─ ToolPanel × 3:
    ├─ AhrefsTool       (logo=<AhrefsLogo>,       title="Ahrefs",          subtitle="关键词难度查询")
    ├─ GoogleTrendsTool (logo=<GoogleTrendsLogo>, title="Google Trends",   subtitle="谷歌趋势")
    └─ QuickSearchTool  (logo=<GoogleLogo>,       title="快捷搜索")
```

`ToolPanel`(`components/ToolPanel.tsx`)是统一卡片壳:`[logo] title subtitle` header + `children`。当前 header 不支持右侧动作区。

`brand-logos.tsx` 导出 4 个组件 `GoogleLogo / BingLogo / AhrefsLogo / GoogleTrendsLogo`,签名均为 `({ size = 16 }: { size?: number })`,被 `AhrefsTool`(size=18)、`GoogleTrendsTool`(size=18)、`QuickSearchTool`(size=18 header + size=14 按钮)引用。

### 2.2 geo 的 Google-only 事实(决定视觉归属的依据)

- `lib/quicksearch/geo.ts:53` `GEO_HOST_FILTER = 'google.com'`,`applyGeo` 注册的 `declarativeNetRequest` session 规则 `condition.urlFilter` 只匹配 `google.com`。
- `background.ts:74-89` 启动/安装时按 storage 重建规则,`storage.onChanged` 实时增删;**全程不涉及 Bing**。
- 故「搜索位置」是 Google 专属能力,Bing 按钮与其并列时必须做视觉隔离。

### 2.3 logo 真实图片识别结果(用户提供的 4 个 URL)

| URL | 平台 | 原始下载结果 | 规范化目标 |
|---|---|---|---|
| url1 `ODF.P6OCt919s5RCC8Y_Tmg71A` | Ahrefs(橙"a") | 32×32 PNG 透明 | 128×128 PNG 透明 |
| url2 `OIP-C.pSuadi6NxsnzqVj8GUVu8wAAAA` | Google Trends(四色趋势线) | 180×180 WebP,带青绿底 | 128×128 PNG(保留底色) |
| url3 `ODF.b64Z_8Z3An4K5uiMyfPSjQ` | Google(四色"G") | 32×32 PNG 透明 | 128×128 PNG 透明 |
| url4 `OIP-C.AYeZh-30xeoDw3eKcUCiCQHaHa` | Bing(青绿"b") | 216×216 WebP,带暗灰紫底 | 128×128 PNG(保留底色) |

已验证:把 url1/url3 的 `w=32&h=32` 改为 `w=128&h=128` 可直接取到 128×128 高清 PNG(透明);url2/url4 改 `w=128&h=128` 取到 128×128 WebP,再用 `sips -s format png` 转 PNG(保留品牌底色)。

## 3. 设计方案

### 3.1 logo 资源规范化(新增 4 个文件)

- 目录:`entrypoints/sidepanel/assets/logos/`(新建)
- 文件:`ahrefs.png` / `google-trends.png` / `google.png` / `bing.png`,全部 128×128 PNG
- 获取流程(实现时执行):
  1. `curl` 请求 url1/url3 的 128px 版 → 直接得到 128×128 PNG
  2. `curl` 请求 url2/url4 的 128px 版 → 得到 128×128 WebP
  3. `sips -s format png url2.webp --out google-trends.png`(url4 同理)转 PNG
  4. 复制到 `entrypoints/sidepanel/assets/logos/`
- 引用方式:`import googleLogoUrl from '../assets/logos/google.png'`(Vite 自动处理路径与 hash,构建产物正确打入扩展)。
- 类型支持已开箱可用:`.wxt/wxt.d.ts` → `wxt/vite-builder-env` → `vite/client`,后者已 `declare module '*.png'`,无需额外补类型声明文件。

### 3.2 `brand-logos.tsx` 重写(SVG → img)

保持 4 个命名导出与 `size` prop 签名不变,调用方零改动:

```tsx
import ahrefsLogoUrl from '../assets/logos/ahrefs.png';
import googleTrendsLogoUrl from '../assets/logos/google-trends.png';
import googleLogoUrl from '../assets/logos/google.png';
import bingLogoUrl from '../assets/logos/bing.png';

interface LogoProps { size?: number; }
const imgStyle: React.CSSProperties = { objectFit: 'contain', display: 'inline-block', lineHeight: 0 };

export function GoogleLogo({ size = 16 }: LogoProps) {
  return <img src={googleLogoUrl} width={size} height={size} alt="" style={imgStyle} />;
}
// BingLogo / AhrefsLogo / GoogleTrendsLogo 同构
```

`objectFit: 'contain'` 保证四张不同来源(透明 / 带底)的图在固定方形画框内不变形、统一居中。

### 3.3 `ToolPanel.tsx` 增强(向后兼容)

新增可选 `action?: React.ReactNode`,渲染在 header 右侧(`margin-left:auto` 推到最右)。不传时外观与现状完全一致,其他调用方不受影响。

```tsx
interface ToolPanelProps {
  logo: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;   // 新增
  children: React.ReactNode;
}
// header 内:... title/subtitle 之后加
{action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
```

### 3.4 四个页面布局(激进紧凑)

#### `KeywordTools.tsx`
- 删除第 28 行 `<h2 style={...}>关键词工具</h2>`。
- 外层 `<div style={{ padding: 'var(--space-md)' }}>` 保持;下方三个 `ToolPanel` 的纵向 gap 从 `--space-md` 收紧为 `--space-sm`。

#### `AhrefsTool.tsx`
- 「打开查询」按钮上提为 `ToolPanel` 的 `action`(用 `variant="primary"`,不再 `width:100%`)。
- 主体改为单行:`[标签"国家"(宽 ~44px)] [Select flex:1]`,自定义国家输入框(展开时)在这一行下方追加。
- 去掉冗余 `marginTop`,错误信息仍保留。

```
┌─[●] Ahrefs  关键词难度 ──── [打开查询 ▶]┐
│ 国家  [us ▼]                            │
└─────────────────────────────────────────┘
```

#### `GoogleTrendsTool.tsx`(压缩最多)
- 「搜索」按钮上提为 `action`。
- 对比词:单行 `[标签"对比词"] [Combobox flex:1]`。
- 天数 + 地区:并排两列(flex gap),每列 `[小标签] [Select]`,各占 50%。

```
┌─[▲] Google Trends  谷歌趋势 ── [搜索 ▶]┐
│ 对比词  [gpts____________________]      │
│ 天数              地区                   │
│ [1-m▼]            [全球▼]               │
└─────────────────────────────────────────┘
```

#### `QuickSearchTool.tsx`(geo 归属 Google)
- 整体改为两列 flex 容器。
- **左列**(宽度与 Google 按钮绑定):顶部小字「仅 Google」标签 + geo 下拉 + 「用 Google 搜」按钮。三者宽度一致,视觉上 geo 与 Google 强绑定。
- **右列**:「用 Bing 搜」按钮,`align-self: flex-end` 与 Google 按钮底部对齐;按钮上方留白(表示无 geo)。
- geo 下拉从面板顶部下沉到 Google 按钮正上方,移除「搜索位置」独立全宽行。

```
┌─[G] 快捷搜索 ──────────────────────────┐
│  仅 Google                              │
│  [🇺🇸 美国 ▼]            │             │
│  [G Google 搜]           [b Bing 搜]   │
└─────────────────────────────────────────┘
```

### 3.5 紧凑效果

| 指标 | 现状 | 重设计后 |
|---|---|---|
| 可视行数(三张卡合计) | ~18 行 | ~11 行 |
| `GoogleTrendsTool` 控件行 | 4(全宽纵排) | 2(对比词 1 行 + 天数/地区并排 1 行) |
| 主按钮位置 | 卡片底部全宽 | 卡片 header 右侧 |
| 重复标题 | 1 处 | 0 |

## 4. 受影响文件

| 文件 | 改动 |
|---|---|
| `entrypoints/sidepanel/assets/logos/*.png` | 新增 4 个 |
| `entrypoints/sidepanel/components/brand-logos.tsx` | 重写(SVG→img) |
| `entrypoints/sidepanel/components/ToolPanel.tsx` | 新增 `action` prop |
| `entrypoints/sidepanel/pages/KeywordTools.tsx` | 删 h2、收紧 gap |
| `entrypoints/sidepanel/pages/AhrefsTool.tsx` | 布局重排 + action |
| `entrypoints/sidepanel/pages/GoogleTrendsTool.tsx` | 布局重排 + action |
| `entrypoints/sidepanel/pages/QuickSearchTool.tsx` | geo 下沉、两列布局 |

`Select.tsx` / `Button.tsx` / `tokens.css` / `global.css` 不改。

## 5. 验证

- `pnpm typecheck`(若有)/ `pnpm build`:确认 png import 类型与构建通过。
- 手动在 sidepanel 查看:三张卡片在 320px 宽下一屏可见;geo 下拉视觉上只与 Google 按钮对齐;四张 logo 等大、不变形。
- 功能回归:切换 geo → 打开 Google 搜索验证仍生效;Ahrefs 自定义国家、Trends 各下拉、Bing 搜索均正常。
- 现有测试 `tests/quicksearch-geo.test.ts` / `tests/ahrefs-url.test.ts` / `tests/trends-url.test.ts` 应保持通过(本次只动 UI,不动 url/geo 逻辑)。
