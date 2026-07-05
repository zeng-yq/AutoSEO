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
    expect(screen.queryByText(/^GSC\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/提交中 Bing 3\/10/)).toBeInTheDocument();
  });

  it('勾选且为当前平台时 GSC 步骤渲染', () => {
    render(<RunningOverlay orch={mkOrch({ active: 'gsc' })} gscSelected bingSelected onCancel={() => {}} />);
    expect(screen.getByText(/^GSC\b/)).toBeInTheDocument();
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
