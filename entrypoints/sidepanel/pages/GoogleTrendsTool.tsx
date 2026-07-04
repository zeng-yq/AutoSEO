import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Select from '../components/Select';
import Combobox from '../components/Combobox';
import ToolPanel from '../components/ToolPanel';
import { GoogleTrendsLogo } from '../components/brand-logos';
import { TRENDS_DATE_RANGES, TRENDS_GEOS, buildTrendsUrl } from '@lib/trends/url';

const STORAGE_KEY = 'kw-tools:trends';
const COMPARE_PRESETS = ['gpts', 'chatgpt', 'ai', 'ai tools'];

interface Props { keyword: string; }
interface Last { date: string; compare: string; geo: string; }

const colLabelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 };
const rowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-muted)',
  width: 56,
  flexShrink: 0,
  paddingTop: 7,
};

export default function GoogleTrendsTool({ keyword }: Props) {
  const [date, setDate] = useState<string>('today 1-m');
  const [compare, setCompare] = useState<string>('gpts');
  const [geo, setGeo] = useState<string>('Worldwide');

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (items) => {
      const last = items[STORAGE_KEY] as Partial<Last> | undefined;
      if (last) {
        if (typeof last.date === 'string') setDate(last.date);
        if (typeof last.compare === 'string') setCompare(last.compare);
        if (typeof last.geo === 'string') setGeo(last.geo);
      }
    });
  }, []);

  function persist(patch: Partial<Last>) {
    chrome.storage.local.set({ [STORAGE_KEY]: { date, compare, geo, ...patch } });
  }

  function open() {
    const url = buildTrendsUrl(keyword, compare, date, geo);
    chrome.storage.local.set({ [STORAGE_KEY]: { date, compare, geo } });
    chrome.tabs.create({ url });
  }

  return (
    <ToolPanel
      logo={<GoogleTrendsLogo size={18} />}
      title="Google Trends"
      subtitle="谷歌趋势"
      action={<Button onClick={open} disabled={!keyword.trim()}>搜索</Button>}
    >
      {/* 对比词:标签 + Combobox 同行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
        <span style={rowLabelStyle}>对比词</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Combobox
            value={compare}
            options={COMPARE_PRESETS}
            placeholder="如 gpts,可留空"
            onChange={(v) => { setCompare(v); persist({ compare: v }); }}
          />
        </div>
      </div>
      {/* 天数 + 地区:两列并排 */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={colLabelStyle}>天数</div>
          <Select
            value={date}
            options={TRENDS_DATE_RANGES.map((d) => ({ value: d.value, label: d.label }))}
            onChange={(e) => { setDate(e.target.value); persist({ date: e.target.value }); }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={colLabelStyle}>地区</div>
          <Select
            value={geo}
            options={TRENDS_GEOS.map((g) => ({ value: g.value, label: g.label }))}
            onChange={(e) => { setGeo(e.target.value); persist({ geo: e.target.value }); }}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
