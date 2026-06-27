export interface Project { id: string; domain: string; label?: string; createdAt: number; }
const KEY = 'projects';
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

export function isValidDomain(d: string): boolean { return DOMAIN_RE.test(d.trim()); }

export async function getProjects(): Promise<Project[]> {
  const items = await chrome.storage.local.get(KEY);
  return (items[KEY] as Project[] | undefined) ?? [];
}

async function save(list: Project[]) { await chrome.storage.local.set({ [KEY]: list }); }

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
  if (patch.domain != null && !isValidDomain(patch.domain)) throw new Error('invalid domain');
  const list = await getProjects();
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) throw new Error('project not found');
  list[i] = { ...list[i], ...patch };
  await save(list);
}

export async function removeProject(id: string): Promise<void> {
  const list = await getProjects();
  await save(list.filter((p) => p.id !== id));
}

/** 按 id 查询单个项目。供 background 取 domain 拼 GSC URL。 */
export async function getProjectById(id: string): Promise<Project | undefined> {
  return (await getProjects()).find((p) => p.id === id);
}
