import backlinkLogo from '../../entrypoints/sidepanel/assets/logos/backlink-checker.webp';
import authorityLogo from '../../entrypoints/sidepanel/assets/logos/website-authority-checker.webp';
import gscLogo from '../../entrypoints/sidepanel/assets/logos/google-search-console.png';
import bingLogo from '../../entrypoints/sidepanel/assets/logos/bing.png';
import gaLogo from '../../entrypoints/sidepanel/assets/logos/google-analytics.svg';
import clarityLogo from '../../entrypoints/sidepanel/assets/logos/clarity.svg';
import pagespeedLogo from '../../entrypoints/sidepanel/assets/logos/pagespeed.svg';
import { buildSeoFileUrl } from '../seo-files/url';
import { buildBacklinkCheckerUrl, buildWebsiteAuthorityCheckerUrl } from './url';

/** 站点工具分类。automation(网站提交)由 SiteTools 内部单独渲染,不入此表。 */
export type SiteToolCategory = 'quick' | 'webmaster' | 'analytics';

export interface SiteTool {
  id: string;
  name: string;
  category: SiteToolCategory;
  /** 图片 logo url(与 icon 二选一)。 */
  logo?: string;
  /** SVG icon 标记(robots/sitemap 用,与 logo 二选一)。 */
  icon?: 'robots' | 'sitemap';
  /** 构造打开 url;domain 为 null 表示当前无网站(仅 requiresDomain 未设/为 false 的工具会被这样调用)。 */
  buildUrl: (domain: string | null) => string;
  /** true = 必须有有效网站才能使用(无网站时禁用);缺省 false = 始终可点击。 */
  requiresDomain?: boolean;
  /** 标题较长,在两列网格里会折行,标记后在网格中独占整行。 */
  fullWidth?: boolean;
}

/** 分类渲染顺序与标题(automation 在 SiteTools 里单独渲染,故不在表内)。 */
export const SITE_TOOL_GROUPS: { id: SiteToolCategory; label: string }[] = [
  { id: 'quick', label: '快捷工具' },
  { id: 'webmaster', label: '站长后台' },
  { id: 'analytics', label: '网站分析' },
];

export const SITE_TOOLS: SiteTool[] = [
  { id: 'robots', name: 'robots.txt', category: 'quick', icon: 'robots', requiresDomain: true, buildUrl: (d) => buildSeoFileUrl(d!, 'robots.txt') },
  { id: 'sitemap', name: 'sitemap.xml', category: 'quick', icon: 'sitemap', requiresDomain: true, buildUrl: (d) => buildSeoFileUrl(d!, 'sitemap.xml') },
  { id: 'backlink-checker', name: 'Backlink Checker', category: 'quick', logo: backlinkLogo, buildUrl: (d) => (d ? buildBacklinkCheckerUrl(d) : 'https://ahrefs.com/backlink-checker'), fullWidth: true },
  { id: 'authority-checker', name: 'Website Authority Checker', category: 'quick', logo: authorityLogo, buildUrl: (d) => (d ? buildWebsiteAuthorityCheckerUrl(d) : 'https://ahrefs.com/website-authority-checker'), fullWidth: true },
  { id: 'gsc', name: 'GSC', category: 'webmaster', logo: gscLogo, buildUrl: () => 'https://search.google.com/search-console' },
  { id: 'bing-webmaster', name: 'Bing', category: 'webmaster', logo: bingLogo, buildUrl: () => 'https://www.bing.com/webmasters' },
  { id: 'ga', name: 'Google Analytics', category: 'analytics', logo: gaLogo, buildUrl: () => 'https://analytics.google.com/analytics/web' },
  { id: 'clarity', name: 'Microsoft Clarity', category: 'analytics', logo: clarityLogo, buildUrl: () => 'https://clarity.microsoft.com/projects/view' },
  { id: 'pagespeed', name: 'PageSpeed Insights', category: 'analytics', logo: pagespeedLogo, buildUrl: () => 'https://pagespeed.web.dev/', fullWidth: true },
];
