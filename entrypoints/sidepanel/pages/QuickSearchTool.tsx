import Button from '../components/Button';
import ToolPanel from '../components/ToolPanel';
import { GoogleLogo, BingLogo } from '../components/brand-logos';
import { buildGoogleSearchUrl, buildBingSearchUrl } from '@lib/quicksearch/url';

interface Props { keyword: string; }

export default function QuickSearchTool({ keyword }: Props) {
  const disabled = !keyword.trim();
  return (
    <ToolPanel logo={<GoogleLogo size={18} />} title="快捷搜索">
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="secondary"
          onClick={() => chrome.tabs.create({ url: buildGoogleSearchUrl(keyword) })}
          disabled={disabled}
          style={{ flex: 1 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <GoogleLogo size={14} /> 用 Google 搜
          </span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => chrome.tabs.create({ url: buildBingSearchUrl(keyword) })}
          disabled={disabled}
          style={{ flex: 1 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <BingLogo size={14} /> 用 Bing 搜
          </span>
        </Button>
      </div>
    </ToolPanel>
  );
}
