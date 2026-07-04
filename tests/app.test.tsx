import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../entrypoints/sidepanel/hooks/useSubmitOrchestrator', () => ({
  useSubmitOrchestrator: () => ({
    run: vi.fn(), cancel: vi.fn(), active: null,
    gsc: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
    bing: { state: { running: false, total: 0, done: 0 }, logs: [], results: [] },
  }),
}));

import App from '../entrypoints/sidepanel/App';

describe('App', () => {
  it('默认显示网站工具板块，切到关键词工具显示 Ahrefs 表单', () => {
    render(<App />);
    expect(screen.getByText('网站工具')).toBeInTheDocument();
    expect(screen.getByText('网站提交')).toBeInTheDocument();
    fireEvent.click(screen.getByText('关键词工具'));
    expect(screen.getByText('Ahrefs')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('如 apple')).toBeInTheDocument();
  });
});
