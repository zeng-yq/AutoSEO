import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractKeywordFromElement,
  findKeywordAnchor,
  getKeywordType,
  isKeywordElement,
} from '../lib/trends/keyword-detector';

describe('trends keyword detector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('识别主查询输入框（data-index="0"）', () => {
    document.body.innerHTML =
      '<input value="audio to midi" aria-label="audio to midi" data-index="0" data-axe="mdc-autocomplete" />';
    const input = document.querySelector('input') as HTMLInputElement;
    expect(extractKeywordFromElement(input)).toBe('audio to midi');
    expect(getKeywordType(input)).toBe('main');
    expect(isKeywordElement(input)).toBe(true);
  });

  it('识别比较查询输入框（data-index="2"）', () => {
    document.body.innerHTML =
      '<input value="pdf to midi" aria-label="pdf to midi" data-index="2" data-axe="mdc-autocomplete" />';
    const input = document.querySelector('input') as HTMLInputElement;
    expect(extractKeywordFromElement(input)).toBe('pdf to midi');
    expect(getKeywordType(input)).toBe('compare');
  });

  it('从输入框容器向上找到关键词锚点', () => {
    document.body.innerHTML = `
      <div class="qdOxv-fmcmS-yrriRe" jsname="rYJt4b" data-idom-container-class="fzfY1e">
        <span>
          <input value="audio to midi" aria-label="audio to midi" data-index="2" data-axe="mdc-autocomplete" />
        </span>
      </div>
    `;
    const span = document.querySelector('span') as HTMLSpanElement;
    expect(findKeywordAnchor(span)).toBe(document.querySelector('input'));
  });

  it('hover 在 label span 上时，通过单输入框祖先找到关键词', () => {
    document.body.innerHTML = `
      <div class="qdOxv-fmcmS-yrriRe" jsname="rYJt4b">
        <span id="c83-label-id">
          <span class="dA2hVd-NLUYnc-xRPttf-NLUYnc">music creator ai</span>
        </span>
        <span>
          <input value="music creator ai" aria-label="music creator ai" data-index="2" data-axe="mdc-autocomplete" />
        </span>
      </div>
    `;
    const labelText = document.querySelector('.dA2hVd-NLUYnc-xRPttf-NLUYnc') as HTMLSpanElement;
    expect(findKeywordAnchor(labelText)).toBe(document.querySelector('input'));
  });

  it('识别 Related / Rising / Top 查询词 span.Z9Uqw', () => {
    document.body.innerHTML = '<span class="Z9Uqw">convert jpg to pdf free</span>';
    const span = document.querySelector('span') as HTMLSpanElement;
    expect(extractKeywordFromElement(span)).toBe('convert jpg to pdf free');
    expect(getKeywordType(span)).toBe('related');
    expect(isKeywordElement(span)).toBe(true);
  });

  it('从 span.Z9Uqw 内部子节点向上找到关键词锚点', () => {
    document.body.innerHTML = '<span class="Z9Uqw"><b>pdf to midi online</b></span>';
    const b = document.querySelector('b') as HTMLElement;
    expect(findKeywordAnchor(b)).toBe(document.querySelector('span'));
  });

  it('不识别 Explore topics 占位输入框', () => {
    document.body.innerHTML = '<input placeholder="Explore topics" class="yNVtPc ZAGvjd" />';
    const input = document.querySelector('input') as HTMLInputElement;
    expect(extractKeywordFromElement(input)).toBeNull();
    expect(isKeywordElement(input)).toBe(false);
  });

  it('不识别普通 span 文本', () => {
    document.body.innerHTML = '<span>Some random text</span>';
    const span = document.querySelector('span') as HTMLSpanElement;
    expect(extractKeywordFromElement(span)).toBeNull();
    expect(isKeywordElement(span)).toBe(false);
  });

  it('不识别按钮内的文本', () => {
    document.body.innerHTML = '<button>Settings</button>';
    const btn = document.querySelector('button') as HTMLButtonElement;
    expect(extractKeywordFromElement(btn)).toBeNull();
    expect(findKeywordAnchor(btn)).toBeNull();
  });
});
