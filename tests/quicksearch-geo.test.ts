import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encodeXGeo,
  resolveGeo,
  applyGeo,
  getGeoPref,
  setGeoPref,
  GEO_REGIONS,
  GEO_STORAGE_KEY,
  DEFAULT_GEO_CODE,
  GEO_OFF,
} from '../lib/quicksearch/geo';

describe('encodeXGeo', () => {
  it('以 "a " 前缀开头，base64 解码后含正确的 e7 经纬度与 proto 字段', () => {
    const v = encodeXGeo(37.4224, -122.0842);
    expect(v.startsWith('a ')).toBe(true);
    const plain = atob(v.slice(2));
    expect(plain).toContain('role: CURRENT_LOCATION');
    expect(plain).toContain('producer: DEVICE_LOCATION');
    expect(plain).toContain('radius: 65000');
    expect(plain).toContain('latitude_e7: 374224000');
    expect(plain).toContain('longitude_e7: -1220842000');
  });
});

describe('resolveGeo', () => {
  it('已知 code 返回对应 region', () => {
    expect(resolveGeo('US')?.label).toBe('美国');
    expect(resolveGeo('DE')?.gl).toBe('DE');
    expect(resolveGeo('JP')?.code).toBe('JP');
  });
  it('OFF / undefined / 未知 code 返回 null', () => {
    expect(resolveGeo(GEO_OFF)).toBeNull();
    expect(resolveGeo(undefined)).toBeNull();
    expect(resolveGeo('XX')).toBeNull();
  });
});

describe('GEO_REGIONS 数据完整性', () => {
  it('恰好 8 条，code 唯一，字段齐全，坐标在合理范围', () => {
    expect(GEO_REGIONS).toHaveLength(8);
    const codes = GEO_REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of GEO_REGIONS) {
      expect(typeof r.label).toBe('string');
      expect(r.flag.length).toBeGreaterThan(0);
      expect(r.gl).toHaveLength(2);
      expect(r.lat).toBeGreaterThanOrEqual(-90);
      expect(r.lat).toBeLessThanOrEqual(90);
      expect(r.lng).toBeGreaterThanOrEqual(-180);
      expect(r.lng).toBeLessThanOrEqual(180);
    }
  });
  it('默认值与关闭值常量', () => {
    expect(DEFAULT_GEO_CODE).toBe('US');
    expect(GEO_OFF).toBe('OFF');
  });
});

/**
 * chrome.declarativeNetRequest / cookies 在 tests/setup.ts 未 mock，
 * 本文件内补一个最小 mock，返回可断言的 spy。
 */
function installDnrCookieMocks(cookies: chrome.cookies.Cookie[] = []) {
  const dnr = {
    updateSessionRules: vi.fn(async (_opts: unknown) => {}),
  };
  const cookiesApi = {
    getAll: vi.fn(async (_filter: { name: string }) => cookies),
    remove: vi.fn(async (_details: { name: string; url: string }) => ({})),
  };
  (chrome as unknown as { declarativeNetRequest: unknown }).declarativeNetRequest = dnr;
  (chrome as unknown as { cookies: unknown }).cookies = cookiesApi;
  return { dnr, cookiesApi };
}

describe('applyGeo', () => {
  it('传 region：先删旧规则 + 清 UULE，再加含 x-geo / accept-language 的新规则', async () => {
    const { dnr, cookiesApi } = installDnrCookieMocks([
      { name: 'UULE', domain: '.google.com', path: '/' } as chrome.cookies.Cookie,
    ]);
    await applyGeo(resolveGeo('DE'));

    expect(dnr.updateSessionRules).toHaveBeenCalledTimes(2);
    expect(dnr.updateSessionRules).toHaveBeenNthCalledWith(1, { removeRuleIds: [1] });
    const addCall = (dnr.updateSessionRules as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
      addRules: Array<{
        id: number;
        action: { requestHeaders: Array<{ header: string; operation: string; value: string }> };
        condition: { urlFilter: string; resourceTypes: string[] };
      }>;
    };
    expect(addCall.addRules).toHaveLength(1);
    const rule = addCall.addRules[0];
    expect(rule.id).toBe(1);
    expect(rule.condition.urlFilter).toBe('google.com');
    const xgeo = rule.action.requestHeaders.find((h) => h.header === 'x-geo');
    const al = rule.action.requestHeaders.find((h) => h.header === 'accept-language');
    expect(xgeo?.value.startsWith('a ')).toBe(true);
    expect(al?.value).toBe('en');
    expect(cookiesApi.getAll).toHaveBeenCalledWith({ name: 'UULE' });
    expect(cookiesApi.remove).toHaveBeenCalled();
  });

  it('传 null：只删规则 + 清 cookie，不 addRules', async () => {
    const { dnr } = installDnrCookieMocks([]);
    await applyGeo(null);
    expect(dnr.updateSessionRules).toHaveBeenCalledTimes(1);
    expect((dnr.updateSessionRules as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      removeRuleIds: [1],
    });
  });

  it('clearUuleCookies：domain 带前导点时拼出无点的合法 url', async () => {
    const { cookiesApi } = installDnrCookieMocks([
      { name: 'UULE', domain: '.google.com', path: '/' } as chrome.cookies.Cookie,
    ]);
    await applyGeo(null);
    expect(cookiesApi.remove).toHaveBeenCalledWith({
      name: 'UULE',
      url: 'https://google.com/',
    });
  });
});

describe('geo pref storage', () => {
  beforeEach(() => {
    // setup.ts 的 beforeEach 已清空 storage；这里无需额外操作，显式留空表明隔离意图。
  });

  it('空 storage → 默认 US', async () => {
    expect(await getGeoPref()).toEqual({ code: 'US' });
  });

  it('setGeoPref 后 getGeoPref 返回新值，且写入含 ts', async () => {
    await setGeoPref('DE');
    expect(await getGeoPref()).toEqual({ code: 'DE' });
    const items = (await chrome.storage.local.get(GEO_STORAGE_KEY)) as Record<string, { code: string; ts: number }>;
    expect(items[GEO_STORAGE_KEY].code).toBe('DE');
    expect(typeof items[GEO_STORAGE_KEY].ts).toBe('number');
  });

  it('脏数据（无 code 字段）→ 回落默认 US', async () => {
    await chrome.storage.local.set({ [GEO_STORAGE_KEY]: { foo: 'bar' } });
    expect(await getGeoPref()).toEqual({ code: DEFAULT_GEO_CODE });
  });
});
