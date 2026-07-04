import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountHoverButton, destroyHoverButton, isHoverButton } from '../lib/trends/hover-ui';

describe('trends hover ui', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
  });

  afterEach(() => {
    destroyHoverButton();
    vi.unstubAllGlobals();
  });

  it('mountHoverButton 创建固定定位按钮并显示', () => {
    const anchor = document.createElement('span');
    anchor.textContent = 'apple';
    document.body.appendChild(anchor);

    const onAsk = vi.fn();
    mountHoverButton(anchor, onAsk);

    const btn = document.getElementById('autoseo-trends-ask-gemini') as HTMLButtonElement;
    expect(btn).toBeInTheDocument();
    expect(btn?.style.display).toBe('block');
    expect(btn?.style.position).toBe('fixed');
    expect(btn?.textContent).toBe('问 Gemini');
    expect(isHoverButton(btn)).toBe(true);
  });

  it('点击按钮触发 onAsk', () => {
    const anchor = document.createElement('span');
    document.body.appendChild(anchor);
    const onAsk = vi.fn();
    mountHoverButton(anchor, onAsk);

    const btn = document.getElementById('autoseo-trends-ask-gemini') as HTMLButtonElement;
    btn.click();
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('destroyHoverButton 隐藏按钮', () => {
    const anchor = document.createElement('span');
    document.body.appendChild(anchor);
    mountHoverButton(anchor, () => {});

    destroyHoverButton();
    const btn = document.getElementById('autoseo-trends-ask-gemini') as HTMLButtonElement;
    expect(btn?.style.display).toBe('none');
  });

  it('按钮默认渲染在关键词右侧', () => {
    const anchor = document.createElement('span');
    anchor.textContent = 'apple';
    document.body.appendChild(anchor);

    // 给 anchor 一个确定的可视矩形。
    const rect = { top: 100, right: 150, bottom: 120, left: 100, width: 50, height: 20 } as DOMRect;
    anchor.getBoundingClientRect = () => rect;

    mountHoverButton(anchor, () => {});
    const btn = document.getElementById('autoseo-trends-ask-gemini') as HTMLButtonElement;
    const left = parseInt(btn.style.left ?? '0', 10);
    expect(left).toBeGreaterThanOrEqual(rect.right);
  });
});
