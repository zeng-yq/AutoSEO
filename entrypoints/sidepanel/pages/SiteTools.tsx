import { useState } from 'react';
import Combobox from '../components/Combobox';
import ToolCard from '../components/ToolCard';
import ToolPanel from '../components/ToolPanel';
import ProjectModal from '../components/ProjectModal';
import SubmitPanel from './SubmitPanel';
import { IconSubmit, IconRobots, IconSitemap, IconBolt, IconGlobe, IconChart, IconRefresh } from '../components/icons';
import { useSite } from '../hooks/useSite';
import { useProjects } from '../hooks/useProjects';
import { isValidDomain, normalizeDomain, sanitizeDomainInput } from '@lib/storage/projects';
import { SITE_TOOLS, SITE_TOOL_GROUPS, type SiteToolCategory } from '@lib/site-tools/tools';

// 分类 → header icon(与关键词面板每个 ToolPanel 的「icon + 标题」一致)
const CATEGORY_ICON: Record<SiteToolCategory, React.ReactNode> = {
  quick: <IconBolt size={18} />,
  webmaster: <IconGlobe size={18} />,
  analytics: <IconChart size={18} />,
};

// robots/sitemap 用 svg icon,其余走 logo
function toolIcon(t: { icon?: 'robots' | 'sitemap' }) {
  return t.icon === 'robots' ? <IconRobots /> : t.icon === 'sitemap' ? <IconSitemap /> : undefined;
}

export default function SiteTools() {
  const { site, setSite } = useSite();
  const { projects } = useProjects();
  const [view, setView] = useState<'list' | 'submit'>('list');
  const [modalOpen, setModalOpen] = useState(false);

  const domains = projects.map((p) => p.domain);
  const hasSite = isValidDomain(normalizeDomain(site.domain));
  const showInvalid = !!site.domain && !hasSite; // 输入了但清洗后仍无效

  function handleSiteBlur() {
    const n = normalizeDomain(site.domain);
    if (n && n !== site.domain) setSite({ domain: n });
  }

  function openTool(buildUrl: (domain: string | null) => string) {
    try { chrome.tabs.create({ url: buildUrl(hasSite ? site.domain : null) }); }
    catch { /* tabs.create 失败静默(扩展上下文异常等,不阻塞 UI) */ }
  }

  if (view === 'submit') return <SubmitPanel site={site} onBack={() => setView('list')} />;

  // 两列等分网格;minWidth:0 解除 grid item 默认 min-content 下限,避免长名撑宽列
  const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-xs)', rowGap: 'var(--space-xs)' };

  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>网站</label>
      <Combobox value={site.domain} options={domains} placeholder="example.com" sanitize={sanitizeDomainInput} onChange={(v) => setSite({ domain: v })} onBlur={handleSiteBlur} onManage={() => setModalOpen(true)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        {/* 自动化工具:网站提交进入 SubmitPanel(置顶) */}
        <ToolPanel logo={<IconRefresh size={18} />} title="自动化工具">
          <div style={gridStyle}>
            <ToolCard
              icon={<IconSubmit />}
              title="网站提交（GSC · Bing）"
              onClick={hasSite ? () => setView('submit') : undefined}
              disabled={!hasSite}
              style={{ gridColumn: '1 / -1' }}
            />
          </div>
        </ToolPanel>

        {SITE_TOOL_GROUPS.map((g) => (
          <ToolPanel key={g.id} logo={CATEGORY_ICON[g.id]} title={g.label}>
            <div style={gridStyle}>
              {SITE_TOOLS.filter((t) => t.category === g.id).map((t) => {
                const disabled = t.requiresDomain === true && !hasSite;
                return (
                  <ToolCard
                    key={t.id}
                    icon={toolIcon(t)}
                    logo={t.logo}
                    title={t.name}
                    onClick={!disabled ? () => openTool(t.buildUrl) : undefined}
                    disabled={disabled}
                    style={t.fullWidth ? { gridColumn: '1 / -1' } : undefined}
                  />
                );
              })}
            </div>
          </ToolPanel>
        ))}
      </div>

      {!hasSite && (
        <div style={{ color: showInvalid ? 'var(--color-error)' : 'var(--color-muted)', fontSize: 12, marginTop: 'var(--space-sm)' }}>
          {showInvalid ? '请输入有效域名，如 example.com' : '填写网站可额外查询 robots.txt / sitemap.xml'}
        </div>
      )}

      {modalOpen && <ProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
