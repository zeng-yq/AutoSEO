// tests/combobox.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Combobox from '../entrypoints/sidepanel/components/Combobox';

describe('Combobox', () => {
  it('输入时按 includes 过滤建议', () => {
    const { container } = render(<Combobox value="" options={['example.com', 'shop.example.com', 'other.io']} onChange={() => {}} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'example' } });
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('shop.example.com')).toBeInTheDocument();
    expect(screen.queryByText('other.io')).toBeNull();
  });
  it('点击建议触发 onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<Combobox value="" options={['example.com']} onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ex' } });
    fireEvent.mouseDown(screen.getByText('example.com'));
    expect(onChange).toHaveBeenCalledWith('example.com');
  });
  it('齿轮按钮触发 onManage', () => {
    const onManage = vi.fn();
    render(<Combobox value="" options={[]} onChange={() => {}} onManage={onManage} />);
    fireEvent.click(screen.getByLabelText('项目管理'));
    expect(onManage).toHaveBeenCalledOnce();
  });
  it('失焦触发 onBlur', () => {
    const onBlur = vi.fn();
    const { container } = render(<Combobox value="example.com" options={[]} onChange={() => {}} onBlur={onBlur} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });
  it('传入 sanitize 时对输入实时清洗后回调', () => {
    const onChange = vi.fn();
    const { container } = render(<Combobox value="" options={[]} onChange={onChange} sanitize={(v) => v.toUpperCase()} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('ABC');
  });
  it('未传 sanitize 时原文透传', () => {
    const onChange = vi.fn();
    const { container } = render(<Combobox value="" options={[]} onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });
});
