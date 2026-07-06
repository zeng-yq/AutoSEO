import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishUrl, getMetadata, reasonFor, submitBatch } from '../lib/gsc/submit';

beforeEach(() => vi.restoreAllMocks());

describe('publishUrl', () => {
  it('POST publish 端点，Bearer + JSON body {url, type:URL_UPDATED}', async () => {
    const m = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const r = await publishUrl('TOK', 'https://example.com/a');
    expect(r).toEqual({ ok: true, status: 200 });
    const [url, init] = m.mock.calls[0];
    expect(url).toBe('https://indexing.googleapis.com/v3/urlNotifications:publish');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
    expect(JSON.parse(init?.body as string)).toEqual({ url: 'https://example.com/a', type: 'URL_UPDATED' });
  });
  it('403 → 密钥/所有者', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 403 } as Response);
    expect((await publishUrl('T', 'https://x')).reason).toMatch(/所有者|密钥/);
  });
  it('429 → 配额', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 429 } as Response);
    expect((await publishUrl('T', 'https://x')).reason).toMatch(/配额/);
  });
  it('fetch 抛错 → 透传', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    await expect(publishUrl('T', 'https://x')).rejects.toThrow('down');
  });
});

describe('getMetadata', () => {
  it('GET metadata 端点（url 编码），200 → ok', async () => {
    const m = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const r = await getMetadata('T', 'https://example.com/a');
    expect(r.ok).toBe(true);
    const [url] = m.mock.calls[0];
    expect(url).toContain('url=https%3A%2F%2Fexample.com%2Fa');
  });
});

describe('reasonFor', () => {
  it('已知码均有文案', () => {
    expect(reasonFor(403)).toMatch(/所有者|密钥/);
    expect(reasonFor(429)).toMatch(/配额/);
    expect(reasonFor(400)).toMatch(/格式|网址/);
  });
  it('未知码兜底', () => {
    expect(reasonFor(500)).toBe('GSC：返回 500');
  });
});

describe('submitBatch', () => {
  it('逐条提交，全部成功 → results 全 ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const progress: number[] = [];
    const { results, ok, skipped } = await submitBatch('T', ['https://a', 'https://b'], {
      onProgress: (p) => progress.push(p.done),
    });
    expect(ok).toBe(2);
    expect(skipped).toBe(0);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(progress).toEqual([1, 2]);
  });
  it('遇 429 → 设 quotaHit，剩余标 skipped(未执行（批次终止）)，不再 fetch', async () => {
    const m = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ status: 200 } as Response)
      .mockResolvedValueOnce({ status: 429 } as Response) // 第 2 条触发配额
      .mockResolvedValue({ status: 200 } as Response);    // 不应被调用
    const { results, ok } = await submitBatch('T', ['https://a', 'https://b', 'https://c', 'https://d']);
    expect(ok).toBe(1);
    expect(results[1].reason).toMatch(/配额/);
    expect(results[2].reason).toBe('未执行（批次终止）');
    expect(results[3].reason).toBe('未执行（批次终止）');
    expect(m).toHaveBeenCalledTimes(2); // 只发了 2 次
  });
  it('shouldStop=true → 下一条前中止，剩余保持 skipped', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    let stop = false;
    const { ok } = await submitBatch('T', ['https://a', 'https://b', 'https://c'], {
      shouldStop: () => stop,
      onProgress: (p) => { if (p.done === 1) stop = true; },
    });
    expect(ok).toBe(1);
  });
  it('网络错误 → 该条 reason 含「网络错误」，其余继续', async () => {
    const m = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 200 } as Response);
    const { results } = await submitBatch('T', ['https://a', 'https://b']);
    expect(results[0].reason).toMatch(/网络错误/);
    expect(results[1].status).toBe('ok');
    expect(m).toHaveBeenCalledTimes(2);
  });
});
