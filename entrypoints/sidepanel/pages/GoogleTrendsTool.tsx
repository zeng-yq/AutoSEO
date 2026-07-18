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

export default function GoogleTrendsTool({ keyword }: Props) {
  const [date, setDate] = useState<string>('today 1-m');
  const [compare, setCompare] = useState<string>('gpts(对比词)');
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
    // 默认值带提示后缀「(对比词)」，查询前剥离括号注释，仅保留真实对比词
    const cmp = compare.replace(/\([^)]*\)/g, '').trim();
    const url = buildTrendsUrl(keyword, cmp, date, geo);
    chrome.storage.local.set({ [STORAGE_KEY]: { date, compare, geo } });
    chrome.tabs.create({ url });
  }

  return (
    <ToolPanel logo={<GoogleTrendsLogo size={18} />} title="Google Trends">
      {/* 第 1 行:天数 + 地区(无标题) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-sm)' }}>
        <div style={{ minWidth: 0 }}>
          <Select
            value={date}
            options={TRENDS_DATE_RANGES.map((d) => ({ value: d.value, label: d.label }))}
            onChange={(e) => { setDate(e.target.value); persist({ date: e.target.value }); }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <Select
            value={geo}
            options={TRENDS_GEOS.map((g) => ({ value: g.value, label: g.label }))}
            onChange={(e) => { setGeo(e.target.value); persist({ geo: e.target.value }); }}
          />
        </div>
      </div>
      {/* 第 2 行:对比词 + 搜索按钮(无标题) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
        <div style={{ minWidth: 0 }}>
          <Combobox
            value={compare}
            options={COMPARE_PRESETS}
            placeholder="如 gpts,可留空"
            onChange={(v) => { setCompare(v); persist({ compare: v }); }}
          />
        </div>
        <Button onClick={open} disabled={!keyword.trim()} style={{ minWidth: 0, width: '100%' }}>点击查询</Button>
      </div>
    </ToolPanel>
  );
}
