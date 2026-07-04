# Google 搜索地理位置切换(集成 gslocation 核心方式)

- 日期:2026-07-04
- 状态:已通过设计评审,待编写实现计划
- 作者:zengyq
- 关联开源项目:[VorticonCmdr/gslocation](https://github.com/VorticonCmdr/gslocation)(v3.9)

## 1. 背景与目标

AutoSEO 的关键词工具(`KeywordTools`)里有一张「快捷搜索」卡片(`QuickSearchTool`),提供「用 Google 搜 / 用 Bing 搜」两个按钮,点击后用 `chrome.tabs.create` 打开 Google/Bing 搜索结果页。当前 `buildGoogleSearchUrl` 只拼接 `q=` 参数,**没有任何地理位置维度** —— 用户看到的是其真实 IP 所在地的 Google 结果。

做 SEO 关键词调研时,需要看到**目标国家用户看到的搜索结果**(本地包、地图、排名差异)。本设计把开源项目 gslocation 的核心实现方式(`x-geo` HTTP 头注入)集成进插件,让用户在「快捷搜索」卡片里选一个国家,即可全局伪装 Google 搜索的地理位置。

### 目标

- 在 `QuickSearchTool` 的 Google 搜索按钮旁,新增一个「搜索位置」下拉。
- **默认开启,默认选中美国**(插件装上即生效,无需首次交互)。
- 预留精选 8 国:美国 / 德国 / 日本 / 西班牙 / 英国 / 法国 / 加拿大 / 澳大利亚。
- 用户选择一个即可切换;提供「关闭(用真实位置)」逃生口。

### 非目标(YAGNI)

- ❌ 城市级精确位置(gslocation 的 photon.komoot.io 地理编码 / typeahead 搜索框 / popup / options 页 / 收藏夹 / 右键菜单 —— 全部不要)。
- ❌ 影响 Bing 搜索(Bing 地理机制不同,本期只做 Google;用户明确只提「Google 搜索旁边」)。
- ❌ 可扩展的动态国家列表 / 搜索筛选(8 国用普通 Select 即可)。
- ❌ 抓取或解析 Google 结果(只改请求头,不 fetch)。

## 2. gslocation 核心机制分析

通读 gslocation v3.9 源码(`background.js` / `manifest.json` / `geo.json` / `popup.js` / `CLAUDE.md`)后,核心机制如下:

**本质**:通过 Chrome MV3 `declarativeNetRequest` API,在所有发往 `google.com` 的请求上注入 `x-geo` HTTP 请求头,让 Google 服务器相信请求来自某个经纬度,从而返回该地点视角的搜索结果。Google 收到后会回写一个 `UULE` cookie 持久化位置。

**`x-geo` 头的值(UULE 编码)** —— `genUULE()`:

```
lat_e7 = Math.floor(latitude × 1e7)
lng_e7 = Math.floor(longitude × 1e7)

明文 =
  role: CURRENT_LOCATION
  producer: DEVICE_LOCATION
  radius: 65000
  latlng <
    latitude_e7: <lat_e7>
    longitude_e7: <lng_e7>
  >

x-geo 头值 = "a " + base64(明文)          // 前缀固定 "a "
```

同时注入 `accept-language` 头 = `${hl}-${gl}`(如 `en-US`、`de-DE`)。

**规则定义** —— `declarativeNetRequest.updateSessionRules`:

- rule id 1,priority 1
- action `modifyHeaders`,requestHeaders 设 `x-geo` 与 `accept-language`
- condition `urlFilter: "google.com/"`,resourceTypes `main_frame / sub_frame / image / xmlhttprequest / ping`
- 使用 **sessionRules**(会话级,浏览器重启清空),靠 `onStartup` 重建

**清除位置**:移除规则 + 用 `chrome.cookies.remove` 删除 Google 回写的 `UULE` cookie。

**权限**:`declarativeNetRequestWithHostAccess`、`cookies`、`storage`、`contextMenus`;host_permissions 含 `https://www.google.com/`。

**对我们的关键简化**:gslocation 做「城市级精确伪装」,所以需要 geocoding API + typeahead + popup + options + 收藏。我们要的是「国家级切换」,每个国家只需**一个代表性经纬度(首都)+ `{gl, hl}` 映射**,直接套 `genUULE()` 公式即可 —— 不需要 gslocation 的 UI 与数据获取那一整套。集成后约几十行 background 逻辑 + 一个 Select。

## 3. 关键决策(已与用户确认)

| 维度 | 决策 | 理由 |
|---|---|---|
| 作用范围 | **全局生效**:`declarativeNetRequest` 常驻规则 + `x-geo`/`accept-language` 注入 + `UULE` cookie 管理 | 用户明确「集成核心实现方式」;SEO 调研时点开任何结果都保持目标国家视角最方便。副作用(影响所有 Google 访问)用户已知悉并接受。 |
| 国家广度 | **精选 8 国**:美/德/日/西/英/法/加/澳 | 覆盖主流 SEO 目标市场,普通 `Select` 下拉即可承载,无需搜索框。 |
| 界面语言 | **固定英文**(`accept-language = "en"`) | `x-geo` 决定结果国家,`accept-language` 决定界面语言;固定英文避免选德国变德文界面的惊吓,符合「只选一个(位置)」的简洁预期。 |
| 关闭交互 | **单 Select 下拉,首项为「关闭(用真实位置)」**,默认选中「美国」 | 最简,符合「只需选一个」;关闭 = 选首项。 |
| 代表坐标 | 各国首都/代表城市 | 国家级搜索结果对城市级坐标差异不敏感。 |
| 规则持久性 | **sessionRules** + `onStartup`/`onInstalled` 兜底重建 | 会话级天然兜底(重启即净,副作用不残留),不占持久规则配额;onStartup 重建使其跨重启仍生效。 |
| 存储 key | `'kw-tools:geo'`(chrome.storage.local) | 沿用关键词工具命名惯例,不混入 GSC 的 `settings`。 |

## 4. 总体架构与数据流

```
QuickSearchTool 里新增 <Select 搜索位置>
   │ onChange 写
   ▼
chrome.storage.local['kw-tools:geo'] = { code: 'US'|'DE'|...|'OFF', ts }
   │
   ▼ chrome.storage.onChanged(background 监听)
lib/quicksearch/geo.ts · applyGeo(region | null)
   ├─ updateSessionRules({ removeRuleIds:[1] })   ← 先清旧规则
   ├─ clearUuleCookies()                           ← 删 Google 回写的 UULE
   └─ 若 region 非空:updateSessionRules({ addRules:[规则] })
        规则:对 google.com/* 注入
          x-geo = "a " + base64(UULE 明文)   ← 经纬度编码
          accept-language = "en"              ← 固定英文界面
```

打开的 Google 搜索 URL **不变**(`buildGoogleSearchUrl` 不改),仍是 `https://www.google.com/search?q=xxx`;background 的全局规则会让 Google 返回目标国家的结果。

## 5. 国家数据模型

新文件 `lib/quicksearch/geo.ts` 内置:

```ts
export type GeoCode = 'US' | 'DE' | 'JP' | 'ES' | 'GB' | 'FR' | 'CA' | 'AU' | 'OFF';

export interface GeoRegion {
  code: Exclude<GeoCode, 'OFF'>;
  label: string;        // '美国'
  flag: string;         // '🇺🇸'
  gl: string;           // 'US'(语义保留)
  lat: number;
  lng: number;
}

export const GEO_REGIONS: GeoRegion[] = [
  { code:'US', label:'美国',     flag:'🇺🇸', gl:'US', lat: 37.4224, lng:-122.0842 }, // 山景城(gslocation 默认坐标)
  { code:'DE', label:'德国',     flag:'🇩🇪', gl:'DE', lat: 52.5200, lng:  13.4050 }, // 柏林
  { code:'JP', label:'日本',     flag:'🇯🇵', gl:'JP', lat: 35.6762, lng: 139.6503 }, // 东京
  { code:'ES', label:'西班牙',   flag:'🇪🇸', gl:'ES', lat: 40.4168, lng:  -3.7038 }, // 马德里
  { code:'GB', label:'英国',     flag:'🇬🇧', gl:'GB', lat: 51.5074, lng:  -0.1278 }, // 伦敦
  { code:'FR', label:'法国',     flag:'🇫🇷', gl:'FR', lat: 48.8566, lng:   2.3522 }, // 巴黎
  { code:'CA', label:'加拿大',   flag:'🇨🇦', gl:'CA', lat: 43.6532, lng:-79.3832 },  // 多伦多
  { code:'AU', label:'澳大利亚', flag:'🇦🇺', gl:'AU', lat:-33.8688, lng:151.2093 },  // 悉尼
];

export const DEFAULT_GEO_CODE: GeoCode = 'US';   // 默认开启 + 美国
export const GEO_OFF: GeoCode = 'OFF';
```

## 6. background 规则引擎(`lib/quicksearch/geo.ts`)

```ts
const RULE_ID = 1;
const ACCEPT_LANG = 'en';
const GEO_HOST_FILTER = 'google.com';

/** UULE 编码 —— 移植自 gslocation genUULE()。 */
export function encodeXGeo(lat: number, lng: number): string {
  const latE7 = Math.floor(lat * 1e7);
  const lngE7 = Math.floor(lng * 1e7);
  const plain =
    'role: CURRENT_LOCATION\nproducer: DEVICE_LOCATION\nradius: 65000\n' +
    'latlng <\n' +
    `  latitude_e7: ${latE7}\n  longitude_e7: ${lngE7}\n>`;
  return 'a ' + btoa(plain);
}

/** code → GeoRegion;OFF/未知 → null。 */
export function resolveGeo(code: string | undefined): GeoRegion | null {
  if (!code || code === GEO_OFF) return null;
  return GEO_REGIONS.find(r => r.code === code) ?? null;
}

/** 应用地理位置:先清旧规则与 UULE,再写新规则;传 null = 关闭。 */
export async function applyGeo(region: GeoRegion | null): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  await clearUuleCookies();
  if (!region) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id: RULE_ID, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'x-geo',           operation: 'set', value: encodeXGeo(region.lat, region.lng) },
        { header: 'accept-language', operation: 'set', value: ACCEPT_LANG },
      ]},
      condition: {
        urlFilter: GEO_HOST_FILTER,
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'ping'],
      },
    }],
  });
}

/**
 * 删 Google 回写的 UULE cookie。
 * domain 可能带前导 '.',需去掉才能拼合法 URL(gslocation 原版此处有隐患,修正)。
 */
async function clearUuleCookies(): Promise<void> {
  const cookies = await chrome.cookies.getAll({ name: 'UULE' });
  await Promise.all(cookies.map(c => {
    const host = c.domain.replace(/^\./, '');
    const url = `https://${host}${c.path}`;
    return chrome.cookies.remove({ name: 'UULE', url });
  }));
}
```

存储读写封装(同文件):

```ts
export const GEO_STORAGE_KEY = 'kw-tools:geo';
interface GeoPref { code: GeoCode; ts: number; }

export async function getGeoPref(): Promise<{ code: GeoCode }> {
  const items = await chrome.storage.local.get(GEO_STORAGE_KEY);
  const code = (items[GEO_STORAGE_KEY] as GeoPref | undefined)?.code;
  return { code: code ?? DEFAULT_GEO_CODE };
}

export async function setGeoPref(code: GeoCode): Promise<void> {
  await chrome.storage.local.set({ [GEO_STORAGE_KEY]: { code, ts: Date.now() } });
}
```

## 7. background.ts 集成

在现有 `defineBackground(() => { ... })` 顶层(与 `onConnect` 监听并列)追加:

```ts
import { getGeoPref, applyGeo, resolveGeo, GEO_STORAGE_KEY, DEFAULT_GEO_CODE, type GeoCode } from '../lib/quicksearch/geo';

// 启动/安装时按 storage 重建规则(默认 'US' → 即默认开启美国)
chrome.runtime.onStartup.addListener(initGeo);
chrome.runtime.onInstalled.addListener(initGeo);
async function initGeo(): Promise<void> {
  const { code } = await getGeoPref();
  await applyGeo(resolveGeo(code));
}

// UI 切换 → 实时生效
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[GEO_STORAGE_KEY]) return;
  const code = (changes[GEO_STORAGE_KEY].newValue as { code?: GeoCode } | undefined)?.code ?? DEFAULT_GEO_CODE;
  void applyGeo(resolveGeo(code));
});
```

## 8. UI 改造(`QuickSearchTool.tsx`)

按钮组上方加一行「搜索位置」下拉(复用现有 `Select` 组件):

```tsx
import Select from '../components/Select';
import { useEffect, useState } from 'react';
import { GEO_REGIONS, GEO_OFF, getGeoPref, setGeoPref, type GeoCode } from '@lib/quicksearch/geo';

const labelStyle = { display:'block', fontSize:12, color:'var(--color-muted)', marginBottom:4 } as const;

// 组件内:
const [geoCode, setGeoCode] = useState<GeoCode>('US');
useEffect(() => { void (async () => setGeoCode((await getGeoPref()).code))(); }, []);
const onGeoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
  const v = e.target.value as GeoCode;
  setGeoCode(v);
  void setGeoPref(v);   // background 监听 storage 变化生效
};

// JSX(在按钮 div 之前):
<label style={labelStyle}>搜索位置</label>
<div style={{ marginBottom: 8 }}>
  <Select
    value={geoCode}
    onChange={onGeoChange}
    options={[
      { value: GEO_OFF, label: '🚪 关闭(用真实位置)' },
      ...GEO_REGIONS.map(r => ({ value: r.code, label: `${r.flag} ${r.label}` })),
    ]}
  />
</div>
```

`buildGoogleSearchUrl` 与「用 Google 搜」按钮逻辑**保持不变**(URL 仍是普通 google.com/search,header 全局规则负责伪装)。

## 9. manifest 权限改动(`wxt.config.ts`)

```ts
permissions: ['debugger', 'tabs', 'sidePanel', 'storage',
  'declarativeNetRequestWithHostAccess',  // 新增:注入 x-geo / accept-language
  'cookies'],                              // 新增:清 UULE cookie
// host_permissions 已含 '<all_urls>',覆盖 google.com,无需改
```

选用 `declarativeNetRequestWithHostAccess`(而非 `declarativeNetRequest`):它允许在已有 host_permissions 的域上 modifyHeaders,无需用户额外授权弹窗;`x-geo` 与 `accept-language` 不在 [受限头列表](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest),可自由 set。

## 10. 边界与错误处理

- **sessionRules 跨 SW 回收**:`sessionRules` 存于浏览器进程,service worker 被回收不影响规则存活;`onStartup`/`onInstalled` 仅作兜底重建。
- **切换残留**:每次切换都先 `removeRuleIds([1])` + `clearUuleCookies()`,再加新规则 → UULE 不残留、规则不叠加。
- **UULE domain 带前导 `.`**:gslocation 原版 `'https://' + domain + path` 在 domain 为 `.google.com` 时拼出非法 URL;本设计用 `domain.replace(/^\./, '')` 修正。
- **关闭语义**:选 `OFF` → 移规则 + 删 UULE → 恢复真实位置;浏览器重启也会因 sessionRules 失效而天然回到真实位置(下次启动 onStartup 按存储重建,若仍是 OFF 则不注入)。
- **未知 code 容错**:`resolveGeo` 对未知 code 返回 null(等同关闭),不会因脏数据崩溃。
- **btoa 可用性**:MV3 service worker 支持 `btoa`/`atob`,无需 polyfill。
- **不抓结果**:本功能只改请求头,不 fetch、不解析,零额外网络副作用。

## 11. 测试策略(Vitest)

新文件 `tests/quicksearch-geo.test.ts`:

1. **`encodeXGeo` 纯函数**:给定 `(37.4224, -122.0842)`,产出以 `"a "` 开头的串;`atob` 解码剥掉 `"a "` 前缀后,明文含 `latitude_e7: 374224000` 与 `longitude_e7: -1220842000`。可对照 gslocation `geo.json` 样例格式佐证。
2. **`applyGeo(region)` 行为**:mock `chrome.declarativeNetRequest` + `chrome.cookies`:
   - 传有效 region → 依次调用 `updateSessionRules({removeRuleIds:[1]})`、`cookies.getAll({name:'UULE'})`、`cookies.remove(...)`、`updateSessionRules({addRules:[...]})`;新增规则的 requestHeaders 含 `x-geo` 与 `accept-language: en`。
   - 传 null → 只 `removeRuleIds` + 清 cookie,不调 `addRules`。
3. **`clearUuleCookies` domain 修正**:构造一个 `domain: '.google.com'` 的 cookie,断言 `cookies.remove` 收到的 url 是 `https://google.com/...`(无前导点)。
4. **数据完整性**:`GEO_REGIONS` 恰好 8 条;每条 `code/label/flag/gl/lat/lng` 齐全;`code` 唯一;`lat∈[-90,90]`、`lng∈[-180,180]`。
5. **`getGeoPref` 默认值**:空 storage → 返回 `{ code: 'US' }`;有存储值 → 原样返回。
6. **`resolveGeo`**:`'US'` → 美国 region;`'OFF'`/`undefined`/`'XX'` → null。
7. **回归**:现有 `tests/quicksearch-url.test.ts` 保持绿色(`url.ts` 未动)。

## 12. 文件清单

| 动作 | 文件 | 说明 |
|---|---|---|
| 新增 | `lib/quicksearch/geo.ts` | `GEO_REGIONS` / `encodeXGeo` / `resolveGeo` / `applyGeo` / `clearUuleCookies` / `getGeoPref`·`setGeoPref` / 常量与类型 |
| 改 | `entrypoints/background.ts` | 加 `onStartup`/`onInstalled` + `storage.onChanged` 监听(与现有 `onConnect` 并列) |
| 改 | `entrypoints/sidepanel/pages/QuickSearchTool.tsx` | 加 `Select` + label + geo state/effect |
| 改 | `wxt.config.ts` | `permissions` 加 `declarativeNetRequestWithHostAccess`、`cookies` |
| 新增 | `tests/quicksearch-geo.test.ts` | 上述 7 组用例 |

## 13. 风险与已知限制

- **全局副作用**:开启期间,用户在浏览器内**所有** Google 访问都被伪装(含手动打开 google.com、其他标签页)。用户已确认接受,并通过「关闭」项提供逃生口。
- **Google 可能调整 `x-geo`/`UULE` 机制**:gslocation v3.7→v3.9 多次因 Google Maps endpoint 变化而调整,说明该机制是「非官方」的,存在未来失效风险。本期锁定国家级固定坐标(不依赖 geocoding endpoint),较 gslocation 城市级更稳定;但仍属非官方机制,无法保证永久有效。
- **`accept-language` 被全局设为 `en`**:会影响 google.com 的界面语言,但不影响其他网站(规则 condition 仅匹配 `google.com`)。
