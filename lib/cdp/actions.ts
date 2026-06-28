import { send, type Target } from './client';

export async function waitForLoad(target: Target, timeoutMs = 30000): Promise<void> {
  await send(target, 'Page.enable');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await send<{ result?: { value?: string } }>(target, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result?.value === 'complete') return;
    await new Promise((res) => setTimeout(res, 500));
  }
}

export async function evalJs<T>(target: Target, expression: string): Promise<T> {
  // chrome.debugger.sendCommand 对 Runtime.evaluate 的 resolve 值是单层结构
  // { result: <RemoteObject>, exceptionDetails? }：exceptionDetails 与 result 平级，
  // 而非嵌套在 result 内。与 waitForLoad 的解构保持一致。
  const r = await send<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>(
    target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true },
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval failed');
  return r.result!.value as T;
}

export async function waitForPredicate(
  target: Target, jsPredicate: string, opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await evalJs<boolean>(target, `!!(${jsPredicate})`);
    if (ok) return true;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}

export async function focusSelector(target: Target, selector: string): Promise<boolean> {
  return evalJs<boolean>(target, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.scrollIntoView({block:'center'});el.focus();return true;})()`);
}

export function typeText(target: Target, text: string): Promise<void> {
  return send(target, 'Input.insertText', { text }).then(() => undefined);
}

export async function pressEnter(target: Target): Promise<void> {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send(target, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
  await send(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function clickReal(target: Target, selector: string): Promise<boolean> {
  const coord = await evalJs<{ x: number; y: number } | null>(target,
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!coord) return false;
  await send(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1 });
  await send(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1 });
  return true;
}

/** 步骤日志回调（与 FlowCallbacks.onLog 同构）。 */
export type StepLog = (e: { level: 'info' | 'warn' | 'error'; phase: string; message: string }) => void;

/** 毫秒耗时格式化：<1s 用 ms，否则 s（1 位小数）。 */
export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 等某信号就绪并自动产出「进入 / 完成 / 超时」步骤日志。
 * 内部仍调 waitForPredicate（超时返回 false 不抛），耗时由本函数测量写入 message。
 * log 可选——未传时仅作 waitForPredicate 的语义包装。
 */
export async function waitForStep(
  target: Target,
  jsPredicate: string,
  opts: { name: string; timeoutMs?: number; intervalMs?: number; phase?: string; log?: StepLog },
): Promise<boolean> {
  const phase = opts.phase ?? 'submit';
  opts.log?.({ level: 'info', phase, message: `${opts.name}…` });
  const start = Date.now();
  const ok = await waitForPredicate(target, jsPredicate, {
    timeoutMs: opts.timeoutMs,
    intervalMs: opts.intervalMs,
  });
  const ms = Date.now() - start;
  opts.log?.({
    level: ok ? 'info' : 'warn',
    phase,
    message: `${opts.name} ${ok ? '✓' : '超时'} (${fmtMs(ms)})`,
  });
  return ok;
}
