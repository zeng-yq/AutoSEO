interface LogEntry {
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
}

const COLOR = {
  info: 'var(--color-on-dark-soft)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

export default function LogPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <div style={{
      background: 'var(--color-surface-dark)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-sm)',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--color-on-dark)',
      maxHeight: 160,
      overflow: 'auto',
    }}>
      {logs.length === 0 && <div style={{ color: 'var(--color-on-dark-soft)' }}>暂无日志</div>}
      {logs.map((l, i) => (
        <div key={i} style={{ color: COLOR[l.level], lineHeight: 1.6 }}>
          <span style={{ color: 'var(--color-on-dark-soft)' }}>[{l.phase}]</span> {l.message}
        </div>
      ))}
    </div>
  );
}
