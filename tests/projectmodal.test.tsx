// tests/projectmodal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ProjectModal from '../entrypoints/sidepanel/components/ProjectModal';

describe('ProjectModal', () => {
  it('添加域名后列表更新', async () => {
    render(<ProjectModal onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'modal-test.com' } });
    fireEvent.click(screen.getByText('添加'));
    const item = await screen.findByText('modal-test.com');
    expect(item).toBeTruthy();
  });
  it('遮罩点击触发 onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(<ProjectModal onClose={onClose} />);
    await act(async () => { fireEvent.mouseDown(container.querySelector('.modal__overlay')!); });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('ESC 触发 onClose', async () => {
    const onClose = vi.fn();
    render(<ProjectModal onClose={onClose} />);
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
