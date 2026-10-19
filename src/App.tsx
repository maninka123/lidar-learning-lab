import { Suspense, lazy, ReactNode } from 'react';
import { Radar, Info, Boxes, Route, GitMerge, Filter, Network, Camera, Share2, Trophy, Check } from './ui/icons';
import { useLab } from './state/store';
import { Toast } from './ui/shared';
import { CHALLENGES } from './exercises/defs';

const Tab0 = lazy(() => import('./tabs/Tab0Concepts'));
const Tab1 = lazy(() => import('./tabs/Tab1Fundamentals'));
const Tab2 = lazy(() => import('./tabs/Tab2Explorer'));
const Tab3 = lazy(() => import('./tabs/Tab3TlsMls'));
const Tab4 = lazy(() => import('./tabs/Tab4Slam'));
const Tab5 = lazy(() => import('./tabs/Tab5Processing'));
const Tab6 = lazy(() => import('./tabs/Tab6Segmentation'));
const Tab7 = lazy(() => import('./tabs/Tab7Recon'));
const Tab8 = lazy(() => import('./tabs/Tab8SceneGraph'));
const Tab9 = lazy(() => import('./tabs/Tab9Challenges'));

const TABS: { label: string; icon: ReactNode; el: ReactNode }[] = [
  { label: 'What is LiDAR?', icon: <Info size={18} />, el: <Tab0 /> },
  { label: 'Scanner Simulator', icon: <Radar size={18} />, el: <Tab1 /> },
  { label: 'Point Cloud Explorer', icon: <Boxes size={18} />, el: <Tab2 /> },
  { label: 'TLS & MLS Laboratory', icon: <Route size={18} />, el: <Tab3 /> },
  { label: 'SLAM & Registration', icon: <GitMerge size={18} />, el: <Tab4 /> },
  { label: 'Point Cloud Processing', icon: <Filter size={18} />, el: <Tab5 /> },
  { label: 'Clustering & Segmentation', icon: <Network size={18} />, el: <Tab6 /> },
  { label: 'Image to 3D', icon: <Camera size={18} />, el: <Tab7 /> },
  { label: 'Scene Graphs & 3D AI', icon: <Share2 size={18} />, el: <Tab8 /> },
  { label: 'Challenges', icon: <Trophy size={18} />, el: <Tab9 /> },
];

export default function App() {
  const tab = useLab((s) => s.tab);
  const setTab = useLab((s) => s.setTab);
  const state = useLab();
  const done = new Set(CHALLENGES.filter((c) => c.check(state).done).map((c) => c.tab));
  return (
    <div className="app">
      <nav className="sidebar glass" aria-label="Lecture sections">
        <div className="brand">
          <div className="brand-mark"><Radar size={22} color="#fff" /></div>
          <div><b>LiDAR Learning Lab</b><span>60-minute workshop</span></div>
        </div>
        {TABS.map((t, i) => (
          <button key={t.label} className="nav-item" aria-current={tab === i ? 'page' : undefined} onClick={() => setTab(i)} data-testid={`nav-${i}`} title={t.label}>
            <span className="nav-num">{i + 1}</span>
            <span className="nav-label">{t.label}</span>
            {done.has(i) && <Check size={16} className="tick" aria-label="Challenge complete" />}
          </button>
        ))}
      </nav>
      <main className="main">
        <Suspense fallback={<div style={{ padding: 24 }} className="hint">Loading…</div>}>{TABS[tab].el}</Suspense>
        <Toast />
      </main>
    </div>
  );
}
