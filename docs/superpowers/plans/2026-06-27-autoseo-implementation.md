# AutoSEO SEO 工具集合扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 WXT + React 19 + TypeScript 空模板改造成侧边栏 SEO 工具集合扩展，首发两个工具：GSC 批量提交（`chrome.debugger` CDP 模拟人工）与 Ahrefs KD 查询。

**Architecture:** 侧边栏 React UI（不持运行态）+ background service worker（持运行态、驱动 CDP、经 port 推送进度）+ 纯 `chrome.debugger` CDP 引擎 lib。运行态只在 background，任务在侧边栏关闭后继续。

**Tech Stack:** WXT 0.20、React 19、TypeScript、vitest + jsdom + fake-indexeddb、@fontsource（Inter / JetBrains Mono / EB Garamond）。包管理器 pnpm。

## Global Constraints

- 包管理器固定 **pnpm**（项目已有 pnpm-lock.yaml）。所有安装/脚本用 `pnpm`。
- 浏览器目标 **Chrome MV3**（manifest v3）。CDP 通道固定 `chrome.debugger`，版本字符串 `'1.3'`，target 形如 `{ tabId }`。
- UI 严格遵循根目录 `DESIGN.md` 令牌：暖奶油 `canvas #faf9f5`、珊瑚 `primary #cc785c`、衬线标题、`feature-card` 等；颜色/圆角/间距**用 CSS 变量**，不内联 hex（本计划给的 hex 仅作令牌定义）。
- 字体本地打包（`@fontsource`），不用远程字体（MV3 extension 页 `font-src` 默认 `'self'`）。
- 不引入 content script；不申请 `<all_urls>`；不保留 popup（统一 sidepanel）。
- 权限限定：`permissions: ['debugger','tabs','sidePanel','storage']`、`host_permissions: ['https://search.google.com/*','https://ahrefs.com/*']`。
- 测试命令统一 `pnpm test`（vitest）。每个任务结束 `git commit`，commit message 用约定式（`feat:`/`chore:`/`test:`/`refactor:`）。

---

## Phase 0 — 脚手架与设计系统

### Task 1: 项目配置与测试骨架

**Files:**
- Modify: `package.json`
- Modify: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `entrypoints/sidepanel/index.html`
- Create: `entrypoints/sidepanel/main.tsx`
- Create: `entrypoints/sidepanel/App.tsx`
- Delete: `entrypoints/popup/`（整个目录）

**Interfaces:**
- Produces: 可运行的 sidepanel 入口（占位 App）、可运行的 vitest（含 chrome/storage mock 的 setup）。后续所有 UI 任务依赖 sidepanel 入口；所有 lib 测试依赖 `tests/setup.ts` 的 `chrome` mock。

- [ ] **Step 1: 安装依赖**

Run:
```bash
pnpm add @fontsource/inter @fontsource/jetbrains-mono @fontsource/eb-garamond \
  && pnpm add -D vitest@^3 jsdom fake-indexeddb @testing-library/react \
     @testing-library/jest-dom @types/chrome
```
Expected: 依赖写入 `package.json`，无报错。

- [ ] **Step 2: 更新 package.json scripts**

把 `package.json` 的 `scripts` 改为：
```json
"scripts": {
  "dev": "wxt",
  "dev:firefox": "wxt -b firefox",
  "build": "wxt build",
  "build:firefox": "wxt build -b firefox",
  "zip": "wxt zip",
  "zip:firefox": "wxt zip -b firefox",
  "compile": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "postinstall": "wxt prepare"
}
```

- [ ] **Step 3: 写 vitest 配置**

Create `vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@lib': path.resolve(__dirname, 'lib'),
      '@components': path.resolve(__dirname, 'entrypoints/sidepanel/components'),
      '@pages': path.resolve(__dirname, 'entrypoints/sidepanel/pages'),
      '@hooks': path.resolve(__dirname, 'entrypoints/sidepanel/hooks'),
    },
  },
});
```

- [ ] **Step 4: 写测试 setup（chrome mock + indexeddb）**

Create `tests/setup.ts`：
```ts
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// chrome.storage.local 内存实现（兼容 callback 与 Promise 两种调用风格）
const memStore = new Map<string, unknown>();
const storageArea = {
  get(keys: string | string[] | null | object, cb?: (items: Record<string, unknown>) => void) {
    const out: Record<string, unknown> = {};
    const keyList = keys == null ? [...memStore.keys()] : Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [keys];
    for (const k of keyList) if (memStore.has(k)) out[k] = memStore.get(k);
    const result = out;
    cb?.(result);
    return Promise.resolve(result);
  },
  set(items: Record<string, unknown>, cb?: () => void) {
    for (const [k, v] of Object.entries(items)) memStore.set(k, v);
    cb?.();
    return Promise.resolve();
  },
  remove(keys: string | string[], cb?: () => void) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) memStore.delete(k);
    cb?.();
    return Promise.resolve();
  },
  clear(cb?: () => void) { memStore.clear(); cb?.(); return Promise.resolve(); },
};

function resetChromeMock() { memStore.clear(); }

const chromeMock = {
  storage: { local: storageArea, session: storageArea },
  runtime: {
    id: 'test-extension-id',
    onMessage: { addListener: () => {}, removeListener: () => {} },
    connect: () => ({ postMessage: () => {}, onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, disconnect: () => {} }),
    sendMessage: () => Promise.resolve(),
  },
  tabs: { create: () => Promise.resolve({ id: 1 }), query: () => Promise.resolve([]), remove: () => Promise.resolve() },
  debugger: { attach: () => Promise.resolve(), detach: () => Promise.resolve(), sendCommand: () => Promise.resolve({}) },
  sidePanel: { setPanelBehavior: () => Promise.resolve() },
};

Object.defineProperty(globalThis, 'chrome', { value: chromeMock, writable: true, configurable: true });

// 每个测试前重置 storage，避免用例间污染
beforeEach(() => { resetChromeMock(); });

export { resetChromeMock };
```

- [ ] **Step 5: 写占位 sidepanel 入口**

Create `entrypoints/sidepanel/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AutoSEO</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Create `entrypoints/sidepanel/main.tsx`：
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `entrypoints/sidepanel/App.tsx`（占位，Task 4 替换）：
```tsx
export default function App() {
  return <div style={{ padding: 24 }}>AutoSEO loading…</div>;
}
```

- [ ] **Step 6: 删除旧 popup 目录**

Run:
```bash
rm -rf entrypoints/popup
```
Expected: `entrypoints/popup/` 不再存在。

- [ ] **Step 7: 验证 sidepanel 可加载**

Run: `pnpm dev`
Expected: WXT 启动，控制台无入口缺失错误，浏览器加载扩展后 sidepanel 显示 "AutoSEO loading…"。确认后 Ctrl-C 退出。

- [ ] **Step 8: 验证测试可运行**

Create `tests/sanity.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
describe('sanity', () => {
  it('chrome mock 存在', () => {
    expect(chrome.storage.local).toBeDefined();
  });
});
```
Run: `pnpm test`
Expected: 1 passed。

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: 切换为 sidepanel 入口并搭建 vitest 测试骨架"
```

---

### Task 2: DESIGN.md 设计令牌与全局样式

**Files:**
- Create: `entrypoints/sidepanel/styles/tokens.css`
- Create: `entrypoints/sidepanel/styles/global.css`

**Interfaces:**
- Produces: `tokens.css` 暴露的 CSS 自定义属性（`--color-canvas`、`--color-primary`、`--radius-md`、`--space-md` 等），后续所有组件/页面引用这些变量。

- [ ] **Step 1: 写令牌文件**

Create `entrypoints/sidepanel/styles/tokens.css`：
```css
:root {
  /* color */
  --color-primary: #cc785c;
  --color-primary-active: #a9583e;
  --color-primary-disabled: #e6dfd8;
  --color-ink: #141413;
  --color-body: #3d3d3a;
  --color-body-strong: #252523;
  --color-muted: #6c6a64;
  --color-muted-soft: #8e8b82;
  --color-hairline: #e6dfd8;
  --color-hairline-soft: #ebe6df;
  --color-canvas: #faf9f5;
  --color-surface-soft: #f5f0e8;
  --color-surface-card: #efe9de;
  --color-surface-cream-strong: #e8e0d2;
  --color-surface-dark: #181715;
  --color-surface-dark-elevated: #252320;
  --color-on-primary: #ffffff;
  --color-on-dark: #faf9f5;
  --color-on-dark-soft: #a09d96;
  --color-success: #5db872;
  --color-warning: #d4a017;
  --color-error: #c64545;

  /* radius */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 9999px;

  /* spacing */
  --space-xxs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* typography */
  --font-serif: 'EB Garamond', 'Tiempos Headline', Georgia, 'Times New Roman', serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

- [ ] **Step 2: 写全局样式与字体引入**

Create `entrypoints/sidepanel/styles/global.css`：
```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/eb-garamond/400.css';
@import './tokens.css';

* { box-sizing: border-box; }

html, body, #root {
  margin: 0;
  height: 100%;
}

body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 {
  font-family: var(--font-serif);
  font-weight: 400;
  color: var(--color-ink);
  margin: 0;
}

button { font-family: var(--font-sans); cursor: pointer; }
button:disabled { cursor: not-allowed; }
```

> 字体均经 @fontsource 本地打包（包名如 `@fontsource/eb-garamond`），符合 MV3 `font-src 'self'`。

- [ ] **Step 3: 验证样式生效**

Run: `pnpm dev`，打开 sidepanel。
Expected: 页面背景为奶油色（#faf9f5），文字为暖深色。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): 引入 DESIGN.md 设计令牌与全局样式"
```

---

### Task 3: 基础 UI 组件库

**Files:**
- Create: `entrypoints/sidepanel/components/Button.tsx`
- Create: `entrypoints/sidepanel/components/TextInput.tsx`
- Create: `entrypoints/sidepanel/components/Select.tsx`
- Create: `entrypoints/sidepanel/components/Textarea.tsx`
- Create: `entrypoints/sidepanel/components/Card.tsx`
- Create: `entrypoints/sidepanel/components/Badge.tsx`
- Create: `entrypoints/sidepanel/components/TopBar.tsx`
- Test: `tests/components.test.tsx`

**Interfaces:**
- Produces（被 Task 4/7/8/14 消费）：
  - `<Button variant="primary"|"secondary" onClick disabled>` — 按钮
  - `<TextInput value onChange placeholder />`、`<Textarea value onChange rows />`、`<Select value onChange options:[{value,label}] />`
  - `<Card title subtitle onClick>` — 首页工具卡片（可点击）
  - `<Badge>{children}</Badge>`
  - `<TopBar onHome />` — 顶部 `✲ AutoSEO`，点击回首页

- [ ] **Step 1: 写 Button**

Create `entrypoints/sidepanel/components/Button.tsx`：
```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}
const styles: Record<string, React.CSSProperties> = {
  primary: { background: 'var(--color-primary)', color: 'var(--color-on-primary)', border: 'none' },
  secondary: { background: 'var(--color-canvas)', color: 'var(--color-ink)', border: '1px solid var(--color-hairline)' },
};
export default function Button({ variant = 'primary', style, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        height: 40, padding: '0 20px', borderRadius: 'var(--radius-md)',
        fontSize: 14, fontWeight: 500, lineHeight: 1, ...styles[variant], ...style,
      }}
    />
  );
}
```

- [ ] **Step 2: 写 TextInput / Textarea / Select**

Create `entrypoints/sidepanel/components/TextInput.tsx`：
```tsx
import { useState } from 'react';
export default function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        width: '100%', height: 40, padding: '0 14px',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: `1px solid ${focused ? 'var(--color-primary)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-md)', fontSize: 14, outline: 'none',
        ...props.style,
      }}
    />
  );
}
```

Create `entrypoints/sidepanel/components/Textarea.tsx`：
```tsx
export default function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%', padding: '10px 14px', resize: 'vertical',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
        fontSize: 14, lineHeight: 1.55, fontFamily: 'var(--font-mono)', ...props.style,
      }}
    />
  );
}
```

Create `entrypoints/sidepanel/components/Select.tsx`：
```tsx
interface Option { value: string; label: string; }
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Option[];
}
export default function Select({ options, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      style={{
        width: '100%', height: 40, padding: '0 10px',
        background: 'var(--color-canvas)', color: 'var(--color-ink)',
        border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
        fontSize: 14, ...rest.style,
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
```

- [ ] **Step 3: 写 Card / Badge / TopBar**

Create `entrypoints/sidepanel/components/Card.tsx`：
```tsx
interface CardProps {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}
export default function Card({ title, subtitle, onClick, children }: CardProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: 'var(--color-surface-card)', color: 'var(--color-ink)',
        border: 'none', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500 }}>{title}</div>
      {subtitle && <div style={{ color: 'var(--color-muted)', fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
      {children}
    </button>
  );
}
```

Create `entrypoints/sidepanel/components/Badge.tsx`：
```tsx
export default function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', background: 'var(--color-surface-card)', color: 'var(--color-ink)',
      fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-pill)', padding: '4px 12px',
    }}>{children}</span>
  );
}
```

Create `entrypoints/sidepanel/components/TopBar.tsx`：
```tsx
export default function TopBar({ onHome }: { onHome?: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: 'var(--space-md) var(--space-lg)',
      borderBottom: '1px solid var(--color-hairline-soft)',
    }}>
      <button onClick={onHome} style={{
        background: 'none', border: 'none', padding: 0,
        fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--color-ink)', cursor: 'pointer',
      }}>
        <span aria-hidden style={{ color: 'var(--color-ink)' }}>✲</span> AutoSEO
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 写组件渲染测试**

Create `tests/components.test.tsx`：
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../entrypoints/sidepanel/components/Button';
import Card from '../entrypoints/sidepanel/components/Card';

describe('Button', () => {
  it('渲染子节点并响应点击', () => {
    let clicked = false;
    render(<Button onClick={() => (clicked = true)}>开始</Button>);
    fireEvent.click(screen.getByText('开始'));
    expect(clicked).toBe(true);
  });
});

describe('Card', () => {
  it('点击触发 onClick', () => {
    let n = 0;
    render(<Card title="GSC" onClick={() => (n++)} />);
    fireEvent.click(screen.getByText('GSC'));
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test`
Expected: 2 passed。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): 基础组件库 Button/Input/Select/Textarea/Card/Badge/TopBar"
```

---

### Task 4: 侧边栏路由与首页卡片

**Files:**
- Modify: `entrypoints/sidepanel/App.tsx`
- Create: `entrypoints/sidepanel/pages/Home.tsx`

**Interfaces:**
- Produces: `App` 持有 `route` state（`'home' | 'gsc' | 'ahrefs' | 'projects'`），通过 `setRoute` 导航。各页面组件接收 `onBack: () => void` 回首页。

- [ ] **Step 1: 写 Home 页**

Create `entrypoints/sidepanel/pages/Home.tsx`：
```tsx
import Card from '../components/Card';
const TOOLS = [
  { key: 'gsc', title: 'GSC 批量提交', subtitle: '批量请求编入索引' },
  { key: 'ahrefs', title: 'Ahrefs KD 查询', subtitle: '关键词难度查询' },
  { key: 'projects', title: '项目管理', subtitle: '网站域名增删改' },
] as const;
export default function Home({ onNavigate }: { onNavigate: (r: 'gsc' | 'ahrefs' | 'projects') => void }) {
  return (
    <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {TOOLS.map((t) => (
        <Card key={t.key} title={t.title} subtitle={t.subtitle} onClick={() => onNavigate(t.key)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 App 路由**

Replace `entrypoints/sidepanel/App.tsx`：
```tsx
import { useState } from 'react';
import TopBar from './components/TopBar';
import Home from './pages/Home';
function GscPlaceholder({ onBack }: { onBack: () => void }) { return <Placeholder title="GSC" onBack={onBack} />; }
function AhrefsPlaceholder({ onBack }: { onBack: () => void }) { return <Placeholder title="Ahrefs" onBack={onBack} />; }
function ProjectsPlaceholder({ onBack }: { onBack: () => void }) { return <Placeholder title="项目管理" onBack={onBack} />; }
function Placeholder({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 12 }}>← 返回</button>
      <h2>{title}</h2>
    </div>
  );
}
export default function App() {
  const [route, setRoute] = useState<'home' | 'gsc' | 'ahrefs' | 'projects'>('home');
  const back = () => setRoute('home');
  return (
    <>
      <TopBar onHome={back} />
      {route === 'home' && <Home onNavigate={setRoute} />}
      {route === 'gsc' && <GscPlaceholder onBack={back} />}
      {route === 'ahrefs' && <AhrefsPlaceholder onBack={back} />}
      {route === 'projects' && <ProjectsPlaceholder onBack={back} />}
    </>
  );
}
```

- [ ] **Step 3: 验证导航**

Run: `pnpm dev`
Expected: sidepanel 首页显示三张卡片，点击进入对应占位页，点 ← 返回 / ✲ AutoSEO 回首页。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): sidepanel 路由与首页工具卡片"
```

---

## Phase 1 — 存储

### Task 5: storage lib（项目 CRUD + 设置）

**Files:**
- Create: `lib/storage/projects.ts`
- Create: `lib/storage/settings.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Produces（被 Task 7/8/14 消费）：
  - `getProjects(): Promise<Project[]>`
  - `addProject(domain: string, label?: string): Promise<Project>`
  - `updateProject(id: string, patch: Partial<Pick<Project,'domain'|'label'>>): Promise<void>`
  - `removeProject(id: string): Promise<void>`
  - `getSettings(): Promise<Settings>`、`updateSettings(patch: Partial<Settings>): Promise<void>`
  - 类型：`Project = { id: string; domain: string; label?: string; createdAt: number }`、`Settings = { accountIndex: number }`
  - domain 校验：合法域名正则 `/^([a-z0-9-]+\.)+[a-z]{2,}$/i`（不含协议/路径），`addProject`/`updateProject` 非法时抛 `Error('invalid domain')`。

- [ ] **Step 1: 写失败测试**

Create `tests/storage.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { getProjects, addProject, removeProject } from '../lib/storage/projects';
import { getSettings } from '../lib/storage/settings';

describe('projects', () => {
  it('新增并读取项目', async () => {
    const p = await addProject('bottleneck-checker.com');
    expect(p.domain).toBe('bottleneck-checker.com');
    expect(p.id).toBeTruthy();
    const all = await getProjects();
    expect(all).toHaveLength(1);
  });
  it('非法域名抛错', async () => {
    await expect(addProject('not a url')).rejects.toThrow('invalid domain');
  });
  it('删除项目', async () => {
    const p = await addProject('excelcompare.org');
    await removeProject(p.id);
    expect(await getProjects()).toHaveLength(0);
  });
});

describe('settings', () => {
  it('默认 accountIndex 为 0', async () => {
    expect((await getSettings()).accountIndex).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现 projects.ts**

Create `lib/storage/projects.ts`：
```ts
export interface Project { id: string; domain: string; label?: string; createdAt: number; }
const KEY = 'projects';
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

export function isValidDomain(d: string): boolean { return DOMAIN_RE.test(d.trim()); }

export async function getProjects(): Promise<Project[]> {
  const items = await chrome.storage.local.get(KEY);
  return (items[KEY] as Project[] | undefined) ?? [];
}

async function save(list: Project[]) { await chrome.storage.local.set({ [KEY]: list }); }

export async function addProject(domain: string, label?: string): Promise<Project> {
  const d = domain.trim();
  if (!isValidDomain(d)) throw new Error('invalid domain');
  const project: Project = { id: crypto.randomUUID(), domain: d, label: label?.trim() || undefined, createdAt: Date.now() };
  const list = await getProjects();
  list.push(project);
  await save(list);
  return project;
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'domain' | 'label'>>): Promise<void> {
  if (patch.domain != null && !isValidDomain(patch.domain)) throw new Error('invalid domain');
  const list = await getProjects();
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) throw new Error('project not found');
  list[i] = { ...list[i], ...patch };
  await save(list);
}

export async function removeProject(id: string): Promise<void> {
  const list = await getProjects();
  await save(list.filter((p) => p.id !== id));
}
```

- [ ] **Step 4: 写实现 settings.ts**

Create `lib/storage/settings.ts`：
```ts
export interface Settings { accountIndex: number; }
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };

export async function getSettings(): Promise<Settings> {
  const items = await chrome.storage.local.get(KEY);
  return { ...DEFAULT, ...(items[KEY] as Partial<Settings> | undefined) };
}
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await chrome.storage.local.set({ [KEY]: { ...cur, ...patch } });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: storage 用例全 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(storage): 项目 CRUD 与设置"
```

---

## Phase 2 — Ahrefs 工具

### Task 6: Ahrefs URL 拼接 lib

**Files:**
- Create: `lib/ahrefs/url.ts`
- Test: `tests/ahrefs-url.test.ts`

**Interfaces:**
- Produces：
  - `COUNTRIES: { code: string; label: string }[]` — 预置常用国家（code 小写两位）
  - `buildAhrefsUrl(country: string, keyword: string): string`
  - `isValidCountryCode(c: string): boolean`（小写两位字母）

- [ ] **Step 1: 写失败测试**

Create `tests/ahrefs-url.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { buildAhrefsUrl, isValidCountryCode, COUNTRIES } from '../lib/ahrefs/url';

describe('ahrefs url', () => {
  it('拼接示例链接', () => {
    expect(buildAhrefsUrl('us', 'apple')).toBe('https://ahrefs.com/keyword-difficulty/?country=us&input=apple');
  });
  it('关键词需 URL 编码', () => {
    expect(buildAhrefsUrl('uk', 'best laptop 2026')).toContain('input=best%20laptop%202026');
  });
  it('国家代码转小写', () => {
    expect(buildAhrefsUrl('US', 'apple')).toContain('country=us');
  });
  it('非法国家代码抛错', () => {
    expect(() => buildAhrefsUrl('usa', 'apple')).toThrow();
  });
  it('预置列表含 us/uk', () => {
    expect(COUNTRIES.some((c) => c.code === 'us')).toBe(true);
    expect(COUNTRIES.some((c) => c.code === 'uk')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

Create `lib/ahrefs/url.ts`：
```ts
export interface Country { code: string; label: string; }

export const COUNTRIES: Country[] = [
  { code: 'us', label: '美国 (US)' },
  { code: 'uk', label: '英国 (UK)' },
  { code: 'au', label: '澳洲 (AU)' },
  { code: 'ca', label: '加拿大 (CA)' },
  { code: 'in', label: '印度 (IN)' },
  { code: 'de', label: '德国 (DE)' },
  { code: 'fr', label: '法国 (FR)' },
  { code: 'jp', label: '日本 (JP)' },
  { code: 'br', label: '巴西 (BR)' },
  { code: 'es', label: '西班牙 (ES)' },
];

const CC_RE = /^[a-z]{2}$/i;
export function isValidCountryCode(c: string): boolean { return CC_RE.test(c); }

export function buildAhrefsUrl(country: string, keyword: string): string {
  const cc = country.trim().toLowerCase();
  if (!isValidCountryCode(cc)) throw new Error('invalid country code');
  const kw = keyword.trim();
  if (!kw) throw new Error('keyword required');
  return `https://ahrefs.com/keyword-difficulty/?country=${cc}&input=${encodeURIComponent(kw)}`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test`
Expected: ahrefs 用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ahrefs): 关键词难度查询 URL 拼接与国家列表"
```

---

### Task 7: Ahrefs 工具页

**Files:**
- Modify: `entrypoints/sidepanel/App.tsx`（替换占位）
- Create: `entrypoints/sidepanel/pages/AhrefsTool.tsx`

**Interfaces:**
- Consumes: `buildAhrefsUrl`、`COUNTRIES`、`isValidCountryCode`（Task 6）
- Produces: `AhrefsTool({ onBack })`，记住上次 country/keyword（存 `chrome.storage.local` key `ahrefs:last`）。

- [ ] **Step 1: 写 AhrefsTool**

Create `entrypoints/sidepanel/pages/AhrefsTool.tsx`：
```tsx
import { useEffect, useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import Select from '../components/Select';
import { COUNTRIES, buildAhrefsUrl, isValidCountryCode } from '@lib/ahrefs/url';

const STORAGE_KEY = 'ahrefs:last';
interface Last { country: string; keyword: string; }

export default function AhrefsTool({ onBack }: { onBack: () => void }) {
  const [country, setCountry] = useState('us');
  const [keyword, setKeyword] = useState('');
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      const last = items[STORAGE_KEY] as Last | undefined;
      if (last) { setCountry(last.country); setKeyword(last.keyword); }
    });
  }, []);

  const options = [...COUNTRIES.map((c) => ({ value: c.code, label: c.label })), { value: '__custom', label: '自定义…' }];

  function open() {
    try {
      const cc = country;
      const url = buildAhrefsUrl(cc, keyword);
      chrome.storage.local.set({ [STORAGE_KEY]: { country: cc, keyword } });
      chrome.tabs.create({ url });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 12 }}>← 返回</button>
      <h2 style={{ fontSize: 24, marginBottom: 'var(--space-lg)' }}>Ahrefs KD 查询</h2>

      <label style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', marginBottom: 6 }}>国家</label>
      <Select value={country} options={options} onChange={(e) => {
        if (e.target.value === '__custom') { setCustom(true); setCountry(''); }
        else { setCustom(false); setCountry(e.target.value); }
      }} />
      {custom && (
        <TextInput value={country} placeholder="两位代码，如 us" onChange={(e) => setCountry(e.target.value)} style={{ marginTop: 8 }} />
      )}

      <label style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', margin: 'var(--space-md) 0 6px' }}>关键词</label>
      <TextInput value={keyword} placeholder="如 apple" onChange={(e) => setKeyword(e.target.value)} />

      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 8 }}>{error}</div>}

      <Button onClick={open} disabled={!keyword.trim() || !isValidCountryCode(country)} style={{ marginTop: 'var(--space-lg)', width: '100%' }}>
        打开查询
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: 接入 App**

把 `App.tsx` 中的 `AhrefsPlaceholder` 替换为真实导入：
```tsx
import AhrefsTool from './pages/AhrefsTool';
// 删除 AhrefsPlaceholder 定义，并把渲染行改为：
{route === 'ahrefs' && <AhrefsTool onBack={back} />}
```

- [ ] **Step 3: 验证**

Run: `pnpm dev`
Expected: Ahrefs 页选 us + 输入 apple → 点"打开查询"在新标签打开正确 URL；重开 sidepanel 后选项回填。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ahrefs): Ahrefs KD 查询工具页（含记忆）"
```

---

## Phase 3 — 项目管理

### Task 8: useProjects hook 与项目管理页

**Files:**
- Create: `entrypoints/sidepanel/hooks/useProjects.ts`
- Create: `entrypoints/sidepanel/pages/Projects.tsx`
- Modify: `entrypoints/sidepanel/App.tsx`
- Test: `tests/useProjects.test.tsx`

**Interfaces:**
- Consumes: `getProjects`/`addProject`/`removeProject`/`updateProject`（Task 5）
- Produces: `useProjects()` → `{ projects, refresh, add, remove, update }`；`Projects({ onBack })` 页面。

- [ ] **Step 1: 写 useProjects**

Create `entrypoints/sidepanel/hooks/useProjects.ts`：
```ts
import { useCallback, useEffect, useState } from 'react';
import { getProjects, addProject, removeProject, updateProject, type Project } from '@lib/storage/projects';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const refresh = useCallback(() => { getProjects().then(setProjects); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const add = useCallback((domain: string, label?: string) => addProject(domain, label).then(refresh), [refresh]);
  const remove = useCallback((id: string) => removeProject(id).then(refresh), [refresh]);
  const update = useCallback((id: string, patch: { domain?: string; label?: string }) => updateProject(id, patch).then(refresh), [refresh]);
  return { projects, refresh, add, remove, update };
}
```

- [ ] **Step 2: 写 hook 测试**

Create `tests/useProjects.test.tsx`：
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjects } from '../entrypoints/sidepanel/hooks/useProjects';

describe('useProjects', () => {
  it('增删后刷新列表', async () => {
    const { result } = renderHook(() => useProjects());
    await act(async () => { await result.current.add('bottleneck-checker.com'); });
    expect(result.current.projects).toHaveLength(1);
    const id = result.current.projects[0].id;
    await act(async () => { await result.current.remove(id); });
    expect(result.current.projects).toHaveLength(0);
  });
});
```
> 需要 `@testing-library/react` 已含 `renderHook`（v13+ 在主包导出）。Task 1 已装。

- [ ] **Step 3: 运行测试**

Run: `pnpm test`
Expected: useProjects 用例 PASS。

- [ ] **Step 4: 写 Projects 页**

Create `entrypoints/sidepanel/pages/Projects.tsx`：
```tsx
import { useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import { useProjects } from '../hooks/useProjects';
import { isValidDomain } from '@lib/storage/projects';

export default function Projects({ onBack }: { onBack: () => void }) {
  const { projects, add, remove } = useProjects();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    try { await add(domain); setDomain(''); setError(''); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 12 }}>← 返回</button>
      <h2 style={{ fontSize: 24, marginBottom: 'var(--space-lg)' }}>项目管理</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
        <TextInput value={domain} placeholder="example.com" onChange={(e) => setDomain(e.target.value)} />
        <Button onClick={submit} disabled={!isValidDomain(domain)}>添加</Button>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.domain}</span>
            <button onClick={() => remove(p.id)} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer' }}>删除</button>
          </div>
        ))}
        {projects.length === 0 && <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>还没有项目</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 接入 App**

`App.tsx` 删除 `ProjectsPlaceholder`，改为：
```tsx
import Projects from './pages/Projects';
{route === 'projects' && <Projects onBack={back} />}
```

- [ ] **Step 6: 验证**

Run: `pnpm dev`
Expected: 添加 `bottleneck-checker.com` 出现在列表；删除生效；非法输入报错。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(projects): 项目管理页与 useProjects hook"
```

---

## Phase 4 — CDP 引擎

### Task 9: CDP client 与 actions 原语

**Files:**
- Create: `lib/cdp/client.ts`
- Create: `lib/cdp/actions.ts`
- Test: `tests/cdp.test.ts`

**Interfaces:**
- Produces（被 Task 12 消费）：
  - `client.ts`：`Target = { tabId: number }`；`attach(target)`、`detach(target)`、`send<T>(target, method, params?)`
  - `actions.ts`：
    - `waitForLoad(target, timeoutMs=30000)`
    - `evalJs<T>(target, expression): Promise<T>`（`Runtime.evaluate`，`returnByValue`+`awaitPromise`）
    - `waitForPredicate(target, jsPredicate, {timeoutMs, intervalMs=500}): Promise<boolean>`（轮询执行返回 boolean 的表达式）
    - `focusSelector(target, selector): Promise<boolean>`
    - `typeText(target, text)`（`Input.insertText`）
    - `pressEnter(target)`（`Input.dispatchKeyEvent` ×3）
    - `clickReal(target, selector): Promise<boolean>`（取坐标 + `Input.dispatchMouseEvent` ×2）

- [ ] **Step 1: 写失败测试**

Create `tests/cdp.test.ts`：
```ts
import { describe, it, expect, vi } from 'vitest';
import { send, attach, detach } from '../lib/cdp/client';
import { evalJs, typeText, pressEnter } from '../lib/cdp/actions';

describe('cdp client', () => {
  it('send 调用 chrome.debugger.sendCommand', async () => {
    const spy = vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValue({ result: { result: { value: 42 } } });
    const r = await send({ tabId: 1 }, 'Runtime.evaluate', { expression: '6*7' });
    expect(spy).toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.evaluate', { expression: '6*7' });
    expect((r as any).result.result.value).toBe(42);
    spy.mockRestore();
  });
  it('attach/detach 用 1.3', async () => {
    const a = vi.spyOn(chrome.debugger, 'attach').mockResolvedValue(undefined);
    const d = vi.spyOn(chrome.debugger, 'detach').mockResolvedValue(undefined);
    await attach({ tabId: 2 });
    expect(a).toHaveBeenCalledWith({ tabId: 2 }, '1.3');
    await detach({ tabId: 2 });
    expect(d).toHaveBeenCalledWith({ tabId: 2 });
    a.mockRestore(); d.mockRestore();
  });
});

describe('cdp actions', () => {
  it('evalJs 提取 value', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValue({ result: { result: { value: 'hello' } } });
    const v = await evalJs<string>({ tabId: 1 }, "'hello'");
    expect(v).toBe('hello');
  });
  it('typeText 用 Input.insertText', async () => {
    const spy = vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValue({});
    await typeText({ tabId: 1 }, 'apple');
    expect(spy).toHaveBeenCalledWith({ tabId: 1 }, 'Input.insertText', { text: 'apple' });
    spy.mockRestore();
  });
  it('pressEnter 派发 keyDown/char/keyUp', async () => {
    const spy = vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValue({});
    await pressEnter({ tabId: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 client.ts**

Create `lib/cdp/client.ts`：
```ts
export interface Target { tabId: number; }

export function attach(target: Target): Promise<void> {
  return chrome.debugger.attach(target, '1.3');
}
export function detach(target: Target): Promise<void> {
  return chrome.debugger.detach(target);
}
export function send<T = unknown>(target: Target, method: string, params: object = {}): Promise<T> {
  return chrome.debugger.sendCommand(target, method, params) as Promise<T>;
}
```

- [ ] **Step 4: 写 actions.ts**

Create `lib/cdp/actions.ts`：
```ts
import { send, type Target } from './client';

export async function waitForLoad(target: Target, timeoutMs = 30000): Promise<void> {
  await send(target, 'Page.enable');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await send<{ result?: { value?: string } }>(target, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result?.value === 'complete') return;
    await new Promise((res) => setTimeout(res, 500));
  }
}

export async function evalJs<T>(target: Target, expression: string): Promise<T> {
  const r = await send<{ result?: { result?: { value?: T }; exceptionDetails?: { text?: string } } }>(
    target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true },
  );
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'eval failed');
  return r.result!.result!.value as T;
}

export async function waitForPredicate(
  target: Target, jsPredicate: string, opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await evalJs<boolean>(target, `!!(${jsPredicate})`);
    if (ok) return true;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}

export async function focusSelector(target: Target, selector: string): Promise<boolean> {
  return evalJs<boolean>(target, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.scrollIntoView({block:'center'});el.focus();return true;})()`);
}

export function typeText(target: Target, text: string): Promise<void> {
  return send(target, 'Input.insertText', { text }).then(() => undefined);
}

export async function pressEnter(target: Target): Promise<void> {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send(target, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function clickReal(target: Target, selector: string): Promise<boolean> {
  const coord = await evalJs<{ x: number; y: number } | null>(target,
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!coord) return false;
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1 });
  return true;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test`
Expected: cdp 用例全 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(cdp): chrome.debugger 封装与高层动作原语"
```

---

## Phase 5 — CDP 探测先行（手动探索，固化选择器）

### Task 10: 用 web-access CDP 探测真实 GSC 流程

> 这是探索性任务，不写单元测试。目的：在写 `selectors.ts`/`flow.ts` 前，用 web-access skill 的外部 CDP（`http://localhost:3456`）在真实 GSC 页跑通单条 URL，验证并微调 Task 11 的文本探测表达式，记录真实交互细节（弹窗、成功提示文案）。

**Prerequisites:**
- web-access proxy 已启动（`node ~/.claude/skills/web-access/scripts/cdp-proxy.mjs &`），`curl -s http://localhost:3456/health` 返回 `connected: true`。
- 用户浏览器已登录拥有 `bottleneck-checker.com` 资源权限的 Google 账号。

**Inputs:**
- 项目域名：`bottleneck-checker.com`
- 测试 URL：`https://bottleneck-checker.com/es/`

**Outputs（记录进 `docs/superpowers/notes/gsc-probe.md`）：** 每个步骤的真实探测表达式（文本匹配为准）+ 等待条件 + 弹窗/成功提示文案，供 Task 11 固化。

- [ ] **Step 1: 确认 proxy 健康**

Run: `curl -s http://localhost:3456/health`
Expected: JSON 含 `"connected":true`。若 false，提示用户开启浏览器远程调试并重启 proxy。

- [ ] **Step 2: 打开 GSC 检查页（后台 tab）**

Run:
```bash
curl -s -X POST --data-raw 'https://search.google.com/u/0/search-console?resource_id=sc-domain%3Abottleneck-checker.com' http://localhost:3456/new
```
Expected: 返回 `{ "targetId": "..." }`，记下 `targetId`（下文记作 `$T`）。

- [ ] **Step 3: 探测 URL 检查输入框**

Run（替换 `$T`）：
```bash
curl -s -X POST "http://localhost:3456/eval?target=$T" -d "JSON.stringify({ hasInput: !!document.querySelector('input[type=text],input[type=url]'), ph: [...document.querySelectorAll('input')].map(i=>i.placeholder) })"
```
Expected: 返回页面顶部输入框的 placeholder 文案（用于定位"检查网址"输入框）。记录稳定定位表达式（优先 placeholder/aria-label 文本，而非动态 class）。目标产出形如：
```
inspectInput 定位: [...document.querySelectorAll('input')].find(i => /检查|inspect|url/i.test(i.placeholder||i.getAttribute('aria-label')||''))
```

- [ ] **Step 4: 输入测试 URL 并回车**

Run（先聚焦+填值，回车用真实手势或 dispatchEvent）：
```bash
curl -s -X POST "http://localhost:3456/eval?target=$T" -d "(()=>{const i=[...document.querySelectorAll('input')].find(x=>/检查|inspect/i.test(x.placeholder||'')); if(!i)return 'no input'; i.focus(); i.value='https://bottleneck-checker.com/es/'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 'submitted';})()"
```
Expected: `'submitted'`，页面进入 URL 检查 loading。

- [ ] **Step 5: 等待并探测"请求编入索引"按钮**

等待 ~5s 后 Run：
```bash
curl -s -X POST "http://localhost:3456/eval?target=$T" -d "JSON.stringify([...document.querySelectorAll('button,[role=button]')].map(b=>({t:(b.textContent||'').trim().slice(0,30),d:b.disabled})))"
```
Expected: 按钮文案列表中出现含"请求编入索引"或"Request indexing"的项。记录真实文案（中/英）与 disabled 状态，固化进 selectors.ts 的 `requestIndexingButton` 表达式。

- [ ] **Step 6: 点击按钮并探测后续弹窗/提示**

Run:
```bash
curl -s -X POST "http://localhost:3456/clickAt?target=$T" -d "$(curl -s -X POST "http://localhost:3456/eval?target=$T" -d "(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(x=>/请求编入索引|Request indexing/.test(x.textContent));return b?'button[data-probe]':'';})()" >/dev/null; echo '请求编入索引 文本匹配 selector 需在此步骤确认')"
```
> 若按钮无稳定 CSS selector，改用 `/eval` 直接 `b.click()` 再轮询弹窗。等待后探测页面 toast/确认按钮与"已成功提交"提示文案：
```bash
curl -s -X POST "http://localhost:3456/eval?target=$T" -d "JSON.stringify([...document.querySelectorAll('button,[role=button]')].map(b=>(b.textContent||'').trim()).concat([document.body.innerText.slice(-200)]))"
```
Expected: 记录弹窗确认按钮文案、成功提示文案。这些用于 `flow.ts` 的"提交完成"判定。

- [ ] **Step 7: 探测"重置"回到可输入态**

Run: 再次执行 Step 3 的探测，确认检查输入框是否已自动清空/可再次输入。记录是否需要手动清空（选中全删）。产出 `resetInput` 步骤的真实操作。

- [ ] **Step 8: 把探测结论写入笔记**

Create `docs/superpowers/notes/gsc-probe.md`，记录：每个步骤真实探测表达式、等待条件、文案、重置方式。**这些值将在 Task 11 校准进 `selectors.ts` 与 `flow.ts`。**

- [ ] **Step 9: 关闭探测 tab**

Run: `curl -s "http://localhost:3456/close?target=$T"`
Expected: `{ ... }` 成功关闭。

- [ ] **Step 10: Commit 笔记**

```bash
git add docs/superpowers/notes/gsc-probe.md && git commit -m "docs: GSC 真实页面 CDP 探测结论"
```

---

## Phase 6 — GSC 核心

### Task 11: GSC URL 拼接与 selectors

**Files:**
- Create: `lib/gsc/url.ts`
- Create: `lib/gsc/selectors.ts`
- Test: `tests/gsc-url.test.ts`

**Interfaces:**
- Produces：
  - `buildGscUrl(domain: string, accountIndex = 0): string`
  - `selectors.ts`：`PROBES` 对象，每个字段是一段**在页面执行的 JS 表达式**（文本优先匹配），返回元素或状态。初始版用通用文本匹配，**Task 10 探测结论校准后更新**。
  - 字段：`inspectInput`、`requestIndexingButton`、`isAlreadyIndexed`、`isQuota`、`isNotOwned`、`successIndicator`。

- [ ] **Step 1: 写失败测试**

Create `tests/gsc-url.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { buildGscUrl } from '../lib/gsc/url';
import { PROBES } from '../lib/gsc/selectors';

describe('gsc url', () => {
  it('拼接示例域名', () => {
    expect(buildGscUrl('bottleneck-checker.com')).toBe('https://search.google.com/u/0/search-console?resource_id=sc-domain%3Abottleneck-checker.com');
  });
  it('accountIndex 可改', () => {
    expect(buildGscUrl('excelcompare.org', 1)).toContain('/u/1/');
  });
});

describe('selectors', () => {
  it('PROBES 字段齐全', () => {
    for (const k of ['inspectInput', 'requestIndexingButton', 'isAlreadyIndexed', 'isQuota', 'successIndicator']) {
      expect(typeof PROBES[k as keyof typeof PROBES]).toBe('string');
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 url.ts**

Create `lib/gsc/url.ts`：
```ts
export function buildGscUrl(domain: string, accountIndex = 0): string {
  const d = domain.trim();
  if (!d) throw new Error('domain required');
  return `https://search.google.com/u/${accountIndex}/search-console?resource_id=${encodeURIComponent('sc-domain:' + d)}`;
}
```

- [ ] **Step 4: 写 selectors.ts（初始文本匹配版，Task 10 校准）**

Create `lib/gsc/selectors.ts`：
```ts
// 每个字段是一段在 GSC 页面执行的 JS 表达式（返回元素/boolean）。
// 文本优先匹配，规避 Google 动态 class 名。
// ⚠️ 首版实现后用 Task 10 的探测结论（docs/superpowers/notes/gsc-probe.md）校准真实文案。

const BTN_TEXT_INDEXING = '/请求编入索引|Request indexing/i';

export const PROBES = {
  // 检查输入框：按 placeholder/aria 文本定位
  inspectInput: `[...document.querySelectorAll('input')].find(i => /检查|inspect|url/i.test((i.placeholder||'') + ' ' + (i.getAttribute('aria-label')||'')))`,

  // "请求编入索引"按钮（可点）
  requestIndexingButton: `[...document.querySelectorAll('button,[role=button]')].find(b => ${BTN_TEXT_INDEXING}.test(b.textContent||'') && !b.disabled)`,

  // 已被索引（页面文案）
  isAlreadyIndexed: `/网址.*位于 Google|URL is on Google|已编入索引/i.test(document.body.innerText)`,

  // 配额提示
  isQuota: `/配额|quota|已达到|try again later/i.test(document.body.innerText)`,

  // 不属于此资源
  isNotOwned: `/不属于此资源|not a property|doesn.t belong/i.test(document.body.innerText)`,

  // 提交成功提示
  successIndicator: `/已请求|requested|已成功|successfully/i.test(document.body.innerText)`,
} as const;
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test`
Expected: gsc-url 用例全 PASS。

- [ ] **Step 6: 用 Task 10 探测结论校准**

打开 `docs/superpowers/notes/gsc-probe.md`，按真实文案/定位表达式更新 `PROBES` 各字段（替换上面的初始正则/定位）。重新 `pnpm test` 确认仍 PASS（测试只验字段为字符串）。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(gsc): URL 拼接与文本优先选择器（已用探测结论校准）"
```

---

### Task 12: GSC flow（单条步骤机 + 批量循环 + 配额熔断）

**Files:**
- Create: `lib/gsc/flow.ts`
- Test: `tests/gsc-flow.test.ts`

**Interfaces:**
- Consumes: cdp actions（Task 9）、`PROBES`（Task 11）
- Produces：
  - `type SubmitStatus = 'ok' | 'skipped'`
  - `interface SubmitResult { url: string; status: SubmitStatus; reason?: string }`
  - `interface FlowCallbacks { onProgress?: (s: { total: number; done: number; currentUrl?: string; results: SubmitResult[] }) => void; onLog?: (e: { level: 'info'|'warn'|'error'; phase: string; message: string }) => void; shouldStop?: () => boolean }`
  - `submitOne(target, url): Promise<SubmitResult>` — 单条步骤机
  - `runBatch(target, urls, cb): Promise<{ ok: number; failed: number; skipped: number }>` — 批量 + 连续 3 条配额熔断

- [ ] **Step 1: 写失败测试**

Create `tests/gsc-flow.test.ts`：
```ts
import { describe, it, expect, vi } from 'vitest';
import { submitOne, runBatch } from '../lib/gsc/flow';
import * as cdp from '../lib/cdp/actions';

function mockEvalSeq(values: unknown[]) {
  const q = [...values];
  vi.spyOn(cdp, 'evalJs').mockImplementation(async () => q.shift() as never);
  vi.spyOn(cdp, 'waitForLoad').mockResolvedValue(undefined);
  vi.spyOn(cdp, 'waitForPredicate').mockResolvedValue(true);
  vi.spyOn(cdp, 'focusSelector').mockResolvedValue(true);
  vi.spyOn(cdp, 'typeText').mockResolvedValue(undefined);
  vi.spyOn(cdp, 'pressEnter').mockResolvedValue(undefined);
  vi.spyOn(cdp, 'clickReal').mockResolvedValue(true);
}

describe('submitOne', () => {
  it('找到按钮并点击 → ok', async () => {
    mockEvalSeq([
      /* requestIndexingButton */ {},    // 找到按钮
      /* isAlreadyIndexed */ false,
      /* successIndicator */ true,        // 提交成功
    ]);
    const r = await submitOne({ tabId: 1 }, 'https://bottleneck-checker.com/es/');
    expect(r.status).toBe('ok');
  });
  it('已索引 → skipped', async () => {
    mockEvalSeq([null, /* isAlreadyIndexed */ true]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/已索引/);
  });
});

describe('runBatch', () => {
  it('连续 3 条配额信号熔断', async () => {
    // 每条 submitOne 命中 isQuota
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (expr.includes('isQuota')) return true as never;
      if (expr.includes('requestIndexingButton')) return null as never;
      return false as never;
    });
    vi.spyOn(cdp, 'waitForPredicate').mockResolvedValue(true);
    vi.spyOn(cdp, 'focusSelector').mockResolvedValue(true);
    vi.spyOn(cdp, 'typeText').mockResolvedValue(undefined);
    vi.spyOn(cdp, 'pressEnter').mockResolvedValue(undefined);
    const urls = Array.from({ length: 10 }, (_, i) => `https://bottleneck-checker.com/p${i}`);
    const summary = await runBatch({ tabId: 1 }, urls, {});
    expect(summary.skipped).toBe(urls.length); // 全部 skipped（前 3 条触发熔断，剩余跳过）
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 flow.ts**

Create `lib/gsc/flow.ts`：
```ts
import { clickReal, evalJs, focusSelector, pressEnter, typeText, waitForPredicate, type Target } from '../lib/cdp/actions';
import { PROBES } from './selectors';

export type SubmitStatus = 'ok' | 'skipped';
export interface SubmitResult { url: string; status: SubmitStatus; reason?: string }
export interface FlowCallbacks {
  onProgress?: (s: { total: number; done: number; currentUrl?: string; results: SubmitResult[] }) => void;
  onLog?: (e: { level: 'info' | 'warn' | 'error'; phase: string; message: string }) => void;
  shouldStop?: () => boolean;
}

const INSPECT_TIMEOUT = 30000;
const QUOTA_THRESHOLD = 3;

export async function submitOne(target: Target, url: string): Promise<SubmitResult> {
  const log = (phase: string, message: string, level: 'info' | 'warn' | 'error' = 'info') => {};
  // ① 输入
  await focusSelector(target, await firstSelectorFor(target, 'inspectInput'));
  await typeText(target, url);
  await pressEnter(target);

  // ② 等检查结果区出现（用任意结果信号作为就绪判据）
  await waitForPredicate(target, `(${PROBES.requestIndexingButton}) || (${PROBES.isAlreadyIndexed}) || (${PROBES.isQuota}) || (${PROBES.isNotOwned})`, { timeoutMs: INSPECT_TIMEOUT });

  // ③ 判定
  if (await evalJs<boolean>(target, PROBES.isAlreadyIndexed)) return { url, status: 'skipped', reason: '已索引' };
  if (await evalJs<boolean>(target, PROBES.isNotOwned)) return { url, status: 'skipped', reason: '不属于此域名' };
  if (await evalJs<boolean>(target, PROBES.isQuota)) return { url, status: 'skipped', reason: '配额' };

  const btn = await evalJs<HTMLElement | null>(target, PROBES.requestIndexingButton);
  if (!btn) return { url, status: 'skipped', reason: '无请求编入索引按钮' };

  // ④ 提交
  await clickReal(target, await selectorFromProbe(target, 'requestIndexingButton'));
  const ok = await waitForPredicate(target, PROBES.successIndicator, { timeoutMs: 15000 });
  return ok ? { url, status: 'ok' } : { url, status: 'skipped', reason: '提交未确认' };
}

export async function runBatch(target: Target, urls: string[], cb: FlowCallbacks): Promise<{ ok: number; failed: number; skipped: number }> {
  const results: SubmitResult[] = [];
  let quotaStreak = 0;
  let stopped = false;

  for (let i = 0; i < urls.length; i++) {
    if (cb.shouldStop?.()) { stopped = true; break; }
    const url = urls[i];
    cb.onLog?.({ level: 'info', phase: 'inspect', message: `[${i + 1}/${urls.length}] ${url}` });
    let r: SubmitResult;
    try {
      r = await submitOne(target, url);
    } catch (e) {
      r = { url, status: 'skipped', reason: (e as Error).message };
    }
    results.push(r);
    cb.onProgress?.({ total: urls.length, done: i + 1, currentUrl: url, results });

    if (r.reason === '配额') {
      quotaStreak++;
      if (quotaStreak >= QUOTA_THRESHOLD) {
        cb.onLog?.({ level: 'warn', phase: 'system', message: '连续配额信号，熔断剩余' });
        stopped = true;
        break;
      }
    } else {
      quotaStreak = 0;
    }
  }

  // 熔断或取消时，剩余计为 skipped
  if (stopped) {
    for (const u of urls.slice(results.length)) results.push({ url: u, status: 'skipped', reason: '未执行（批次终止）' });
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return { ok, failed: 0, skipped };
}

// 辅助：把 PROBES 里"返回元素"的表达式转成可定位用的伪 selector（供 focusSelector/clickReal）。
// GSC 用文本匹配，无 CSS selector —— 这里用 data 属性桥接：先 eval 打标记，再用属性 selector 定位。
async function firstSelectorFor(target: Target, key: keyof typeof PROBES): Promise<string> {
  await evalJs(target, `(()=>{document.querySelectorAll('[data-autoseo]').forEach(e=>e.removeAttribute('data-autoseo'));const el=(${PROBES[key]}); if(el){el.setAttribute('data-autoseo','1');} return true;})()`);
  return '[data-autoseo="1"]';
}
async function selectorFromProbe(target: Target, key: keyof typeof PROBES): Promise<string> {
  return firstSelectorFor(target, key);
}
```

> 说明：`focusSelector`/`clickReal` 接受 CSS selector，而 PROBES 是文本匹配 JS 表达式。桥接方式：先用 `evalJs` 给目标元素打 `data-autoseo="1"` 标记，再用 `[data-autoseo="1"]` 作为 selector 定位，操作完成后下次打标记前需先清除旧标记。若 Task 10 探测发现更稳的 CSS selector，可直接替换该桥接。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test`
Expected: gsc-flow 用例全 PASS。如不通过，按 mock 序列与 submitOne 的 evalJs 调用顺序对齐（参考实现中 ②→③ 的 eval 顺序）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(gsc): 单条步骤机、批量循环与配额熔断"
```

---

### Task 13: 消息协议与 background 编排

**Files:**
- Create: `lib/messaging/types.ts`
- Create: `lib/messaging/protocol.ts`
- Modify: `entrypoints/background.ts`
- Test: `tests/messaging.test.ts`

**Interfaces:**
- Produces：
  - `types.ts`：`GscRequest = GSC_START | GSC_CANCEL`；`GscEvent = GscState | GscLog | GscDone`（字段见 spec 第 6 节）
  - `protocol.ts`：`GSC_PORT_NAME = 'gsc-runner'`；`createGscPort(): chrome.runtime.Port`
  - `background.ts`：监听 `GSC_START` → 开后台 tab → attach → waitForLoad → 检查框就绪 → `runBatch`（经 port 推 GSC_STATE/GSC_LOG）→ detach → GSC_DONE。`GSC_CANCEL` 设置停止标志。

- [ ] **Step 1: 写失败测试**

Create `tests/messaging.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { GSC_PORT_NAME } from '../lib/messaging/protocol';
import type { GscRequest, GscEvent } from '../lib/messaging/types';

describe('messaging types', () => {
  it('GSC_START 结构', () => {
    const m: GscRequest = { type: 'GSC_START', projectId: 'p1', urls: ['https://x.com/'] };
    expect(m.type).toBe('GSC_START');
  });
  it('GscEvent 可赋值', () => {
    const e: GscEvent = { type: 'GSC_LOG', level: 'info', phase: 'inspect', message: 'ok' };
    expect(e.type).toBe('GSC_LOG');
  });
  it('port 名固定', () => {
    expect(GSC_PORT_NAME).toBe('gsc-runner');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL。

- [ ] **Step 3: 写 types.ts**

Create `lib/messaging/types.ts`：
```ts
export interface GscStart { type: 'GSC_START'; projectId: string; urls: string[] }
export interface GscCancel { type: 'GSC_CANCEL' }
export type GscRequest = GscStart | GscCancel;

export type SubmitStatus = 'ok' | 'skipped';
export interface SubmitResult { url: string; status: SubmitStatus; reason?: string }
export interface GscState {
  type: 'GSC_STATE';
  state: 'running' | 'done' | 'canceled';
  total: number; done: number; currentUrl?: string;
  results: SubmitResult[];
}
export interface GscLog { type: 'GSC_LOG'; level: 'info' | 'warn' | 'error'; phase: string; message: string }
export interface GscDone { type: 'GSC_DONE'; ok: number; failed: number; skipped: number }
export type GscEvent = GscState | GscLog | GscDone;
```

- [ ] **Step 4: 写 protocol.ts**

Create `lib/messaging/protocol.ts`：
```ts
export const GSC_PORT_NAME = 'gsc-runner';
export function createGscPort(): chrome.runtime.Port {
  return chrome.runtime.connect({ name: GSC_PORT_NAME });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: messaging 用例 PASS。

- [ ] **Step 6: 写 background 编排**

Replace `entrypoints/background.ts`：
```ts
import { attach, detach } from '../lib/cdp/client';
import { waitForLoad, evalJs, waitForPredicate } from '../lib/cdp/actions';
import { runBatch } from '../lib/gsc/flow';
import { buildGscUrl } from '../lib/gsc/url';
import { getProjectById } from '../lib/storage/projects';
import { getSettings } from '../lib/storage/settings';
import { PROBES } from '../lib/gsc/selectors';
import type { GscRequest, GscEvent } from '../lib/messaging/types';

export default defineBackground(() => {
  let stopRequested = false;
  let currentPort: chrome.runtime.Port | null = null;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'gsc-runner') return;
    currentPort = port;
    port.onMessage.addListener(async (msg: GscRequest) => {
      if (msg.type === 'GSC_START') await handleStart(port, msg);
      else if (msg.type === 'GSC_CANCEL') stopRequested = true;
    });
  });
});

function emit(port: chrome.runtime.Port, e: GscEvent) { port.postMessage(e); }

async function handleStart(port: chrome.runtime.Port, msg: { projectId: string; urls: string[] }) {
  stopRequested = false;
  const project = await getProjectById(msg.projectId);
  if (!project) { emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: '项目不存在' }); return; }
  const { accountIndex } = await getSettings();
  const url = buildGscUrl(project.domain, accountIndex);

  emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: '打开 GSC…' });
  const tab = await chrome.tabs.create({ url, active: false });
  const target = { tabId: tab.id! };
  await attach(target);
  try {
    await waitForLoad(target);
    await waitForPredicate(target, `!!(${PROBES.inspectInput})`, { timeoutMs: 30000 });

    const summary = await runBatch(target, msg.urls, {
      onProgress: (s) => emit(port, { type: 'GSC_STATE', state: 'running', total: s.total, done: s.done, currentUrl: s.currentUrl, results: s.results }),
      onLog: (e) => emit(port, { type: 'GSC_LOG', level: e.level, phase: e.phase, message: e.message }),
      shouldStop: () => stopRequested,
    });
    emit(port, { type: 'GSC_DONE', ...summary });
  } catch (e) {
    emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: (e as Error).message });
    emit(port, { type: 'GSC_DONE', ok: 0, failed: 1, skipped: 0 });
  } finally {
    await detach(target);
  }
}
```

- [ ] **Step 7: 补 storage 查询函数**

在 `lib/storage/projects.ts` 末尾追加（Step 6 的 background 依赖它）：
```ts
export async function getProjectById(id: string): Promise<Project | undefined> {
  return (await getProjects()).find((p) => p.id === id);
}
```

- [ ] **Step 8: 运行全部测试**

Run: `pnpm test`
Expected: 全 PASS。

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(background): GSC 批量编排与 port 事件推送"
```

---

### Task 14: GSC 工具页（useGscRunner + UI 订阅）

**Files:**
- Create: `entrypoints/sidepanel/components/LogPanel.tsx`
- Create: `entrypoints/sidepanel/hooks/useGscRunner.ts`
- Create: `entrypoints/sidepanel/pages/GscTool.tsx`
- Modify: `entrypoints/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `useProjects`（Task 8）、`createGscPort`/`GscEvent`（Task 13）
- Produces：
  - `useGscRunner()` → `{ state, logs, results, start(projectId, urls), cancel() }`
  - `GscTool({ onBack })`：项目下拉 + URL textarea + 开始/取消按钮 + 进度 Badge + LogPanel。

- [ ] **Step 1: 写 LogPanel**

Create `entrypoints/sidepanel/components/LogPanel.tsx`：
```tsx
interface LogEntry { level: 'info' | 'warn' | 'error'; phase: string; message: string }
const COLOR = { info: 'var(--color-on-dark-soft)', warn: 'var(--color-warning)', error: 'var(--color-error)' };
export default function LogPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <div style={{
      background: 'var(--color-surface-dark)', borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-md)', fontFamily: 'var(--font-mono)', fontSize: 12,
      color: 'var(--color-on-dark)', maxHeight: 200, overflow: 'auto',
    }}>
      {logs.length === 0 && <div style={{ color: 'var(--color-on-dark-soft)' }}>暂无日志</div>}
      {logs.map((l, i) => (
        <div key={i} style={{ color: COLOR[l.level], lineHeight: 1.6 }}>
          <span style={{ color: 'var(--color-on-dark-soft)' }}>[{l.phase}]</span> {l.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 useGscRunner**

Create `entrypoints/sidepanel/hooks/useGscRunner.ts`：
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { createGscPort } from '@lib/messaging/protocol';
import type { GscEvent, SubmitResult } from '@lib/messaging/types';

interface RunnerState { running: boolean; total: number; done: number; currentUrl?: string }
const IDLE: RunnerState = { running: false, total: 0, done: 0 };

export function useGscRunner() {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [state, setState] = useState<RunnerState>(IDLE);
  const [results, setResults] = useState<SubmitResult[]>([]);
  const [logs, setLogs] = useState<{ level: 'info' | 'warn' | 'error'; phase: string; message: string }[]>([]);

  useEffect(() => {
    const port = createGscPort();
    portRef.current = port;
    port.onMessage.addListener((e: GscEvent) => {
      if (e.type === 'GSC_STATE') {
        setState({ running: e.state === 'running', total: e.total, done: e.done, currentUrl: e.currentUrl });
        setResults(e.results);
      } else if (e.type === 'GSC_LOG') {
        setLogs((prev) => [...prev, { level: e.level, phase: e.phase, message: e.message }]);
      } else if (e.type === 'GSC_DONE') {
        setState(IDLE);
      }
    });
    return () => port.disconnect();
  }, []);

  const start = useCallback((projectId: string, urls: string[]) => {
    setLogs([]); setResults([]); setState({ running: true, total: urls.length, done: 0 });
    portRef.current?.postMessage({ type: 'GSC_START', projectId, urls });
  }, []);
  const cancel = useCallback(() => portRef.current?.postMessage({ type: 'GSC_CANCEL' }), []);

  return { state, results, logs, start, cancel };
}
```
listener 处理三种事件：GSC_STATE 更新进度与结果、GSC_LOG 追加日志、GSC_DONE 回到 idle。

- [ ] **Step 3: 写 GscTool**

Create `entrypoints/sidepanel/pages/GscTool.tsx`：
```tsx
import { useState } from 'react';
import Button from '../components/Button';
import Select from '../components/Select';
import Textarea from '../components/Textarea';
import Badge from '../components/Badge';
import LogPanel from '../components/LogPanel';
import { useProjects } from '../hooks/useProjects';
import { useGscRunner } from '../hooks/useGscRunner';

export default function GscTool({ onBack }: { onBack: () => void }) {
  const { projects } = useProjects();
  const { state, logs, start, cancel } = useGscRunner();
  const [projectId, setProjectId] = useState('');
  const [text, setText] = useState('');

  const urls = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const ready = !!projectId && urls.length > 0 && !state.running;

  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 12 }}>← 返回</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: 24 }}>GSC 批量提交</h2>
        {state.total > 0 && <Badge>{state.done}/{state.total}</Badge>}
      </div>

      <label style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', marginBottom: 6 }}>项目</label>
      <Select
        value={projectId}
        options={[{ value: '', label: '选择项目…' }, ...projects.map((p) => ({ value: p.id, label: p.domain }))]}
        onChange={(e) => setProjectId(e.target.value)}
      />

      <label style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', margin: 'var(--space-md) 0 6px' }}>链接（每行一条）</label>
      <Textarea rows={6} value={text} placeholder={'https://bottleneck-checker.com/es/\nhttps://bottleneck-checker.com/de/'} onChange={(e) => setText(e.target.value)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-lg)' }}>
        <Button onClick={() => start(projectId, urls)} disabled={!ready} style={{ flex: 1 }}>开始批量提交</Button>
        {state.running && <Button variant="secondary" onClick={cancel}>取消</Button>}
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 接入 App**

`App.tsx` 删除 `GscPlaceholder`，改为：
```tsx
import GscTool from './pages/GscTool';
{route === 'gsc' && <GscTool onBack={back} />}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(gsc): GSC 工具页与 useGscRunner 订阅"
```

---

## Phase 7 — 集成与端到端验证

### Task 15: manifest 权限、sidePanel 行为与端到端验证

**Files:**
- Modify: `wxt.config.ts`

**Interfaces:**
- Produces: 最终 manifest 含 `debugger`/`tabs`/`sidePanel`/`storage` 权限与 GSC/Ahrefs host_permissions；点击扩展图标打开 sidepanel。

- [ ] **Step 1: 写 manifest 配置**

Replace `wxt.config.ts`：
```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AutoSEO',
    description: 'SEO 快捷工具集合：GSC 批量提交 + Ahrefs KD 查询',
    permissions: ['debugger', 'tabs', 'sidePanel', 'storage'],
    host_permissions: ['https://search.google.com/*', 'https://ahrefs.com/*'],
    action: { default_title: 'AutoSEO' },
    side_panel: { default_path: 'sidepanel/index.html' },
  },
});
```

- [ ] **Step 2: background 启用 sidepanel 行为**

在 `entrypoints/background.ts` 的 `defineBackground` 回调顶部加入：
```ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

- [ ] **Step 3: 编译检查**

Run: `pnpm compile`
Expected: 无类型错误。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: `.output/chrome-mv3` 生成，无错误。

- [ ] **Step 5: 端到端验证（Ahrefs）**

Run: `pnpm dev`，在 sidepanel 的 Ahrefs 页选 us + 输入 apple → 打开查询。
Expected: 新标签打开 `https://ahrefs.com/keyword-difficulty/?country=us&input=apple`。

- [ ] **Step 6: 端到端验证（项目管理）**

在项目管理页添加 `bottleneck-checker.com`。
Expected: 列表显示该域名；GSC 页项目下拉出现该项。

- [ ] **Step 7: 端到端验证（GSC 批量）**

前置：浏览器已登录拥有 `bottleneck-checker.com` 权限的 Google 账号。在 GSC 页选 `bottleneck-checker.com`，粘贴：
```
https://bottleneck-checker.com/es/
```
点"开始批量提交"。
Expected: 后台开 GSC 标签（顶部出现调试横幅），侧边栏日志实时滚动进度，完成后显示 1/1 结果（ok 或 skipped+原因）。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: manifest 权限与 sidePanel 行为，完成端到端验证"
```

---

## Self-Review（已在编写时完成）

- **Spec 覆盖**：第 4 节模块结构 → Task 1-15 全覆盖；第 7 节 GSC 步骤机/选择器/熔断 → Task 10-12；第 8 节 Ahrefs → Task 6-7；第 9 节存储 → Task 5/8；第 10 节 UI 令牌 → Task 2-3；第 11 节 manifest → Task 15；第 12 节 CDP 探测先行 → Task 10；第 14 节测试 → 各 Task 的 TDD 步骤。
- **占位符**：无 TBD/TODO；UI 组件与 lib 均给完整代码。
- **类型一致**：`SubmitResult`/`FlowCallbacks` 在 flow.ts 与 messaging/types.ts 字段一致；`getProjectById` 在 storage 与 background 一致；`Target` 在 cdp 全链路一致。
- **已知校准点**：Task 10 探测结论会回填 Task 11 的 `PROBES` 真实文案——这是设计内的探测-固化循环，非占位符。
