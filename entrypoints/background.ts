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
import { evalJs, waitForLoad, waitForPredicate } from '../lib/cdp/actions';
import { runBatch } from '../lib/gsc/flow';
import { buildGscUrl } from '../lib/gsc/url';
import { PROBES } from '../lib/gsc/selectors';
import { getProjectById } from '../lib/storage/projects';
import { getSettings } from '../lib/storage/settings';
import { GSC_PORT_NAME } from '../lib/messaging/protocol';
import type { GscRequest, GscEvent } from '../lib/messaging/types';

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

export default defineBackground(() => {
  /** 取消标志；GSC_CANCEL 置 true，runBatch 下一条 URL 前自检。 */
  let stopRequested = false;
  /** 当前活跃 port；UI 断开即视为放弃（清空以便后续 GSC_START 复用）。 */
  let currentPort: chrome.runtime.Port | null = null;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== GSC_PORT_NAME) return;
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
  });

  /**
   * 编排一次批量执行。
   *
   * 流程：取项目/设置 → 开 tab → attach → 等 SPA 就绪（§1）→ 登录/权限前置检查（§3）
   *   → runBatch（推 GSC_STATE / GSC_LOG，shouldStop 接 stop 标志）→ 推 GSC_DONE → detach。
   * 任一阶段失败：推 error 日志 + GSC_DONE(0/0/0)，确保 UI 一定能收到结束事件。
   */
  async function handleStart(
    port: chrome.runtime.Port,
    msg: { projectId: string; urls: string[] },
  ): Promise<void> {
    stopRequested = false;

    const project = await getProjectById(msg.projectId);
    if (!project) {
      emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: '项目不存在' });
      emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: 0 });
      return;
    }

    const { accountIndex } = await getSettings();
    const gscUrl = buildGscUrl(project.domain, accountIndex);

    emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: '打开 GSC…' });
    const tab = await chrome.tabs.create({ url: gscUrl, active: false });
    const target: Target = { tabId: tab.id! };
    await attach(target);

    try {
      // 先等 readyState（best-effort，忽略其超时），再以 href+输入框 为权威就绪信号（§1）。
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

      // 登录态/权限态前置检查（§3）：未登录或无权限则不驱动登录，直接以 0 汇总结束。
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
        emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `当前账号无 ${project.domain} 资源权限` });
        emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: 0 });
        return;
      }

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

  /** 经 port 推送一个 GscEvent；若 port 已断开则静默忽略。 */
  function emit(port: chrome.runtime.Port, e: GscEvent): void {
    try {
      port.postMessage(e);
    } catch {
      // port 已断开（UI 关闭/刷新），忽略。
    }
  }
});
