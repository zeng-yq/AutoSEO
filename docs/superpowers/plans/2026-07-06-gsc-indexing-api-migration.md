# GSC Indexing API 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 GSC 网址提交从 CDP（开 tab + chrome.debugger 操控 DOM）迁移到 Google Indexing API（OAuth2 服务账号 JSON + 单条 publish），与 Bing/IndexNow 模式对称。

**Architecture:** 服务账号 JSON 密钥粘贴到提交面板配置区 → background 用其 private_key 签 JWT（Web Crypto）换 access_token（带缓存）→ 串行逐条 POST `urlNotifications:publish` → 按状态码映射 `SubmitResult`。复用现有 `GSC_*` 消息协议，UI/Runner/Orchestrator 零改动。

**Tech Stack:** TypeScript, WXT (MV3 service worker), React 19, Web Crypto API (`crypto.subtle` RS256), Vitest + jsdom, `chrome.storage.local`。

## Global Constraints

- **零依赖**：JWT 签名只用 Web Crypto API，不引入 jose / jsrsasign 等库。
- **协议零改动**：不改 `lib/messaging/types.ts` / `protocol.ts`（`GscStart`/`GscCancel`/`GscState`/`GscLog`/`GscDone`/`SubmitResult`/`SubmitStatus` 完全复用）。
- **串行逐条提交**：`for...await` 串行，无人为 sleep；遇 429 立即停止剩余（标 skipped）。
- **无 `failed` 状态**：`SubmitStatus` 只有 `'ok' | 'skipped'`；失败复用 skipped + reason（`classifyResult` 反向枚举归 failed）。
- **私钥明文存储**：`chrome.storage.local` 明文存整段 JSON（与 `indexnowKey` 一致，项目无加密层）。
- **测试命令**：单文件 `npx vitest run tests/<file>`；全量 `npm test`；类型检查 `npm run compile`。
- **commit 约定**：`feat(gsc): ...` / `refactor(gsc): ...` / `chore(gsc): ...`，中文描述。
- **不得运行 `npm run dev`**（项目铁律）。

**设计依据**：`docs/superpowers/specs/2026-07-06-gsc-indexing-api-migration-design.md`

---

### Task 1: `lib/gsc/auth.ts` — 服务账号解析 + JWT 签名 + access_token 缓存

**Files:**
- Create: `lib/gsc/auth.ts`
- Test: `tests/gsc-auth.test.ts`

**Interfaces:**
- Produces: `ServiceAccount`（`{ clientEmail, privateKeyPem, tokenUri }`）、`parseServiceAccount(jsonText: string): ServiceAccount`、`base64url(bytes: Uint8Array | string): string`、`getAccessToken(creds: ServiceAccount): Promise<string>`。Task 4/5 依赖。

- [ ] **Step 1: 写失败测试（base64url + parseServiceAccount）**

创建 `tests/gsc-auth.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseServiceAccount, base64url, getAccessToken } from '../lib/gsc/auth';
import * as settings from '../lib/storage/settings';

beforeEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const VALID_SA = JSON.stringify({
  type: 'service_account',
  client_email: 'sa@proj-42.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAUEwggE9AgE\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});

describe('base64url', () => {
  it('字符串输入 → 去填充', () => {
    expect(base64url('hello')).toBe('aGVsbG8'); // btoa('hello')='aGVsbG8='
  });
  it('字节输入 → 与字符串等价', () => {
    expect(base64url(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8');
  });
  it('URL 安全：+ → -、/ → _', () => {
    // 字节序列使 btoa 产生 + 和 / 与 =
    expect(base64url(new Uint8Array([255, 255, 255, 254]))).not.toMatch(/[+/=]/);
  });
});

describe('parseServiceAccount', () => {
  it('合法 JSON → 正确字段', () => {
    const r = parseServiceAccount(VALID_SA);
    expect(r.clientEmail).toBe('sa@proj-42.iam.gserviceaccount.com');
    expect(r.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(r.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
  it('非法 JSON → 抛错', () => {
    expect(() => parseServiceAccount('{not json')).toThrow(/JSON/i);
  });
  it('type 非 service_account → 抛错', () => {
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toThrow(/service_account/);
  });
  it('缺 client_email → 抛错', () => {
    const o = JSON.parse(VALID_SA); delete o.client_email;
    expect(() => parseServiceAccount(JSON.stringify(o))).toThrow(/client_email/);
  });
  it('缺 private_key → 抛错', () => {
    const o = JSON.parse(VALID_SA); delete o.private_key;
    expect(() => parseServiceAccount(JSON.stringify(o))).toThrow(/private_key/);
  });
  it('缺 token_uri → 用默认', () => {
    const o = JSON.parse(VALID_SA); delete o.token_uri;
    expect(parseServiceAccount(JSON.stringify(o)).tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
});

describe('getAccessToken', () => {
  const CREDS = parseServiceAccount(VALID_SA);

  it('缓存未过期 → 直接返回，不 fetch', async () => {
    vi.spyOn(settings, 'getSettings').mockResolvedValue({
      gscToken: { accessToken: 'cached-token', expiresAt: Date.now() + 600_000 },
    } as any);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await getAccessToken(CREDS)).toBe('cached-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缓存过期 → 签 JWT 换新 + 写缓存', async () => {
    vi.spyOn(settings, 'getSettings').mockResolvedValue({
      gscToken: { accessToken: 'old', expiresAt: Date.now() - 1000 },
    } as any);
    const updateSpy = vi.spyOn(settings, 'updateSettings').mockResolvedValue();
    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue('key-handle'),
        sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      },
    } as any);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
    } as any);
    expect(await getAccessToken(CREDS)).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    // 断言 assertion 三段式 + grant_type 正确
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(body).toContain('assertion=');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      gscToken: expect.objectContaining({ accessToken: 'new-token' }),
    }));
  });

  it('无缓存 → 签 JWT 换新', async () => {
    vi.spyOn(settings, 'getSettings').mockResolvedValue({} as any);
    vi.spyOn(settings, 'updateSettings').mockResolvedValue();
    vi.stubGlobal('crypto', {
      subtle: { importKey: vi.fn().mockResolvedValue('k'), sign: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer) },
    } as any);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }),
    } as any);
    expect(await getAccessToken(CREDS)).toBe('fresh');
  });

  it('换 token HTTP 非 200 → 抛错', async () => {
    vi.spyOn(settings, 'getSettings').mockResolvedValue({} as any);
    vi.stubGlobal('crypto', {
      subtle: { importKey: vi.fn().mockResolvedValue('k'), sign: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer) },
    } as any);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' } as any);
    await expect(getAccessToken(CREDS)).rejects.toThrow(/换.*令牌.*失败|HTTP 400/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/gsc-auth.test.ts`
Expected: FAIL（模块 `../lib/gsc/auth` 不存在）。

- [ ] **Step 3: 实现 `lib/gsc/auth.ts`**

```ts
/**
 * Google Indexing API 服务账号认证。
 *
 * OAuth2 server-to-server：用服务账号 JSON 的 private_key 签 JWT 换 access_token。
 * access_token 带过期缓存（settings.gscToken），避免每次提交都换 token。
 * Web Crypto 实现 RS256 签名，零依赖（MV3 service worker 支持 crypto.subtle）。
 *
 * 依据：docs/superpowers/specs/2026-07-06-gsc-indexing-api-migration-design.md §5.1
 */

import { getSettings, updateSettings } from '../storage/settings';

const SCOPE = 'https://www.googleapis.com/auth/indexing';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** 提前过期边界：避免提交途中恰好失效。 */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export interface ServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
}

/** 解析服务账号 JSON 文本。失败抛错（供 UI 保存/测试连接反馈）。 */
export function parseServiceAccount(jsonText: string): ServiceAccount {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  if (obj.type !== 'service_account') {
    throw new Error('JSON 不是服务账号（type !== "service_account"）');
  }
  const clientEmail = typeof obj.client_email === 'string' ? obj.client_email : undefined;
  const privateKeyPem = typeof obj.private_key === 'string' ? obj.private_key : undefined;
  const tokenUri = typeof obj.token_uri === 'string' ? obj.token_uri : DEFAULT_TOKEN_URI;
  if (!clientEmail) throw new Error('缺少 client_email');
  if (!privateKeyPem) throw new Error('缺少 private_key');
  return { clientEmail, privateKeyPem, tokenUri };
}

/** base64url 编码（无填充）。SW 无 Buffer，手写。 */
export function base64url(input: Uint8Array | string): string {
  const bin = typeof input === 'string' ? input : bytesToBinaryString(input);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** PEM(PKCS#8) → DER 字节。剥离头尾与换行后 atob 解码。 */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function signRsaSha256(privateKeyPem: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  return base64url(new Uint8Array(sig));
}

async function buildAssertion(creds: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: creds.clientEmail,
    scope: SCOPE,
    aud: creds.tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${payload}`;
  const signature = await signRsaSha256(creds.privateKeyPem, signInput);
  return `${signInput}.${signature}`;
}

async function fetchAccessToken(creds: ServiceAccount): Promise<{ accessToken: string; expiresIn: number }> {
  const assertion = await buildAssertion(creds);
  const res = await fetch(creds.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`换取访问令牌失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** 取 access_token：命中缓存则返回，否则签 JWT 换新并写缓存。 */
export async function getAccessToken(creds: ServiceAccount): Promise<string> {
  const { gscToken } = await getSettings();
  if (gscToken && gscToken.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
    return gscToken.accessToken;
  }
  const { accessToken, expiresIn } = await fetchAccessToken(creds);
  await updateSettings({
    gscToken: { accessToken, expiresAt: Date.now() + expiresIn * 1000 },
  });
  return accessToken;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/gsc-auth.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 类型检查**

Run: `npm run compile`
Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add lib/gsc/auth.ts tests/gsc-auth.test.ts
git commit -m "feat(gsc): 新增服务账号 JWT 签名与 access_token 缓存"
```

---

### Task 2: `lib/gsc/submit.ts` — publish / getMetadata / submitBatch

**Files:**
- Create: `lib/gsc/submit.ts`
- Test: `tests/gsc-submit.test.ts`

**Interfaces:**
- Consumes: `SubmitResult` from `../messaging/types`。
- Produces: `GscResult`、`publishUrl(token, url)`、`getMetadata(token, url)`、`reasonFor(status)`、`submitBatch(token, urls, hooks)`。Task 4/5 依赖。

- [ ] **Step 1: 写失败测试**

创建 `tests/gsc-submit.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/gsc-submit.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `lib/gsc/submit.ts`**

```ts
/**
 * Google Indexing API 提交。
 *
 * 端点：POST https://indexing.googleapis.com/v3/urlNotifications:publish
 * 鉴权：Authorization: Bearer <access_token>（token 由 lib/gsc/auth.ts 提供）。
 * 依据：docs/superpowers/specs/2026-07-06-gsc-indexing-api-migration-design.md §5.2/§5.6
 */

import type { SubmitResult } from '../messaging/types';

const PUBLISH_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const METADATA_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications/metadata';

export interface GscResult {
  ok: boolean;
  status: number;
  reason?: string;
}

export interface SubmitBatchProgress {
  total: number;
  done: number;
  currentUrl: string;
  results: SubmitResult[];
}

export interface SubmitBatchLog {
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
}

/** 单条提交（URL_UPDATED）。fetch 抛错透传（调用方 catch 兜底「网络错误」）。 */
export async function publishUrl(token: string, url: string): Promise<GscResult> {
  const res = await fetch(PUBLISH_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type: 'URL_UPDATED' }),
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

/** 探活（测试连接用）：GET metadata，仅看鉴权是否通过。 */
export async function getMetadata(token: string, url: string): Promise<GscResult> {
  const res = await fetch(`${METADATA_ENDPOINT}?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 200) return { ok: true, status: 200 };
  return { ok: false, status: res.status, reason: reasonFor(res.status) };
}

export function reasonFor(status: number): string {
  switch (status) {
    case 403: return 'GSC：密钥无效，或服务账号未加为站点所有者';
    case 429: return 'GSC：超出每日 200 次配额，请明日重试';
    case 400: return 'GSC：请求格式或网址错误';
    case 404: return 'GSC：端点未找到';
    default: return `GSC：返回 ${status}`;
  }
}

/**
 * 串行逐条提交一批 URL。
 * - 串行（非并发）：与 handleBingStart 风格一致，进度逐条递增（done 1→2→…→N）。
 * - 遇 429 设 quotaHit：剩余条目保持 skipped(reason「未执行（批次终止）」)，不再请求。
 * - shouldStop() 为 true 即在下一条前中止。
 */
export async function submitBatch(
  token: string,
  urls: string[],
  hooks: {
    shouldStop?: () => boolean;
    onProgress?: (p: SubmitBatchProgress) => void;
    onLog?: (e: SubmitBatchLog) => void;
  } = {},
): Promise<{ results: SubmitResult[]; ok: number; skipped: number }> {
  const results: SubmitResult[] = urls.map((u) => ({ url: u, status: 'skipped', reason: '未执行' }));
  let quotaHit = false;

  for (let i = 0; i < urls.length; i++) {
    if (hooks.shouldStop?.()) break;
    const url = urls[i];
    const row = results[i];

    if (quotaHit) {
      row.reason = '未执行（批次终止）';
      continue;
    }

    let r: GscResult;
    try {
      r = await publishUrl(token, url);
    } catch (e) {
      r = { ok: false, status: 0, reason: `网络错误：${(e as Error).message ?? String(e)}` };
    }

    if (r.ok) {
      row.status = 'ok';
      row.reason = undefined;
    } else {
      row.reason = r.reason;
      if (r.status === 429) quotaHit = true;
    }

    hooks.onLog?.({
      level: r.ok ? 'info' : 'error',
      phase: 'submit',
      message: r.ok ? `✓ ${url}` : `✗ ${url}：${r.reason}`,
    });
    hooks.onProgress?.({
      total: urls.length,
      done: i + 1,
      currentUrl: url,
      results: [...results],
    });
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  return { results, ok, skipped: urls.length - ok };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/gsc-submit.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/gsc/submit.ts tests/gsc-submit.test.ts
git commit -m "feat(gsc): 新增 Indexing API 单条/批量提交与状态码映射"
```

---

### Task 3: `lib/storage/settings.ts` 扩展（加 GSC 凭证字段）

**Files:**
- Modify: `lib/storage/settings.ts`
- Test: 无需新增（复用现有 settings 行为；字段为可选，不破坏既有测试）。

**Interfaces:**
- Produces: `Settings` 新增 `gscCredentials?: string`、`gscToken?: { accessToken: string; expiresAt: number }`。Task 1（auth.ts）已通过 `getSettings/updateSettings` 消费；Task 4/5 依赖。`accountIndex` 暂保留（Task 8 删除）。

- [ ] **Step 1: 修改 `Settings` 接口与 `DEFAULT`**

打开 `lib/storage/settings.ts`，将第 1 行和第 3 行：

```ts
export interface Settings { accountIndex: number; indexnowKey?: string; }
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };
```

改为：

```ts
export interface Settings {
  accountIndex: number;
  indexnowKey?: string;
  /** Google Indexing API 服务账号 JSON 整段文本（手动粘贴）。 */
  gscCredentials?: string;
  /** access_token 缓存（由 lib/gsc/auth.ts 读写）。 */
  gscToken?: { accessToken: string; expiresAt: number };
}
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };
```

- [ ] **Step 2: 类型检查 + 全量测试不回归**

Run: `npm run compile && npm test`
Expected: 编译无错；全量测试通过（新增可选字段不破坏既有用例）。

- [ ] **Step 3: Commit**

```bash
git add lib/storage/settings.ts
git commit -m "feat(settings): 新增 gscCredentials/gscToken 字段"
```

---

### Task 4: 重写 `entrypoints/background.ts` 的 `handleStart`（CDP → API）

**Files:**
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: `parseServiceAccount`/`getAccessToken`（Task 1）、`submitBatch`（Task 2）、`getSettings`（Task 3）。
- Produces: 新 `handleStart(port, msg, shouldStop)`，仍推送 `GSC_STATE`/`GSC_LOG`/`GSC_DONE`（协议不变）。删除对 `lib/cdp/*`、`lib/gsc/{flow,url,selectors}` 的引用（使 Task 8 可安全删除）。

- [ ] **Step 1: 替换 imports（删除 CDP/GSC-CDP，加入 auth/submit）**

打开 `entrypoints/background.ts`。删除以下 import（第 21–25 行）：

```ts
import { attach, detach, type Target } from '../lib/cdp/client';
import { evalJs, waitForLoad, waitForPredicate, fmtMs } from '../lib/cdp/actions';
import { runBatch } from '../lib/gsc/flow';
import { buildGscUrl } from '../lib/gsc/url';
import { PROBES } from '../lib/gsc/selectors';
```

将第 26 行 `import { getSettings, isValidIndexNowKey } from '../lib/storage/settings';` 改为：

```ts
import { getSettings, isValidIndexNowKey } from '../lib/storage/settings';
import { parseServiceAccount, getAccessToken, type ServiceAccount } from '../lib/gsc/auth';
import { submitBatch } from '../lib/gsc/submit';
```

删除第 33–50 行的 CDP 常量（`GSC_LOAD_TIMEOUT_MS`、`GSC_LOAD_INTERVAL_MS`、`LOGIN_CHECK_EXPR` 整块）。

- [ ] **Step 2: 改 GSC port 监听为闭包 stop（删 module-scope 标志）**

删除第 75–78 行的 module-scope 变量：

```ts
  /** 取消标志；GSC_CANCEL 置 true，runBatch 下一条 URL 前自检。 */
  let stopRequested = false;
  /** 当前活跃 port；UI 断开即视为放弃（清空以便后续 GSC_START 复用）。 */
  let currentPort: chrome.runtime.Port | null = null;
```

将 GSC port 分支（第 81–95 行）：

```ts
    if (port.name === GSC_PORT_NAME) {
      currentPort = port;

      port.onMessage.addListener((msg: GscRequest) => {
        // GSC_START 是异步长流程；GSC_CANCEL 仅置标志。
        if (msg.type === 'GSC_START') {
          void handleStart(port, msg);
        } else if (msg.type === 'GSC_CANCEL') {
          stopRequested = true;
        }
      });

      port.onDisconnect.addListener(() => {
        if (currentPort === port) currentPort = null;
      });
    } else if (port.name === BING_PORT_NAME) {
```

改为：

```ts
    if (port.name === GSC_PORT_NAME) {
      // 闭包 stop 标志（与 Bing runner 一致）：GSC_CANCEL 置位，submitBatch 下一条前自检。
      let gscStop = false;
      port.onMessage.addListener((msg: GscRequest) => {
        if (msg.type === 'GSC_START') {
          void handleStart(port, msg, () => gscStop);
        } else if (msg.type === 'GSC_CANCEL') {
          gscStop = true;
        }
      });
    } else if (port.name === BING_PORT_NAME) {
```

- [ ] **Step 3: 重写 `handleStart` 函数**

将整个旧 `handleStart`（原第 133–213 行，从 `async function handleStart(` 到对应的 `}`，含 try/catch/finally 和 detach）替换为：

```ts
  /**
   * 编排一次 GSC 批量提交（Indexing API 版）。
   *
   * 流程：读 settings.gscCredentials → parseServiceAccount → getAccessToken（命中缓存或 JWT 换取）
   *   → submitBatch（串行逐条 POST urlNotifications:publish，推 GSC_STATE/GSC_LOG）→ GSC_DONE。
   * 未配密钥 / 解析失败 / 换 token 失败：推 error 日志 + GSC_DONE(全 skipped)。
   *
   * 替代旧版 CDP 编排（开 tab / attach / 等 SPA / 登录检查 / 逐条 evalJs 操控 DOM / detach）。
   * 单次 POST 通常 1-3s；遇 429 立即停止剩余（submitBatch 内 quotaHit）。
   *
   * ⚠️ Indexing API 官方仅支持 JobPosting/BroadcastEvent 页面；普通网页调用返回 200 但 Google
   *   不保证抓取。用户已知情并选择迁移（spec §2）。
   */
  async function handleStart(
    port: chrome.runtime.Port,
    msg: { domain: string; urls: string[] },
    shouldStop: () => boolean,
  ): Promise<void> {
    const { gscCredentials } = await getSettings();
    if (!gscCredentials) {
      emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: '未配置 GSC 服务账号密钥，请在下方粘贴' });
      emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
      return;
    }

    let creds: ServiceAccount;
    try {
      creds = parseServiceAccount(gscCredentials);
    } catch (e) {
      emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `密钥解析失败：${(e as Error).message}` });
      emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
      return;
    }

    let token: string;
    try {
      token = await getAccessToken(creds);
    } catch (e) {
      emit(port, { type: 'GSC_LOG', level: 'error', phase: 'system', message: `换取访问令牌失败：${(e as Error).message}` });
      emit(port, { type: 'GSC_DONE', ok: 0, failed: 0, skipped: msg.urls.length });
      return;
    }

    emit(port, { type: 'GSC_STATE', state: 'running', total: msg.urls.length, done: 0, results: [] });
    emit(port, { type: 'GSC_LOG', level: 'info', phase: 'system', message: `提交 ${msg.urls.length} 条到 Indexing API…` });

    const { results, ok, skipped } = await submitBatch(token, msg.urls, {
      shouldStop,
      onProgress: (s) => emit(port, {
        type: 'GSC_STATE',
        state: 'running',
        total: s.total,
        done: s.done,
        currentUrl: s.currentUrl,
        results: s.results,
      }),
      onLog: (e) => emit(port, { type: 'GSC_LOG', level: e.level, phase: e.phase, message: e.message }),
    });

    void results; // results 已随 GSC_STATE 推送；GSC_DONE 仅汇总计数
    emit(port, { type: 'GSC_DONE', ok, failed: 0, skipped });
  }
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npm run compile && npm test`
Expected: 编译无错；全量测试通过（`useGscRunner` 协议测试不变）。

- [ ] **Step 5: 手动验证（构建 + 实跑）**

Run: `npm run build`
Expected: 构建成功，无 `lib/cdp` 未解析引用。

手动（需在浏览器加载扩展，配置真实服务账号 JSON 后触发一次 GSC 提交）：日志应出现「提交 N 条到 Indexing API…」→ 逐条 ✓/✗ → GSC_DONE。若暂无真实密钥，跳过实跑，依靠类型检查 + Task 1/2 单测覆盖逻辑。

- [ ] **Step 6: Commit**

```bash
git add entrypoints/background.ts
git commit -m "refactor(gsc): handleStart 改为 Indexing API 编排，去除 CDP 依赖"
```

---

### Task 5: `useGscCredentials` hook

**Files:**
- Create: `entrypoints/sidepanel/hooks/useGscCredentials.ts`
- Test: `tests/useGscCredentials.test.tsx`

**Interfaces:**
- Consumes: `getSettings`/`updateSettings`（Task 3）、`parseServiceAccount`/`getAccessToken`（Task 1）。
- Produces: `{ credentials, save, clear, testConnection, testStatus, testMessage }`。Task 6 依赖。

- [ ] **Step 1: 写失败测试**

创建 `tests/useGscCredentials.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGscCredentials } from '../entrypoints/sidepanel/hooks/useGscCredentials';
import { getSettings, updateSettings } from '../lib/storage/settings';
import * as auth from '../lib/gsc/auth';

const VALID = JSON.stringify({
  type: 'service_account',
  client_email: 'sa@proj.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});

// 与 useIndexNowKey.test.tsx 一致：依赖 vitest 全局 chrome.storage.local polyfill，直接用真实 settings。
beforeEach(async () => {
  vi.restoreAllMocks();
  await updateSettings({ gscCredentials: undefined, gscToken: undefined });
});

describe('useGscCredentials', () => {
  it('初次读 settings.gscCredentials', async () => {
    await updateSettings({ gscCredentials: VALID });
    const { result } = renderHook(() => useGscCredentials());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.credentials).toBe(VALID);
  });

  it('save → 写 gscCredentials + 清 gscToken', async () => {
    const { result } = renderHook(() => useGscCredentials());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { result.current.save(VALID); await Promise.resolve(); await Promise.resolve(); });
    const s = await getSettings();
    expect(s.gscCredentials).toBe(VALID);
    expect(s.gscToken).toBeUndefined();
  });

  it('clear → 清空两个字段', async () => {
    await updateSettings({ gscCredentials: VALID, gscToken: { accessToken: 'x', expiresAt: 1 } });
    const { result } = renderHook(() => useGscCredentials());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { result.current.clear(); await Promise.resolve(); await Promise.resolve(); });
    const s = await getSettings();
    expect(s.gscCredentials).toBeUndefined();
    expect(s.gscToken).toBeUndefined();
  });

  it('testConnection 成功 → testStatus=ok + 服务账号邮箱', async () => {
    await updateSettings({ gscCredentials: VALID });
    vi.spyOn(auth, 'getAccessToken').mockResolvedValue('TOK');
    const { result } = renderHook(() => useGscCredentials());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await result.current.testConnection(); });
    expect(result.current.testStatus).toBe('ok');
    expect(result.current.testMessage).toContain('sa@proj.iam.gserviceaccount.com');
  });

  it('testConnection 失败（密钥非法）→ testStatus=fail + message', async () => {
    await updateSettings({ gscCredentials: 'not-json' });
    const { result } = renderHook(() => useGscCredentials());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await result.current.testConnection(); });
    expect(result.current.testStatus).toBe('fail');
    expect(result.current.testMessage).toMatch(/JSON/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/useGscCredentials.test.tsx`
Expected: FAIL（hook 模块不存在）。

- [ ] **Step 3: 实现 hook**

创建 `entrypoints/sidepanel/hooks/useGscCredentials.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '@lib/storage/settings';
import { parseServiceAccount, getAccessToken } from '@lib/gsc/auth';

const SETTINGS_KEY = 'settings';

export type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

/**
 * GSC 服务账号凭证状态（对应 useIndexNowKey）。
 * - credentials：读 settings.gscCredentials，storage.onChanged 跨视图同步。
 * - save：写 gscCredentials 并清旧 gscToken（换密钥即作废缓存）。
 * - clear：清空两个字段。
 * - testConnection：强制清缓存后重换 token，验证密钥格式 + private_key 有效。
 */
export function useGscCredentials() {
  const [credentials, setCredentials] = useState<string | undefined>(undefined);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getSettings().then((s) => { if (active) setCredentials(s.gscCredentials); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const next = (changes[SETTINGS_KEY].newValue as { gscCredentials?: string } | undefined)?.gscCredentials;
      setCredentials(next);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const save = useCallback((text: string) => {
    void updateSettings({ gscCredentials: text, gscToken: undefined });
    setTestStatus('idle');
    setTestMessage(undefined);
  }, []);

  const clear = useCallback(() => {
    void updateSettings({ gscCredentials: undefined, gscToken: undefined });
    setTestStatus('idle');
    setTestMessage(undefined);
  }, []);

  const testConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestMessage(undefined);
    try {
      const creds = parseServiceAccount(credentials ?? '');
      await updateSettings({ gscToken: undefined }); // 强制重换 token，避免缓存命中掩盖问题
      await getAccessToken(creds);
      setTestStatus('ok');
      setTestMessage(`密钥有效（服务账号：${creds.clientEmail}）`);
    } catch (e) {
      setTestStatus('fail');
      setTestMessage((e as Error).message ?? String(e));
    }
  }, [credentials]);

  return { credentials, save, clear, testConnection, testStatus, testMessage };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/useGscCredentials.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add entrypoints/sidepanel/hooks/useGscCredentials.ts tests/useGscCredentials.test.tsx
git commit -m "feat(gsc): 新增 useGscCredentials 凭证管理 hook"
```

---

### Task 6: `GscCredentialsSection` 组件

**Files:**
- Create: `entrypoints/sidepanel/components/GscCredentialsSection.tsx`
- Test: `tests/gsc-credentials-section.test.tsx`

**Interfaces:**
- Consumes: `useGscCredentials`（Task 5）、`Button`。
- Produces: 默认导出的 React 组件，常驻 SubmitPanel。Task 7 引用。

- [ ] **Step 1: 写失败测试**

创建 `tests/gsc-credentials-section.test.tsx`：

```tsx
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/gsc-credentials-section.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现组件**

创建 `entrypoints/sidepanel/components/GscCredentialsSection.tsx`：

```tsx
import { useEffect, useState } from 'react';
import Button from './Button';
import { useGscCredentials } from '../hooks/useGscCredentials';

/**
 * GSC 服务账号密钥配置区（常驻提交面板，对应 IndexNowKeySection）。
 * textarea 粘贴整段服务账号 JSON；保存/清空/测试连接。
 * 测试连接：强制重换 access_token，验证密钥格式 + private_key 有效（不验证站点所有权，由真实提交的 403 暴露）。
 */
export default function GscCredentialsSection() {
  const { credentials, save, clear, testConnection, testStatus, testMessage } = useGscCredentials();
  const [draft, setDraft] = useState(credentials ?? '');

  // credentials 外部变化（如 save/clear 后 storage.onChanged 回写）时同步 draft
  useEffect(() => { setDraft(credentials ?? ''); }, [credentials]);

  const dirty = draft !== (credentials ?? '');
  const testColor = testStatus === 'ok' ? '#16a34a'
    : testStatus === 'fail' ? '#dc2626'
    : 'var(--color-muted)';

  return (
    <div style={{ marginTop: 'var(--space-md)', padding: 12, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>GSC 服务账号密钥（Indexing API）</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={credentials ? '已配置密钥（粘贴新内容覆盖）' : '粘贴从 Google Cloud 下载的服务账号 JSON 文件内容'}
        aria-label="GSC 服务账号 JSON"
        rows={4}
        style={{
          width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 8,
          borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)',
          background: 'var(--color-canvas)', color: 'var(--color-ink)',
          resize: 'vertical', boxSizing: 'border-box', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => save(draft)} disabled={!dirty}>保存</Button>
        <Button variant="secondary" onClick={() => void testConnection()} disabled={!credentials || testStatus === 'testing'}>
          {testStatus === 'testing' ? '测试中…' : '测试连接'}
        </Button>
        {credentials && <Button variant="secondary" onClick={clear}>清空</Button>}
      </div>
      {testMessage && <div style={{ fontSize: 11, color: testColor, marginTop: 8 }}>{testMessage}</div>}
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 8 }}>
        配置：① Google Cloud 建服务账号下载 JSON → ② 把 client_email 加为 Search Console 站点所有者 → ③ 粘贴 JSON 到上方。
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/gsc-credentials-section.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add entrypoints/sidepanel/components/GscCredentialsSection.tsx tests/gsc-credentials-section.test.tsx
git commit -m "feat(gsc): 新增 GscCredentialsSection 凭证配置区"
```

---

### Task 7: `SubmitPanel` 集成 GscCredentialsSection

**Files:**
- Modify: `entrypoints/sidepanel/pages/SubmitPanel.tsx`

**Interfaces:**
- Consumes: `GscCredentialsSection`（Task 6）。

- [ ] **Step 1: 引入组件并在 IndexNowKeySection 旁渲染**

打开 `entrypoints/sidepanel/pages/SubmitPanel.tsx`。在 `import IndexNowKeySection from '../components/IndexNowKeySection';` 下一行加入：

```ts
import GscCredentialsSection from '../components/GscCredentialsSection';
```

在 `<IndexNowKeySection />` 紧邻处（同一区块）加入 `<GscCredentialsSection />`。具体位置：找到 JSX 中 `<IndexNowKeySection />` 这一行，在其后追加一行 `<GscCredentialsSection />`（保持与 IndexNowKeySection 并列）。

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `npm run compile && npm test`
Expected: 编译无错；`tests/submitpanel.test.tsx` 等既有测试通过（新增组件不影响）。

- [ ] **Step 3: 手动验证（构建）**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add entrypoints/sidepanel/pages/SubmitPanel.tsx
git commit -m "feat(submit-panel): 集成 GSC 服务账号密钥配置区"
```

---

### Task 8: 删除 CDP 残留 + 清理权限

**Files:**
- Delete: `lib/cdp/client.ts`、`lib/cdp/actions.ts`、`lib/gsc/flow.ts`、`lib/gsc/selectors.ts`、`lib/gsc/url.ts`、`tests/cdp.test.ts`、`tests/cdp-actions.test.ts`、`tests/gsc-flow.test.ts`、`tests/gsc-url.test.ts`
- Modify: `lib/storage/settings.ts`（删 `accountIndex`）、`wxt.config.ts`（删 `debugger` 权限与 `search.google.com/*` host）

- [ ] **Step 1: 确认无残留引用**

Run: `grep -rn "lib/cdp\|gsc/flow\|gsc/selectors\|gsc/url\|accountIndex" entrypoints lib --include="*.ts" --include="*.tsx"`
Expected: 仅命中 `lib/storage/settings.ts` 的 `accountIndex` 字段定义（Task 4 已移除 background 中的 CDP/gsc-flow 引用）。若命中其他文件，先清除引用再继续。

- [ ] **Step 2: 删除 CDP 与 GSC-CDP 源文件及测试**

Run:
```bash
git rm lib/cdp/client.ts lib/cdp/actions.ts
git rm lib/gsc/flow.ts lib/gsc/selectors.ts lib/gsc/url.ts
git rm tests/cdp.test.ts tests/cdp-actions.test.ts tests/gsc-flow.test.ts tests/gsc-url.test.ts
```
Expected: 9 个文件删除（若某个测试文件名不同，按实际 `tests/` 下匹配 `cdp`/`gsc-flow`/`gsc-url` 的文件删除）。

- [ ] **Step 3: 删除 `accountIndex` 字段**

打开 `lib/storage/settings.ts`。将：

```ts
export interface Settings {
  accountIndex: number;
  indexnowKey?: string;
  /** Google Indexing API 服务账号 JSON 整段文本（手动粘贴）。 */
  gscCredentials?: string;
  /** access_token 缓存（由 lib/gsc/auth.ts 读写）。 */
  gscToken?: { accessToken: string; expiresAt: number };
}
const KEY = 'settings';
const DEFAULT: Settings = { accountIndex: 0 };
```

改为：

```ts
export interface Settings {
  indexnowKey?: string;
  /** Google Indexing API 服务账号 JSON 整段文本（手动粘贴）。 */
  gscCredentials?: string;
  /** access_token 缓存（由 lib/gsc/auth.ts 读写）。 */
  gscToken?: { accessToken: string; expiresAt: number };
}
const KEY = 'settings';
const DEFAULT: Settings = {};
```

- [ ] **Step 4: 清理 `wxt.config.ts` 权限**

打开 `wxt.config.ts`。第 10 行 `permissions`：

```ts
    permissions: ['debugger', 'tabs', 'sidePanel', 'storage', 'declarativeNetRequestWithHostAccess', 'cookies'],
```

改为（移除 `'debugger'`）：

```ts
    permissions: ['tabs', 'sidePanel', 'storage', 'declarativeNetRequestWithHostAccess', 'cookies'],
```

第 11 行 `host_permissions`：

```ts
    host_permissions: ['https://search.google.com/*', 'https://www.bing.com/*', 'https://ahrefs.com/*', '<all_urls>'],
```

改为（移除 `'https://search.google.com/*'`；`www.bing.com` / `ahrefs.com` 保留，供 quicksearch/seo-files 等其他功能使用）：

```ts
    host_permissions: ['https://www.bing.com/*', 'https://ahrefs.com/*', '<all_urls>'],
```

- [ ] **Step 5: 类型检查 + 全量测试 + 构建**

Run: `npm run compile && npm test && npm run build`
Expected: 编译无错；全量测试通过；构建成功（无 `lib/cdp` 未解析引用、无 `accountIndex` 残留）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(gsc): 删除 CDP 残留、accountIndex 字段与 debugger 权限"
```

---

## 完成标准

- `npm run compile` 无错；`npm test` 全绿；`npm run build` 成功。
- GSC 提交经 Indexing API（服务账号 JSON 鉴权），与 Bing/IndexNow 模式对称。
- 提交面板含 GSC 服务账号密钥配置区（粘贴/保存/测试连接/清空）。
- `lib/cdp/*`、`lib/gsc/{flow,selectors,url}.ts` 及对应测试已删；`debugger` 权限与 `search.google.com/*` host 已移除；`accountIndex` 已删。
- `useGscRunner` / `useSubmitOrchestrator` / `SubmitBar` / 消息协议零改动。
