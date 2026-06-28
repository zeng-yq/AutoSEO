// entrypoints/sidepanel/pages/KeywordTools.tsx
import AhrefsTool from './AhrefsTool';

export default function KeywordTools() {
  return (
    <div style={{ padding: 'var(--space-md)' }}>
      <h2 style={{ fontSize: 17, marginBottom: 'var(--space-md)' }}>关键词工具</h2>
      <AhrefsTool />
    </div>
  );
}
