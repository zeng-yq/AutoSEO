# 网站提交面板 UI 重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `SubmitPanel` 从「提交 / 查询进度」双 tab 重构为状态驱动的单一「提交中心」视图（空闲仪表盘 + 进行中覆盖层 + 完成报告卡），日志合并为统一时间流。

**Architecture:** 两态状态机（`idle` / `running`）+ 报告卡。`idle` 态主区 = `ProgressDashboard` 仪表盘，底部固定 `SubmitBar`；`running` 态 = `RunningOverlay` 全屏覆盖主区（步骤指示 + 统一日志流）。三路日志（SYS/GSC/BING）经纯函数 `mergeLogs` 在视图层合并。`useSubmitOrchestrator` / `useProgressQuery` / `lib/*` / background 全部不改。

**Tech Stack:** WXT + React 19 + TypeScript；vitest + @testing-library/react；inline-style + `tokens.css`。

## Global Constraints

- 测试用 `tests/setup.ts` 的 `chrome.storage.local` 内存 mock（setupFiles 自动应用，无需手动 import）。
- 测试文件放 `tests/`，用相对路径 import：`../entrypoints/...`、`../lib/...`。
- 组件代码用路径别名 `@lib/...`（vitest.config.ts 已配 `@lib` → `lib`）。
- 颜色仅用 `tokens.css` 既有变量：`--color-primary` `--color-primary-active` `--color-ink` `--color-body` `--color-muted` `--color-muted-soft` `--color-hairline` `--color-canvas` `--color-surface-soft` `--color-surface-card` `--color-surface-dark` `--color-on-dark` `--color-on-dark-soft` `--color-success` `--color-warning` `--color-error` `--color-on-primary`。圆角/间距用 `--radius-*` / `--space-*`。
- 不引入新依赖、不改 `useSubmitOrchestrator.ts` / `useProgressQuery.ts` / `lib/storage/*` / `lib/submit/{progress,filter,pick,reasons}.ts` / `lib/sitemap/*` / `entrypoints/background.ts`。
- 测试用例名用中文；commit message 用 `type(submit): 中文描述`。
- 单测：`npx vitest run tests/<file>`；全量：`pnpm test`；类型：`pnpm compile`。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `lib/submit/logs.ts` | `mergeLogs()` 纯函数 + `UnifiedLogEntry` / `LogPlatform` 类型 |
| `entrypoints/sidepanel/components/UnifiedLogPanel.tsx` | 统一日志面板（接收 `UnifiedLogEntry[]`，平台色标签，一套 filter） |
| `entrypoints/sidepanel/components/BatchReportCard.tsx` | 完成报告卡（汇总 + 失败明细 + 关闭） |
| `entrypoints/sidepanel/components/SubmitBar.tsx` | 底部固定提交条（平台 chip + 提交/取消） |
| `entrypoints/sidepanel/components/ProgressDashboard.tsx` | 仪表盘主体（进度卡 + 筛选 + 明细 + 空态） |
| `entrypoints/sidepanel/components/RunningOverlay.tsx` | 进行中态覆盖层（步骤指示 + 进度 + 日志） |
| `entrypoints/sidepanel/pages/SubmitPanel.tsx` | 状态机编排，挂载上述组件 |
| `entrypoints/sidepanel/components/ProgressPanel.tsx` | 删除（功能迁入 `ProgressDashboard`） |

---

### Task 1: `mergeLogs` 三路日志合并纯函数

**Files:**
- Create: `lib/submit/logs.ts`
- Test: `tests/merge-logs.test.ts`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `mergeLogs(sys, gsc, bing)`、类型 `UnifiedLogEntry` / `LogPlatform` / `SrcLogEntry`

- [ ] **Step 1: 写失败测试**

创建 `tests/merge-logs.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { mergeLogs } from '../lib/submit/logs';

const L = (ts: number, message: string, level: 'info' | 'warn' | 'error' = 'info') => ({ level, phase: 'p', message, ts });

describe('mergeLogs', () => {
  it('三路按 ts 升序合并', () => {
    const r = mergeLogs([L(3, 's3')], [L(1, 'g1')], [L(2, 'b2')]);
    expect(r.map((x) => x.message)).toEqual(['g1', 'b2', 's3']);
  });

  it('同 ts 时稳定顺序 sys→gsc→bing', () => {
    const r = mergeLogs([L(5, 's')], [L(5, 'g')], [L(5, 'b')]);
    expect(r.map((x) => x.message)).toEqual(['s', 'g', 'b']);
  });

  it('任一路为空正常工作', () => {
    const r = mergeLogs([L(1, 's1')], [], []);
    expect(r.map((x) => x.message)).toEqual(['s1']);
    expect(r[0].platform).toBe('sys');
  });

  it('全空返回空数组', () => {
    expect(mergeLogs([], [], [])).toEqual([]);
  });

  it('每条带正确 platform 标签', () => {
    const r = mergeLogs([L(1, 's')], [L(2, 'g')], [L(3, 'b')]);
    expect(r.map((x) => x.platform)).toEqual(['sys', 'gsc', 'bing']);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/merge-logs.test.ts`
Expected: FAIL —— `mergeLogs` 未定义 / 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `lib/submit/logs.ts`：

```ts
export type LogPlatform = 'sys' | 'gsc' | 'bing';

export interface SrcLogEntry {
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
  ts: number;
}

export interface UnifiedLogEntry extends SrcLogEntry {
  platform: LogPlatform;
}

/**
 * 三路日志（系统 / GSC / Bing）按 ts 升序稳定合并为统一时间流。
 * 同 ts 时保持 sys → gsc → bing 的输入相对顺序（稳定排序）。
 * 纯函数，不读外部状态、不引入随机/时间。
 */
export function mergeLogs(sys: SrcLogEntry[], gsc: SrcLogEntry[], bing: SrcLogEntry[]): UnifiedLogEntry[] {
  const withSeq: Array<{ entry: UnifiedLogEntry; seq: number }> = [];
  let seq = 0;
  const push = (arr: SrcLogEntry[], platform: LogPlatform) => {
    for (const l of arr) withSeq.push({ entry: { ...l, platform }, seq: seq++ });
  };
  push(sys, 'sys');
  push(gsc, 'gsc');
  push(bing, 'bing');
  withSeq.sort((a, b) => a.entry.ts - b.entry.ts || a.seq - b.seq);
  return withSeq.map((x) => x.entry);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/merge-logs.test.ts`
Expected: PASS（5 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add lib/submit/logs.ts tests/merge-logs.test.ts
git commit -m "feat(submit): 新增 mergeLogs 三路日志合并纯函数"
```

---

### Task 2: `UnifiedLogPanel` 组件

**Files:**
- Create: `entrypoints/sidepanel/components/UnifiedLogPanel.tsx`
- Test: `tests/unified-log-panel.test.tsx`

**Interfaces:**
- Consumes: `UnifiedLogEntry` / `LogPlatform`（来自 Task 1 的 `lib/submit/logs`）
- Produces: `UnifiedLogPanel({ logs: UnifiedLogEntry[] })`

- [ ] **Step 1: 写失败测试**

创建 `tests/unified-log-panel.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnifiedLogPanel from '../entrypoints/sidepanel/components/UnifiedLogPanel';
import type { UnifiedLogEntry } from '../lib/submit/logs';

const E = (over: Partial<UnifiedLogEntry>): UnifiedLogEntry => ({
  ts: 0, level: 'info', phase: 'p', message: '', platform: 'sys', ...over,
});

describe('UnifiedLogPanel', () => {
  it('渲染每条日志的消息与平台标签', () => {
    render(<UnifiedLogPanel logs={[E({ message: '抓取完成', platform: 'sys' }), E({ message: '已提交', platform: 'gsc' })]} />);
    expect(screen.getByText('抓取完成')).toBeInTheDocument();
    expect(screen.getByText('已提交')).toBeInTheDocument();
    expect(screen.getByText('[GSC]')).toBeInTheDocument();
  });

  it('空日志显示「暂无日志」', () => {
    render(<UnifiedLogPanel logs={[]} />);
    expect(screen.getByText('暂无日志')).toBeInTheDocument();
  });

  it('filter 切换只显示对应级别', () => {
    render(<UnifiedLogPanel logs={[E({ message: '正常', level: 'info' }), E({ message: '出错了', level: 'error' })]} />);
    expect(screen.getByText('正常')).toBeInTheDocument();
    fireEvent.click(screen.getByText('error'));
    expect(screen.queryByText('正常')).not.toBeInTheDocument();
    expect(screen.getByText('出错了')).toBeInTheDocument();
  });

  it('warn 日志默认折叠为两行，点击展开', () => {
    const long = 'X'.repeat(200);
    render(<UnifiedLogPanel logs={[E({ message: long, level: 'warn' })]} />);
    const row = screen.getByText(long);
    expect(row.style.display).toBe('-webkit-box');
    fireEvent.click(row);
    expect(row.style.display).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/unified-log-panel.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `entrypoints/sidepanel/components/UnifiedLogPanel.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import type { UnifiedLogEntry, LogPlatform } from '@lib/submit/logs';

const LEVEL_COLOR: Record<UnifiedLogEntry['level'], string> = {
  info: 'var(--color-on-dark-soft)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

const PLATFORM_COLOR: Record<LogPlatform, string> = {
  sys: 'var(--color-on-dark-soft)',
  gsc: 'var(--color-primary)',
  bing: 'var(--color-success)',
};

const PLATFORM_LABEL: Record<LogPlatform, string> = { sys: 'SYS', gsc: 'GSC', bing: 'BING' };

const LEVELS = ['all', 'info', 'warn', 'error'] as const;
type Filter = (typeof LEVELS)[number];
const LABEL: Record<Filter, string> = { all: '全部', info: 'info', warn: 'warn', error: 'error' };

function tsLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function UnifiedLogPanel({ logs }: { logs: UnifiedLogEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  const visible = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  return (
    <div style={{
      background: 'var(--color-surface-dark)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-xs)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-on-dark)',
    }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {LEVELS.map((lv) => (
          <button key={lv} onClick={() => { setFilter(lv); setExpanded({}); }} style={{
            padding: '2px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-on-dark-soft)',
            background: filter === lv ? 'var(--color-primary)' : 'transparent',
            color: filter === lv ? 'var(--color-on-primary)' : 'var(--color-on-dark-soft)',
            cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>{LABEL[lv]}</button>
        ))}
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {visible.length === 0 && <div style={{ color: 'var(--color-on-dark-soft)' }}>暂无日志</div>}
        {visible.map((l, i) => {
          const detail = l.level === 'warn' || l.level === 'error';
          const open = !!expanded[i];
          return (
            <div key={i} style={{ color: LEVEL_COLOR[l.level], lineHeight: 1.6, cursor: detail ? 'pointer' : 'default' }}
              onClick={() => detail && setExpanded((p) => ({ ...p, [i]: !p[i] }))}>
              <span style={{ color: 'var(--color-on-dark-soft)' }}>[{tsLabel(l.ts)}]</span>{' '}
              <span style={{ color: PLATFORM_COLOR[l.platform] }}>[{PLATFORM_LABEL[l.platform]}]</span>{' '}
              <span style={detail && !open ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>
                {l.message}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/unified-log-panel.test.tsx`
Expected: PASS（4 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/UnifiedLogPanel.tsx tests/unified-log-panel.test.tsx
git commit -m "feat(submit): 新增 UnifiedLogPanel 统一日志面板"
```

---

### Task 3: `BatchReportCard` 完成报告卡

**Files:**
- Create: `entrypoints/sidepanel/components/BatchReportCard.tsx`
- Test: `tests/batch-report-card.test.tsx`

**Interfaces:**
- Consumes: `ReportItem`（来自 `entrypoints/sidepanel/hooks/useSubmitOrchestrator`）；`classifyResult` / `Outcome`（来自 `lib/submit/reasons`）
- Produces: `BatchReportCard({ report: ReportItem[]; onClose: () => void })`

- [ ] **Step 1: 写失败测试**

创建 `tests/batch-report-card.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchReportCard from '../entrypoints/sidepanel/components/BatchReportCard';
import type { ReportItem } from '../entrypoints/sidepanel/hooks/useSubmitOrchestrator';

const R = (over: Partial<ReportItem>): ReportItem => ({ url: '', platform: 'gsc', status: 'ok', ...over });

describe('BatchReportCard', () => {
  it('汇总条计数成功/失败/跳过', () => {
    render(<BatchReportCard report={[
      R({ url: 'https://x/a', status: 'ok' }),
      R({ url: 'https://x/b', status: 'skipped', reason: '已索引' }),
      R({ url: 'https://x/c', status: 'skipped', reason: '检查结果未出现' }),
    ]} onClose={() => {}} />);
    expect(screen.getByText(/本批 3 · 成功 1 · 失败 1 · 跳过 1/)).toBeInTheDocument();
  });

  it('失败明细带 reason', () => {
    render(<BatchReportCard report={[R({ url: 'https://x/p1', platform: 'gsc', status: 'skipped', reason: '检查结果未出现' })]} onClose={() => {}} />);
    expect(screen.getByText(/p1（gsc：检查结果未出现）/)).toBeInTheDocument();
  });

  it('× 触发 onClose', () => {
    const onClose = vi.fn();
    render(<BatchReportCard report={[R({ url: '/a', status: 'ok' })]} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('跳过不列详情', () => {
    render(<BatchReportCard report={[R({ url: 'https://x/a', status: 'skipped', reason: '已索引' })]} onClose={() => {}} />);
    expect(screen.queryByText(/https:\/\/x\/a/)).not.toBeInTheDocument();
  });

  it('成功不列详情仅计数', () => {
    render(<BatchReportCard report={[R({ url: 'https://x/a', status: 'ok' })]} onClose={() => {}} />);
    expect(screen.getByText(/成功 1/)).toBeInTheDocument();
    expect(screen.queryByText('✗')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/batch-report-card.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `entrypoints/sidepanel/components/BatchReportCard.tsx`：

```tsx
import { classifyResult, type Outcome } from '@lib/submit/reasons';
import type { ReportItem } from '../hooks/useSubmitOrchestrator';

export interface BatchReportCardProps {
  report: ReportItem[];
  onClose: () => void;
}

export default function BatchReportCard({ report, onClose }: BatchReportCardProps) {
  const counts: Record<Outcome, number> = { ok: 0, failed: 0, skipped: 0 };
  const failures: ReportItem[] = [];
  for (const r of report) {
    const o = classifyResult(r);
    counts[o]++;
    if (o === 'failed') failures.push(r);
  }

  return (
    <div style={{
      border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-sm)', background: 'var(--color-surface-soft)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: failures.length > 0 ? 6 : 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)' }}>
          本批 {report.length} · 成功 {counts.ok} · 失败 {counts.failed} · 跳过 {counts.skipped}
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} style={{
          border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer',
          fontSize: 16, lineHeight: 1, padding: 0,
        }}>×</button>
      </div>
      {failures.length > 0 && (
        <div style={{ color: 'var(--color-error)', fontSize: 12, lineHeight: 1.6 }}>
          {failures.map((r) => (
            <div key={`${r.platform}-${r.url}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✗ {r.url}（{r.platform}{r.reason ? `：${r.reason}` : ''}）
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/batch-report-card.test.tsx`
Expected: PASS（5 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/BatchReportCard.tsx tests/batch-report-card.test.tsx
git commit -m "feat(submit): 新增 BatchReportCard 完成报告卡"
```

---

### Task 4: `SubmitBar` 底部固定提交条

**Files:**
- Create: `entrypoints/sidepanel/components/SubmitBar.tsx`
- Test: `tests/submit-bar.test.tsx`

**Interfaces:**
- Consumes: `PlatformChip`（`{ label, icon, checked, onToggle }`）、`Button`（`{ variant?, disabled?, onClick?, style? }`）、`GscMark` / `BingMark`（来自 `./icons`）
- Produces: `SubmitBar({ gsc, bing, onToggleGsc, onToggleBing, onSubmit, onCancel, busy, ready })`

- [ ] **Step 1: 写失败测试**

创建 `tests/submit-bar.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubmitBar from '../entrypoints/sidepanel/components/SubmitBar';

const noop = () => {};

describe('SubmitBar', () => {
  it('点击「一次提交」触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(<SubmitBar gsc bing onToggleGsc={noop} onToggleBing={noop} onSubmit={onSubmit} onCancel={noop} busy={false} ready={true} />);
    fireEvent.click(screen.getByText('一次提交 10 个'));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('ready=false 时提交禁用', () => {
    render(<SubmitBar gsc bing onToggleGsc={noop} onToggleBing={noop} onSubmit={noop} onCancel={noop} busy={false} ready={false} />);
    expect(screen.getByText('一次提交 10 个')).toBeDisabled();
  });

  it('busy 时文案「提交中…」并出现取消按钮', () => {
    render(<SubmitBar gsc bing onToggleGsc={noop} onToggleBing={noop} onSubmit={noop} onCancel={noop} busy={true} ready={false} />);
    expect(screen.getByText('提交中…')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('点击 GSC chip 触发 onToggleGsc', () => {
    const onToggleGsc = vi.fn();
    render(<SubmitBar gsc bing onToggleGsc={onToggleGsc} onToggleBing={noop} onSubmit={noop} onCancel={noop} busy={false} ready={true} />);
    fireEvent.click(screen.getByText('GSC'));
    expect(onToggleGsc).toHaveBeenCalledOnce();
  });

  it('取消按钮触发 onCancel', () => {
    const onCancel = vi.fn();
    render(<SubmitBar gsc bing onToggleGsc={noop} onToggleBing={noop} onSubmit={noop} onCancel={onCancel} busy={true} ready={false} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/submit-bar.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `entrypoints/sidepanel/components/SubmitBar.tsx`：

```tsx
import Button from './Button';
import PlatformChip from './PlatformChip';
import { GscMark, BingMark } from './icons';

export interface SubmitBarProps {
  gsc: boolean;
  bing: boolean;
  onToggleGsc: () => void;
  onToggleBing: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  ready: boolean;
}

export default function SubmitBar({ gsc, bing, onToggleGsc, onToggleBing, onSubmit, onCancel, busy, ready }: SubmitBarProps) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, display: 'flex', gap: 8, alignItems: 'center',
      padding: 'var(--space-xs) 0', background: 'var(--color-canvas)',
      borderTop: '1px solid var(--color-hairline)',
    }}>
      <PlatformChip label="GSC" icon={<GscMark />} checked={gsc} onToggle={onToggleGsc} />
      <PlatformChip label="Bing" icon={<BingMark />} checked={bing} onToggle={onToggleBing} />
      <Button onClick={onSubmit} disabled={!ready} style={{ flex: 1 }}>
        {busy ? '提交中…' : '一次提交 10 个'}
      </Button>
      {busy && <Button variant="secondary" onClick={onCancel}>取消</Button>}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/submit-bar.test.tsx`
Expected: PASS（5 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/SubmitBar.tsx tests/submit-bar.test.tsx
git commit -m "feat(submit): 新增 SubmitBar 底部固定提交条"
```

---

### Task 5: `ProgressDashboard` 仪表盘组件

**Files:**
- Create: `entrypoints/sidepanel/components/ProgressDashboard.tsx`
- Create: `tests/progress-dashboard.test.tsx`
- Delete: `tests/progresspanel.test.tsx`（功能迁入新组件，避免测试 import 旧 `ProgressPanel`）

**Interfaces:**
- Consumes: `useProgressQuery`（`{ state, refresh }`）、`Button`、`ProgressItem`（来自 `lib/submit/progress`）
- Produces: `ProgressDashboard({ domain: string; sitemapUrl: string })`

- [ ] **Step 1: 写失败测试**

创建 `tests/progress-dashboard.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const refresh = vi.fn();
const mock: { state: any; refresh: typeof refresh } = { state: { loading: false }, refresh };
vi.mock('../entrypoints/sidepanel/hooks/useProgressQuery', () => ({
  useProgressQuery: () => mock,
}));

import ProgressDashboard from '../entrypoints/sidepanel/components/ProgressDashboard';

const REPORT = {
  total: 2,
  platforms: [
    { platform: 'gsc' as const, done: 1, total: 2, pending: 1 },
    { platform: 'bing' as const, done: 0, total: 2, pending: 2 },
  ],
  items: [
    { url: 'https://example.com/a', gsc: 'done' as const, bing: 'pending' as const },
    { url: 'https://example.com/b', gsc: 'pending' as const, bing: 'pending' as const },
  ],
  stale: [] as Array<{ url: string; platform: 'gsc' | 'bing' }>,
};

beforeEach(() => {
  refresh.mockReset();
  mock.state = { loading: false };
});

describe('ProgressDashboard', () => {
  it('点击「刷新」调用 refresh(sitemapUrl)', () => {
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    fireEvent.click(screen.getByText('刷新'));
    expect(refresh).toHaveBeenCalledWith('https://example.com/sitemap.xml');
  });

  it('loading 时按钮禁用且文案「抓取中…」', () => {
    mock.state = { loading: true };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('抓取中…')).toBeDisabled();
  });

  it('sitemapUrl 为空时刷新按钮禁用', () => {
    render(<ProgressDashboard domain="example.com" sitemapUrl="" />);
    expect(screen.getByText('刷新')).toBeDisabled();
  });

  it('有 report 时显示分平台进度与百分比', () => {
    mock.state = { loading: false, report: REPORT };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('GSC')).toBeInTheDocument();
    expect(screen.getByText(/1\/2（50%/)).toBeInTheDocument();
    expect(screen.getByText(/0\/2（0%/)).toBeInTheDocument();
  });

  it('diff 存在时显示对账摘要与相对时间', () => {
    mock.state = { loading: false, report: REPORT, diff: { added: ['x'], removed: ['y'], unchanged: ['z'] }, updatedAt: Date.now() - 7200000 };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/本次新增 1 · 清理 1 · 未变 1/)).toBeInTheDocument();
    expect(screen.getByText(/2h前/)).toBeInTheDocument();
  });

  it('error 存在时显示错误条', () => {
    mock.state = { loading: false, error: '抓取失败' };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText('抓取失败')).toBeInTheDocument();
  });

  it('无 report 时显示空态', () => {
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/还没有进度数据/)).toBeInTheDocument();
  });

  it('筛选「GSC未提交」只显示 gsc=pending 的子集', () => {
    mock.state = { loading: false, report: REPORT };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/example\.com\/a/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('GSC未提交'));
    expect(screen.queryByText(/example\.com\/a/)).not.toBeInTheDocument();
    expect(screen.getByText(/example\.com\/b/)).toBeInTheDocument();
  });

  it('超过 100 条时显示「加载更多」并追加', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ url: `https://example.com/p${i}`, gsc: 'pending' as const, bing: 'pending' as const }));
    mock.state = { loading: false, report: { ...REPORT, items } };
    render(<ProgressDashboard domain="example.com" sitemapUrl="https://example.com/sitemap.xml" />);
    expect(screen.getByText(/加载更多（剩余 50）/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/加载更多/));
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/progress-dashboard.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `entrypoints/sidepanel/components/ProgressDashboard.tsx`：

```tsx
import { useState } from 'react';
import Button from './Button';
import { useProgressQuery } from '../hooks/useProgressQuery';
import type { ProgressItem } from '@lib/submit/progress';

const PAGE = 100;

type Filter = 'all' | 'gsc-pending' | 'bing-pending' | 'stale';

export interface ProgressDashboardProps {
  domain: string;
  sitemapUrl: string;
}

interface Row { key: string; left: string; right: string; stale?: boolean; }

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3_600_000);
  if (h >= 1) return `${h}h前`;
  const m = Math.floor(diff / 60_000);
  if (m >= 1) return `${m}m前`;
  return '刚刚';
}

export default function ProgressDashboard({ domain, sitemapUrl }: ProgressDashboardProps) {
  const { state, refresh } = useProgressQuery(domain);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE);

  const report = state.report;
  const canRefresh = sitemapUrl.trim().length > 0 && domain.trim().length > 0 && !state.loading;

  let rows: Row[] = [];
  if (report) {
    if (filter === 'stale') {
      rows = report.stale.map((s) => ({ key: `${s.platform}|${s.url}`, left: s.url, right: s.platform, stale: true }));
    } else {
      let items: ProgressItem[] = report.items;
      if (filter === 'gsc-pending') items = items.filter((i) => i.gsc === 'pending');
      else if (filter === 'bing-pending') items = items.filter((i) => i.bing === 'pending');
      rows = items.map((i) => ({ key: i.url, left: i.url, right: `GSC${i.gsc === 'done' ? '✓' : '✗'} Bing${i.bing === 'done' ? '✓' : '✗'}` }));
    }
  }

  const filters: Array<[Filter, string]> = [
    ['all', '全部'],
    ['gsc-pending', 'GSC未提交'],
    ['bing-pending', 'Bing未提交'],
    ['stale', `已不在sitemap(${report?.stale.length ?? 0})`],
  ];

  return (
    <div>
      {/* 进度卡 */}
      <div style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)' }}>提交进度</span>
          <Button variant="secondary" onClick={() => void refresh(sitemapUrl.trim())} disabled={!canRefresh}>
            {state.loading ? '抓取中…' : '刷新'}
          </Button>
        </div>
        {state.error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 6 }}>{state.error}</div>}
        {state.diff && (
          <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
            本次新增 {state.diff.added.length} · 清理 {state.diff.removed.length} · 未变 {state.diff.unchanged.length}{state.updatedAt ? ` · ${relTime(state.updatedAt)}` : ''}
          </div>
        )}
      </div>

      {report && report.total > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.platforms.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <div key={p.platform}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{p.platform.toUpperCase()}</span>
                    <span>{p.done}/{p.total}（{pct}%）</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-canvas)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'var(--space-sm)' }}>
            {filters.map(([key, label]) => (
              <button key={key} type="button" onClick={() => { setFilter(key); setVisible(PAGE); }} className={`platform-chip${filter === key ? ' is-active' : ''}`}>{label}</button>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
            {rows.slice(0, visible).map((r) => (
              <div key={r.key} style={{ color: r.stale ? 'var(--color-muted)' : 'var(--color-ink)', opacity: r.stale ? 0.6 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {r.left} <span style={{ color: 'var(--color-muted)' }}>{r.right}</span>
              </div>
            ))}
            {rows.length === 0 && <div style={{ color: 'var(--color-muted)' }}>无符合条件的链接</div>}
            {visible < rows.length && (
              <button type="button" onClick={() => setVisible((v) => v + PAGE)} style={{ marginTop: 8, border: 'none', background: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                加载更多（剩余 {rows.length - visible}）
              </button>
            )}
          </div>
        </>
      )}

      {(!report || report.total === 0) && !state.error && (
        <div style={{ marginTop: 'var(--space-sm)', fontSize: 12, color: 'var(--color-muted)' }}>
          还没有进度数据，点「刷新」抓取最新 sitemap 并对账。
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过；删除旧测试**

Run: `rm tests/progresspanel.test.tsx && npx vitest run tests/progress-dashboard.test.tsx`
Expected: PASS（9 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/ProgressDashboard.tsx tests/progress-dashboard.test.tsx tests/progresspanel.test.tsx
git commit -m "feat(submit): 新增 ProgressDashboard 仪表盘组件"
```

---

### Task 6: `RunningOverlay` 进行中态覆盖层

**Files:**
- Create: `entrypoints/sidepanel/components/RunningOverlay.tsx`
- Test: `tests/running-overlay.test.tsx`

**Interfaces:**
- Consumes: `UnifiedLogPanel`（Task 2）、`mergeLogs`（Task 1）、`useSubmitOrchestrator` 返回类型（`{ active, gsc, bing, logs }`）
- Produces: `RunningOverlay({ orch, gscSelected, bingSelected, onCancel })`

- [ ] **Step 1: 写失败测试**

创建 `tests/running-overlay.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RunningOverlay from '../entrypoints/sidepanel/components/RunningOverlay';

const mkOrch = (over: any) => ({
  active: 'gsc',
  logs: [],
  gsc: { state: { running: true, total: 10, done: 7 }, logs: [], results: [] },
  bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  ...over,
});

describe('RunningOverlay', () => {
  it('active=gsc 顶部显示「提交中 GSC 7/10」', () => {
    render(<RunningOverlay orch={mkOrch({ active: 'gsc' })} gscSelected bingSelected onCancel={() => {}} />);
    expect(screen.getByText(/提交中 GSC 7\/10/)).toBeInTheDocument();
  });

  it('取消按钮触发 onCancel', () => {
    const onCancel = vi.fn();
    render(<RunningOverlay orch={mkOrch({})} gscSelected bingSelected onCancel={onCancel} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('未勾选平台的步骤不渲染', () => {
    render(<RunningOverlay orch={mkOrch({ active: 'bing', bing: { state: { running: true, total: 10, done: 3 }, logs: [], results: [] } })} gscSelected={false} bingSelected onCancel={() => {}} />);
    expect(screen.queryByText('GSC')).not.toBeInTheDocument();
    expect(screen.getByText(/提交中 Bing 3\/10/)).toBeInTheDocument();
  });

  it('合并三路日志并渲染消息', () => {
    const orch = mkOrch({
      active: 'gsc',
      logs: [{ level: 'info', phase: 'system', message: 'sys-msg', ts: 1 }],
      gsc: { state: { running: true, total: 10, done: 7 }, logs: [{ level: 'info', phase: 'g', message: 'gsc-msg', ts: 2 }], results: [] },
    });
    render(<RunningOverlay orch={orch} gscSelected bingSelected onCancel={() => {}} />);
    expect(screen.getByText('sys-msg')).toBeInTheDocument();
    expect(screen.getByText('gsc-msg')).toBeInTheDocument();
  });

  it('active=sitemap 显示「提交中 抓取 sitemap」', () => {
    render(<RunningOverlay orch={mkOrch({ active: 'sitemap' })} gscSelected bingSelected onCancel={() => {}} />);
    expect(screen.getByText(/提交中 抓取 sitemap/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/running-overlay.test.tsx`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `entrypoints/sidepanel/components/RunningOverlay.tsx`：

```tsx
import Button from './Button';
import UnifiedLogPanel from './UnifiedLogPanel';
import { mergeLogs } from '@lib/submit/logs';
import type { useSubmitOrchestrator } from '../hooks/useSubmitOrchestrator';

type Orch = ReturnType<typeof useSubmitOrchestrator>;

export interface RunningOverlayProps {
  orch: Orch;
  gscSelected: boolean;
  bingSelected: boolean;
  onCancel: () => void;
}

interface Step { label: string; status: 'done' | 'current' | 'pending'; detail?: string; }

export default function RunningOverlay({ orch, gscSelected, bingSelected, onCancel }: RunningOverlayProps) {
  const active = orch.active;
  const activeLabel = active === 'sitemap' ? '抓取 sitemap' : active === 'gsc' ? 'GSC' : active === 'bing' ? 'Bing' : '';
  const activeRunner = active === 'gsc' ? orch.gsc : active === 'bing' ? orch.bing : null;
  const done = activeRunner?.state.done ?? 0;
  const total = activeRunner?.state.total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const steps: Step[] = [];
  steps.push({ label: '抓取', status: active === 'sitemap' ? 'current' : 'done' });
  if (gscSelected) {
    steps.push({
      label: 'GSC',
      status: active === 'gsc' ? 'current' : active === 'sitemap' ? 'pending' : 'done',
      detail: active === 'gsc' ? `${orch.gsc.state.done}/${orch.gsc.state.total}` : undefined,
    });
  }
  if (bingSelected) {
    steps.push({
      label: 'Bing',
      status: active === 'bing' ? 'current' : 'pending',
      detail: active === 'bing' ? `${orch.bing.state.done}/${orch.bing.state.total}` : undefined,
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>
          提交中 {activeLabel}{total > 0 ? ` ${done}/${total}` : ''}
        </div>
        <Button variant="secondary" onClick={onCancel}>取消</Button>
      </div>

      <div style={{ height: 6, background: 'var(--color-canvas)', borderRadius: 3, overflow: 'hidden', marginBottom: 'var(--space-xs)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.2s' }} />
      </div>

      <div style={{ display: 'flex', gap: 6, fontSize: 12, marginBottom: 'var(--space-sm)' }}>
        {steps.map((s, i) => (
          <span key={s.label} style={{ color: s.status === 'current' ? 'var(--color-primary)' : s.status === 'done' ? 'var(--color-success)' : 'var(--color-muted-soft)' }}>
            {s.label} {s.status === 'done' ? '✓' : s.status === 'current' ? `›${s.detail ? ` (${s.detail})` : ''}` : '·'}{i < steps.length - 1 ? ' →' : ''}
          </span>
        ))}
      </div>

      <UnifiedLogPanel logs={mergeLogs(orch.logs, orch.gsc.logs, orch.bing.logs)} />
    </div>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/running-overlay.test.tsx`
Expected: PASS（5 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/RunningOverlay.tsx tests/running-overlay.test.tsx
git commit -m "feat(submit): 新增 RunningOverlay 进行中态覆盖层"
```

---

### Task 7: 重构 `SubmitPanel` 为状态驱动视图

**Files:**
- Modify: `entrypoints/sidepanel/pages/SubmitPanel.tsx`（整体重写）
- Modify: `tests/submitpanel.test.tsx`（整体重写）

**Interfaces:**
- Consumes: `ProgressDashboard` / `SubmitBar` / `RunningOverlay` / `BatchReportCard`（Task 2-6）；`useSubmitOrchestrator` / `useProgressQuery`；`TextInput` / `PlatformChip`（仅 `SubmitBar` 用）；`isValidDomain`（`@lib/storage/projects`）；`normalizeOrigin`（`@lib/seo-files/url`）；`Site`（`../hooks/useSite`）
- Produces: 重构后的 `SubmitPanel({ site, onBack })`

- [ ] **Step 1: 写失败测试（整体重写 `tests/submitpanel.test.tsx`）**

整体替换 `tests/submitpanel.test.tsx` 内容为：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockOrch: any = {
  run: vi.fn(),
  cancel: vi.fn(),
  clearReport: vi.fn(),
  active: null,
  report: [],
  logs: [],
  gsc: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
};

vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', () => ({
  useSubmitOrchestrator: () => mockOrch,
}));

const refresh = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useProgressQuery', () => ({
  useProgressQuery: () => ({ state: { loading: false }, refresh }),
}));

import SubmitPanel from '../entrypoints/sidepanel/pages/SubmitPanel';

beforeEach(() => {
  mockOrch.run.mockReset();
  mockOrch.cancel.mockReset();
  mockOrch.clearReport.mockReset();
  refresh.mockReset();
  mockOrch.active = null;
  mockOrch.report = [];
  mockOrch.gsc.state = { running: false, total: 0, done: 0 };
  mockOrch.bing.state = { running: false, total: 0, done: 0 };
  mockOrch.gsc.logs = [];
  mockOrch.bing.logs = [];
});

describe('SubmitPanel', () => {
  it('默认 sitemapUrl = origin + /sitemap.xml', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('https://example.com/sitemap.xml');
  });

  it('有效域名点击提交：用 sitemapUrl 调 run', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.click(screen.getByText('一次提交 10 个'));
    expect(mockOrch.run).toHaveBeenCalledWith({ gsc: true, bing: true }, 'example.com', 'https://example.com/sitemap.xml');
  });

  it('手改 sitemapUrl 后用新值提交', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/sitemap-index.xml' } });
    fireEvent.click(screen.getByText('一次提交 10 个'));
    expect(mockOrch.run).toHaveBeenCalledWith({ gsc: true, bing: true }, 'example.com', 'https://example.com/sitemap-index.xml');
  });

  it('idle 态渲染仪表盘的「刷新」按钮', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect(screen.getByText('刷新')).toBeInTheDocument();
  });

  it('idle 改 sitemapUrl 后点「刷新」用新值', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/sitemap-index.xml' } });
    fireEvent.click(screen.getByText('刷新'));
    expect(refresh).toHaveBeenCalledWith('https://example.com/sitemap-index.xml');
  });

  it('返回按钮触发 onBack', () => {
    const onBack = vi.fn();
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={onBack} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('running 态渲染 RunningOverlay 且隐藏返回 / 提交条', () => {
    mockOrch.active = 'gsc';
    mockOrch.gsc.state = { running: true, total: 10, done: 3 };
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect(screen.getByText(/提交中 GSC/)).toBeInTheDocument();
    expect(screen.queryByText('返回')).not.toBeInTheDocument();
    expect(screen.queryByText('一次提交 10 个')).not.toBeInTheDocument();
  });

  it('完成后(report 非空 & idle)渲染报告卡', () => {
    mockOrch.report = [{ url: 'https://x/p1', platform: 'gsc', status: 'ok' }];
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect(screen.getByText(/本批 1/)).toBeInTheDocument();
  });

  it('报告卡 × 触发 clearReport', () => {
    mockOrch.report = [{ url: 'https://x/p1', platform: 'gsc', status: 'ok' }];
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(mockOrch.clearReport).toHaveBeenCalledOnce();
  });

  it('渲染低价值过滤说明', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    expect(screen.getByText(/将自动过滤登录.*低价值链接/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/submitpanel.test.tsx`
Expected: FAIL —— 旧 `SubmitPanel` 仍有 tab / 旧文案，新断言不通过（如 `一次提交 10 个` 不存在、`返回` 在 running 仍渲染等）。

- [ ] **Step 3: 重写 `SubmitPanel`**

整体替换 `entrypoints/sidepanel/pages/SubmitPanel.tsx` 内容为：

```tsx
import { useEffect, useRef, useState } from 'react';
import TextInput from '../components/TextInput';
import ProgressDashboard from '../components/ProgressDashboard';
import RunningOverlay from '../components/RunningOverlay';
import BatchReportCard from '../components/BatchReportCard';
import SubmitBar from '../components/SubmitBar';
import { IconBack } from '../components/icons';
import { useSubmitOrchestrator } from '../hooks/useSubmitOrchestrator';
import { isValidDomain } from '@lib/storage/projects';
import { normalizeOrigin } from '@lib/seo-files/url';
import type { Site } from '../hooks/useSite';

function defaultSitemapUrl(domain: string): string {
  try { return `${normalizeOrigin(domain)}/sitemap.xml`; } catch { return ''; }
}

export default function SubmitPanel({ site, onBack }: { site: Site; onBack: () => void }) {
  const orch = useSubmitOrchestrator();
  const [sitemapUrl, setSitemapUrl] = useState(() => defaultSitemapUrl(site.domain));
  const [gsc, setGsc] = useState(true);
  const [bing, setBing] = useState(true);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setSitemapUrl(defaultSitemapUrl(site.domain));
  }, [site.domain]);

  const running = orch.active !== null;
  const busy = orch.gsc.state.running || orch.bing.state.running || orch.active !== null;
  const ready = (gsc || bing) && !busy && isValidDomain(site.domain) && !!sitemapUrl.trim();
  const showReport = !running && orch.report.length > 0;

  function submit() {
    if (!isValidDomain(site.domain)) { setError('请先选择或填写有效网站（如 example.com）'); return; }
    if (!sitemapUrl.trim()) { setError('请填写站点地图 URL（如 https://example.com/sitemap.xml）'); return; }
    setError('');
    void orch.run({ gsc, bing }, site.domain.trim(), sitemapUrl.trim());
  }

  return (
    <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {!running && (
        <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
          <IconBack size={14} /> 返回
        </button>
      )}
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>网站提交</h2>

      {running ? (
        <RunningOverlay orch={orch} gscSelected={gsc} bingSelected={bing} onCancel={orch.cancel} />
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>站点地图（sitemap.xml）</label>
          <TextInput value={sitemapUrl} placeholder="https://example.com/sitemap.xml" onChange={(e) => { dirtyRef.current = true; setSitemapUrl(e.target.value); }} />
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
            将自动过滤登录 / 注册 / 隐私 / 条款 / 账号等低价值链接，不参与提交。
          </div>

          {showReport && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <BatchReportCard report={orch.report} onClose={orch.clearReport} />
            </div>
          )}

          <div style={{ marginTop: 'var(--space-md)', flex: 1 }}>
            <ProgressDashboard domain={site.domain.trim()} sitemapUrl={sitemapUrl.trim()} />
          </div>

          <SubmitBar
            gsc={gsc}
            bing={bing}
            onToggleGsc={() => setGsc((v) => !v)}
            onToggleBing={() => setBing((v) => !v)}
            onSubmit={submit}
            onCancel={orch.cancel}
            busy={busy}
            ready={ready}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

Run: `npx vitest run tests/submitpanel.test.tsx && pnpm compile`
Expected: 测试 PASS（10 个用例全过）；`tsc --noEmit` 无错误。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/pages/SubmitPanel.tsx tests/submitpanel.test.tsx
git commit -m "refactor(submit): 重构 SubmitPanel 为状态驱动视图"
```

---

### Task 8: 移除旧 `ProgressPanel` 组件 + 全量回归

**Files:**
- Delete: `entrypoints/sidepanel/components/ProgressPanel.tsx`

- [ ] **Step 1: 确认无残留引用**

Run: `grep -rn "ProgressPanel" entrypoints/ tests/`
Expected: 无输出（Task 7 已不 import；Task 5 已删 `progresspanel.test.tsx`）。若有输出，先清理引用再继续。

- [ ] **Step 2: 删除旧组件**

Run: `rm entrypoints/sidepanel/components/ProgressPanel.tsx`

- [ ] **Step 3: 全量测试 + 类型检查 + 构建**

Run: `pnpm test && pnpm compile`
Expected: 所有测试 PASS（含 `submitpanel` / `progress-dashboard` / `running-overlay` / `unified-log-panel` / `batch-report-card` / `submit-bar` / `merge-logs` 及未动的 `useSubmitOrchestrator` / `useProgressQuery` / `progress` 等）；`tsc --noEmit` 无错误。

- [ ] **Step 4: 手动回归（sidepanel 实机）**

打开 sidepanel，进入「网站提交」：
1. `idle` 态：看到仪表盘（进度卡 + 刷新 + 明细）+ 底部提交条；无空日志面板。
2. 点「一次提交 10 个」→ 进入 `running` 全屏态：步骤指示 `抓取 → GSC › (x/y) → Bing`，统一日志流滚动，顶部「取消」可点。
3. 完成后回 `idle`，顶部浮现报告卡（汇总 + 失败明细），`×` 可关闭。
4. 点「刷新」→ 进度卡对账摘要更新（`+X · -Y · Zh前`）。
5. running 态顶部无「返回」按钮。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/sidepanel/components/ProgressPanel.tsx
git commit -m "chore(submit): 移除旧 ProgressPanel 组件"
```

---

## Self-Review

**1. Spec coverage:**
- 状态机（两态 + 报告卡）→ Task 7（`running` / `showReport` 判定）✓
- 统一时间流日志 → Task 1（`mergeLogs`）+ Task 2（`UnifiedLogPanel`）+ Task 6（接入）✓
- 仪表盘主体（进度卡 + 筛选 + 明细 + 空态 + 对账摘要）→ Task 5 ✓
- 底部固定提交条 → Task 4 ✓
- 进行中覆盖层（步骤 + 进度 + 日志 + 取消）→ Task 6 ✓
- 完成报告卡（汇总 + 失败明细 + 关闭）→ Task 3 ✓
- 进行中禁返回 → Task 7（`{!running && <返回>}`）✓
- 日志合并在视图层，hook 不改 → 全部任务未改 hook ✓
- 旧 `ProgressPanel` 清理 → Task 8 ✓

**2. Placeholder scan:** 无 TBD / TODO / "add error handling" / "similar to Task N"。所有代码步骤含完整代码。

**3. Type consistency:**
- `UnifiedLogEntry` / `LogPlatform` 在 Task 1 定义，Task 2 / Task 6 消费，签名一致 ✓
- `mergeLogs(sys, gsc, bing)` 签名在 Task 1 / Task 6 一致 ✓
- `BatchReportCard({ report, onClose })` 在 Task 3 定义、Task 7 消费一致 ✓
- `SubmitBar` props 在 Task 4 定义、Task 7 消费一致（`gsc/bing/onToggleGsc/onToggleBing/onSubmit/onCancel/busy/ready`）✓
- `RunningOverlay({ orch, gscSelected, bingSelected, onCancel })` 在 Task 6 定义、Task 7 消费一致 ✓
- `ProgressDashboard({ domain, sitemapUrl })` 在 Task 5 定义、Task 7 消费一致 ✓
- `classifyResult` / `Outcome` 来自 `lib/submit/reasons`（既有），Task 3 消费 ✓

无问题，计划完整。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-05-submit-panel-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 Task 派发独立 subagent 实现，task 间我做 review 门禁，快速迭代。

**2. Inline Execution** - 在当前会话按 executing-plans 批量执行，带 checkpoint 让你 review。

Which approach?
