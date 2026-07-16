import ToolCard from '../components/ToolCard';
import { IconTrophy, IconLink } from '../components/icons';
import seoBoxLogo from '../assets/logos/seo-box.png';
import arrfounderLogo from '../assets/logos/arrfounder.svg';
import indiepageLogo from '../assets/logos/indiepage.png';
import trustmrrLogo from '../assets/logos/trustmrr.png';
import trafficCvLogo from '../assets/logos/traffic-cv.png';
import starterStoryLogo from '../assets/logos/starter-story.svg';

interface Ranking {
  id: string;
  name: string;
  desc: string;
  url: string;
  logo: string;
  icon: React.ReactNode;
}

// 常用榜单快捷入口(纯展示 + 点击新标签跳转)。后续新增榜单在此追加一项即可。
const RANKINGS: Ranking[] = [
  { id: 'stripe-traffic', name: 'Stripe 流量榜', desc: '外链来源排行', url: 'https://seo.box/referring/', logo: seoBoxLogo, icon: <IconLink /> },
  { id: 'arrfounder', name: 'Arrfounder', desc: '产品 ARR 收入榜', url: 'https://arrfounder.com/?tab=products', logo: arrfounderLogo, icon: <IconTrophy /> },
  { id: 'indiepage', name: 'IndiePage', desc: '独立开发者收入榜', url: 'https://indiepa.ge/leaderboard', logo: indiepageLogo, icon: <IconTrophy /> },
  { id: 'trustmrr', name: 'TrustMRR', desc: 'SaaS 项目 MRR 榜', url: 'https://trustmrr.com/', logo: trustmrrLogo, icon: <IconTrophy /> },
  { id: 'traffic-cv', name: 'Traffic.cv', desc: '网站流量排行榜', url: 'https://traffic.cv/leaderboard/traffic', logo: trafficCvLogo, icon: <IconTrophy /> },
  { id: 'starter-story', name: 'Starter Story', desc: '创业项目数据库', url: 'https://www.starterstory.com/data', logo: starterStoryLogo, icon: <IconTrophy /> },
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
          <ToolCard key={r.id} icon={r.icon} logo={r.logo} title={r.name} subtitle={r.desc} onClick={() => open(r.url)} />
        ))}
      </div>
    </div>
  );
}
