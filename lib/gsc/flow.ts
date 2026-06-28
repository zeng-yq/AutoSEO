/**
 * GSC（Google Search Console）「请求编入索引」流程。
 *
 * 实现依据：docs/superpowers/notes/gsc-probe.md §2（VERIFIED 2026-06-28）。
 * 关键运行事实（来自真实页面探测）：
 *  - GSC 的检查输入框是 **React 受控组件**：直接 `input.value=` 会被覆盖，
 *    必须用 `HTMLInputElement.prototype` 的 native value setter + 派发 `input` 事件，
 *    然后派发 `keydown` Enter 事件触发检查（没有放大镜按钮可点）。见 §2.2。
 *  - 「请求编入索引」按钮是 **`DIV[role=button]`**（不是 `<button>`），没有 `disabled`
 *    属性，启用状态由 `aria-disabled="false"` 表征。见 §2.3。
 *  - 点击用**页面内 `el.click()`**（非 Input.dispatchMouseEvent）：chrome.debugger 后台 tab
 *    下后者不触发 React 点击（已实测），前者是 Runtime.evaluate 里的纯 DOM 调用，可靠。见 §2.3。
 *  - 点击后是 **单按钮流程**：弹出「正在测试实际网址可否编入索引」进度弹窗（1-2 分钟），
 *    自动完成后出现成功 toast（无需点第二个提交按钮）。见 §2.7。
 *
 * 因此 Task 12 的 flow = 等输入就绪 → native setter 填值 + Enter → 等结果信号 →
 * 分类（已索引/不属于/配额）→ 找按钮并校验 aria-disabled → 页面内 el.click() 点击 →
 * 轮询成功 toast（180s）→ 清空输入框（供下一条复用）。
 */

import { evalJs, waitForStep } from '../cdp/actions';
import type { StepLog } from '../cdp/actions';
import { type Target } from '../cdp/client';
import { PROBES } from './selectors';

export type SubmitStatus = 'ok' | 'skipped';

export interface SubmitResult {
  url: string;
  status: SubmitStatus;
  reason?: string;
}

export interface FlowCallbacks {
  onProgress?: (s: { total: number; done: number; currentUrl?: string; results: SubmitResult[] }) => void;
  onLog?: (e: { level: 'info' | 'warn' | 'error'; phase: string; message: string }) => void;
  shouldStop?: () => boolean;
}

/** 检查结果区出现的最长等待（gsc-probe §2.3：实测 ~10-15s，留余量到 30s）。 */
const INSPECT_TIMEOUT = 30000;
/** 输入框就绪等待（页面初次加载）。 */
const INPUT_READY_TIMEOUT = 30000;
/**
 * 成功 toast 轮询超时。gsc-probe §2.7：点按钮后先弹「实时测试进度弹窗」1-2 分钟，
 * 之后才出现成功 toast。给到 180s（3 分钟）兜底，每 6s 轮询一次。
 */
const SUCCESS_TIMEOUT = 180000;
const SUCCESS_INTERVAL = 6000;
/** 连续配额命中达到该阈值即熔断剩余批次。 */
const QUOTA_THRESHOLD = 3;

/**
 * 单条 URL 的「请求编入索引」步骤机。
 *
 * 步骤（对应 gsc-probe.md §2）：
 *  1. 等输入框就绪（§2.1）。
 *  2. native setter 填值 + 派发 input/keydown Enter（§2.2）。
 *  3. 等待检查结果信号出现（按钮 / 已索引 / 配额 / 不属于，任一命中即就绪）。
 *  4. 找「请求编入索引」按钮 + 读 aria-disabled（§2.3，DIV[role=button]）。
 *  5. 分类：isAlreadyIndexed（状态文案命中）→ 已索引；isNotOwned→不属于此域名；
 *     isQuota→配额；最后判定按钮存在性 / 启用态。已索引判定**不**依赖按钮缺失
 *     （实测两态都有按钮，见 gsc-probe §2.4 修订）。
 *  6. 给按钮打 `data-autoseo` 标记后用真实手势点击（§2.3）。
 *  7. 轮询成功 toast（§2.7，单按钮流程，180s）。
 *  8. native setter 清空输入框（§2.8，供下一条复用）。
 */
export async function submitOne(
  target: Target,
  url: string,
  log?: StepLog,
): Promise<SubmitResult> {
  // ① 等输入框就绪（§2.1）——超时即 skipped，不再静默滑入下一步
  const inputReady = await waitForStep(target, `!!(${PROBES.inspectInput})`, {
    name: '等输入框就绪', timeoutMs: INPUT_READY_TIMEOUT, phase: 'inspect', log,
  });
  if (!inputReady) return { url, status: 'skipped', reason: '输入框未就绪' };

  // ② native setter 填值 + Enter（§2.2 verbatim，URL 经 JSON.stringify 注入避免引号注入）
  const fillExpr =
    `(() => {` +
    `const i = ${PROBES.inspectInput};` +
    `if (!i) return false;` +
    `const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;` +
    `setter.call(i, ${JSON.stringify(url)});` +
    `i.dispatchEvent(new Event('input', { bubbles: true }));` +
    `i.focus();` +
    `i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));` +
    `return true;` +
    `})()`;
  await evalJs<boolean>(target, fillExpr);
  log?.({ level: 'info', phase: 'inspect', message: '已填值并回车' });

  // ③ 等检查结果信号（任一命中即视为结果区已加载）——超时即 skipped
  const resultReady =
    `(${PROBES.requestIndexingButton}) || (${PROBES.isAlreadyIndexed}) || (${PROBES.isQuota}) || (${PROBES.isNotOwned})`;
  const ready = await waitForStep(target, resultReady, {
    name: '等检查结果', timeoutMs: INSPECT_TIMEOUT, phase: 'inspect', log,
  });
  if (!ready) return { url, status: 'skipped', reason: '检查结果未出现' };

  // ④ 找「请求编入索引」按钮 + 读 aria-disabled（§2.3：DIV[role=button]，无 disabled 属性）。
  //    ⚠️ 按钮探测不能用于判定「已索引」——两态都有按钮（gsc-probe §2.4）。
  const btnInfo = await evalJs<{ button: boolean; ariaDisabled: string } | null>(target, btnProbeExpr());
  const hasButton = !!btnInfo?.button;
  log?.({ level: 'info', phase: 'inspect', message: `按钮 aria-disabled=${btnInfo?.ariaDisabled ?? 'null'}` });

  // ⑤ 分类（顺序：已索引 → 不属于 → 配额 → 按钮态）
  if (await evalJs<boolean>(target, PROBES.isAlreadyIndexed)) {
    return { url, status: 'skipped', reason: '已索引' };
  }
  if (await evalJs<boolean>(target, PROBES.isNotOwned)) {
    return { url, status: 'skipped', reason: '不属于此域名' };
  }
  if (await evalJs<boolean>(target, PROBES.isQuota)) {
    return { url, status: 'skipped', reason: '配额' };
  }
  if (!hasButton) {
    return { url, status: 'skipped', reason: '无请求编入索引按钮' };
  }
  const disabled = btnInfo!.ariaDisabled != null && btnInfo!.ariaDisabled !== 'false';
  if (disabled) {
    return { url, status: 'skipped', reason: '按钮禁用' };
  }

  // ⑥ 点击「请求编入索引」（页面内 el.click()，§2.3）
  const clickExpr =
    `(() => {` +
    `const b = ${PROBES.requestIndexingButton};` +
    `if (!b) return false;` +
    `b.scrollIntoView({ block: 'center' });` +
    `b.click();` +
    `return true;` +
    `})()`;
  await evalJs<boolean>(target, clickExpr);
  log?.({ level: 'info', phase: 'submit', message: '点击「请求编入索引」' });

  // ⑦ 单按钮流程：轮询成功 toast（§2.7，180s / 6s 间隔）
  const ok = await waitForStep(target, PROBES.successIndicator, {
    name: '等成功提示（最长180s）', timeoutMs: SUCCESS_TIMEOUT, intervalMs: SUCCESS_INTERVAL, phase: 'submit', log,
  });
  if (!ok) return { url, status: 'skipped', reason: '提交未确认' };

  // ⑧ 清空输入框（§2.8，best-effort，不阻塞结果）
  await resetInput(target).catch(() => undefined);

  return { url, status: 'ok' };
}

/**
 * 批量执行 + 配额熔断。
 *
 * - 逐条调用 submitOne，通过 onProgress/onLog 上报状态。
 * - 连续 QUOTA_THRESHOLD 条命中「配额」即熔断，剩余 URL 计为 skipped(未执行)。
 * - cb.shouldStop() 为 true 时立即终止，剩余同样计为 skipped。
 */
export async function runBatch(
  target: Target,
  urls: string[],
  cb: FlowCallbacks = {},
): Promise<{ ok: number; failed: number; skipped: number }> {
  const results: SubmitResult[] = [];
  let quotaStreak = 0;
  let stopped = false;

  for (let i = 0; i < urls.length; i++) {
    if (cb.shouldStop?.()) {
      stopped = true;
      break;
    }
    const url = urls[i];
    cb.onLog?.({ level: 'info', phase: 'inspect', message: `[${i + 1}/${urls.length}] ${url}` });

    let r: SubmitResult;
    try {
      r = await submitOne(target, url, cb.onLog);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      cb.onLog?.({ level: 'error', phase: 'submit', message: `步骤异常: ${msg}` });
      r = { url, status: 'skipped', reason: msg };
    }
    results.push(r);
    cb.onProgress?.({ total: urls.length, done: i + 1, currentUrl: url, results });
    // 每条结果上日志（含 reason），与 Bing 一致
    cb.onLog?.({
      level: r.status === 'ok' || r.reason === '已索引' ? 'info' : 'warn',
      phase: 'submit',
      message: r.reason ? `→ ${r.reason}` : '→ 已提交',
    });

    if (r.reason === '配额') {
      quotaStreak += 1;
      if (quotaStreak >= QUOTA_THRESHOLD) {
        cb.onLog?.({ level: 'warn', phase: 'system', message: '连续配额信号，熔断剩余' });
        stopped = true;
        break;
      }
    } else {
      // 非配额结果（含 ok 与其他 skipped 原因）重置连续计数
      quotaStreak = 0;
    }
  }

  // 熔断或取消时，剩余 URL 计为 skipped(未执行)
  if (stopped) {
    for (const u of urls.slice(results.length)) {
      results.push({ url: u, status: 'skipped', reason: '未执行（批次终止）' });
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return { ok, failed: 0, skipped };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 探测「请求编入索引」按钮并读取其 aria-disabled。
 * §2.3：按钮是 DIV[role=button]，没有 disabled 属性，启用状态由 aria-disabled="false" 表征。
 * 返回 { button: 是否存在, ariaDisabled: aria-disabled 属性值（可能为 null） }。
 */
function btnProbeExpr(): string {
  return (
    `(() => {` +
    `const b = ${PROBES.requestIndexingButton};` +
    `if (!b) return { button: false, ariaDisabled: null };` +
    `return { button: true, ariaDisabled: b.getAttribute('aria-disabled') };` +
    `})()`
  );
}

/**
 * 清空检查输入框（§2.8）。同样需要 native setter —— React 受控组件直接赋 '' 会被覆盖。
 * best-effort：失败时不影响已得出的结果。
 */
async function resetInput(target: Target): Promise<void> {
  await evalJs<boolean>(
    target,
    `(() => {` +
      `const i = ${PROBES.inspectInput};` +
      `if (!i) return false;` +
      `i.focus();` +
      `try { i.select(); } catch (e) {}` +
      `const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;` +
      `setter.call(i, '');` +
      `i.dispatchEvent(new Event('input', { bubbles: true }));` +
      `return true;` +
      `})()`,
  );
}
