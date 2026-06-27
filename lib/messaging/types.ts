/**
 * GSC 批量执行的消息协议（side panel UI ↔ background service worker）。
 *
 * 协议基于一条命名 port（见 protocol.ts 的 `gsc-runner`）：
 *  - UI → background：`GscRequest`（GSC_START / GSC_CANCEL）。
 *  - background → UI：`GscEvent`（GSC_STATE / GSC_LOG / GSC_DONE），由 background 主动推送。
 *
 * 字段须与 spec 第 6 节保持一致（Task 14 的 UI 直接消费这些事件）。
 */

/** 启动一次批量「请求编入索引」。 */
export interface GscStart {
  type: 'GSC_START';
  /** 目标项目（提供域名），background 用其 domain 拼 GSC URL。 */
  projectId: string;
  /** 待提交的 URL 列表，逐条经 runBatch 执行。 */
  urls: string[];
}

/** 取消正在运行的批次（background 在下一条 URL 前检查 stop 标志）。 */
export interface GscCancel {
  type: 'GSC_CANCEL';
}

export type GscRequest = GscStart | GscCancel;

/** 单条 URL 的提交结果。`skipped` 用于已索引/不属于/配额/未执行等非成功情形。 */
export type SubmitStatus = 'ok' | 'skipped';

export interface SubmitResult {
  url: string;
  status: SubmitStatus;
  reason?: string;
}

/** 进度/状态推送。每完成一条 URL 即发一次（含累计结果数组）。 */
export interface GscState {
  type: 'GSC_STATE';
  state: 'running' | 'done' | 'canceled';
  total: number;
  done: number;
  currentUrl?: string;
  results: SubmitResult[];
}

/** 日志推送。phase 标识来源阶段（system / inspect / submit / …），便于 UI 分组展示。 */
export interface GscLog {
  type: 'GSC_LOG';
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
}

/** 批次结束汇总。无论正常结束、取消、登录/权限失败都会发一次。 */
export interface GscDone {
  type: 'GSC_DONE';
  ok: number;
  failed: number;
  skipped: number;
}

export type GscEvent = GscState | GscLog | GscDone;
