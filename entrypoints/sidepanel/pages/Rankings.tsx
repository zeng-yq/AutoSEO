import ToolCard from '../components/ToolCard';
import { IconTrophy, IconLink } from '../components/icons';

interface Ranking {
  id: string;
  name: string;
  desc: string;
  url: string;
  icon: React.ReactNode;
}

// 常用榜单快捷入口(纯展示 + 点击新标签跳转)。后续新增榜单在此追加一项即可。
const RANKINGS: Ranking[] = [
  { id: 'producthunt', name: 'Product Hunt', desc: '每日新产品 / 工具榜单', url: 'https://www.producthunt.com', icon: <IconTrophy /> },
  { id: 'stripe-traffic', name: 'Stripe 流量榜', desc: '外链来源排行', url: 'https://seo.box/referring/', icon: <IconLink /> },
  { id: 'arrfounder', name: 'Arrfounder', desc: '产品 ARR 收入榜', url: 'https://arrfounder.com/?tab=products', icon: <IconTrophy /> },
];

export default function Rankings() {
  function open(url: string) {
    try {
      chrome.tabs.create({ url });
    } catch {
      /* tabs.create 失败静默(扩展上下文异常等,不阻塞 UI) */
    }
  }

  // 两列等分网格,与「网站工具」标签一致;minWidth:0 避免长名撑宽列。
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    columnGap: 'var(--space-xs)',
    rowGap: 'var(--space-xs)',
  };

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <div style={gridStyle}>
        {RANKINGS.map((r) => (
          <ToolCard key={r.id} icon={r.icon} title={r.name} subtitle={r.desc} onClick={() => open(r.url)} />
        ))}
      </div>
    </div>
  );
}
