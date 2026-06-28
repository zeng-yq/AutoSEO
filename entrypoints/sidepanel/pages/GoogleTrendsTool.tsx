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

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 };
const fieldStyle: React.CSSProperties = { marginTop: 'var(--space-sm)' };

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
    <ToolPanel logo={<GoogleTrendsLogo size={18} />} title="Google Trends" subtitle="谷歌趋势">
      <label style={labelStyle}>天数</label>
      <Select
        value={date}
        options={TRENDS_DATE_RANGES.map((d) => ({ value: d.value, label: d.label }))}
        onChange={(e) => { setDate(e.target.value); persist({ date: e.target.value }); }}
      />
      <label style={{ ...labelStyle, ...fieldStyle }}>对比词</label>
      <Combobox
        value={compare}
        options={COMPARE_PRESETS}
        placeholder="如 gpts，可留空"
        onChange={(v) => { setCompare(v); persist({ compare: v }); }}
      />
      <label style={{ ...labelStyle, ...fieldStyle }}>地区</label>
      <Select
        value={geo}
        options={TRENDS_GEOS.map((g) => ({ value: g.value, label: g.label }))}
        onChange={(e) => { setGeo(e.target.value); persist({ geo: e.target.value }); }}
      />
      <Button onClick={open} disabled={!keyword.trim()} style={{ marginTop: 'var(--space-md)', width: '100%' }}>
        搜索
      </Button>
    </ToolPanel>
  );
}
