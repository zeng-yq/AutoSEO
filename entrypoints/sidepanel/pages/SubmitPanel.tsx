import { useState } from 'react';
import Button from '../components/Button';
import Textarea from '../components/Textarea';
import LogPanel from '../components/LogPanel';
import PlatformChip from '../components/PlatformChip';
import { IconBack, GscMark, BingMark } from '../components/icons';
import { useSubmitOrchestrator } from '../hooks/useSubmitOrchestrator';
import { isValidDomain } from '@lib/storage/projects';
import type { Site } from '../hooks/useSite';

export default function SubmitPanel({ site, onBack }: { site: Site; onBack: () => void }) {
  const orch = useSubmitOrchestrator();
  const [text, setText] = useState('');
  const [gsc, setGsc] = useState(true);
  const [bing, setBing] = useState(true);
  const [error, setError] = useState('');

  const urls = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const busy = orch.gsc.state.running || orch.bing.state.running;
  const ready = urls.length > 0 && (gsc || bing) && !busy;

  function submit() {
    if (!isValidDomain(site.domain)) { setError('请先选择或填写有效网站（如 example.com）'); return; }
    setError('');
    // T10 改签名：run(platforms, domain, sitemapUrl)；完整 sitemap 输入 UI 见 T11。
    const sitemapUrl = `https://${site.domain.trim()}/sitemap.xml`;
    void orch.run({ gsc, bing }, site.domain.trim(), sitemapUrl);
  }

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
        <IconBack size={14} /> 返回
      </button>
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>网站提交</h2>

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>目标平台</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
        <PlatformChip label="GSC" icon={<GscMark />} checked={gsc} onToggle={() => setGsc((v) => !v)} />
        <PlatformChip label="Bing" icon={<BingMark />} checked={bing} onToggle={() => setBing((v) => !v)} />
      </div>

      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>链接（每行一条）</label>
      <Textarea rows={6} value={text} placeholder={'https://example.com/es/\nhttps://example.com/de/'} onChange={(e) => setText(e.target.value)} />

      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
        <Button onClick={submit} disabled={!ready} style={{ flex: 1 }}>{busy ? '提交中…' : '一次提交'}</Button>
        {busy && <Button variant="secondary" onClick={orch.cancel}>取消</Button>}
      </div>

      <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(gsc || orch.gsc.logs.length > 0) && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>▍GSC{orch.gsc.state.total > 0 ? `  ${orch.gsc.state.done}/${orch.gsc.state.total}` : ''}</div>
            <LogPanel logs={orch.gsc.logs} />
          </div>
        )}
        {(bing || orch.bing.logs.length > 0) && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>▍Bing{orch.bing.state.total > 0 ? `  ${orch.bing.state.done}/${orch.bing.state.total}` : ''}</div>
            <LogPanel logs={orch.bing.logs} />
          </div>
        )}
      </div>
    </div>
  );
}
