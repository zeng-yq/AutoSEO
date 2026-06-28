import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForStep, fmtMs } from '../lib/cdp/actions';

beforeEach(() => vi.restoreAllMocks());

describe('fmtMs', () => {
  it('<1000 用 ms', () => expect(fmtMs(50)).toBe('50ms'));
  it('>=1000 用 s（1 位小数）', () => expect(fmtMs(1250)).toBe('1.3s'));
});

describe('waitForStep', () => {
  it('成功：先打「进入 …」再打「✓(...)」两条 info，返回 true', async () => {
    // 在 chrome.debugger.sendCommand 边界 mock：evalJs→true → waitForPredicate 立即 return true
    vi.spyOn(chrome.debugger, 'sendCommand' as never)
      .mockResolvedValue({ result: { value: true } } as never);
    const log = vi.fn();
    const ok = await waitForStep({ tabId: 1 }, 'PRED', { name: '等输入框就绪', log });
    expect(ok).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatchObject({ level: 'info', phase: 'submit' });
    expect(log.mock.calls[0][0].message).toBe('等输入框就绪…');
    expect(log.mock.calls[1][0].level).toBe('info');
    expect(log.mock.calls[1][0].message).toMatch(/等输入框就绪 ✓ \(/);
  });

  it('超时(timeoutMs=0)：打 warn「超时(...)」，返回 false', async () => {
    // timeoutMs=0 → waitForPredicate 的 deadline 立即到，不进循环，return false（不调 send）
    const log = vi.fn();
    const ok = await waitForStep({ tabId: 1 }, 'PRED', { name: '等检查结果', timeoutMs: 0, log });
    expect(ok).toBe(false);
    const last = log.mock.calls.at(-1)![0];
    expect(last.level).toBe('warn');
    expect(last.message).toMatch(/等检查结果 超时 \(/);
  });

  it('phase 默认 submit，可覆盖为 inspect', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand' as never)
      .mockResolvedValue({ result: { value: true } } as never);
    const log = vi.fn();
    await waitForStep({ tabId: 1 }, 'PRED', { name: 'x', phase: 'inspect', log });
    expect(log.mock.calls[0][0].phase).toBe('inspect');
  });

  it('log 可选：不传不报错', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand' as never)
      .mockResolvedValue({ result: { value: true } } as never);
    await expect(waitForStep({ tabId: 1 }, 'PRED', { name: 'x' })).resolves.toBe(true);
  });
});
