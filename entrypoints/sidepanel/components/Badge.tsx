export default function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', background: 'var(--color-surface-card)', color: 'var(--color-ink)',
      fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-pill)', padding: '2px 10px',
    }}>{children}</span>
  );
}
