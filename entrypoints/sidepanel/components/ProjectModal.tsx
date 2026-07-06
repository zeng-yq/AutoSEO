import { useEffect, useState } from 'react';
import Button from './Button';
import TextInput from './TextInput';
import { IconClose } from './icons';
import { useProjects } from '../hooks/useProjects';
import { isValidDomain, normalizeDomain } from '@lib/storage/projects';

export default function ProjectModal({ onClose }: { onClose: () => void }) {
  const { projects, add, remove } = useProjects();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  const valid = isValidDomain(normalizeDomain(domain));

  function handleBlur() {
    const n = normalizeDomain(domain);
    if (n && n !== domain) setDomain(n);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    try { await add(normalizeDomain(domain)); setDomain(''); setError(''); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="modal__overlay" onMouseDown={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,20,19,0.4)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{
        width: 'min(360px, 92vw)', background: 'var(--color-canvas)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-hairline)', padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>项目管理</h2>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', lineHeight: 0, padding: 4 }}>
            <IconClose size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <TextInput value={domain} placeholder="example.com" onChange={(e) => setDomain(e.target.value)} onBlur={handleBlur} onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }} />
          <Button onClick={submit} disabled={!valid}>添加</Button>
        </div>
        {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 6 }}>{error}</div>}
        {!error && !!domain && !valid && <div style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 6 }}>请输入有效域名，如 example.com</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {projects.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--color-surface-card)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.domain}</span>
              <button type="button" aria-label={`删除 ${p.domain}`} onClick={() => remove(p.id).catch((e) => setError((e as Error).message ?? String(e)))} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 12 }}>删除</button>
            </div>
          ))}
          {projects.length === 0 && <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>还没有项目</div>}
        </div>
      </div>
    </div>
  );
}
