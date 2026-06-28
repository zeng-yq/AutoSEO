// entrypoints/sidepanel/components/PlatformChip.tsx
export interface PlatformChipProps {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  onToggle: () => void;
}

export default function PlatformChip({ label, icon, checked, onToggle }: PlatformChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`platform-chip${checked ? ' is-active' : ''}`}
    >
      <span style={{ display: 'inline-flex', lineHeight: 0 }}>{icon}</span>
      <span>{label}</span>
      <span aria-hidden style={{ fontSize: 11, opacity: checked ? 1 : 0.5 }}>{checked ? '✓' : '○'}</span>
    </button>
  );
}
