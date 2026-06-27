export type Route = 'gsc' | 'ahrefs' | 'projects';

const NAV_ITEMS: { key: Route; label: string }[] = [
  { key: 'gsc', label: 'GSC 批量提交' },
  { key: 'ahrefs', label: 'Ahrefs KD 查询' },
  { key: 'projects', label: '项目管理' },
];

export default function SideNav({ route, onNavigate }: {
  route: Route;
  onNavigate: (r: Route) => void;
}) {
  return (
    <nav style={{
      width: 148,
      flexShrink: 0,
      height: '100%',
      background: 'var(--color-surface-soft)',
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid var(--color-hairline)',
    }}>
      <div style={{
        padding: 'var(--space-sm)',
        borderBottom: '1px solid var(--color-hairline-soft)',
      }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--color-ink)' }}>
          <span aria-hidden style={{ color: 'var(--color-primary)' }}>✲</span> AutoSEO
        </span>
      </div>
      <div style={{ padding: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const active = route === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`side-nav__item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
