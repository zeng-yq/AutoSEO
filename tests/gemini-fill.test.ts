import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autoFillFromUrl } from '../lib/gemini/fill';

describe('gemini fill', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('读取 URL prompt 参数、填入 textarea 并点击发送按钮', async () => {
    vi.stubGlobal('location', { search: '?prompt=explain%20ai', pathname: '/app', hash: '' });
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });

    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-test-id', 'input-text');
    const sendBtn = document.createElement('button');
    sendBtn.setAttribute('aria-label', 'Send message');
    document.body.appendChild(textarea);
    document.body.appendChild(sendBtn);

    const clickSpy = vi.spyOn(sendBtn, 'click');

    await autoFillFromUrl();
    expect(textarea.value).toBe('explain ai');

    vi.advanceTimersByTime(150);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app');
  });

  it('无 prompt 参数时不操作', async () => {
    vi.stubGlobal('location', { search: '', pathname: '/app', hash: '' });
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    await autoFillFromUrl();
    expect(textarea.value).toBe('');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('contenteditable 输入框也能填写', async () => {
    vi.stubGlobal('location', { search: '?prompt=hello', pathname: '/app', hash: '' });
    vi.stubGlobal('history', { replaceState: vi.fn() });

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('role', 'textbox');
    document.body.appendChild(editable);

    await autoFillFromUrl();
    expect(editable.textContent).toBe('hello');
  });
});
