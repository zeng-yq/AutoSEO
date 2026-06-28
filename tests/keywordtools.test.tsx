// tests/keywordtools.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KeywordTools from '../entrypoints/sidepanel/pages/KeywordTools';

describe('KeywordTools', () => {
  it('渲染板块标题与国家/关键词输入', () => {
    render(<KeywordTools />);
    expect(screen.getByText('关键词工具')).toBeTruthy();
    expect(screen.getByPlaceholderText('如 apple')).toBeTruthy();
  });
});
