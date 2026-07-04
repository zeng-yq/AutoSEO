/**
 * Google 搜索地理位置伪装 —— 核心：通过 declarativeNetRequest 注入 x-geo 头
 * (UULE 编码经纬度) + accept-language 头，让 Google 返回目标国家视角的结果。
 * 机制移植自 gslocation v3.9 genUULE()。
 * 设计：docs/superpowers/specs/2026-07-04-google-search-geo-design.md
 */

export type GeoCode = 'US' | 'DE' | 'JP' | 'ES' | 'GB' | 'FR' | 'CA' | 'AU' | 'OFF';

export interface GeoRegion {
  code: Exclude<GeoCode, 'OFF'>;
  label: string; // UI 显示名
  flag: string; // emoji
  gl: string; // ISO alpha-2，语义保留
  lat: number;
  lng: number;
}

/** 精选 8 国（首都/代表城市坐标）。 */
export const GEO_REGIONS: GeoRegion[] = [
  { code: 'US', label: '美国', flag: '🇺🇸', gl: 'US', lat: 37.4224, lng: -122.0842 }, // 山景城（gslocation 默认坐标）
  { code: 'DE', label: '德国', flag: '🇩🇪', gl: 'DE', lat: 52.52, lng: 13.405 }, // 柏林
  { code: 'JP', label: '日本', flag: '🇯🇵', gl: 'JP', lat: 35.6762, lng: 139.6503 }, // 东京
  { code: 'ES', label: '西班牙', flag: '🇪🇸', gl: 'ES', lat: 40.4168, lng: -3.7038 }, // 马德里
  { code: 'GB', label: '英国', flag: '🇬🇧', gl: 'GB', lat: 51.5074, lng: -0.1278 }, // 伦敦
  { code: 'FR', label: '法国', flag: '🇫🇷', gl: 'FR', lat: 48.8566, lng: 2.3522 }, // 巴黎
  { code: 'CA', label: '加拿大', flag: '🇨🇦', gl: 'CA', lat: 43.6532, lng: -79.3832 }, // 多伦多
  { code: 'AU', label: '澳大利亚', flag: '🇦🇺', gl: 'AU', lat: -33.8688, lng: 151.2093 }, // 悉尼
];

export const DEFAULT_GEO_CODE: GeoCode = 'US';
export const GEO_OFF: GeoCode = 'OFF';

/** UULE 编码：lat/lng × 1e7 → proto-text → base64，前缀 "a "。移植自 gslocation genUULE()。 */
export function encodeXGeo(lat: number, lng: number): string {
  const latE7 = Math.floor(lat * 1e7);
  const lngE7 = Math.floor(lng * 1e7);
  const plain =
    'role: CURRENT_LOCATION\nproducer: DEVICE_LOCATION\nradius: 65000\n' +
    'latlng <\n' +
    `  latitude_e7: ${latE7}\n  longitude_e7: ${lngE7}\n>`;
  return 'a ' + btoa(plain);
}

/** code → GeoRegion；OFF / 未知 / 缺省 → null（等同关闭）。 */
export function resolveGeo(code: string | undefined): GeoRegion | null {
  if (!code || code === GEO_OFF) return null;
  return GEO_REGIONS.find((r) => r.code === code) ?? null;
}

const RULE_ID = 1;
const ACCEPT_LANG = 'en';
const GEO_HOST_FILTER = 'google.com';

/** storage key（跟随关键词工具 kw-tools:* 命名惯例）。 */
export const GEO_STORAGE_KEY = 'kw-tools:geo';

interface GeoPref {
  code: GeoCode;
  ts: number;
}

/**
 * 应用地理位置：先移除旧会话规则 + 清 UULE cookie，再写新规则。
 * 传 null = 关闭（只清不加），恢复真实位置。
 */
export async function applyGeo(region: GeoRegion | null): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  await clearUuleCookies();
  if (!region) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'x-geo', operation: 'set', value: encodeXGeo(region.lat, region.lng) },
            { header: 'accept-language', operation: 'set', value: ACCEPT_LANG },
          ],
        },
        condition: {
          urlFilter: GEO_HOST_FILTER,
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'ping'],
        },
      },
    ],
  });
}

/**
 * 删 Google 回写的 UULE cookie。
 * domain 可能带前导 '.'（如 .google.com），去掉才能拼合法 URL（gslocation 原版此处有隐患，修正）。
 */
async function clearUuleCookies(): Promise<void> {
  const cookies = await chrome.cookies.getAll({ name: 'UULE' });
  await Promise.all(
    cookies.map((c) => {
      const host = c.domain.replace(/^\./, '');
      return chrome.cookies.remove({ name: 'UULE', url: `https://${host}${c.path}` });
    }),
  );
}

/** 读取位置偏好；空/脏 storage → 默认 US。 */
export async function getGeoPref(): Promise<{ code: GeoCode }> {
  const items = (await chrome.storage.local.get(GEO_STORAGE_KEY)) as Record<string, Partial<GeoPref> | undefined>;
  const code = items[GEO_STORAGE_KEY]?.code;
  return { code: code ?? DEFAULT_GEO_CODE };
}

/** 写入位置偏好（含时间戳）。 */
export async function setGeoPref(code: GeoCode): Promise<void> {
  await chrome.storage.local.set({ [GEO_STORAGE_KEY]: { code, ts: Date.now() } satisfies GeoPref });
}
