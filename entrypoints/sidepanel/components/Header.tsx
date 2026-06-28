// entrypoints/sidepanel/components/Header.tsx
import { Logo } from './icons';

export default function Header() {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--color-hairline)' }}>
      <span style={{ color: 'var(--color-primary)', display: 'inline-flex', lineHeight: 0 }}>
        <Logo size={18} />
      </span>
      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--color-ink)' }}>AutoSEO</span>
    </header>
  );
}
