// entrypoints/sidepanel/components/TabBar.tsx
export type Tab = 'site' | 'keyword';

const TABS: { key: Tab; label: string }[] = [
  { key: 'site', label: '网站工具' },
  { key: 'keyword', label: '关键词工具' },
];

export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="tab-bar">
      {TABS.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`tab${tab === it.key ? ' is-active' : ''}`}
          aria-current={tab === it.key ? 'page' : undefined}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
