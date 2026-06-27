import { useState } from 'react';
import Button from '../components/Button';
import Select from '../components/Select';
import Textarea from '../components/Textarea';
import Badge from '../components/Badge';
import LogPanel from '../components/LogPanel';
import { useProjects } from '../hooks/useProjects';
import { useGscRunner } from '../hooks/useGscRunner';

export default function GscTool() {
  const { projects } = useProjects();
  const { state, logs, start, cancel } = useGscRunner();
  const [projectId, setProjectId] = useState('');
  const [text, setText] = useState('');

  const urls = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const ready = !!projectId && urls.length > 0 && !state.running;

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-md)' }}>
        <h2 style={{ fontSize: 17 }}>GSC 批量提交</h2>
        {state.total > 0 && <Badge>{state.done}/{state.total}</Badge>}
      </div>

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>项目</label>
      <Select
        value={projectId}
        options={[{ value: '', label: '选择项目…' }, ...projects.map((p) => ({ value: p.id, label: p.domain }))]}
        onChange={(e) => setProjectId(e.target.value)}
      />

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', margin: 'var(--space-sm) 0 4px' }}>链接（每行一条）</label>
      <Textarea rows={6} value={text} placeholder={'https://example.com/es/\nhttps://example.com/de/'} onChange={(e) => setText(e.target.value)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
        <Button onClick={() => start(projectId, urls)} disabled={!ready} style={{ flex: 1 }}>开始批量提交</Button>
        {state.running && <Button variant="secondary" onClick={cancel}>取消</Button>}
      </div>

      <div style={{ marginTop: 'var(--space-md)' }}>
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
