/**
 * Google Trends 页面悬浮按钮。
 *
 * 在关键词元素右侧渲染一个固定定位的小按钮，点击后调用 onAsk。
 */

const BUTTON_ID = 'autoseo-trends-ask-gemini';
const GAP = 6;

function createButton(): HTMLButtonElement {
  const existing = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (existing) return existing;

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.textContent = '问 Gemini';
  btn.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'padding:4px 10px',
    'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:12px',
    'font-weight:600',
    'line-height:1.4',
    'color:#fff',
    'background:#4285F4',
    'border:none',
    'border-radius:6px',
    'box-shadow:0 2px 6px rgba(0,0,0,0.18)',
    'cursor:pointer',
    'white-space:nowrap',
    'display:none',
  ].join(';');

  // 悬停在按钮上时保持显示
  btn.addEventListener('mouseenter', () => { btn.style.display = 'block'; });
  btn.addEventListener('mouseleave', destroyHoverButton);

  document.body.appendChild(btn);
  return btn;
}

export function mountHoverButton(anchor: HTMLElement, onAsk: () => void): void {
  const btn = createButton();
  btn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onAsk();
  };

  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 先显示按钮才能拿到真实尺寸，但用 visibility:hidden 避免在错误位置闪烁。
  btn.style.display = 'block';
  btn.style.visibility = 'hidden';
  const btnWidth = btn.offsetWidth || 72;
  const btnHeight = btn.offsetHeight || 24;

  // 默认放在关键词右侧（fixed 定位使用视口坐标，不带 scroll 偏移）。
  let left = rect.right + GAP;
  let top = rect.top;

  // 如果右侧空间不足，放到左侧
  if (left + btnWidth > viewportWidth) {
    left = rect.left - btnWidth - GAP;
  }

  // 如果底部空间不足，向上微调
  if (top + btnHeight > viewportHeight) {
    top = rect.bottom - btnHeight;
  }

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  btn.style.visibility = 'visible';
}

export function destroyHoverButton(): void {
  const btn = document.getElementById(BUTTON_ID);
  if (btn) {
    btn.style.display = 'none';
    btn.onclick = null;
  }
}

export function isHoverButton(el: unknown): boolean {
  return el instanceof HTMLElement && el.id === BUTTON_ID;
}
