/**
 * Google Trends 页面关键词元素识别。
 *
 * 仅识别两类明确的关键词元素：
 *  1. 主查询/比较查询输入框：
 *     `<input value="..." aria-label="..." data-index="N" data-axe="mdc-autocomplete">`
 *  2. Related / Rising / Top 查询词：
 *     `<span class="Z9Uqw">...</span>`
 *
 * 不再使用“任意文本兜底”策略，避免鼠标移到删除按钮、下拉菜单等位置时误出按钮。
 */

export type KeywordType = 'main' | 'compare' | 'related' | 'rising' | 'top' | 'unknown';

const MAX_KEYWORD_LENGTH = 120;

/** 主查询/比较查询输入框。 */
function isTrendsKeywordInput(el: HTMLElement): boolean {
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (!input.value.trim()) return false;
  if (input.getAttribute('data-axe') !== 'mdc-autocomplete') return false;
  if (input.getAttribute('data-index') === null) return false;
  return true;
}

/** Related / Rising / Top 等列表中的查询词。 */
function isTrendsRelatedTerm(el: HTMLElement): boolean {
  return el.tagName === 'SPAN' && el.classList.contains('Z9Uqw');
}

/** 从元素中提取关键词文本。 */
export function extractKeywordFromElement(el: HTMLElement): string | null {
  let raw = '';

  if (isTrendsKeywordInput(el)) {
    raw = (el as HTMLInputElement).value;
  } else if (isTrendsRelatedTerm(el)) {
    raw = el.textContent ?? '';
  } else {
    return null;
  }

  const kw = raw.split('\n')[0].trim();
  if (!kw || kw.length > MAX_KEYWORD_LENGTH) return null;
  return kw;
}

/** 判断元素是否可视为关键词。 */
export function isKeywordElement(el: HTMLElement): boolean {
  if (!el || el === document.body || el === document.documentElement) return false;
  return isTrendsKeywordInput(el) || isTrendsRelatedTerm(el);
}

/** 从事件目标向上寻找最近的关键词元素。 */
export function findKeywordAnchor(start: HTMLElement): HTMLElement | null {
  if (!start || start === document.body || start === document.documentElement) return null;

  // 排除按钮、链接等控件本身，避免 hover 在删除按钮上时误触发。
  if (start.closest('button, a, [role="button"], [role="link"]')) {
    const self = start.closest('button, a, [role="button"], [role="link"]') as HTMLElement;
    if (self === start || self.contains(start)) return null;
  }

  // 1) 本身就是关键词输入框。
  if (isTrendsKeywordInput(start)) return start;

  // 2) span.Z9Uqw 及其内部子节点。
  const related = start.closest('.Z9Uqw') as HTMLElement | null;
  if (related && isTrendsRelatedTerm(related)) return related;

  // 3) 落在主查询/比较查询的输入框容器内（例如 hover 在 label span 上）。
  const container = start.closest('[data-idom-container-class="fzfY1e"]') as HTMLElement | null;
  if (container) {
    const input = container.querySelector('input[data-axe="mdc-autocomplete"]') as HTMLInputElement | null;
    if (input && isTrendsKeywordInput(input)) return input;
  }

  // 4) 向上查找“只包含一个关键词输入框”的祖先，处理 disabled input 不触发事件、
  //    但 hover 落在其外层容器/label 上的情况。
  let ancestor: HTMLElement | null = start.parentElement;
  let depth = 0;
  while (ancestor && ancestor !== document.body && depth < 6) {
    const inputs = Array.from(ancestor.querySelectorAll('input')).filter(isTrendsKeywordInput);
    if (inputs.length === 1) return inputs[0];
    ancestor = ancestor.parentElement;
    depth++;
  }

  // 5) 向上回溯，兜底识别直接的关键词元素。
  let node: HTMLElement | null = start;
  while (node && node !== document.body) {
    if (isKeywordElement(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** 识别关键词类型。 */
export function getKeywordType(el: HTMLElement): KeywordType {
  if (isTrendsKeywordInput(el)) {
    // data-index="0" 视为主查询，其余作为比较查询。
    const idx = (el as HTMLInputElement).getAttribute('data-index');
    return idx === '0' ? 'main' : 'compare';
  }
  if (isTrendsRelatedTerm(el)) return 'related';
  return 'unknown';
}
