// tests/submitpanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const run = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', () => ({
  useSubmitOrchestrator: () => ({
    run,
    cancel: vi.fn(),
    active: null,
    gsc: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
    bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  }),
}));

import SubmitPanel from '../entrypoints/sidepanel/pages/SubmitPanel';

describe('SubmitPanel', () => {
  it('手动填非法域名提交时显示错误且不调用 run', () => {
    render(<SubmitPanel site={{ domain: 'not a domain' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/' } });
    fireEvent.click(screen.getByText('一次提交'));
    expect(screen.getByText(/请先选择或填写有效网站/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
  it('有效域名 + 链接时点击提交调用 run', () => {
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/es/' } });
    fireEvent.click(screen.getByText('一次提交'));
    // T10 起 run 签名为 (platforms, domain, sitemapUrl)；sitemap 输入 UI 见 T11
    expect(run).toHaveBeenCalledWith({ gsc: true, bing: true }, 'example.com', 'https://example.com/sitemap.xml');
  });
  it('返回按钮触发 onBack', () => {
    const onBack = vi.fn();
    render(<SubmitPanel site={{ domain: 'example.com' }} onBack={onBack} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
