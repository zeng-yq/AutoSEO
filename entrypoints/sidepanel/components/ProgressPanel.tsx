import { useState } from 'react';
import Button from './Button';
import { useProgressQuery } from '../hooks/useProgressQuery';
import type { ProgressItem } from '@lib/submit/progress';

const PAGE = 100;

type Filter = 'all' | 'gsc-pending' | 'bing-pending' | 'stale';

export interface ProgressPanelProps {
  domain: string;
  sitemapUrl: string;
}

interface Row { key: string; left: string; right: string; stale?: boolean; }

export default function ProgressPanel({ domain, sitemapUrl }: ProgressPanelProps) {
  const { state, refresh } = useProgressQuery(domain);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE);

  const report = state.report;
  const canRefresh = sitemapUrl.trim().length > 0 && domain.trim().length > 0 && !state.loading;

  let rows: Row[] = [];
  if (report) {
    if (filter === 'stale') {
      rows = report.stale.map((s) => ({ key: `${s.platform}|${s.url}`, left: s.url, right: s.platform, stale: true }));
    } else {
      let items: ProgressItem[] = report.items;
      if (filter === 'gsc-pending') items = items.filter((i) => i.gsc === 'pending');
      else if (filter === 'bing-pending') items = items.filter((i) => i.bing === 'pending');
      rows = items.map((i) => ({
        key: i.url,
        left: i.url,
        right: `GSC${i.gsc === 'done' ? '✓' : '✗'} Bing${i.bing === 'done' ? '✓' : '✗'}`,
      }));
    }
  }

  const filters: Array<[Filter, string]> = [
    ['all', '全部'],
    ['gsc-pending', 'GSC未提交'],
    ['bing-pending', 'Bing未提交'],
    ['stale', `已不在sitemap(${report?.stale.length ?? 0})`],
  ];

  return (
    <div>
      <Button onClick={() => void refresh(sitemapUrl.trim())} disabled={!canRefresh} style={{ width: '100%' }}>
        {state.loading ? '抓取中…' : '刷新进度'}
      </Button>

      {state.error && (
        <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 8 }}>{state.error}</div>
      )}

      {state.diff && (
        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-muted)' }}>
          本次新增 {state.diff.added.length} · 清理 {state.diff.removed.length} · 未变 {state.diff.unchanged.length}
        </div>
      )}

      {report && report.total > 0 && (
        <>
          <div style={{ marginTop: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {report.platforms.map((p) => {
              const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <div key={p.platform}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{p.platform.toUpperCase()}</span>
                    <span>{p.done}/{p.total}（{pct}%）</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--color-canvas)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)' }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
            {filters.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); setVisible(PAGE); }}
                className={`platform-chip${filter === key ? ' is-active' : ''}`}
              >{label}</button>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
            {rows.slice(0, visible).map((r) => (
              <div key={r.key} style={{ color: r.stale ? 'var(--color-muted)' : 'var(--color-ink)', opacity: r.stale ? 0.6 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {r.left} <span style={{ color: 'var(--color-muted)' }}>{r.right}</span>
              </div>
            ))}
            {rows.length === 0 && (
              <div style={{ color: 'var(--color-muted)' }}>无符合条件的链接</div>
            )}
            {visible < rows.length && (
              <button type="button" onClick={() => setVisible((v) => v + PAGE)} style={{ marginTop: 8, border: 'none', background: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                加载更多（剩余 {rows.length - visible}）
              </button>
            )}
          </div>
        </>
      )}

      {(!report || report.total === 0) && !state.error && (
        <div style={{ marginTop: 'var(--space-md)', fontSize: 12, color: 'var(--color-muted)' }}>
          还没有进度数据，点「刷新进度」抓取最新 sitemap 并对账。
        </div>
      )}
    </div>
  );
}
