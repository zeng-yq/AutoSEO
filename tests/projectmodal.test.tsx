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
    expect(item).toBeInTheDocument();
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
  it('脏域名失焦后清洗回填', async () => {
    render(<ProjectModal onClose={() => {}} />);
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/path' } });
    fireEvent.blur(input);
    expect(input.value).toBe('example.com');
  });
  it('无效输入显示提示且添加按钮禁用', async () => {
    render(<ProjectModal onClose={() => {}} />);
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'notadomain' } });
    expect(screen.getByText('请输入有效域名，如 example.com')).toBeInTheDocument();
    expect(screen.getByText('添加')).toBeDisabled();
  });
  it('非 ASCII 输入失焦不清空，仍显示校验提示', async () => {
    render(<ProjectModal onClose={() => {}} />);
    const input = screen.getByPlaceholderText('example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '例子.中国' } });
    fireEvent.blur(input);
    expect(input.value).toBe('例子.中国');
    expect(screen.getByText('请输入有效域名，如 example.com')).toBeInTheDocument();
  });
});
