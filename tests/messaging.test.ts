import { describe, it, expect } from 'vitest';
import { GSC_PORT_NAME, createGscPort } from '../lib/messaging/protocol';
import type { GscRequest, GscEvent } from '../lib/messaging/types';

/**
 * 消息协议单测。
 *
 * 仅做静态契约校验：
 *  - GSC_START / GSC_CANCEL 请求结构。
 *  - GscEvent（GSC_STATE / GSC_LOG / GSC_DONE）字段可与 background 推送的对齐。
 *  - port 名固定为 'gsc-runner'，createGscPort 返回 chrome.runtime.Port。
 *
 * 不实例化 background（它是 MV3 service worker，依赖 chrome.debugger / chrome.tabs，
 * 在 jsdom 下无意义）；background 的行为由真实集成验证覆盖。
 */

describe('messaging types', () => {
  it('GSC_START 结构', () => {
    const m: GscRequest = { type: 'GSC_START', projectId: 'p1', urls: ['https://x.com/'] };
    expect(m.type).toBe('GSC_START');
  });

  it('GSC_CANCEL 结构', () => {
    const m: GscRequest = { type: 'GSC_CANCEL' };
    expect(m.type).toBe('GSC_CANCEL');
  });

  it('GscEvent GSC_LOG 可赋值', () => {
    const e: GscEvent = { type: 'GSC_LOG', level: 'info', phase: 'inspect', message: 'ok' };
    expect(e.type).toBe('GSC_LOG');
  });

  it('GscEvent GSC_STATE 可赋值', () => {
    const e: GscEvent = {
      type: 'GSC_STATE',
      state: 'running',
      total: 3,
      done: 1,
      currentUrl: 'https://x.com/',
      results: [{ url: 'https://x.com/', status: 'ok' }],
    };
    expect(e.type).toBe('GSC_STATE');
  });

  it('GscEvent GSC_DONE 可赋值', () => {
    const e: GscEvent = { type: 'GSC_DONE', ok: 2, failed: 0, skipped: 1 };
    expect(e.type).toBe('GSC_DONE');
  });

  it('port 名固定', () => {
    expect(GSC_PORT_NAME).toBe('gsc-runner');
  });

  it('createGscPort 返回 chrome.runtime.Port', () => {
    const port = createGscPort();
    // setup.ts 的 chrome.runtime.connect 返回一个 mock port 对象
    expect(typeof port.postMessage).toBe('function');
    expect(typeof port.onMessage.addListener).toBe('function');
  });
});
