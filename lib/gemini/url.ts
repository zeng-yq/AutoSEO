/**
 * Gemini 打开链接构造器。
 *
 * 优先尝试 URL 参数预填 prompt；若 Gemini 不识别该参数，
 * 再由 gemini-fill.content.ts 兜底注入。
 */

export function buildGeminiUrl(prompt: string): string {
  return `https://gemini.google.com/app?prompt=${encodeURIComponent(prompt)}`;
}
