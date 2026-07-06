import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GscCredentialsSection from '../entrypoints/sidepanel/components/GscCredentialsSection';
import * as creds from '../entrypoints/sidepanel/hooks/useGscCredentials';

vi.mock('../entrypoints/sidepanel/hooks/useGscCredentials');

beforeEach(() => vi.restoreAllMocks());

function mockHook(over: Partial<ReturnType<typeof creds.useGscCredentials>> = {}) {
  const base = {
    credentials: undefined as string | undefined,
    save: vi.fn(),
    clear: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(undefined),
    testStatus: 'idle' as creds.TestStatus,
    testMessage: undefined as string | undefined,
  };
  vi.mocked(creds.useGscCredentials).mockReturnValue({ ...base, ...over });
  return base;
}

describe('GscCredentialsSection', () => {
  it('渲染标题与 textarea', () => {
    mockHook();
    render(<GscCredentialsSection />);
    expect(screen.getByText(/GSC 服务账号密钥/)).toBeInTheDocument();
    expect(screen.getByLabelText(/JSON/)).toBeInTheDocument();
  });

  it('未配置时，保存按钮在无输入时禁用', () => {
    mockHook();
    render(<GscCredentialsSection />);
    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled();
  });

  it('粘贴后保存按钮启用，点击调用 save', () => {
    const base = mockHook();
    render(<GscCredentialsSection />);
    const ta = screen.getByLabelText(/JSON/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"type":"service_account"}' } });
    expect(screen.getByRole('button', { name: /保存/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(base.save).toHaveBeenCalledWith('{"type":"service_account"}');
  });

  it('测试连接按钮点击调用 testConnection', () => {
    const base = mockHook({ credentials: '{"x":1}' });
    render(<GscCredentialsSection />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    expect(base.testConnection).toHaveBeenCalled();
  });

  it('testStatus=ok → 显示成功消息', () => {
    mockHook({ credentials: '{}', testStatus: 'ok', testMessage: '密钥有效（服务账号：sa@x）' });
    render(<GscCredentialsSection />);
    expect(screen.getByText(/密钥有效/)).toBeInTheDocument();
  });

  it('testStatus=fail → 显示错误消息', () => {
    mockHook({ credentials: '{}', testStatus: 'fail', testMessage: '不是合法的 JSON' });
    render(<GscCredentialsSection />);
    expect(screen.getByText(/不是合法的 JSON/)).toBeInTheDocument();
  });
});
