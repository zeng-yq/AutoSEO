import { buildGeminiPrompt } from './prompt';
import { buildGeminiUrl } from './url';

/**
 * 用关键词向 Gemini 提问。
 *
 * 在点击事件内同步调用 window.open，确保用户手势有效、不会被弹窗拦截，
 * 同时避免 background tabs.create 的异步回退导致手势过期。
 */
export function askGemini(keyword: string): void {
  const url = buildGeminiUrl(buildGeminiPrompt(keyword));
  window.open(url, '_blank', 'noopener,noreferrer');
}
