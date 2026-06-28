import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitOne, runBatch } from '../lib/bing/flow';
import * as cdp from '../lib/cdp/actions';
import { PROBES } from '../lib/bing/selectors';

/**
 * Bing flow 单测。策略与 gsc-flow.test.ts 一致：mock lib/cdp/actions 的 evalJs / waitForStep，
 * 让 submitOne 在受控输入下推进，验证「真实流程判定」而非自证。
 *
 * 与 GSC 的关键差异（测试重点）：
 *  - 触发 inspect 用**点击按钮**（非回车）。
 *  - **两步按钮**：Request indexing → 确认弹窗（⑧ 以 role=dialog 为就绪信号）→ Submit（⑨ 多策略定位）。
 *
 * 注：submitOne 改造后 ①④⑧⑩ 调 waitForStep（actions.ts 内部对 waitForPredicate 是同文件词法直调，
 * 无法被 vi.spyOn 拦截），故这里 spy waitForStep 而非 waitForPredicate。
 * 让 submitOne 在受控输入下推进，验证「真实流程判定」而非自证。
 *
 * 与 GSC 的关键差异（测试重点）：
 *  - 触发 inspect 用**点击按钮**（非回车）。
 *  - **两步按钮**：Request indexing → 确认弹窗（⑧ 以 role=dialog 为就绪信号）→ Submit（⑨ 多策略定位）。
 */

/**
 * mockOkPath：让每条 URL 走「ok」路径。
 * 分类 booleans（isAlreadyIndexed/isQuota）→ false；
 * Request indexing 探测 → 启用；submit 多策略定位 → {found,disabled,clicked}；
 * 其余 evalJs（填值 / 点击 inspect / 点击 request indexing / reset）→ true。
 */
function mockOkPath() {
  vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
    if (typeof expr !== 'string') return true as never;
    if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) {
      return false as never;
    }
    // 按钮探测表达式含对应 data-tag + 'disabled'（btnProbeExpr）；点击表达式只含 data-tag + '.click()'。
    if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
      return { button: true, disabled: false } as never;
    }
    // submitActionExpr（多策略定位 Submit，含 'submitBtn'）
    if (expr.includes('submitBtn')) {
      return { found: true, disabled: false, clicked: true } as never;
    }
    return true as never;
  });
  vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('submitOne', () => {
  it('ok 路径：填值→点 Inspect→未索引→点 Request indexing→确认弹窗→点 Submit→成功提示', async () => {
    mockOkPath();
    const r = await submitOne({ tabId: 1 }, 'https://bottleneck-checker.com/de/');
    expect(r.status).toBe('ok');
    expect(r.url).toBe('https://bottleneck-checker.com/de/');
    expect(r.reason).toBeUndefined();
  });

  it('已索引 → skipped(已索引)，不点击 Request indexing（§2.4：已索引页也显示该按钮）', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed) return true as never;
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
    const r = await submitOne({ tabId: 1 }, 'https://bottleneck-checker.com');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/已索引/);
    const riClicked = vi.mocked(cdp.evalJs).mock.calls.some(([, expr]) =>
      typeof expr === 'string' && expr.includes('requestIndexingButton') && expr.includes('.click()'));
    expect(riClicked).toBe(false);
  });

  it('无 Request indexing 按钮 → skipped(无 Request indexing 按钮)', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: false, disabled: true } as never;
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/无 Request indexing 按钮/);
  });

  it('Request indexing 按钮禁用 → skipped(按钮禁用)', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: true } as never;
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/按钮禁用/);
  });

  it('确认弹窗未出现 → skipped(确认弹窗未出现)，含诊断计数', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: false } as never;
      }
      // CONFIRM_DIAG_EXPR（含 'dialog:' / 'deep'）
      if (expr.includes('dialog:') || expr.includes('deep')) {
        return { dialog: 0, submit: 0, deep: 0 } as never;
      }
      return true as never;
    });
    // waitForStep：输入就绪 / resultReady=true；confirmDialog=false（确认弹窗未出现）
    vi.spyOn(cdp, 'waitForStep').mockImplementation(async (_t, expr) => {
      return expr !== PROBES.confirmDialog;
    });
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/确认弹窗未出现/);
    expect(r.reason).toContain('dialog=0');
  });

  it('Submit 未找到（多策略均落空）→ skipped(Submit 未找到)，含诊断计数', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: false } as never;
      }
      // CONFIRM_DIAG_EXPR（特征含 'dialog:'，带冒号；先于 submitBtn 判定，因两者表达式都含 'submitBtn'）
      if (expr.includes('dialog:')) {
        return { dialog: 1, submit: 0, deep: 0 } as never;
      }
      // submitActionExpr（多策略定位）→ 未找到
      if (expr.includes('submitBtn')) {
        return { found: false, disabled: false, clicked: false } as never;
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/Submit 未找到/);
    expect(r.reason).toContain('submit=0');
  });

  it('Submit 禁用（配额耗尽）→ skipped(配额)', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: false } as never;
      }
      if (expr.includes('submitBtn')) {
        return { found: true, disabled: true, clicked: false } as never; // Submit 禁用 → 配额
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/配额/);
  });

  it('成功提示超时未出现 → skipped(提交未确认)', async () => {
    mockOkPath();
    vi.spyOn(cdp, 'waitForStep').mockImplementation(async (_t, expr) => {
      return expr !== PROBES.successIndicator;
    });
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/提交未确认/);
  });

  it('成功提示超时 + 配额文案 → skipped(配额)', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return true as never;
      if (expr === PROBES.isAlreadyIndexed) return false as never;
      if (expr === PROBES.isQuota) return true as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: false } as never;
      }
      if (expr.includes('submitBtn')) {
        return { found: true, disabled: false, clicked: true } as never;
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockImplementation(async (_t, expr) => expr !== PROBES.successIndicator);
    const r = await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/配额/);
  });

  it('触发 inspect 用点击按钮而非回车（点击 [data-tag=inspectBtn]）', async () => {
    mockOkPath();
    await submitOne({ tabId: 1 }, 'https://x.com/');
    const inspectClick = vi.mocked(cdp.evalJs).mock.calls.find(([, expr]) =>
      typeof expr === 'string' && expr.includes('inspectBtn') && expr.includes('.click()'));
    expect(inspectClick).toBeTruthy();
  });

  it('填值用 native setter，但不派发回车（Bing 靠点击按钮触发）', async () => {
    mockOkPath();
    await submitOne({ tabId: 1 }, 'https://x.com/');
    const calls = vi.mocked(cdp.evalJs).mock.calls.map(([, e]) => (typeof e === 'string' ? e : ''));
    const setterCalls = calls.filter((e) => e.includes('HTMLInputElement.prototype'));
    expect(setterCalls.length).toBeGreaterThan(0);
    expect(setterCalls.some((e) => e.includes('keydown'))).toBe(false);
  });

  it('两步按钮：依次点击 Request indexing 与 Submit（Submit 在 submitActionExpr 内点击）', async () => {
    mockOkPath();
    await submitOne({ tabId: 1 }, 'https://x.com/');
    const calls = vi.mocked(cdp.evalJs).mock.calls.map(([, e]) => (typeof e === 'string' ? e : ''));
    const riIdx = calls.findIndex((e) => e.includes('requestIndexingButton') && e.includes('.click()'));
    const submitIdx = calls.findIndex((e) => e.includes('submitBtn') && e.includes('.click()'));
    expect(riIdx).toBeGreaterThanOrEqual(0);
    expect(submitIdx).toBeGreaterThanOrEqual(0);
    expect(riIdx).toBeLessThan(submitIdx);
  });

  it('⑧ 等待确认弹窗用 dialog 信号（confirmDialog）而非 submitBtn，30s 超时', async () => {
    mockOkPath();
    await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(cdp.waitForStep).toHaveBeenCalledWith(
      { tabId: 1 },
      PROBES.confirmDialog,
      expect.objectContaining({ timeoutMs: 30000 }),
    );
  });

  it('成功提示轮询用 60s 超时 / 3s 间隔（bing-probe §2.7）', async () => {
    mockOkPath();
    await submitOne({ tabId: 1 }, 'https://x.com/');
    expect(cdp.waitForStep).toHaveBeenCalledWith(
      { tabId: 1 },
      PROBES.successIndicator,
      expect.objectContaining({ timeoutMs: 60000, intervalMs: 3000 }),
    );
  });
});

describe('runBatch', () => {
  it('连续 3 条配额信号（Submit 禁用）熔断，剩余计为 skipped', async () => {
    vi.spyOn(cdp, 'evalJs').mockImplementation(async (_t, expr) => {
      if (typeof expr !== 'string') return false as never;
      if (expr === PROBES.isAlreadyIndexed || expr === PROBES.isQuota) return false as never;
      if (expr.includes('requestIndexingButton') && expr.includes('disabled')) {
        return { button: true, disabled: false } as never;
      }
      if (expr.includes('submitBtn')) {
        return { found: true, disabled: true, clicked: false } as never; // Submit 禁用 → 配额
      }
      return true as never;
    });
    vi.spyOn(cdp, 'waitForStep').mockResolvedValue(true);

    const urls = Array.from({ length: 10 }, (_, i) => `https://bottleneck-checker.com/p${i}`);
    const summary = await runBatch({ tabId: 1 }, urls, {});

    expect(summary.skipped).toBe(urls.length);
    expect(summary.ok).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('shouldStop 为 true 时立即终止，剩余 skipped', async () => {
    mockOkPath();
    const urls = ['https://a.com/', 'https://b.com/', 'https://c.com/'];
    let stop = false;
    const summary = await runBatch({ tabId: 1 }, urls, {
      shouldStop: () => stop,
      onProgress: (s) => {
        if (s.done === 1) stop = true;
      },
    });
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

  it('每条结果上 onLog（submit 阶段含 reason）', async () => {
    mockOkPath();
    const onLog = vi.fn();
    await runBatch({ tabId: 1 }, ['https://a.com/'], { onLog });
    // submitOne 手动埋点（点击 Request indexing / 点击 Submit / 等成功提示）也是 submit phase，
    // 故按「每条结果日志」特征（message 以 '→ ' 起始）定位。
    const resultLog = onLog.mock.calls
      .map((c) => c[0] as { phase?: string; message?: string })
      .find((e) => e.phase === 'submit' && /^→ /.test(e.message ?? ''));
    expect(resultLog).toBeTruthy();
    expect(resultLog!.message).toMatch(/已提交/);
  });

  it('埋点：onLog 含 inspect 与 submit 两个 phase，submitOne 手动埋点到位', async () => {
    mockOkPath();
    const onLog = vi.fn();
    await runBatch({ tabId: 1 }, ['https://a.com/'], { onLog });
    const phases = new Set(onLog.mock.calls.map((c) => (c[0] as { phase?: string }).phase));
    expect(phases.has('inspect')).toBe(true);
    expect(phases.has('submit')).toBe(true);
    // submitOne 手动埋点：②已填值 / ③点击 Inspect 属 inspect；⑦点击 Request indexing / ⑨点击 Submit 属 submit
    const inspectMsgs = onLog.mock.calls
      .filter((c) => (c[0] as { phase?: string }).phase === 'inspect')
      .map((c) => (c[0] as { message?: string }).message);
    expect(inspectMsgs.some((m) => /已填值|点击 Inspect/.test(m || ''))).toBe(true);
  });
});
