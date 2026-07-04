import { describe, it, expect, vi, afterEach } from 'vitest';
import { askGemini } from '../lib/gemini/open';

const runtimeMock = chrome.runtime as unknown as { sendMessage: (...args: unknown[]) => Promise<unknown> };

describe('askGemini', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('通过 sendMessage 让 background 开标签', async () => {
    const sendSpy = vi.spyOn(runtimeMock, 'sendMessage').mockResolvedValue({ ok: true });

    await askGemini('chatgpt');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const payload = sendSpy.mock.calls[0][0] as { type: string; url: string };
    expect(payload.type).toBe('OPEN_GEMINI');
    expect(payload.url).toContain('https://gemini.google.com/app?prompt=');
    expect(decodeURIComponent(payload.url)).toContain('chatgpt');
  });

  it('background 返回失败时 fallback 到 window.open', async () => {
    vi.spyOn(runtimeMock, 'sendMessage').mockResolvedValue({ ok: false, error: 'disallowed' });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await askGemini('ai tools');

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0] as string).toContain('gemini.google.com');
  });

  it('sendMessage 异常时 fallback 到 window.open', async () => {
    vi.spyOn(runtimeMock, 'sendMessage').mockRejectedValue(new Error('broken'));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    await askGemini('seo');

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0] as string).toContain('gemini.google.com');
  });
});
