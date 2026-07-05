/**
 * 低价值链接过滤（纯函数）。
 *
 * sitemap 抓取后、候选池构建前，剔除账号认证 / 法务条款 / 用户中心三类
 * 「提交无意义」的 URL。discovered 库仍保留全量，仅不参与提交候选。
 *
 * 匹配粒度：路径段精确匹配（前边界 ^|/，非子串），按类别分两个严格度：
 * - STRICT（账号 / 用户中心）：整段，后边界 $/?# 不含 -（防 login-tips 误伤）
 * - LOOSE（法务条款）：段首关键词，允许 - 后缀（容 privacy-policy / terms-of-service 等组合）
 * - my- / my_ 前缀单独一支（用户中心入口习惯）
 *
 * 单复数用 s? 合并（accounts? / orders? …），避免依赖正则回溯。
 *
 * 详见 docs/superpowers/specs/2026-07-05-sitemap-lowvalue-filter-design.md
 */

/** 严格段关键词（账号认证 + 用户中心）：整段精确匹配 */
const STRICT = [
  // 账号认证
  'login', 'sign[-_]?in', 'sign[-_]?up', 'log[-_]?out', 'log[-_]?off',
  'register', 'registration', 'auth',
  // 用户中心
  'accounts?', 'profiles?', 'dashboard', 'settings?', 'members?',
  'carts?', 'checkout', 'orders?',
].join('|');

/** 宽松段关键词（法务条款）：段首关键词即可，允许 - 后缀 */
const LOOSE = [
  'privacy', 'polic(?:y|ies)', 'terms', 'tos',
  'agreements?', 'disclaimers?', 'legal', 'cookies?', 'gdpr',
].join('|');

/**
 * 低价值链接匹配正则。i 标志：大小写不敏感。
 * 无 g 标志 —— 配合 .test() 不会累积 lastIndex，多次调用安全。
 */
export const LOW_VALUE_URL_RE = new RegExp(
  '(?:^|/)(?:' +
    'my[-_]' +                              // ① my- / my_ 前缀
    '|' + '(?:' + LOOSE + ')(?=$|[/?#-])' + // ② 法务：段首关键词
    '|' + '(?:' + STRICT + ')(?=$|[/?#])'   // ③ 账号 / 用户中心：整段
  + ')',
  'i',
);

/** 单条 URL 是否为低价值（不参与提交候选） */
export function isLowValueUrl(url: string): boolean {
  return LOW_VALUE_URL_RE.test(url);
}

/**
 * 把 URL 列表拆为「保留候选」与「被过滤」两段。
 * 保序、不去重、不修改入参。单次遍历 O(n)。
 * 调用方负责在 dropped.length > 0 时上报日志。
 */
export function partitionLowValue(urls: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const u of urls) {
    if (isLowValueUrl(u)) dropped.push(u);
    else kept.push(u);
  }
  return { kept, dropped };
}
