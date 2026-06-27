# sidepanel 左右布局重构

## 背景

AutoSEO sidePanel 当前是「`TopBar` + 首页卡片菜单 + 子页面（带 `← 返回` 按钮）」的单列模式，每次进工具都要回首页再点。用户希望改成参考图（AITDK/SiteData）那样的「左侧常驻菜单 + 右侧内容」左右布局，点哪项右侧直接显示内容。

## 关键决策（已与用户确认）

- **改造范围**：整个 AutoSEO 面板（GSC 批量提交 / Ahrefs KD 查询 / 项目管理）。
- **视觉风格**：沿用项目现有暖色米白设计语言（`tokens.css`），**不**引入参考图的深灰侧栏 / 蓝色竖条。
- **侧栏宽度**：160px（适配 sidePanel 默认窄宽）。
- **菜单标题**：完整名（GSC 批量提交 / Ahrefs KD 查询 / 项目管理）。
- **默认选中**：`gsc`（移除首页卡片首屏）。

## 改动清单

1. **`App.tsx`**：`TopBar` + 单页路由 → 左右双栏 `flex` 布局。左侧渲染新 `SideNav`，右侧渲染当前选中工具页；`route` 默认 `'gsc'`。
2. **新增 `components/SideNav.tsx`**（常驻导航）：
   - 顶部沿用 `TopBar` 的 `✲ AutoSEO` logo（serif 20px）。
   - 三个菜单项；选中态 = 左侧 3px 橘棕竖条（`--color-primary`）+ 橘棕文字 + `--color-surface-soft` 背景；未选中 = `--color-muted` 文字。
   - 侧栏背景 `--color-surface-soft`（`#f5f0e8`），与右侧 `--color-canvas`（`#faf9f5`）靠暖色深浅区分。
3. **三个工具页**（`GscTool` / `AhrefsTool` / `Projects`）：移除各自顶部「`← 返回`」按钮及 `onBack` prop（调用点仅 `App`，一并改掉，无残留），保留 `<h2>` 标题作为右侧内容区标题。
4. **`Home.tsx` / `TopBar.tsx`**：不再挂载（logo 已并入 `SideNav`）。文件暂不删除，避免误伤。

## 设计令牌

全部复用 `tokens.css`，不新增。配色：侧栏 `--color-surface-soft` / 内容 `--color-canvas` / 选中 `--color-primary`。

## 验证

`wxt build` + `tsc` 类型检查通过，无回归。
