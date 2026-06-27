import { useState } from 'react';
import TopBar from './components/TopBar';
import Home from './pages/Home';
import AhrefsTool from './pages/AhrefsTool';
function GscPlaceholder({ onBack }: { onBack: () => void }) { return <Placeholder title="GSC" onBack={onBack} />; }
function ProjectsPlaceholder({ onBack }: { onBack: () => void }) { return <Placeholder title="项目管理" onBack={onBack} />; }
function Placeholder({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ padding: 'var(--space-lg)' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 12 }}>← 返回</button>
      <h2>{title}</h2>
    </div>
  );
}
export default function App() {
  const [route, setRoute] = useState<'home' | 'gsc' | 'ahrefs' | 'projects'>('home');
  const back = () => setRoute('home');
  return (
    <>
      <TopBar onHome={back} />
      {route === 'home' && <Home onNavigate={setRoute} />}
      {route === 'gsc' && <GscPlaceholder onBack={back} />}
      {route === 'ahrefs' && <AhrefsTool onBack={back} />}
      {route === 'projects' && <ProjectsPlaceholder onBack={back} />}
    </>
  );
}
