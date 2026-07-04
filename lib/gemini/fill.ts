/**
 * Gemini 页面兜底填充与自动提交。
 *
 * 当 URL 携带 ?prompt=... 且 Gemini 未自动识别该参数时，
 * 本脚本等待输入框出现，填入 prompt 并触发发送。
 */

const PROMPT_PARAM = 'prompt';

/**
 * 等待任意一个 selector 命中元素，超时返回 null。
 * 使用 MutationObserver 监听 DOM 变化，避免 SPA 懒加载导致错过。
 */
function waitForElement(
  selectors: string[],
  timeoutMs = 10000,
  root: Document | Element = document,
): Promise<Element | null> {
  const existing = selectors.map((s) => root.querySelector(s)).find(Boolean);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const found = selectors.map((s) => root.querySelector(s)).find(Boolean);
      if (found) {
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** 查找发送按钮。 */
function findSendButton(): HTMLElement | null {
  return document.querySelector(
    '[data-test-id="send-button"], button[aria-label*="Send" i], button[aria-label*="发送" i]',
  ) as HTMLElement | null;
}

/** 设置输入值并触发 React / 框架能感知的事件。 */
function setInputValue(el: Element, value: string): void {
  if (el.tagName.toLowerCase() === 'textarea' && el instanceof HTMLTextAreaElement) {
    const textarea = el;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, value);
    } else {
      textarea.value = value;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // contenteditable 兜底
  el.textContent = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

/** 读取 URL 中的 prompt 参数并消费它，防止刷新后重复提交。 */
function consumePrompt(): string | null {
  const params = new URLSearchParams(location.search);
  const prompt = params.get(PROMPT_PARAM);
  if (!prompt) return null;

  params.delete(PROMPT_PARAM);
  const query = params.toString();
  const newUrl = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  history.replaceState(null, '', newUrl);
  return prompt;
}

export async function autoFillFromUrl(): Promise<void> {
  const prompt = consumePrompt();
  if (!prompt) return;

  // 等待输入框出现；Gemini 是 SPA，textarea 可能延迟渲染。
  const input = await waitForElement([
    'textarea[data-test-id="input-text"]',
    'textarea[placeholder*="Ask" i]',
    'textarea[aria-label*="Ask" i]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ]);
  if (!input) return;

  setInputValue(input, prompt);

  // 稍微延迟再点发送，让框架完成状态更新。
  window.setTimeout(() => {
    const sendBtn = findSendButton();
    sendBtn?.click();
  }, 100);
}
