import { describe, it, expect, vi, afterEach } from 'vitest';
import { askGemini } from '../lib/gemini/open';

describe('askGemini', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('同步打开带 prompt 的 Gemini 窗口', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    askGemini('chatgpt');

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url).toContain('https://gemini.google.com/app?prompt=');
    expect(decodeURIComponent(url)).toContain('chatgpt');
    expect(openSpy.mock.calls[0][1]).toBe('_blank');
  });

  it('对关键词进行 URL 编码', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    askGemini('生成式 AI');

    const url = openSpy.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toContain('生成式 AI');
  });
});
