import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitOne, runBatch } from '../lib/gsc/flow';
import * as cdp from '../lib/cdp/actions';
import { PROBES } from '../lib/gsc/selectors';

/**
 * GSC flow 单测。
 *
 * 策略：直接 mock `lib/cdp/actions` 的两个原语（evalJs / waitForStep），
 * 让 `submitOne` 的步骤机在受控输入下推进，从而验证「真实流程判定」而非自证。
 *
 * mockEvalSeq：按 evalJs 调用顺序返回值（queue）。
 * waitForStep 默认返回 true（已就绪），仅在需要测「超时未确认」时覆盖。
 */
function mockEvalSeq(values: unknown[]) {
  const q = [...values];
  vi.spyOn(cdp, 'evalJs').mockImplementation(async () => q.shift() as never);
  vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
}

/**
 * mockOkPath：让每条 URL 走「ok」路径。
 * 分类 booleans（isAlreadyIndexed/isNotOwned/isQuota）→ false；
 * 按钮 aria-disabled → 'false'（启用）；其余 evalJs（填值/打标记/reset）→ true。
 */
function mockOkPath() {
  vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
    if (typeof expr !== 'string') return true as never;
    if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isNotOwned || expr === PROBES.isQuota) {
      return false as never;
    }
    if (expr.includes('aria-disabled')) return { button: true, ariaDisabled: 'false' } as never;
    return true as never;
  });
  vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('submitOne', () => {
  it('ok 路径：填值→检查→按钮启用→点击→成功 toast', async () => {
    // submitOne 的 evalJs 调用顺序（按钮检测前置于分类，见 §2.4 按钮缺失=已索引）：
    //   1) 原生 setter 填值并提交（返回 true）
    //   2) 找按钮 + 读 aria-disabled → { button: true, ariaDisabled: 'false' }
    //   3) 分类 isAlreadyIndexed → false（按钮在，分支不走）
    //   4) 分类 isNotOwned → false
    //   5) 分类 isQuota → false
    //   6) 页面内 el.click() 点击按钮（返回 true）
    //   7) 重置输入框（返回 true）
    // waitForStep（输入就绪 / 结果信号 / 成功 toast）默认 true。
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, false, false, false, true, true]);

    const r = await submitOne({ tabId: 1 }, 'https://bottleneck-checker.com/es/');

    expect(r.status).toBe('ok');
    expect(r.url).toBe('https://bottleneck-checker.com/es/');
    expect(r.reason).toBeUndefined();
    // 关键：用页面内 el.click() 点击「请求编入索引」按钮（chrome.debugger 后台 tab 下可靠）
    const clickCall = vi.mocked(cdp.evalJs).mock.calls.find(([, expr]) =>
      typeof expr === 'string' && expr.includes('.click()') && expr.includes('请求编入索引'),
    );
    expect(clickCall).toBeTruthy();
    // 关键：成功 toast 轮询用了 180s 超时（gsc-probe §2.7）
    expect(cdp.waitForStep).toHaveBeenCalledWith(
      { tabId: 1 },
      PROBES.successIndicator,
      expect.objectContaining({ timeoutMs: 180000, intervalMs: 6000 }),
    );
  });

  it('已索引 → skipped(已索引)，且不点击按钮（§2.4：按钮缺失 + 正向文案命中）', async () => {
    // 按钮缺失 → 触发 isAlreadyIndexed 检测 → true
    mockEvalSeq([true, { button: false, ariaDisabled: null }, /* isAlreadyIndexed */ true]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/已索引/);
  });

  it('已索引（按钮仍存在）→ skipped(已索引)，不点击（实测：已索引页面也显示按钮）', async () => {
    // 实测（2026-06-28）：已索引页面状态文案「网址已收录到 Google」，且「请求编入索引」
    // 按钮仍存在(DIV[role=button], aria-disabled=false)。判定必须以状态文案为准，不能依赖按钮缺失。
    // evalJs 顺序：填值 true → 按钮探测{button:true,ad:'false'} → isAlreadyIndexed true → 返回 skipped
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, /* isAlreadyIndexed */ true]);
    const r = await submitOne({ tabId: 1 }, 'https://bottleneck-checker.com/es/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/已索引/);
  });

  it('不属于此域名 → skipped', async () => {
    // isAlreadyIndexed false → isNotOwned true
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, /* isAlreadyIndexed */ false, /* isNotOwned */ true]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/不属于此域名/);
  });

  it('配额 → skipped(配额)', async () => {
    // isAlreadyIndexed false → isNotOwned false → isQuota true
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, /* isAlreadyIndexed */ false, /* isNotOwned */ false, /* isQuota */ true]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/配额/);
  });

  it('无请求编入索引按钮 → skipped(无请求编入索引按钮)', async () => {
    // 按钮缺失：先查 isAlreadyIndexed（false），再 isNotOwned/isQuota 均 false，最后落「无按钮」
    mockEvalSeq([true, { button: false, ariaDisabled: null }, false, false, false]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/无请求编入索引按钮/);
  });

  it('按钮 aria-disabled 非 false → skipped(按钮禁用)', async () => {
    mockEvalSeq([true, { button: true, ariaDisabled: 'true' }, false, false, false]);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/按钮禁用/);
  });

  it('点击后成功 toast 超时未出现 → skipped(提交未确认)', async () => {
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, false, false, false, true, true]);
    // 成功 toast 轮询超时（waitForStep 返回 false）
    vi.spyOn(cdp, 'waitForStep').mockImplementation(async (_t, expr, _o) => {
      // 输入就绪 / 结果信号为 true；successIndicator 为 false
      return expr !== PROBES.successIndicator;
    });
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/提交未确认/);
  });

  it('填值用 native setter（evalJs 表达式含 HTMLInputElement.prototype 与 keydown Enter）', async () => {
    mockEvalSeq([true, { button: true, ariaDisabled: 'false' }, false, false, false, true, true]);
    await submitOne({ tabId: 1 }, 'https://x.com/');
    const fillCall = vi.mocked(cdp.evalJs).mock.calls.find(([, expr]) =>
      typeof expr === 'string' && expr.includes('HTMLInputElement.prototype'),
    );
    expect(fillCall).toBeTruthy();
    expect(fillCall![1]).toContain('keydown');
    expect(fillCall![1]).toContain('Enter');
    // URL 通过 JSON.stringify 注入，避免引号注入
    expect(fillCall![1]).toContain(JSON.stringify('https://x.com/'));
  });

  it('① 输入框超时 → skipped(输入框未就绪)，不再静默滑入下一步', async () => {
    vi.spyOn(cdp, 'evalJs').mockResolvedValue(true as never);
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(false); // 所有等待超时
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/输入框未就绪/);
  });

  it('③ 检查结果超时 → skipped(检查结果未出现)', async () => {
    vi.spyOn(cdp, 'evalJs').mockResolvedValue(true as never);
    let first = true;
    vi.spyOn(cdp, 'waitForStep').mockImplementation(async () => {
      if (first) { first = false; return true; } // ① 输入框就绪
      return false; // ③ 结果超时
    });
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/检查结果未出现/);
  });
});

describe('runBatch', () => {
  it('连续 3 条配额信号熔断，剩余计为 skipped', async () => {
    // 每条 submitOne：填值 true → 按钮探测 → isAlreadyIndexed false → isNotOwned false → isQuota true
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return false as never;
      if (expr === PROBES.isQuota) return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isNotOwned) return false as never;
      if (expr.includes('HTMLInputElement.prototype')) return true as never; // 填值
      // 按钮探测 + 打标记：返回 button 对象 / true
      if (expr.includes('aria-disabled')) return { button: true, ariaDisabled: 'false' } as never;
      if (expr.includes('data-autoseo')) return true as never;
      return false as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);

    const urls = Array.from({ length: 10 }, (_, i) => `https://bottleneck-checker.com/p${i}`);
    const summary = await runBatch({ tabId: 1 }, urls, {});

    // 前 3 条触发熔断（每条 skipped/配额），剩余 7 条 skipped(未执行)
    expect(summary.skipped).toBe(urls.length);
    expect(summary.ok).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('配额不连续时不熔断（中间穿插 ok 重置计数）', async () => {
    // 顺序：配额、配额、ok、配额、配额、配额（最后才满 3 连）
    // true=该 URL 命中配额；false=该 URL 走 ok 路径
    const quotaStates = [true, true, false, true, true, true];
    let urlIndex = -1;
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return false as never;
      // 填值表达式含具体 URL（JSON.stringify 后），用其推进 urlIndex；
      // reset 表达式含 setter.call(i, '')（空串），不推进。
      if (expr.includes('HTMLInputElement.prototype') && expr.includes('https://')) {
        urlIndex += 1;
        return true as never;
      }
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isNotOwned) return false as never;
      if (expr === PROBES.isQuota) return (quotaStates[urlIndex] ?? false) as never;
      // 找按钮 + aria-disabled：ok 路径需要按钮启用；配额路径不会走到这（提前返回）
      if (expr.includes('aria-disabled')) return { button: true, ariaDisabled: 'false' } as never;
      // 打标记 / reset / 其它：默认 true
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);

    const urls = quotaStates.map((_, i) => `https://x.com/${i}`);
    const summary = await runBatch({ tabId: 1 }, urls, {});
    // quotaStates 中 index 2 为 ok（1 条）；其余 5 条配额，仅在最后 3 连才熔断 → 全部跑完
    expect(summary.ok).toBe(1);
    expect(summary.skipped).toBe(5);
    expect(summary.failed).toBe(0);
  });

  it('shouldStop 为 true 时立即终止，剩余 skipped', async () => {
    // 用「全 ok」路径 mock：分类均为 false、按钮启用、成功 toast 命中
    mockOkPath();
    const urls = ['https://a.com/', 'https://b.com/', 'https://c.com/'];
    let stop = false;
    const summary = await runBatch({ tabId: 1 }, urls, {
      shouldStop: () => stop,
      onProgress: (s) => {
        // 第一条结束后请求停止
        if (s.done === 1) stop = true;
      },
    });
    // 第一条 ok，后两条 skipped(未执行)
    expect(summary.ok).toBe(1);
    expect(summary.skipped).toBe(2);
  });

  it('onProgress/onLog 回调被调用', async () => {
    mockOkPath();
    const onProgress = vi.fn();
    const onLog = vi.fn();
    await runBatch({ tabId: 1 }, ['https://a.com/'], { onProgress, onLog });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalled();
  });

  it('埋点：onLog 含 inspect 与 submit 两个 phase，submit 含 → 已提交', async () => {
    mockOkPath();
    const onLog = vi.fn();
    await runBatch({ tabId: 1 }, ['https://a.com/'], { onLog });
    const phases = new Set(onLog.mock.calls.map((c) => (c[0] as { phase?: string }).phase));
    expect(phases.has('inspect')).toBe(true);
    expect(phases.has('submit')).toBe(true);
    const submitted = onLog.mock.calls.find(
      (c) => (c[0] as { phase?: string; message?: string }).phase === 'submit'
        && (c[0] as { message?: string }).message?.startsWith('→ 已提交'),
    );
    expect(submitted).toBeTruthy();
  });
});
