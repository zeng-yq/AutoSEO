import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CountrySelect from '../entrypoints/sidepanel/components/CountrySelect';

const OPTS = [
  { value: 'us', label: '美国', flag: '🇺🇸', searchKeys: ['美国', 'United States', 'us', 'US'] },
  { value: 'de', label: '德国', flag: '🇩🇪', searchKeys: ['德国', 'Germany', 'de', 'DE'] },
  { value: 'jp', label: '日本', flag: '🇯🇵', searchKeys: ['日本', 'Japan', 'jp', 'JP'] },
];
const isCode = (v: string) => /^[a-z]{2}$/i.test(v);
const combo = () => screen.getByRole('combobox') as HTMLInputElement;

describe('CountrySelect', () => {
  it('回显当前选中项', () => {
    render(<CountrySelect value="de" options={OPTS} onChange={() => {}} ariaLabel="国家" />);
    expect(combo().value).toMatch(/德国/);
  });

  it('按中文名过滤', () => {
    render(<CountrySelect value="" options={OPTS} onChange={() => {}} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: '德' } });
    expect(screen.getByText(/德国/)).toBeInTheDocument();
    expect(screen.queryByText(/美国/)).toBeNull();
  });

  it('按英文与 code 过滤', () => {
    render(<CountrySelect value="" options={OPTS} onChange={() => {}} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: 'germany' } });
    expect(screen.getByText(/德国/)).toBeInTheDocument();
    fireEvent.change(combo(), { target: { value: 'JP' } });
    expect(screen.getByText(/日本/)).toBeInTheDocument();
  });

  it('点选建议触发 onChange', () => {
    const onChange = vi.fn();
    render(<CountrySelect value="" options={OPTS} onChange={onChange} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: '日' } });
    fireEvent.mouseDown(screen.getByText(/日本/));
    expect(onChange).toHaveBeenCalledWith('jp');
  });

  it('唯一匹配失焦自动选中', () => {
    const onChange = vi.fn();
    render(<CountrySelect value="us" options={OPTS} onChange={onChange} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: '德国' } });
    fireEvent.blur(combo());
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('allowFreeText: 列表外合法代码失焦提交', () => {
    const onChange = vi.fn();
    render(<CountrySelect value="us" options={OPTS} onChange={onChange} allowFreeText freeTextValidate={isCode} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: 'mt' } });
    fireEvent.blur(combo());
    expect(onChange).toHaveBeenCalledWith('mt');
  });

  it('非 freeText: 列表外输入失焦回退,不提交', () => {
    const onChange = vi.fn();
    render(<CountrySelect value="us" options={OPTS} onChange={onChange} ariaLabel="国家" />);
    fireEvent.change(combo(), { target: { value: 'mt' } });
    fireEvent.blur(combo());
    expect(onChange).not.toHaveBeenCalled();
    expect(combo().value).toMatch(/美国/);
  });

  it('聚焦时展开全部选项(而非仅当前项)', () => {
    // 默认选中美国,聚焦(全选文本)后应展开全部三国,而不是被回显文本过滤到只剩美国
    render(<CountrySelect value="us" options={OPTS} onChange={() => {}} ariaLabel="国家" />);
    fireEvent.focus(combo());
    expect(screen.getByText(/美国/)).toBeInTheDocument();
    expect(screen.getByText(/德国/)).toBeInTheDocument();
    expect(screen.getByText(/日本/)).toBeInTheDocument();
  });

  it('渲染 prefixOptions 置顶项', () => {
    render(<CountrySelect value="OFF" options={OPTS} prefixOptions={[{ value: 'OFF', label: '关闭', flag: '🚪', searchKeys: ['关闭', 'off'] }]} onChange={() => {}} ariaLabel="定位" />);
    expect(combo().value).toMatch(/关闭/);
  });
});
