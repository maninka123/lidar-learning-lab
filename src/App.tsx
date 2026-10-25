import { Suspense, lazy, ReactNode } from 'react';
import { Layers, PanelLeft, Radar, Info, Boxes, Route, GitMerge, Filter, Network, Camera, Share2, Ruler, Eye, Wand, Crosshair } from './ui/icons';
import { useLab } from './state/store';
import { Toast } from './ui/shared';

const Tab0 = lazy(() => import('./tabs/Tab0Concepts'));
const Tab1 = lazy(() => import('./tabs/Tab1Fundamentals'));
const Tab2 = lazy(() => import('./tabs/Tab2Explorer'));
const TabCmp = lazy(() => import('./tabs/TabCompareSensors'));
const TabMap = lazy(() => import('./tabs/TabMapping'));
const TabTls = lazy(() => import('./tabs/TabTls'));
const TabFusion = lazy(() => import('./tabs/TabFusion'));
const TabReg = lazy(() => import('./tabs/TabRegistration'));
const TabMoving = lazy(() => import('./tabs/TabMoving'));
const TabCad = lazy(() => import('./tabs/TabScanToCad'));
const TabChange = lazy(() => import('./tabs/TabChange'));
const TabMeshing = lazy(() => import('./tabs/TabMeshing'));
const Tab5 = lazy(() => import('./tabs/Tab5Processing'));
const Tab6 = lazy(() => import('./tabs/Tab6Segmentation'));
const Tab7 = lazy(() => import('./tabs/Tab7Recon'));
const Tab8 = lazy(() => import('./tabs/Tab8SceneGraph'));

const TABS: { label: string; icon: ReactNode; el: ReactNode }[] = [
  { label: 'What is LiDAR?', icon: <Info size={18} />, el: <Tab0 /> },
  { label: 'Scanner Simulator', icon: <Radar size={18} />, el: <Tab1 /> },
  { label: 'Compare Sensors', icon: <Layers size={18} />, el: <TabCmp /> },
  { label: 'Point Cloud Gallery', icon: <Boxes size={18} />, el: <Tab2 /> },
  { label: 'Point Cloud Processing', icon: <Filter size={18} />, el: <Tab5 /> },
  { label: 'Point Cloud Registration', icon: <GitMerge size={18} />, el: <TabReg /> },
  { label: 'TLS Scanning', icon: <Crosshair size={18} />, el: <TabTls /> },
  { label: 'SLAM & Mobile Scanning', icon: <Route size={18} />, el: <TabMap /> },
  { label: 'LiDAR + Camera Fusion', icon: <Camera size={18} />, el: <TabFusion /> },
  { label: 'Meshing & Surfaces', icon: <Wand size={18} />, el: <TabMeshing /> },
  { label: 'Clustering & Segmentation', icon: <Network size={18} />, el: <Tab6 /> },
  { label: 'Scene Graphs & 3D AI', icon: <Share2 size={18} />, el: <Tab8 /> },
  { label: 'Moving Scene & Temporal Graph', icon: <Route size={18} />, el: <TabMoving /> },
  { label: 'Scan to CAD', icon: <Ruler size={18} />, el: <TabCad /> },
  { label: 'Change Detection', icon: <Eye size={18} />, el: <TabChange /> },
  { label: 'Image to 3D', icon: <Camera size={18} />, el: <Tab7 /> },
];

export default function App() {
  const tab = useLab((s) => s.tab);
  const setTab = useLab((s) => s.setTab);
  const navOpen = useLab((s) => s.navOpen);
  return (
    <div className={`app ${navOpen ? '' : 'nav-collapsed'}`}>
      <nav className="sidebar glass" aria-label="Lecture sections">
        <div className="brand">
          <div className="brand-mark"><Radar size={22} color="#fff" /></div>
          <div className="brand-text"><b>LiDAR Learning Lab</b></div>
        </div>
        <button className="btn sm icon nav-toggle" onClick={() => useLab.setState({ navOpen: !navOpen })} aria-label={navOpen ? 'Collapse the menu' : 'Expand the menu'} aria-expanded={navOpen} title={navOpen ? 'Collapse menu' : 'Expand menu'} data-testid="nav-toggle"><PanelLeft size={17} /></button>
        {TABS.map((t, i) => (
          <button key={t.label} className="nav-item" aria-current={tab === i ? 'page' : undefined} onClick={() => setTab(i)} data-testid={`nav-${i}`} title={t.label}>
            <span className="nav-num">{i + 1}</span>
            <span className="nav-label">{t.label}</span>
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
