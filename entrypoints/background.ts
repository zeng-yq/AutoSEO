/**
 * Background service worker：GSC 批量「请求编入索引」编排。
 *
 * 职责：
 *  - 监听命名 port（`gsc-runner`），接收 UI 的 GSC_START / GSC_CANCEL 请求。
 *  - GSC_START：开后台 tab → CDP attach → 等 GSC SPA 真正就绪（href + 输入框）
 *    → 登录/权限前置检查 → runBatch（逐条提交，经 port 推 GSC_STATE / GSC_LOG）
 *    → detach → GSC_DONE 汇总。
 *  - GSC_CANCEL：置 stop 标志；runBatch 在下一条 URL 前自检（shouldStop）。
 *
 * 加固依据 docs/superpowers/notes/gsc-probe.md：
 *  - §1 CDP proxy 运维发现：chrome.tabs.create 的 tab 可能停在 about:blank，
 *    waitForLoad 仅轮询 readyState==='complete'，对 GSC 重 SPA 不可靠 →
 *    改为轮询 `location.href` 以 `https://search.google.com` 开头 且
 *    `PROBES.inspectInput` 命中（30s 超时）。
 *  - §3 登录态/权限态识别：runBatch 前先 evalJs 一次性检测 isLoginScreen /
 *    needsVerify；命中即推 error 日志 + GSC_DONE(0/0/0) 并 detach 返回，
 *    不尝试驱动登录。
 */

import { attach, detach, type Target } from '../lib/cdp/client';
import { evalJs, waitForLoad, waitForPredicate, fmtMs } from '../lib/cdp/actions';
import { runBatch } from '../lib/gsc/flow';
import { buildGscUrl } from '../lib/gsc/url';
import { PROBES } from '../lib/gsc/selectors';
import { runBatch as bingRunBatch } from '../lib/bing/flow';
import { buildBingUrl } from '../lib/bing/url';
import { PROBES as BING_PROBES } from '../lib/bing/selectors';
import { getSettings } from '../lib/storage/settings';
import { GSC_PORT_NAME, BING_PORT_NAME } from '../lib/messaging/protocol';
import type { GscRequest, GscEvent, BingRequest, BingEvent, GeminiOpen } from '../lib/messaging/types';

/**
 * GSC SPA 加载完成的等待超时。
 * gsc-probe §1：首条 poll 多数秒级命中，重 SPA 下偶发偏慢，留 30s 余量。
 */
const GSC_LOAD_TIMEOUT_MS = 30000;
const GSC_LOAD_INTERVAL_MS = 1000;

/**
 * 登录/权限检测表达式（gsc-probe §3 verbatim）。
 * 返回一个 JSON 字符串，避免多次 evalJs + 跨字段取值。
 */
const LOGIN_CHECK_EXPR =
  `JSON.stringify({` +
  `url: location.href,` +
  `hasInspectInput: !!(${PROBES.inspectInput}),` +
  `isLoginScreen: /accounts\\.google\\.com|signin/i.test(location.href),` +
  `needsVerify: ${PROBES.isNotOwned}` +
  `})`;

/** Bing SPA 加载完成的等待超时（与 GSC 同量级，bing-probe §1）。 */
const BING_LOAD_TIMEOUT_MS = 30000;
const BING_LOAD_INTERVAL_MS = 1000;

/**
 * Bing 登录态检测表达式（bing-probe §3）。
 * Bing 的 siteUrl 资源权限由 URL 参数锁定，无 GSC 的 needsVerify 分支；未登录会跳登录页。
 */
const BING_LOGIN_CHECK_EXPR =
  `JSON.stringify({` +
  `url: location.href,` +
  `hasInspectInput: !!(${BING_PROBES.inspectInput}),` +
  `isLoginScreen: /login|signin|account\\.live\\.com|identity/i.test(location.href)` +
  `})`;

export default defineBackground(() => {
  // 点击工具栏图标打开 sidepanel（MV3 sidePanel API）。失败静默：旧 Chrome 无此 API。
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  /** content script 请求打开 Gemini 新标签。 */
  chrome.runtime.onMessage.addListener((msg: GeminiOpen, _sender, sendResponse) => {
    if (msg?.type === 'OPEN_GEMINI' && typeof msg.url === 'string') {
      let url: URL;
      try {
        url = new URL(msg.url);
      } catch {
        sendResponse({ ok: false, error: 'invalid url' });
        return true;
      }
      if (url.protocol !== 'https:' || url.hostname !== 'gemini.google.com') {
        sendResponse({ ok: false, error: 'disallowed url' });
        return true;
      }
      chrome.tabs
        .create({ url: msg.url, active: true })
        .then(() => sendResponse({ ok: true }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    return false;
  });

  /** 取消标志；GSC_CANCEL 置 true，runBatch 下一条 URL 前自检。 */
  let stopRequested = false;
  /** 当前活跃 port；UI 断开即视为放弃（清空以便后续 GSC_START 复用）。 */
  let currentPort: chrome.runtime.Port | null = null;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === GSC_PORT_NAME) {
      currentPort = port;

      port.onMessage.addListener((msg: GscRequest) => {
        // GSC_START 是异步长流程；GSC_CANCEL 仅置标志。
        if (msg.type === 'GSC_START') {
          void handleStart(port, msg);
        } else if (msg.type === 'GSC_CANCEL') {
          stopRequested = true;
        }
      });

      port.onDisconnect.addListener(() => {
        if (currentPort === port) currentPort = null;
      });
    } else if (port.name === BING_PORT_NAME) {
      // Bing runner：闭包持有独立 stop 标志（与 GSC 互不干扰）。
      let bingStop = false;
      port.onMessage.addListener((msg: BingRequest) => {
        if (msg.type === 'BING_START') {
          void handleBingStart(port, msg, () => bingStop);
        } else if (msg.type === 'BING_CANCEL') {
          bingStop = true;
        }
      });
    }
  });

  /**
   * 编排一次批量执行。
   *
   * 流程：取设置（accountIndex）→ 开 tab → attach → 等 SPA 就绪（§1）→ 登录/权限前置检查（§3）
   *   → runBatch（推 GSC_STATE / GSC_LOG，shouldStop 接 stop 标志）→ 推 GSC_DONE → detach。
   * 任一阶段失败：推 error 日志 + GSC_DONE(0/0/0)，确保 UI 一定能收到结束事件。
   *
   * ── SW 生命周期（spec §5/§13，accepted risk for v1）──────────────────────────
   * (a) 本批次的所有运行态（stopRequested / currentPort / runBatch 进度）都只存在于
   *     SW 的 module scope；MV3 在长任务中可能回收 SW，丢失这些状态。
   * (b) 实际风险低：runBatch 在每条 URL 的「成功 toast」等待期间每 6s 调一次 CDP
   *     evalJs 轮询（SUCCESS_INTERVAL），CDP 事件会重置 SW 的 keepalive 计时器，
   *     使 SW 在整个批量执行期间保持存活。
   * (c) 接受的风险：若 SW 仍在批次中途被回收，GSC tab 可能停留在
   *     「debugger-attached」状态（detach 未执行）。v1 不实现 resume/重连逻辑（YAGNI）；
   *     用户重新触发 GSC_START 会开新 tab，残留 debugger 可手动关闭或随 tab 关闭释放。
   * ──────────────────────────────────────────────────────────────────────────
   */
  async function handleStart(
    port: chrome.runtime.Port,
    msg: { domain: string; urls: string[] },
  ): Promise<void> {
    stopRequested = false;

    const { accountIndex } = await getSettings();
    const gscUrl = buildGscUrl(msg.domain, accountIndex);

    emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: '打开 GSC…' });
    const tab = await chrome.tabs.create({ url: gscUrl, active: false });
    const target: Target = { tabId: tab.id! };
    await attach(target);

    try {
      // 先等 readyState（best-effort，忽略其超时），再以 href+输入框 为权威就绪信号（§1）。
      const t0 = Date.now();
      await waitForLoad(target).catch(() => undefined);
      const ready = await waitForPredicate(
        target,
        `location.href.startsWith('https://search.google.com') && !!(${PROBES.inspectInput})`,
        { timeoutMs: GSC_LOAD_TIMEOUT_MS, intervalMs: GSC_LOAD_INTERVAL_MS },
      );
      if (!ready) {
        emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: 'GSC 页面加载超时' });
        emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }
      emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: `页面就绪 ✓ (${fmtMs(Date.now() - t0)})` });

      // 登录态/权限态前置检查（§3）
      const check = await evalJs<{
        isLoginScreen: boolean;
        needsVerify: boolean;
      }>(target, LOGIN_CHECK_EXPR);
      if (check.isLoginScreen) {
        emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: '未登录 Google，请在浏览器登录后重试' });
        emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }
      if (check.needsVerify) {
        emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `当前账号无 ${msg.domain} 资源权限` });
        emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }
      emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: '登录态正常' });

      // 批量提交；stopRequested 作为 shouldStop 传入，GSC_CANCEL 可在下一条 URL 前中止。
      const summary = await runBatch(target, msg.urls, {
        onProgress: (s) =>
          emit(port, {
            type: 'GSC_STATE',
            state: 'running',
            total: s.total,
            done: s.done,
            currentUrl: s.currentUrl,
            results: s.results,
          }),
        onLog: (e) =>
          emit(port, { type: 'GSC_LOG', level: e.level, phase: e.phase, message: e.message }),
        shouldStop: () => stopRequested,
      });

      emit(port, {
        type: 'GSC_DONE',
        ok: summary.ok,
        failed: summary.failed,
        skipped: summary.skipped,
      });
    } catch (e) {
      emit(port, {
        type: 'GSC_LOG',
        level: 'error',
        phase: 'system',
        message: (e as Error).message ?? String(e),
      });
      emit(port, { type: 'GSC_DONE', ok: 0, failed: 1, skipped: 0 });
    } finally {
      await detach(target).catch(() => undefined);
    }
  }

  /** 经 port 推送一个 GscEvent / BingEvent；若 port 已断开则静默忽略。 */
  function emit(port: chrome.runtime.Port, e: GscEvent | BingEvent): void {
    try {
      port.postMessage(e);
    } catch {
      // port 已断开（UI 关闭/刷新），忽略。
    }
  }

  /**
   * 编排一次 Bing 批量执行（与 handleStart 同构，换 Bing URL/flow/事件）。
   *
   * 流程：用 domain 拼 URL → 开 tab → attach → 等 SPA 就绪（§1）→ 登录前置检查（§3）
   *   → bingRunBatch（推 BING_STATE / BING_LOG，shouldStop 接闭包 stop 标志）→ 推 BING_DONE → detach。
   * 任一阶段失败：推 error 日志 + BING_DONE，确保 UI 一定能收到结束事件。
   * Bing 无需 accountIndex（siteUrl 直接用 domain），故不读 settings。
   */
  async function handleBingStart(
    port: chrome.runtime.Port,
    msg: { domain: string; urls: string[] },
    shouldStop: () => boolean,
  ): Promise<void> {
    const bingUrl = buildBingUrl(msg.domain);

    emit(port, { type: 'BING_LOG', level: 'info', phase: 'system', message: '打开 Bing…' });
    const tab = await chrome.tabs.create({ url: bingUrl, active: false });
    const target: Target = { tabId: tab.id! };
    await attach(target);

    try {
      const t0 = Date.now();
      await waitForLoad(target).catch(() => undefined);
      const ready = await waitForPredicate(
        target,
        `location.href.startsWith('https://www.bing.com/webmasters/urlinspection') && !!(${BING_PROBES.inspectInput})`,
        { timeoutMs: BING_LOAD_TIMEOUT_MS, intervalMs: BING_LOAD_INTERVAL_MS },
      );
      if (!ready) {
        emit(port, { type: 'BING_LOG', level: 'error', phase: 'system', message: 'Bing 页面加载超时' });
        emit(port, { type: 'BING_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }
      emit(port, { type: 'BING_LOG', level: 'info', phase: 'system', message: `页面就绪 ✓ (${fmtMs(Date.now() - t0)})` });

      // 登录态前置检查（§3）
      const check = await evalJs<{ isLoginScreen: boolean }>(target, BING_LOGIN_CHECK_EXPR);
      if (check.isLoginScreen) {
        emit(port, { type: 'BING_LOG', level: 'error', phase: 'system', message: '未登录 Bing Webmaster，请在浏览器登录后重试' });
        emit(port, { type: 'BING_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }
      emit(port, { type: 'BING_LOG', level: 'info', phase: 'system', message: '登录态正常' });

      // 批量提交；shouldStop 接闭包 stop 标志，BING_CANCEL 可在下一条 URL 前中止。
      const summary = await bingRunBatch(target, msg.urls, {
        onProgress: (s) =>
          emit(port, {
            type: 'BING_STATE',
            state: 'running',
            total: s.total,
            done: s.done,
            currentUrl: s.currentUrl,
            results: s.results,
          }),
        onLog: (e) =>
          emit(port, { type: 'BING_LOG', level: e.level, phase: e.phase, message: e.message }),
        shouldStop,
      });

      emit(port, {
        type: 'BING_DONE',
        ok: summary.ok,
        failed: summary.failed,
        skipped: summary.skipped,
      });
    } catch (e) {
      emit(port, {
        type: 'BING_LOG',
        level: 'error',
        phase: 'system',
        message: (e as Error).message ?? String(e),
      });
      emit(port, { type: 'BING_DONE', ok: 0, failed: 1, skipped: 0 });
    } finally {
      await detach(target).catch(() => undefined);
    }
  }
});
