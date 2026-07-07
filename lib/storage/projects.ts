export interface Project { id: string; domain: string; label?: string; createdAt: number; }
const KEY = 'projects';
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

export function isValidDomain(d: string): boolean { return DOMAIN_RE.test(d.trim()); }

/**
 * 把用户输入清洗为裸域名主机名（小写）。剥离 scheme / path / query / fragment /
 * userinfo / 端口。输入含非 ASCII（中文域名 / IDN）或解析失败时返回空串，
 * 交由 isValidDomain 判定无效并触发提示。
 *
 * 实现：补 https:// 前缀让 URL 能解析，取 hostname（不含端口；host 才含端口）。
 */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/[^\x00-\x7F]/.test(trimmed)) return '';        // 非 ASCII → 不支持 IDN
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 输入过程中的实时域名清洗：剥掉 scheme / path / query / fragment / 端口等，
 * 仅保留主机名（小写）。与 normalizeDomain 的区别：当输入未成形（如逐字输入
 * 的中间态、非 ASCII、解析失败）时保留原文而非返回空串，避免打断用户输入。
 * 空输入返回原值，让用户能正常清空输入框。
 */
export function sanitizeDomainInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;        // 空输入保留原值
  const n = normalizeDomain(raw);
  return n || raw;                 // normalize 失败 → 保留原文
}

export async function getProjects(): Promise<Project[]> {
  const items = await chrome.storage.local.get(KEY);
  return (items[KEY] as Project[] | undefined) ?? [];
}

async function save(list: Project[]) { await chrome.storage.local.set({ [KEY]: list }); }

// 跨视图同步：依赖 chrome.storage.onChanged（storage.local.set 自动触发），
// useProjects 监听 'projects' key 变化自动 refresh，无需此处手动广播。

export async function addProject(domain: string, label?: string): Promise<Project> {
  const d = domain.trim();
  if (!isValidDomain(d)) throw new Error('invalid domain');
  const project: Project = { id: crypto.randomUUID(), domain: d, label: label?.trim() || undefined, createdAt: Date.now() };
  const list = await getProjects();
  list.push(project);
  await save(list);
  return project;
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'domain' | 'label'>>): Promise<void> {
  // 与 addProject 一致：先 trim domain 再校验/合并，避免前后空格导致重复或校验绕过。
  const trimmedPatch: typeof patch = { ...patch };
  if (patch.domain != null) {
    const d = patch.domain.trim();
    if (!isValidDomain(d)) throw new Error('invalid domain');
    trimmedPatch.domain = d;
  }
  const list = await getProjects();
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) throw new Error('project not found');
  list[i] = { ...list[i], ...trimmedPatch };
  await save(list);
}

export async function removeProject(id: string): Promise<void> {
  const list = await getProjects();
  await save(list.filter((p) => p.id !== id));
}
