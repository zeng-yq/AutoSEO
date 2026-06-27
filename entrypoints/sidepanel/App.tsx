import { useState } from 'react';
import SideNav, { type Route } from './components/SideNav';
import AhrefsTool from './pages/AhrefsTool';
import GscTool from './pages/GscTool';
import Projects from './pages/Projects';

export default function App() {
  const [route, setRoute] = useState<Route>('gsc');
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <SideNav route={route} onNavigate={setRoute} />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {route === 'gsc' && <GscTool />}
        {route === 'ahrefs' && <AhrefsTool />}
        {route === 'projects' && <Projects />}
      </main>
    </div>
  );
}
