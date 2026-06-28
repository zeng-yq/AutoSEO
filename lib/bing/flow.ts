/**
 * Bing Webmaster Tools「Request indexing」流程。
 *
 * 实现依据：docs/superpowers/notes/bing-probe.md §2（VERIFIED 2026-06-28）。
 * 关键运行事实（来自真实页面探测）：
 *  - Bing 的检查输入框是 **ms-TextField（React 受控组件）**：直接 `input.value=` 会被覆盖，
 *    必须用 `HTMLInputElement.prototype` 的 native value setter + 派发 `input` 事件。见 §2.2。
 *  - 检查由**点击「Inspect」按钮**触发（`<button data-tag=inspectBtn>`），**不**派发回车
 *    （与 GSC 的回车触发不同）。见 §2.3。
 *  - 点击用**页面内 `el.click()`**（非 Input.dispatchMouseEvent）：chrome.debugger 后台 tab
 *    下后者不触发框架点击（GSC 已实测），前者是 Runtime.evaluate 里的纯 DOM 调用，可靠。见 §2.3。
 *  - 提交是**两步按钮流程**（与 GSC 单按钮不同）：点「Request indexing」→ 弹出确认弹窗
 *    （role=dialog「Are you sure…Quota left for today」）→ 点「Submit」→ 弹窗自动关闭 +
 *    出现 `<span role=alert>Indexing requested.</span>`。见 §2.5/§2.6/§2.7。
 *  - 已索引 / 未发现两态都显示「Request indexing」按钮（与 GSC 同坑）→ 已索引判定**只看
 *    「Indexed successfully」文案**，不叠加按钮缺失条件。见 §2.4。
 *  - 每次新 inspect 会刷新结果区、清除上一次「Indexing requested.」残留 → submit 后轮询
 *    successIndicator 不会误命中上一次。见 §2.7。
 *
 * 因此 flow = 等输入就绪 → native setter 填值 → 点 Inspect → 等结果区 →
 * 分类（已索引→跳过 / 否则→提交）→ 点 Request indexing → 等确认弹窗 → 点 Submit →
 * 轮询「Indexing requested.」成功提示（60s）→ 清空输入框（供下一条复用）。
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

/** 输入框就绪等待（页面初次加载）。 */
const INPUT_READY_TIMEOUT = 30000;
/** 检查结果区出现的最长等待（§2.4：点 Inspect 后先弹 Getting status 弹窗，~5-15s 出结果，留余量到 30s）。 */
const INSPECT_TIMEOUT = 30000;
/**
 * 点 Request indexing 后等确认弹窗出现的等待。
 * chrome.debugger 后台 tab 下弹窗渲染 / Submit 按钮命中可能滞后，留 30s 余量。
 */
const CONFIRM_TIMEOUT = 30000;
/**
 * 成功提示轮询超时。§2.7：点 Submit 后确认弹窗自动关闭、随即出现「Indexing requested.」，
 * 通常数秒内。给到 60s 兜底，每 3s 轮询一次。
 */
const SUCCESS_TIMEOUT = 60000;
const SUCCESS_INTERVAL = 3000;
/** 连续配额命中达到该阈值即熔断剩余批次（Bing 为每日配额，耗尽后后续全失败）。 */
const QUOTA_THRESHOLD = 3;

/**
 * 单条 URL 的「Request indexing」步骤机。
 *
 * 步骤（对应 bing-probe.md §2）：
 *  1. 等输入框就绪（§2.1）。
 *  2. native setter 填值（§2.2，不派发回车——Bing 靠按钮触发）。
 *  3. 点击「Inspect」按钮（§2.3，点击而非回车）。
 *  4. 等待结果区出现（§2.4，getting 弹窗结束后 .urlInspectionSectionTitle 非空）。
 *  5. 分类：isAlreadyIndexed（文案命中）→ 已索引跳过；否则视为可提交（不区分 Not discovered /
 *     Discovered but not crawled 两态，只要 Request indexing 按钮存在且未禁用即提交）。已索引判定
 *     **不**依赖按钮缺失（实测两态都有按钮，见 §2.4）。
 *  6. 点「Request indexing」→ 弹出确认弹窗（§2.5）。
 *  7. 等确认弹窗的「Submit」按钮出现 + 校验未禁用（§2.6，配额耗尽时 Submit 可能禁用）。
 *  8. 点「Submit」→ 确认弹窗自动关闭 + 出现成功提示（§2.6）。
 *  9. 轮询「Indexing requested.」成功提示（§2.7，60s / 3s 间隔）；超时兜底判配额。
 *  10. native setter 清空输入框（§2.8，供下一条复用）。
 */
export async function submitOne(
  target: Target,
  url: string,
  log?: StepLog,
): Promise<SubmitResult> {
  // ① 等输入框就绪（§2.1）
  const inputReady = await waitForStep(target, `!!(${PROBES.inspectInput})`, {
    name: '等输入框就绪', timeoutMs: INPUT_READY_TIMEOUT, phase: 'inspect', log,
  });
  if (!inputReady) return { url, status: 'skipped', reason: '输入框未就绪' };

  // ② native setter 填值（§2.2，URL 经 JSON.stringify 注入；不派发回车）
  await evalJs<boolean>(target, fillExpr(url));
  log?.({ level: 'info', phase: 'inspect', message: '已填值' });

  // ③ 点击「Inspect」按钮（§2.3，页面内 el.click()；Bing 靠按钮触发检查）
  await evalJs<boolean>(target, clickExpr(PROBES.inspectBtn));
  log?.({ level: 'info', phase: 'inspect', message: '点击 Inspect' });

  // ④ 等结果区出现（§2.4，getting 弹窗结束后 sections 非空）
  const ready = await waitForStep(target, PROBES.resultReady, {
    name: '等结果区', timeoutMs: INSPECT_TIMEOUT, phase: 'inspect', log,
  });
  if (!ready) return { url, status: 'skipped', reason: '检查结果未出现' };

  // ⑤ 分类：先判已索引（§2.4，只看文案；已索引页也显示 Request indexing 按钮）
  if (await evalJs<boolean>(target, PROBES.isAlreadyIndexed)) {
    return { url, status: 'skipped', reason: '已索引' };
  }

  // ⑥ 找「Request indexing」按钮 + 校验未禁用（§2.5）
  const riInfo = await evalJs<{ button: boolean; disabled: boolean }>(target, btnProbeExpr(PROBES.requestIndexingButton));
  if (!riInfo.button) return { url, status: 'skipped', reason: '无 Request indexing 按钮' };
  if (riInfo.disabled) return { url, status: 'skipped', reason: '按钮禁用' };

  // ⑦ 点击「Request indexing」→ 弹出确认弹窗（§2.5）
  await evalJs<boolean>(target, clickExpr(PROBES.requestIndexingButton));
  log?.({ level: 'info', phase: 'submit', message: '点击「Request indexing」' });

  // ⑧ 等确认弹窗出现（§2.6）。以 role=dialog 为权威就绪信号。
  const confirmReady = await waitForStep(target, PROBES.confirmDialog, {
    name: '等确认弹窗', timeoutMs: CONFIRM_TIMEOUT, phase: 'submit', log,
  });
  if (!confirmReady) {
    if (await evalJs<boolean>(target, PROBES.isQuota)) return { url, status: 'skipped', reason: '配额' };
    const diag = await evalJs<{ dialog: number; submit: number; deep: number }>(target, CONFIRM_DIAG_EXPR).catch(() => null);
    return { url, status: 'skipped', reason: `确认弹窗未出现${diag ? `(dialog=${diag.dialog},submit=${diag.submit},deep=${diag.deep})` : ''}` };
  }

  // ⑨ 多策略定位 Submit 并点击；Submit 禁用（配额耗尽）则跳过（§2.6）
  const submit = await evalJs<{ found: boolean; disabled: boolean; clicked: boolean }>(target, submitActionExpr());
  if (!submit.found) {
    const diag = await evalJs<{ dialog: number; submit: number; deep: number }>(target, CONFIRM_DIAG_EXPR).catch(() => null);
    return { url, status: 'skipped', reason: `Submit 未找到${diag ? `(dialog=${diag.dialog},submit=${diag.submit},deep=${diag.deep})` : ''}` };
  }
  if (submit.disabled) return { url, status: 'skipped', reason: '配额' };
  log?.({ level: 'info', phase: 'submit', message: '点击 Submit' });

  // ⑩ 轮询「Indexing requested.」成功提示（§2.7，60s / 3s 间隔）
  const ok = await waitForStep(target, PROBES.successIndicator, {
    name: '等 Indexing requested', timeoutMs: SUCCESS_TIMEOUT, intervalMs: SUCCESS_INTERVAL, phase: 'submit', log,
  });
  if (!ok) {
    if (await evalJs<boolean>(target, PROBES.isQuota)) return { url, status: 'skipped', reason: '配额' };
    return { url, status: 'skipped', reason: '提交未确认' };
  }

  // ⑪ 清空输入框（§2.8，供下一条复用，best-effort）
  await resetInput(target).catch(() => undefined);

  return { url, status: 'ok' };
}

/**
 * 批量执行 + 配额熔断（与 GSC runBatch 同构）。
 *
 * - 逐条调用 submitOne，通过 onProgress/onLog 上报状态。
 * - 连续 QUOTA_THRESHOLD 条命中「配额」即熔断，剩余 URL 计为 skipped(未执行)。
 *   Bing 为每日配额，耗尽后后续全失败 → 连续熔断合理。
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
    // 每条结果上日志（含 reason），便于在 LogPanel 直接看到卡在哪一步（如「Submit 未找到(dialog=1,submit=0,deep=0)」）。
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
 * native setter 填值（§2.2）。ms-TextField 是 React 受控组件，直接赋值会被覆盖。
 * 不派发回车——Bing 的检查由点击 Inspect 按钮触发（§2.3）。
 */
function fillExpr(url: string): string {
  return (
    `(() => {` +
    `const i = ${PROBES.inspectInput};` +
    `if (!i) return false;` +
    `i.focus();` +
    `const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;` +
    `setter.call(i, ${JSON.stringify(url)});` +
    `i.dispatchEvent(new Event('input', { bubbles: true }));` +
    `return true;` +
    `})()`
  );
}

/**
 * 页面内点击（§2.3）。⚠️ chrome.debugger 后台 tab 下 Input.dispatchMouseEvent 不触发框架点击
 * （GSC 已实测）；改用 Runtime.evaluate 里的纯 DOM `el.click()`，后台 tab 可靠。
 */
function clickExpr(elExpr: string): string {
  return (
    `(() => {` +
    `const b = ${elExpr};` +
    `if (!b) return false;` +
    `b.scrollIntoView({ block: 'center' });` +
    `b.click();` +
    `return true;` +
    `})()`
  );
}

/**
 * 探测按钮并读取禁用态（§2.5/§2.6）。Bing 按钮是真 `<button>`，有 `disabled` 属性；
 * 同时兼容 `aria-disabled="true"`（fabric 组件偶用）。
 * 返回 { button: 是否存在, disabled: 是否禁用 }。
 */
function btnProbeExpr(elExpr: string): string {
  return (
    `(() => {` +
    `const b = ${elExpr};` +
    `if (!b) return { button: false, disabled: true };` +
    `return { button: true, disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true' };` +
    `})()`
  );
}

/**
 * 多策略定位并点击 Submit（§2.6）。
 * 策略：① `[data-tag=submitBtn]` → ② 确认弹窗内 aria-label/文本为 Submit 的 button → ③ shadow DOM 深度穿透。
 * 返回 { found, disabled, clicked }——Submit 禁用（配额耗尽）时不点击。
 *
 * 背景：实测 submitBtn 在主文档可查（bing-probe §2.6 诊断 directFound=true），但 chrome.debugger 后台 tab
 * 下偶发 querySelector 命中滞后，故用弹窗内按钮 + shadow 穿透兜底，确保点中。
 */
function submitActionExpr(): string {
  return (
    `(() => {` +
    `let b = document.querySelector('[data-tag="submitBtn"]');` +
    `if (!b) {` +
    `const dlg = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(d => /are you sure|submit following/i.test(d.textContent || ''));` +
    `if (dlg) b = [...dlg.querySelectorAll('button')].find(x => /submit/i.test(x.getAttribute('aria-label') || '') || /^submit$/i.test((x.textContent || '').trim()));` +
    `}` +
    `if (!b) {` +
    `const stack = [document];` +
    `while (stack.length && !b) {` +
    `const root = stack.pop();` +
    `try {` +
    `const hit = root.querySelector('[data-tag="submitBtn"]');` +
    `if (hit) { b = hit; break; }` +
    `root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) stack.push(el.shadowRoot); });` +
    `} catch (x) {}` +
    `}` +
    `}` +
    `if (!b) return { found: false, disabled: false, clicked: false };` +
    `const disabled = b.disabled === true || b.getAttribute('aria-disabled') === 'true';` +
    `if (disabled) return { found: true, disabled: true, clicked: false };` +
    `b.scrollIntoView({ block: 'center' });` +
    `b.click();` +
    `return { found: true, disabled: false, clicked: true };` +
    `})()`
  );
}

/** 确认弹窗诊断快照（dialog 数 / 主文档 submit 数 / 含 shadow 的 submit 总数），用于失败 reason 供排查。 */
const CONFIRM_DIAG_EXPR =
  `(() => {` +
  `let deep = 0;` +
  `const stack = [document];` +
  `while (stack.length) {` +
  `const root = stack.pop();` +
  `try {` +
  `deep += root.querySelectorAll('[data-tag="submitBtn"]').length;` +
  `root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) stack.push(el.shadowRoot); });` +
  `} catch (x) {}` +
  `}` +
  `return { dialog: document.querySelectorAll('[role=dialog],[role=alertdialog]').length, submit: document.querySelectorAll('[data-tag="submitBtn"]').length, deep };` +
  `})()`;

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
