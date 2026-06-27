import { useState } from 'react';
import Button from '../components/Button';
import TextInput from '../components/TextInput';
import { useProjects } from '../hooks/useProjects';
import { isValidDomain } from '@lib/storage/projects';

export default function Projects() {
  const { projects, add, remove } = useProjects();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    try { await add(domain); setDomain(''); setError(''); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>项目管理</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-sm)' }}>
        <TextInput value={domain} placeholder="example.com" onChange={(e) => setDomain(e.target.value)} />
        <Button onClick={submit} disabled={!isValidDomain(domain)}>添加</Button>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 6 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.domain}</span>
            <button onClick={() => remove(p.id).catch((e) => setError((e as Error).message ?? String(e)))} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer' }}>删除</button>
          </div>
        ))}
        {projects.length === 0 && <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>还没有项目</div>}
      </div>
    </div>
  );
}
