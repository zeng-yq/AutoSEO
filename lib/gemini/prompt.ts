/**
 * Gemini prompt 模板。
 *
 * 用户要求：解释关键词含义、背后需求和相关关键词，面向完全不了解该词的人。
 */

export const PROMPT_TEMPLATE =
  '请用中文向我解释人们检索的「{keyword}」的意思，以及背后的需求是什么？并解释与其相关的关键词，因为我是一个完全不了解这个词和需求以及背景知识的人。';

export function buildGeminiPrompt(keyword: string): string {
  const kw = keyword.trim();
  if (!kw) throw new Error('keyword required');
  // 模板本身已用「」包裹 {keyword}，直接替换即可降低 LLM prompt 注入风险。
  return PROMPT_TEMPLATE.replace('{keyword}', kw);
}
