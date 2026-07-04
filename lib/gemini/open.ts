import { buildGeminiPrompt } from './prompt';
import { buildGeminiUrl } from './url';
import type { GeminiOpen } from '@lib/messaging/types';

/**
 * 用关键词向 Gemini 提问。
 *
 * 优先通过 background 的 tabs.create 打开新标签（点击事件内触发，用户手势有效）。
 * 仅当消息通道失败时才降级到 window.open；此时可能被弹窗拦截，但不会闪现 about:blank。
 */
export async function askGemini(keyword: string): Promise<void> {
  const url = buildGeminiUrl(buildGeminiPrompt(keyword));

  try {
    const res = await chrome.runtime.sendMessage<GeminiOpen, { ok: boolean; error?: string }>({
      type: 'OPEN_GEMINI',
      url,
    });
    if (!res?.ok) throw new Error(res?.error ?? 'background failed');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
