import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Select from '../components/Select';
import ToolPanel from '../components/ToolPanel';
import { BingLogo, YandexLogo, QuickSearchLogo } from '../components/brand-logos';
import { buildGoogleSearchUrl, buildBingSearchUrl, buildYandexSearchUrl } from '@lib/quicksearch/url';
import { GEO_REGIONS, GEO_OFF, getGeoPref, setGeoPref, type GeoCode } from '@lib/quicksearch/geo';

interface Props { keyword: string; }

export default function QuickSearchTool({ keyword }: Props) {
  const disabled = !keyword.trim();
  const [geoCode, setGeoCode] = useState<GeoCode>('US');

  useEffect(() => {
    void (async () => setGeoCode((await getGeoPref()).code))();
  }, []);

  function onGeoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as GeoCode;
    setGeoCode(v);
    void setGeoPref(v); // background 监听 storage 变化,实时增删规则
  }

  const geoOptions = [
    { value: GEO_OFF, label: '🚪 关闭(用真实位置)' },
    ...GEO_REGIONS.map((r) => ({ value: r.code, label: `${r.flag} ${r.label}` })),
  ];

  // 两行均用 1fr 1fr 等分网格,保证上下两列宽度严格一致(下拉框 = Google = Bing = Yandex)。
  // minWidth:0 解除 grid item 默认 min-content 下限,避免内容把列撑宽。
  return (
    <ToolPanel logo={<QuickSearchLogo size={18} />} title="搜索引擎查询">
      {/* 第 1 行:搜索定位 + Google 按钮(geo 仅作用于 Google) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-sm)', alignItems: 'end' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>搜索定位(仅对 Google 搜索有效)</div>
          <Select value={geoCode} options={geoOptions} onChange={onGeoChange} />
        </div>
        <Button
          variant="secondary"
          onClick={() => chrome.tabs.create({ url: buildGoogleSearchUrl(keyword) })}
          disabled={disabled}
          style={{ minWidth: 0, width: '100%' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <QuickSearchLogo size={14} /> Google 搜索
          </span>
        </Button>
      </div>
      {/* 分割线:左右内缩 var(--space-xs),首尾不贯穿 */}
      <div data-testid="qs-divider" aria-hidden="true" style={{ borderTop: '1px solid var(--color-hairline)', margin: 'var(--space-sm) var(--space-xs)' }} />
      {/* 第 2 行:Bing + Yandex(Bing 在前) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-sm)' }}>
        <Button
          variant="secondary"
          onClick={() => chrome.tabs.create({ url: buildBingSearchUrl(keyword) })}
          disabled={disabled}
          style={{ minWidth: 0, width: '100%' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <BingLogo size={14} /> Bing 搜索
          </span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => chrome.tabs.create({ url: buildYandexSearchUrl(keyword) })}
          disabled={disabled}
          style={{ minWidth: 0, width: '100%' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <YandexLogo size={14} /> Yandex 搜索
          </span>
        </Button>
      </div>
    </ToolPanel>
  );
}
