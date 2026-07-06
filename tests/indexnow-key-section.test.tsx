import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockKey: string | undefined = undefined;
const mockGenerate = vi.fn();
const mockRefresh = vi.fn();
const mockDownload = vi.fn();
vi.mock('../entrypoints/sidepanel/hooks/useIndexNowKey', () => ({
  useIndexNowKey: () => ({ key: mockKey, generate: mockGenerate, refresh: mockRefresh, download: mockDownload }),
}));

import IndexNowKeySection from '../entrypoints/sidepanel/components/IndexNowKeySection';

beforeEach(() => {
  mockKey = undefined;
  mockGenerate.mockReset();
  mockRefresh.mockReset();
  mockDownload.mockReset();
});

describe('IndexNowKeySection', () => {
  it('未配置：显示「生成密钥」，不显示下载/刷新', () => {
    render(<IndexNowKeySection />);
    expect(screen.getByText('生成密钥')).toBeInTheDocument();
    expect(screen.queryByText('下载密钥文件')).not.toBeInTheDocument();
    expect(screen.queryByText('刷新')).not.toBeInTheDocument();
  });

  it('未配置：点「生成密钥」调 generate', () => {
    render(<IndexNowKeySection />);
    fireEvent.click(screen.getByText('生成密钥'));
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('已配置：readonly 输入框显示 key，显示下载/刷新，不显示生成', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    expect((screen.getByLabelText('IndexNow 密钥') as HTMLInputElement).value).toBe(mockKey);
    expect((screen.getByLabelText('IndexNow 密钥') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('下载密钥文件')).toBeInTheDocument();
    expect(screen.getByText('刷新')).toBeInTheDocument();
    expect(screen.queryByText('生成密钥')).not.toBeInTheDocument();
  });

  it('已配置：点下载调 download、点刷新调 refresh', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    fireEvent.click(screen.getByText('下载密钥文件'));
    expect(mockDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('刷新'));
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('提示上传到每个站点根目录', () => {
    render(<IndexNowKeySection />);
    expect(screen.getByText(/上传到你【每个】站点的根目录/)).toBeInTheDocument();
  });

  it('已配置时文案含 <key>.txt 文件名', () => {
    mockKey = 'abc123def456abc123def456abc123de';
    render(<IndexNowKeySection />);
    expect(screen.getByText(/abc123def456abc123def456abc123de\.txt/)).toBeInTheDocument();
  });
});
