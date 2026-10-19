import { ReactNode, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useLab, Background } from '../state/store';
import { viewBus, camBus, ViewKind } from './viewBus';

export const BG: Record<Background, string> = { dark: '#0b0c10', graphite: '#1c1c1e', gray: '#6e6e73', light: '#f2f2f7' };

function Rig({ home, target, group, id, primary }: { home: [number, number, number]; target: [number, number, number]; group?: string; id: string; primary: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (n: string, f: () => void) => void; removeEventListener: (n: string, f: () => void) => void } | null;
  const goal = useRef<{ pos: THREE.Vector3; tgt: THREE.Vector3 } | null>(null);
  const remote = useRef(false);
  const frames = useRef({ t: 0, n: 0, low: 0 });

  const go = (kind: ViewKind) => {
    if (!controls) return;
    const tgt = new THREE.Vector3(...target);
    if (kind === 'home') { goal.current = { pos: new THREE.Vector3(...home), tgt }; return; }
    const D = Math.max(3, camera.position.distanceTo(controls.target));
    const t = controls.target.clone();
    const off = kind === 'top' ? new THREE.Vector3(0, -0.02 * D, D) : kind === 'front' ? new THREE.Vector3(0, -D, 0.02 * D) : new THREE.Vector3(D, 0, 0.02 * D);
    goal.current = { pos: t.clone().add(off), tgt: t };
  };
  useEffect(() => viewBus.on((k) => { if (primary || !group) go(k); }), [controls, home.join(), target.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (controls) { camera.position.set(...home); controls.target.set(...target); controls.update(); } }, [controls, home.join(), target.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; };
    const change = () => {
      if (!group || remote.current) return;
      camBus.emit(group, { pos: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number], src: id });
    };
    controls.addEventListener('start', stop);
    controls.addEventListener('change', change);
    const off = group ? camBus.on(group, (s) => {
      if (s.src === id) return;
      remote.current = true;
      camera.position.set(...s.pos); controls.target.set(...s.target); controls.update();
      remote.current = false;
    }) : () => {};
    return () => { controls.removeEventListener('start', stop); controls.removeEventListener('change', change); off(); };
  }, [controls, group, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    // critically-damped approach from the *current* camera state: interruptible, no jumps
    if (goal.current && controls) {
      const k = 1 - Math.exp(-dt * 9);
      camera.position.lerp(goal.current.pos, k);
      controls.target.lerp(goal.current.tgt, k);
      controls.update();
      if (camera.position.distanceTo(goal.current.pos) < 0.01) goal.current = null;
    }
    if (primary) {
      const f = frames.current;
      f.t += dt; f.n++;
      if (f.t >= 1) {
        const fps = f.n / f.t;
        f.t = 0; f.n = 0;
        const s = useLab.getState();
        useLab.setState({ fps: Math.round(fps) });
        f.low = fps < 12 ? f.low + 1 : 0;
        if (f.low >= 4 && s.view.renderBudget > 20000) {
          const nb = Math.max(20000, Math.round(s.view.renderBudget * 0.6));
          s.setView({ renderBudget: nb });
          s.notify(`Frame rate was low — render budget reduced to ${nb.toLocaleString()} points.`, 'warn');
          f.low = 0;
        }
      }
    }
  });
  return null;
}

export interface ViewportProps {
  children?: ReactNode;
  home?: [number, number, number];
  target?: [number, number, number];
  group?: string;
  id?: string;
  primary?: boolean;
  threshold?: number;
  label?: string;
  labelPos?: 'bl' | 'br';
  bgOverride?: string;
  gridSize?: number;
  hideGrid?: boolean;
  hideAxes?: boolean;
}

export function Viewport({ children, home = [8, -9, 6.5], target = [0, 0, 1], group, id = 'main', primary = true, threshold = 0.05, label, labelPos = 'br', bgOverride, gridSize = 1, hideGrid, hideAxes }: ViewportProps) {
  const bg = useLab((s) => s.view.background);
  const showGrid = useLab((s) => s.view.showGrid);
  const showAxes = useLab((s) => s.view.showAxes);
  const interaction = useLab((s) => s.interaction);
  const light = bg === 'light';
  const color = bgOverride ?? BG[bg];
  return (
    <div style={{ position: 'absolute', inset: 0, background: color, cursor: interaction === 'select' ? undefined : 'crosshair' }} data-testid={`viewport-${id}`}>
      <Canvas
        camera={{ position: home, fov: 50, near: 0.05, far: 800, up: [0, 0, 1] }}
        gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'default' }}
        dpr={[1, 1.75]}
        raycaster={{ params: { Points: { threshold }, Line: { threshold: 0.05 }, Mesh: {}, LOD: {}, Sprite: {} } as never }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      >
        <color attach="background" args={[color]} />
        <ambientLight intensity={1.15} />
        <directionalLight position={[6, -4, 12]} intensity={1.4} />
        <directionalLight position={[-6, 5, 6]} intensity={0.5} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI} />
        <Rig home={home} target={target} group={group} id={id} primary={primary} />
        {showGrid && !hideGrid && (
          <Grid rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.002]} args={[40, 40]} cellSize={gridSize} sectionSize={gridSize * 5} cellColor={light ? '#b9bcc4' : '#2c2f38'} sectionColor={light ? '#8d919c' : '#4a4f5c'} fadeDistance={60} fadeStrength={1.5} infiniteGrid raycast={() => null} />
        )}
        {showAxes && !hideAxes && <axesHelper args={[1.2 * gridSize]} raycast={() => null} />}
        {children}
      </Canvas>
      {label && <div className="overlay card glass" style={{ bottom: 12, [labelPos === 'br' ? 'right' : 'left']: 12, padding: '0.3rem 0.7rem', fontSize: '0.875rem', fontWeight: 600 }}>{label}</div>}
    </div>
  );
}
