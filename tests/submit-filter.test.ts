import { describe, it, expect } from 'vitest';
import { LOW_VALUE_URL_RE, isLowValueUrl, partitionLowValue } from '../lib/submit/filter';

describe('isLowValueUrl', () => {
  it.each([
    'https://example.com/login',
    'https://example.com/auth/login',
    'https://example.com/sign-in',
    'https://example.com/signup',
    'https://example.com/logout',
    'https://example.com/register',
    'https://example.com/auth',
  ])('账号认证命中：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/privacy',
    'https://example.com/privacy-policy',
    'https://example.com/terms',
    'https://example.com/terms-of-service',
    'https://example.com/cookie-statement',
    'https://example.com/legal',
    'https://example.com/gdpr',
    'https://example.com/disclaimer',
  ])('法务条款命中：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/account',
    'https://example.com/accounts',
    'https://example.com/dashboard',
    'https://example.com/profile',
    'https://example.com/cart',
    'https://example.com/checkout',
    'https://example.com/orders',
    'https://example.com/settings',
  ])('用户中心命中：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/my-account',
    'https://example.com/my-orders',
    'https://example.com/my_profile',
  ])('my- 前缀命中：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/blog/login-tips-for-beginners',
    'https://example.com/account-faq',
    'https://example.com/register-guide',
    'https://example.com/search?q=login',
    'https://example.com/loginator',
    'https://example.com/blog/seo-guide',
    'https://example.com/post/how-to-rank',
    'https://example.com/author',
  ])('内容页保留（不误伤）：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(false);
  });

  it.each([
    'https://example.com/LOGIN',
    'https://example.com/Privacy-Policy',
    'https://example.com/MY-Account',
  ])('大小写不敏感：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/login?next=/home',
    'https://example.com/login#section',
    'https://example.com/auth/login?return=/',
  ])('段尾边界（query / hash）命中：%s', (url) => {
    expect(isLowValueUrl(url)).toBe(true);
  });
});

describe('LOW_VALUE_URL_RE', () => {
  it('是全局可复用的 RegExp 实例', () => {
    expect(LOW_VALUE_URL_RE).toBeInstanceOf(RegExp);
    expect(LOW_VALUE_URL_RE.flags).toContain('i');
    // 同一实例多次 test 不互相干扰（lastIndex 不累积）
    LOW_VALUE_URL_RE.lastIndex = 0;
    expect(LOW_VALUE_URL_RE.test('https://x.com/login')).toBe(true);
    expect(LOW_VALUE_URL_RE.test('https://x.com/blog/post')).toBe(false);
  });
});

describe('partitionLowValue', () => {
  it('混合列表正确拆分 + 保序', () => {
    const urls = [
      'https://example.com/login',
      'https://example.com/blog/post-1',
      'https://example.com/privacy-policy',
      'https://example.com/blog/post-2',
      'https://example.com/cart',
    ];
    const { kept, dropped } = partitionLowValue(urls);
    expect(kept).toEqual([
      'https://example.com/blog/post-1',
      'https://example.com/blog/post-2',
    ]);
    expect(dropped).toEqual([
      'https://example.com/login',
      'https://example.com/privacy-policy',
      'https://example.com/cart',
    ]);
  });

  it('空列表返回两个空数组', () => {
    const { kept, dropped } = partitionLowValue([]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it('全保留', () => {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    const { kept, dropped } = partitionLowValue(urls);
    expect(kept).toEqual(urls);
    expect(dropped).toEqual([]);
  });

  it('全过滤', () => {
    const urls = ['https://example.com/login', 'https://example.com/auth'];
    const { kept, dropped } = partitionLowValue(urls);
    expect(kept).toEqual([]);
    expect(dropped).toEqual(urls);
  });

  it('不修改入参', () => {
    const urls = ['https://example.com/login', 'https://example.com/a'];
    const snap = [...urls];
    partitionLowValue(urls);
    expect(urls).toEqual(snap);
  });
});
