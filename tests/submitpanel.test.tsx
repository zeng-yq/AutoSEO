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

vi.mock('../entrypoints/sidepanel/components/IndexNowKeySection', () => ({
  default: () => null,
}));

vi.mock('../entrypoints/sidepanel/components/GscCredentialsSection', () => ({
  default: () => null,
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
