import { describe, it, expect } from 'vitest';
import { buildGeminiPrompt, PROMPT_TEMPLATE } from '../lib/gemini/prompt';

describe('gemini prompt', () => {
  it('用关键词渲染中文 prompt', () => {
    expect(buildGeminiPrompt('chatgpt')).toBe(
      '请用中文向我解释人们检索的「chatgpt」的意思，以及背后的需求是什么？并解释与其相关的关键词，因为我是一个完全不了解这个词和需求以及背景知识的人。',
    );
  });

  it('保留关键词内的空格与 Unicode', () => {
    const prompt = buildGeminiPrompt('生成式 AI');
    expect(prompt).toContain('「生成式 AI」');
    expect(prompt.startsWith('请用中文')).toBe(true);
  });

  it('trim 关键词前后空白', () => {
    const prompt = buildGeminiPrompt('  best laptop  ');
    expect(prompt).toContain('「best laptop」');
    expect(prompt).not.toContain('  best laptop  ');
  });

  it('空关键词抛错', () => {
    expect(() => buildGeminiPrompt('')).toThrow('keyword required');
    expect(() => buildGeminiPrompt('   ')).toThrow('keyword required');
  });

  it('模板包含 {keyword} 占位符', () => {
    expect(PROMPT_TEMPLATE).toContain('{keyword}');
  });
});
