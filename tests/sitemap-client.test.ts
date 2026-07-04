import { describe, it, expect, vi } from 'vitest';
import { fetchSitemapViaBackground } from '../lib/messaging/sitemap-client';

function mockPort() {
  let msgCb: ((e: any) => void) | null = null;
  let discCb: (() => void) | null = null;
  const port = {
    postMessage: vi.fn(),
    onMessage: { addListener: (cb: (e: any) => void) => { msgCb = cb; } },
    onDisconnect: { addListener: (cb: () => void) => { discCb = cb; } },
    disconnect: vi.fn(),
  };
  (chrome as any).runtime.connect = vi.fn(() => port);
  return { port, emit: (e: any) => msgCb!(e), disconnect: () => discCb!() };
}

describe('fetchSitemapViaBackground', () => {
  it('发 SITEMAP_FETCH，收到 RESULT resolve urls/stats', async () => {
    const { port, emit } = mockPort();
    const p = fetchSitemapViaBackground('https://example.com/sitemap.xml');
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'SITEMAP_FETCH', sitemapUrl: 'https://example.com/sitemap.xml' });
    emit({ type: 'SITEMAP_RESULT', urls: ['https://example.com/a'], stats: { indexDepth: 1, truncated: false } });
    await expect(p).resolves.toEqual({ urls: ['https://example.com/a'], stats: { indexDepth: 1, truncated: false } });
  });

  it('收到 ERROR reject 且 disconnect port', async () => {
    const { port, emit } = mockPort();
    const p = fetchSitemapViaBackground('https://example.com/sitemap.xml');
    emit({ type: 'SITEMAP_ERROR', message: 'boom' });
    await expect(p).rejects.toThrow('boom');
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('port 断开 reject', async () => {
    const { disconnect } = mockPort();
    const p = fetchSitemapViaBackground('https://example.com/sitemap.xml');
    disconnect();
    await expect(p).rejects.toThrow();
  });
});
