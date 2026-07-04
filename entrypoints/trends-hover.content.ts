import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractKeywordFromElement, findKeywordAnchor } from '@lib/trends/keyword-detector';
import { destroyHoverButton, isHoverButton, mountHoverButton } from '@lib/trends/hover-ui';
import { askGemini } from '@lib/gemini/open';

export default defineContentScript({
  matches: [
    'https://trends.google.com/trends/explore*',
    'https://trends.google.com/explore*',
  ],
  runAt: 'document_idle',
  main() {
    // 防止 WXT 重复注入导致事件监听重复挂载。
    const marker = '__autoseoTrendsHoverInitialized';
    if ((window as unknown as Record<string, unknown>)[marker]) return;
    (window as unknown as Record<string, unknown>)[marker] = true;

    let currentAnchor: HTMLElement | null = null;
    let hideTimer: number | null = null;

    function hide() {
      destroyHoverButton();
      currentAnchor = null;
    }

    document.body.addEventListener('mouseover', (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      const target = e.target;
      if (isHoverButton(target)) return;

      // 先取消之前的隐藏计时，避免快速重 hover 时按钮被误删。
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }

      const anchor = findKeywordAnchor(target);
      if (!anchor || anchor === currentAnchor) return;

      const keyword = extractKeywordFromElement(anchor);
      if (!keyword) return;

      currentAnchor = anchor;
      mountHoverButton(anchor, () => askGemini(keyword));
    });

    document.body.addEventListener('mouseout', (e) => {
      const related = e.relatedTarget as Node | null;
      if (related && (currentAnchor?.contains(related) || isHoverButton(related))) {
        return;
      }
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => hide(), 60);
    });
  },
});
