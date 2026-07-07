// tests/sitetools.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', () => ({
  useSubmitOrchestrator: () => ({
    run: vi.fn(), cancel: vi.fn(), active: null,
    report: [], logs: [], clearReport: vi.fn(),
    gsc: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
    bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  }),
}));

import SiteTools from '../entrypoints/sidepanel/pages/SiteTools';

// flush 排空 useSite/useProjects 异步 refresh，避免 act warning
const flush = () => act(async () => {});

describe('SiteTools', () => {
  it('未选网站时「网站提交」禁用', async () => {
    render(<SiteTools />);
    await flush();
    const submit = screen.getByText(/网站提交/).closest('[role="button"], .tool-card');
    expect(submit?.getAttribute('aria-disabled')).toBe('true');
  });
  it('选择网站后点击「网站提交」进入提交子面板（出现返回）', async () => {
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText(/网站提交/));
    expect(await screen.findByText('返回')).toBeInTheDocument();
  });
  it('选择有效网站后，点击 robots.txt 打开新标签', async () => {
    const createSpy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    // 等待 useSite/useProjects 异步 refresh 落定，避免 act warning
    await flush();
    // 在网站选择器输入有效域名
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText('robots.txt'));
    expect(createSpy).toHaveBeenCalled();
    const url = createSpy.mock.calls[0][0].url as string;
    expect(url).toBe('https://example.com/robots.txt');
    createSpy.mockRestore();
  });
  it('未选网站时 robots.txt 禁用', async () => {
    render(<SiteTools />);
    // 等待 useSite/useProjects 异步 refresh 落定，避免 act warning
    await flush();
    const robots = screen.getByText('robots.txt').closest('[role="button"], .tool-card');
    expect(robots?.getAttribute('aria-disabled')).toBe('true');
  });
  it('未选网站时 sitemap.xml 同样禁用', async () => {
    render(<SiteTools />);
    await flush();
    const sitemap = screen.getByText('sitemap.xml').closest('[role="button"], .tool-card');
    expect(sitemap?.getAttribute('aria-disabled')).toBe('true');
  });
  it('渲染 7 个新增工具卡片', async () => {
    render(<SiteTools />);
    await flush();
    expect(screen.getByText('Backlink Checker')).toBeInTheDocument();
    expect(screen.getByText('Website Authority Checker')).toBeInTheDocument();
    expect(screen.getByText('GSC')).toBeInTheDocument();
    expect(screen.getByText('Bing')).toBeInTheDocument();
    expect(screen.getByText('Google Analytics')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Clarity')).toBeInTheDocument();
    expect(screen.getByText('PageSpeed Insights')).toBeInTheDocument();
  });
  it('选网站后点 Backlink Checker 打开带 input 与 mode=subdomains 的链接', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'vercel.com' } });
    fireEvent.click(screen.getByText('Backlink Checker'));
    expect(spy).toHaveBeenCalled();
    const url = spy.mock.calls[0][0].url as string;
    expect(url).toBe('https://ahrefs.com/backlink-checker/?input=vercel.com&mode=subdomains');
    spy.mockRestore();
  });
  it('选网站后点 GSC 打开直接链接（无查询参数）', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText('GSC'));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].url).toBe('https://search.google.com/search-console');
    spy.mockRestore();
  });
  it('未选网站时 PageSpeed Insights 可点击并跳首页（不依赖域名）', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const card = screen.getByText('PageSpeed Insights').closest('[role="button"], .tool-card');
    expect(card?.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(screen.getByText('PageSpeed Insights'));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].url).toBe('https://pagespeed.web.dev/');
    spy.mockRestore();
  });
  it('未选网站时 Backlink Checker 可点击并跳工具首页（不带域名）', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const card = screen.getByText('Backlink Checker').closest('[role="button"], .tool-card');
    expect(card?.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(screen.getByText('Backlink Checker'));
    expect(spy.mock.calls[0][0].url).toBe('https://ahrefs.com/backlink-checker');
    spy.mockRestore();
  });
  it('未选网站时 GSC 可点击并跳入口（不带域名）', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    fireEvent.click(screen.getByText('GSC'));
    expect(spy.mock.calls[0][0].url).toBe('https://search.google.com/search-console');
    spy.mockRestore();
  });
  it('未选网站时显示轻量引导文案（而非全量禁用提示）', async () => {
    render(<SiteTools />);
    await flush();
    expect(screen.getByText('填写网站可额外查询 robots.txt / sitemap.xml')).toBeInTheDocument();
  });
  it('选网站后点 Bing 打开直接链接', async () => {
    const spy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByText('Bing'));
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].url).toBe('https://www.bing.com/webmasters');
    spy.mockRestore();
  });
  it('脏域名 change 时实时清洗为裸域名（无需失焦）', async () => {
    const createSpy = vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 1 } as never);
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    // 输入完整 URL,change 时即实时清洗为裸域名(无需失焦)
    fireEvent.change(input, { target: { value: 'https://example.com/path' } });
    expect(input.value).toBe('example.com');
    // 清洗后即启用 robots
    const robots = screen.getByText('robots.txt').closest('[role="button"], .tool-card');
    expect(robots?.getAttribute('aria-disabled')).not.toBe('true');
    // 点击使用清洗后的域名
    fireEvent.click(screen.getByText('robots.txt'));
    expect(createSpy.mock.calls[0][0].url).toBe('https://example.com/robots.txt');
    createSpy.mockRestore();
  });
  it('无效输入显示红字提示', async () => {
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'notadomain' } });
    await flush();
    expect(screen.getByText('请输入有效域名，如 example.com')).toBeInTheDocument();
  });
  it('非 ASCII 输入失焦不清空，仍显示校验提示', async () => {
    render(<SiteTools />);
    await flush();
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '例子.中国' } });
    fireEvent.blur(input);
    // normalizeDomain 返回 ''，但输入框不应被清空
    expect((screen.getByPlaceholderText('example.com') as HTMLInputElement).value).toBe('例子.中国');
    await flush();
    expect(screen.getByText('请输入有效域名，如 example.com')).toBeInTheDocument();
  });
});
