interface LogoProps { size?: number; }

/** Google — 四色圆点（蓝/红/黄/绿），品牌强识别。 */
export function GoogleLogo({ size = 16 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.4" fill="#4285F4" />
      <circle cx="16" cy="8" r="3.4" fill="#EA4335" />
      <circle cx="8" cy="16" r="3.4" fill="#FBBC05" />
      <circle cx="16" cy="16" r="3.4" fill="#34A853" />
    </svg>
  );
}

/** Bing — 青绿底 + 白色 b。 */
export function BingLogo({ size = 16 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#008373" />
      <text x="12" y="17" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="14" fontWeight="700" fill="#fff">b</text>
    </svg>
  );
}

/** Ahrefs — 橙底 + 白色 A。 */
export function AhrefsLogo({ size = 16 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#ff7300" />
      <text x="12" y="17" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="14" fontWeight="700" fill="#fff">A</text>
    </svg>
  );
}

/** Google Trends — Google 蓝底 + 白色上升趋势线。 */
export function GoogleTrendsLogo({ size = 16 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#4285F4" />
      <polyline points="5,15 10,10 13,13 19,6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="15,6 19,6 19,10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
