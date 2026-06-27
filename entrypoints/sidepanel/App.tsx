import { useState } from 'react';
import TopBar from './components/TopBar';
import Home from './pages/Home';
import AhrefsTool from './pages/AhrefsTool';
import GscTool from './pages/GscTool';
import Projects from './pages/Projects';

export default function App() {
  const [route, setRoute] = useState<'home' | 'gsc' | 'ahrefs' | 'projects'>('home');
  const back = () => setRoute('home');
  return (
    <>
      <TopBar onHome={back} />
      {route === 'home' && <Home onNavigate={setRoute} />}
      {route === 'gsc' && <GscTool onBack={back} />}
      {route === 'ahrefs' && <AhrefsTool onBack={back} />}
      {route === 'projects' && <Projects onBack={back} />}
    </>
  );
}
