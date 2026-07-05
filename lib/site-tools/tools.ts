import backlinkLogo from '../../entrypoints/sidepanel/assets/logos/backlink-checker.webp';
import authorityLogo from '../../entrypoints/sidepanel/assets/logos/website-authority-checker.webp';
import gscLogo from '../../entrypoints/sidepanel/assets/logos/google-search-console.png';
import gaLogo from '../../entrypoints/sidepanel/assets/logos/google-analytics.svg';
import clarityLogo from '../../entrypoints/sidepanel/assets/logos/clarity.svg';
import pagespeedLogo from '../../entrypoints/sidepanel/assets/logos/pagespeed.svg';
import { buildSeoFileUrl } from '../seo-files/url';
import { buildBacklinkCheckerUrl, buildWebsiteAuthorityCheckerUrl } from './url';

export interface SiteTool {
  id: string;
  name: string;
  /** 图片 logo url(与 icon 二选一)。 */
  logo?: string;
  /** SVG icon 标记(robots/sitemap 用,与 logo 二选一)。 */
  icon?: 'robots' | 'sitemap';
  /** 由当前 site.domain 构造打开 url;direct 类忽略 domain。 */
  buildUrl: (domain: string) => string;
}

export const SITE_TOOLS: SiteTool[] = [
  { id: 'robots', name: 'robots.txt', icon: 'robots', buildUrl: (d) => buildSeoFileUrl(d, 'robots.txt') },
  { id: 'sitemap', name: 'sitemap.xml', icon: 'sitemap', buildUrl: (d) => buildSeoFileUrl(d, 'sitemap.xml') },
  { id: 'backlink-checker', name: 'Backlink Checker', logo: backlinkLogo, buildUrl: buildBacklinkCheckerUrl },
  { id: 'authority-checker', name: 'Website Authority Checker', logo: authorityLogo, buildUrl: buildWebsiteAuthorityCheckerUrl },
  { id: 'gsc', name: 'Google Search Console', logo: gscLogo, buildUrl: () => 'https://search.google.com/search-console' },
  { id: 'ga', name: 'Google Analytics', logo: gaLogo, buildUrl: () => 'https://analytics.google.com/analytics/web' },
  { id: 'clarity', name: 'Microsoft Clarity', logo: clarityLogo, buildUrl: () => 'https://clarity.microsoft.com/projects/view' },
  { id: 'pagespeed', name: 'PageSpeed Insights', logo: pagespeedLogo, buildUrl: () => 'https://pagespeed.web.dev/' },
];
