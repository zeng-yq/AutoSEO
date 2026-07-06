import { useEffect, useRef, useState } from 'react';
import TextInput from '../components/TextInput';
import ProgressDashboard from '../components/ProgressDashboard';
import RunningOverlay from '../components/RunningOverlay';
import BatchReportCard from '../components/BatchReportCard';
import SubmitBar from '../components/SubmitBar';
import IndexNowKeySection from '../components/IndexNowKeySection';
import { IconBack } from '../components/icons';
import { useSubmitOrchestrator } from '../hooks/useSubmitOrchestrator';
import { isValidDomain } from '@lib/storage/projects';
import { normalizeOrigin } from '@lib/seo-files/url';
import type { Site } from '../hooks/useSite';

function defaultSitemapUrl(domain: string): string {
  try { return `${normalizeOrigin(domain)}/sitemap.xml`; } catch { return ''; }
}

export default function SubmitPanel({ site, onBack }: { site: Site; onBack: () => void }) {
  const orch = useSubmitOrchestrator();
  const [sitemapUrl, setSitemapUrl] = useState(() => defaultSitemapUrl(site.domain));
  const [gsc, setGsc] = useState(true);
  const [bing, setBing] = useState(true);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setSitemapUrl(defaultSitemapUrl(site.domain));
  }, [site.domain]);

  const running = orch.active !== null;
  const busy = orch.gsc.state.running || orch.bing.state.running || orch.active !== null;
  const ready = (gsc || bing) && !busy && isValidDomain(site.domain) && !!sitemapUrl.trim();
  const showReport = !running && orch.report.length > 0;

  function submit() {
    if (!isValidDomain(site.domain)) { setError('请先选择或填写有效网站（如 example.com）'); return; }
    if (!sitemapUrl.trim()) { setError('请填写站点地图 URL（如 https://example.com/sitemap.xml）'); return; }
    setError('');
    void orch.run({ gsc, bing }, site.domain.trim(), sitemapUrl.trim());
  }

  return (
    <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {!running && (
        <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 13, marginBottom: 12, padding: 0 }}>
          <IconBack size={14} /> 返回
        </button>
      )}
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>网站提交</h2>

      {running ? (
        <RunningOverlay orch={orch} gscSelected={gsc} bingSelected={bing} onCancel={orch.cancel} />
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>站点地图（sitemap.xml）</label>
          <TextInput value={sitemapUrl} placeholder="https://example.com/sitemap.xml" onChange={(e) => { dirtyRef.current = true; setSitemapUrl(e.target.value); }} />
          {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
            将自动过滤登录 / 注册 / 隐私 / 条款 / 账号等低价值链接，不参与提交。
          </div>

          <IndexNowKeySection />

          {showReport && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <BatchReportCard report={orch.report} onClose={orch.clearReport} />
            </div>
          )}

          <div style={{ marginTop: 'var(--space-md)', flex: 1 }}>
            <ProgressDashboard domain={site.domain.trim()} sitemapUrl={sitemapUrl.trim()} />
          </div>

          <SubmitBar
            gsc={gsc}
            bing={bing}
            onToggleGsc={() => setGsc((v) => !v)}
            onToggleBing={() => setBing((v) => !v)}
            onSubmit={submit}
            onCancel={orch.cancel}
            busy={busy}
            ready={ready}
          />
        </>
      )}
    </div>
  );
}
