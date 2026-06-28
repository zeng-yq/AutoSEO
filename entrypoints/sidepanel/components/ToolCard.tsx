// entrypoints/sidepanel/components/ToolCard.tsx
import { IconChevron } from './icons';

export interface ToolCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export default function ToolCard({ icon, title, subtitle, onClick, disabled }: ToolCardProps) {
  const interactive = !!onClick && !disabled;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } } : undefined}
      className={`tool-card${disabled ? ' is-disabled' : ''}`}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <span className="tool-card__icon">{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="tool-card__title">{title}</span>
        {subtitle && <span className="tool-card__subtitle">{subtitle}</span>}
      </span>
      {onClick && !disabled && <IconChevron size={16} />}
    </div>
  );
}
