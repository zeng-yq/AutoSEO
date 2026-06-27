import { describe, it, expect } from 'vitest';
import { getProjects, addProject, removeProject } from '../lib/storage/projects';
import { getSettings } from '../lib/storage/settings';

describe('projects', () => {
  it('新增并读取项目', async () => {
    const p = await addProject('bottleneck-checker.com');
    expect(p.domain).toBe('bottleneck-checker.com');
    expect(p.id).toBeTruthy();
    const all = await getProjects();
    expect(all).toHaveLength(1);
  });
  it('非法域名抛错', async () => {
    await expect(addProject('not a url')).rejects.toThrow('invalid domain');
  });
  it('删除项目', async () => {
    const p = await addProject('excelcompare.org');
    await removeProject(p.id);
    expect(await getProjects()).toHaveLength(0);
  });
});

describe('settings', () => {
  it('默认 accountIndex 为 0', async () => {
    expect((await getSettings()).accountIndex).toBe(0);
  });
});
