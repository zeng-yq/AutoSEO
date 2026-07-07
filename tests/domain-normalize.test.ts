import { describe, it, expect } from 'vitest';
import { normalizeDomain, isValidDomain, sanitizeDomainInput } from '../lib/storage/projects';

describe('normalizeDomain', () => {
  it('剥离 scheme / path / query / fragment', () => {
    expect(normalizeDomain('https://example.com/path?x=1#frag')).toBe('example.com');
    expect(normalizeDomain('http://example.com/')).toBe('example.com');
  });
  it('剥离 userinfo 与端口', () => {
    expect(normalizeDomain('http://user:pass@example.com')).toBe('example.com');
    expect(normalizeDomain('example.com:8080')).toBe('example.com');
  });
  it('转小写 + trim', () => {
    expect(normalizeDomain('  HTTPS://WWW.Example.COM/  ')).toBe('www.example.com');
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });
  it('保留 www（不主动去裸域）', () => {
    expect(normalizeDomain('www.example.com')).toBe('www.example.com');
  });
  it('空串 / 纯空白返回空', () => {
    expect(normalizeDomain('')).toBe('');
    expect(normalizeDomain('   ')).toBe('');
  });
  it('含非 ASCII（中文域名 / 重音字符）返回空，不支持 IDN', () => {
    expect(normalizeDomain('例子.中国')).toBe('');
    expect(normalizeDomain('café.com')).toBe('');
  });
  it('无点的裸词返回原样（交由 isValidDomain 判定无效）', () => {
    expect(normalizeDomain('notadomain')).toBe('notadomain');
  });
});

describe('isValidDomain(normalizeDomain(x)) 组合', () => {
  const valid = (x: string) => isValidDomain(normalizeDomain(x));
  it('脏输入清洗后判有效', () => {
    expect(valid('https://example.com/path')).toBe(true);
    expect(valid('example.com:8080')).toBe(true);
    expect(valid('HTTPS://WWW.Example.COM/')).toBe(true);
  });
  it('无效输入仍判无效', () => {
    expect(valid('notadomain')).toBe(false);
    expect(valid('192.168.1.1')).toBe(false); // 末段非 [a-z]{2,}
    expect(valid('例子.中国')).toBe(false);
    expect(valid('')).toBe(false);
  });
});

describe('sanitizeDomainInput', () => {
  it('实时剥掉 scheme / path / query，仅保留主机名', () => {
    expect(sanitizeDomainInput('https://example.com/path?q=1')).toBe('example.com');
    expect(sanitizeDomainInput('http://www.example.com/')).toBe('www.example.com');
  });
  it('已是裸域名则原样返回', () => {
    expect(sanitizeDomainInput('example.com')).toBe('example.com');
  });
  it('未成形输入保留原文，不打断逐字输入', () => {
    expect(sanitizeDomainInput('exa')).toBe('exa');
    expect(sanitizeDomainInput('http://')).toBe('http://');
  });
  it('空输入保留空串', () => {
    expect(sanitizeDomainInput('')).toBe('');
  });
  it('非 ASCII 输入保留原文（normalizeDomain 不支持 IDN）', () => {
    expect(sanitizeDomainInput('例子.中国')).toBe('例子.中国');
  });
});
