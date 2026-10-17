import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './index.css';
import App from './App';
import { useLab } from './state/store';

// Test/debug hook (used by the Playwright suite)
(window as unknown as { __lab: typeof useLab }).__lab = useLab;

// Z-up world (LiDAR convention): must be set before any camera is created.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
