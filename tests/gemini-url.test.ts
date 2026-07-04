import { describe, it, expect } from 'vitest';
import { buildGeminiUrl } from '../lib/gemini/url';

describe('gemini url', () => {
  it('生成以 gemini.google.com/app 开头的链接', () => {
    const url = buildGeminiUrl('hello');
    expect(url.startsWith('https://gemini.google.com/app?prompt=')).toBe(true);
  });

  it('对 prompt 进行 URL 编码', () => {
    const url = buildGeminiUrl('请解释 best laptop');
    expect(url).toContain('prompt=');
    expect(decodeURIComponent(url.split('prompt=')[1])).toBe('请解释 best laptop');
  });

  it('对特殊字符编码且链接可解析', () => {
    const url = buildGeminiUrl('a&b=c?d');
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get('prompt')).toBe('a&b=c?d');
  });
});
