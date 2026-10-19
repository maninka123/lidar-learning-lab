import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Callout, Eq, Section, Seg, Slider, Toggle, Btn } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, TextSprite, roundPointTexture } from '../ui/three';
import { MiniChart } from './common';
import { box, cyl, sph, finalize, RayScene, newHit, SceneDef, primAABB } from '../scenes/geometry';
import { makeRng } from '../core/rng';
import { viridis, turbo } from '../core/colorize';
import { D2R } from '../core/math';
import { useLab } from '../state/store';
import { Play, Pause } from '../ui/icons';

const C = 299_792_458; // m/s
const DETECT = 0.04; // minimum returned intensity the detector can see
const MATERIALS: { id: string; label: string; rho: number }[] = [
  { id: 'white', label: 'White paint (0.90)', rho: 0.9 },
  { id: 'concrete', label: 'Concrete (0.50)', rho: 0.5 },
  { id: 'dark', label: 'Dark rubber (0.08)', rho: 0.08 },
  { id: 'glass', label: 'Clear glass (0.01)', rho: 0.01 },
];
type Lesson = 'tof' | 'div' | 'fov';

interface Beam { det: boolean; rGeo: number; IGeo: number; i: number; az: number; el: number; hit: boolean; r: number; p: [number, number, number]; n: [number, number, number]; obj: number; mixed: boolean; cos: number; rho: number; I: number }

/** A simple human-like figure (legs, torso, arms, head) standing at x = px, facing the sensor. */
function personParts(px: number) {
  return [
    cyl([px, 0.11, 0.45], 0.085, 0.9, 'z'), cyl([px, -0.11, 0.45], 0.085, 0.9, 'z'),
    box([px, 0, 1.2], [0.24, 0.42, 0.6]),
    cyl([px, 0.28, 1.17], 0.05, 0.6, 'z'), cyl([px, -0.28, 1.17], 0.05, 0.6, 'z'),
    sph([px, 0, 1.66], 0.12),
  ];
}

function conceptScene(D: number, wallYawDeg: number, rho: number): SceneDef {
  const mat = (r: number) => ({ color: [200, 200, 205] as [number, number, number], reflectivity: r });
  const objs = finalize([
    { id: 'wall', name: 'Wall', classId: 2, structural: true, color: [205, 208, 214], reflectivity: rho, parts: [box([D + 0.1, 0, 4], [0.2, 60, 24], wallYawDeg * D2R)] },
    { id: 'person', name: 'Person', classId: 20, color: [255, 140, 60], reflectivity: 0.6, parts: personParts(Math.min(5, D * 0.45)) },
  ] as never);
  void mat;
  return { id: 'concept', name: 'concept', description: '', objects: objs, bounds: { min: [0, -30, -8], max: [D + 3, 30, 16] }, defaultPose: { x: 0, y: 0, z: 1.5, yaw: 0 }, cameraHome: [0, 0, 0], cameraTarget: [0, 0, 0] };
}


type V3 = [number, number, number];
function Head({ at, dir, color, size = 0.18 }: { at: V3; dir: V3; color: string; size?: number }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), [dir[0], dir[1], dir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <mesh position={at} quaternion={q} raycast={() => null}><coneGeometry args={[size * 0.45, size, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>;
}
/** Double-headed dimension arrow with a label. */
function DimArrow({ a, b, label, active, color = '#1d1d1f', labelOnActive = false }: { a: V3; b: V3; label: string; active: boolean; color?: string; labelOnActive?: boolean }) {
  const c = active ? '#ff9f0a' : color;
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, u: V3 = [d[0] / L, d[1] / L, d[2] / L];
  return (
    <group>
      <Line points={[a, b]} color={c} lineWidth={active ? 4 : 2} depthTest={false} />
      <Head at={a} dir={[-u[0], -u[1], -u[2]]} color={c} />
      <Head at={b} dir={u} color={c} />
      {(active || !labelOnActive) && <TextSprite text={label} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.28]} bg={active ? 'rgba(217,122,0,0.95)' : 'rgba(29,29,31,0.85)'} />}
    </group>
  );
}
/** Angle arc with arrow heads at both ends. */
function AngleArc({ pts, label, labelAt, active, color }: { pts: V3[]; label: string; labelAt: V3; active: boolean; color: string }) {
  const c = active ? '#ff9f0a' : color;
  const n = pts.length, t0: V3 = [pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], pts[0][2] - pts[1][2]], t1: V3 = [pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1], pts[n - 1][2] - pts[n - 2][2]];
  return (
    <group>
      <Line points={pts} color={c} lineWidth={active ? 4 : 2.5} depthTest={false} />
      <Head at={pts[0]} dir={t0} color={c} />
      <Head at={pts[n - 1]} dir={t1} color={c} />
      {active && <TextSprite text={label} position={labelAt} bg="rgba(217,122,0,0.95)" />}
    </group>
  );
}

function Pulse({ from, to, slow, playing, onTick }: { from: THREE.Vector3; to: THREE.Vector3; slow: number; playing: boolean; onTick: (phase: number) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const acc = useRef(0), last = useRef(0);
  useFrame((_, dt) => {
    if (playing) acc.current = (acc.current + dt / (3.2 / slow)) % 1.15;
    const ph = Math.min(1, acc.current);
    const out = ph < 0.5;
    const f = out ? ph * 2 : (1 - ph) * 2;
    if (ref.current) {
      ref.current.position.lerpVectors(from, to, f);
      ref.current.visible = acc.current < 1.0;
      (ref.current.material as THREE.MeshBasicMaterial).color.set(out ? '#ff9f0a' : '#0a84ff');
    }
    last.current += dt;
    if (last.current > 0.08) { last.current = 0; onTick(acc.current < 1 ? ph : 1); }
  });
  return <mesh ref={ref} raycast={() => null}><sphereGeometry args={[0.13, 16, 12]} /><meshBasicMaterial color="#ff9f0a" /></mesh>;
}

function Footprint({ b, radius }: { b: Beam; radius: number }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...b.n).normalize()), [b.n[0], b.n[1], b.n[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh position={[b.p[0] + b.n[0] * 0.01, b.p[1] + b.n[1] * 0.01, b.p[2] + b.n[2] * 0.01]} quaternion={q} raycast={() => null}>
      <circleGeometry args={[Math.max(radius, 0.012), 28]} />
      <meshBasicMaterial color={'#0a84ff'} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function Tab0() {
  const [lesson, setLesson] = useState<Lesson>('tof');
  const [hFov, setHFov] = useState(60), [vFov, setVFov] = useState(30);
  const [nH, setNH] = useState(31), [nV, setNV] = useState(15);
  const [div, setDiv] = useState(20); // full-angle divergence, mrad
  const [D, setD] = useState(12);
  const [noiseMm, setNoiseMm] = useState(0);
  const [rho, setRho] = useState(0.9);
  const [wallYaw, setWallYaw] = useState(0);
  const pw = 5, tres = 1; // fixed teaching values
  const [slow, setSlow] = useState(1);
  const [colourBy, setColourBy] = useState<'intensity' | 'range'>('intensity');
  const [sel, setSel] = useState<number | null>(null);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);
  const showAxes = useLab((s) => s.view.showAxes);
  const [pane, setPane] = useState<'notes' | 'controls'>('notes');
  const [active, setActive] = useState<string | null>(null);
  const prev = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    const now = { h: hFov, v: vFov, beams: nH * 1000 + nV, spot: div, dist: D };
    const was = prev.current; prev.current = now;
    if (!was) return;
    const changed = (Object.keys(now) as (keyof typeof now)[]).find((k) => now[k] !== was[k]);
    if (!changed) return;
    setActive(changed);
    const t = setTimeout(() => setActive(null), 1800);
    return () => clearTimeout(t);
  }, [hFov, vFov, nH, nV, div, D]);
  const zs = 1.5;

  const scene = useMemo(() => conceptScene(D, wallYaw, rho), [D, wallYaw, rho]);
  const beams: Beam[] = useMemo(() => {
    const rs = new RayScene(scene), h = newHit(), rng = makeRng(5);
    const out: Beam[] = [];
    const dirOf = (az: number, el: number): [number, number, number] => [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const r0 = 15;
    for (let j = 0; j < nV; j++) for (let i = 0; i < nH; i++) {
      const az = (nH === 1 ? 0 : -hFov / 2 + (hFov * i) / (hFov >= 360 ? nH : nH - 1)) * D2R, el = (nV === 1 ? 0 : -vFov / 2 + (vFov * j) / (nV - 1)) * D2R;
      const d = dirOf(az, el);
      const ok = rs.cast(0, 0, zs, d[0], d[1], d[2], 0.05, 80, h);
      const jitter = noiseMm / 1000 * rng.gauss();
      if (!ok) { out.push({ det: false, rGeo: 0, IGeo: 0, i: out.length, az, el, hit: false, r: 80, p: [d[0] * 20, d[1] * 20, zs + d[2] * 20], n: [1, 0, 0], obj: -1, mixed: false, cos: 0, rho: 0, I: 0 }); continue; }
      const r = h.t + jitter;
      let nx = h.nx, ny = h.ny, nz = h.nz;
      let cos = -(nx * d[0] + ny * d[1] + nz * d[2]);
      if (cos < 0) { nx = -nx; ny = -ny; nz = -nz; cos = -cos; }
      const mixed = false;
      const o = scene.objects[h.obj];
      const I = Math.min(1, Math.max(0, (o.reflectivity * cos) / (1 + (r / r0) ** 2)));
      const det = I >= DETECT;
      out.push({ det, rGeo: r, IGeo: I, i: out.length, az, el, hit: det, r: det ? r : 80, p: det ? [d[0] * r, d[1] * r, zs + d[2] * r] : [d[0] * 20, d[1] * 20, zs + d[2] * 20], n: [nx, ny, nz], obj: h.obj, mixed, cos, rho: o.reflectivity, I });
    }
    return out;
  }, [scene, hFov, vFov, nH, nV, div, noiseMm]);

  const centre = beams[Math.floor(nV / 2) * nH + Math.floor(nH / 2)];
  const focus = sel !== null && beams[sel] ? beams[sel] : centre;
  const geoHit = !!focus && (focus.hit || focus.rGeo > 0);
  const spot = (r: number) => 2 * r * Math.tan(div / 2000);
  const dtNs = focus && geoHit ? ((2 * (focus.hit ? focus.r : focus.rGeo)) / C) * 1e9 : 0;
  const dAz = nH > 1 ? hFov / (hFov >= 360 ? nH : nH - 1) : 0, dEl = nV > 1 ? vFov / (nV - 1) : 0;
  const spacingH = focus ? focus.r * Math.tan(dAz * D2R) : 0;
  const hits = beams.filter((b) => b.hit);
  
  const hitGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(beams.length * 3), c = new Float32Array(beams.length * 3);
    const rmax = Math.max(1, ...hits.map((b) => b.r));
    beams.forEach((b, i) => {
      p.set(b.p, i * 3);
      const col = b.hit ? [230, 30, 40] : [200, 200, 200];
      c.set([col[0] / 255, col[1] / 255, col[2] / 255], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeBoundingSphere();
    return g;
  }, [beams, colourBy, rho]); // eslint-disable-line react-hooks/exhaustive-deps
  // thin outline of the field of view, drawn only where it lands on an object (no lines into empty space)
  const fovOutline = useMemo(() => {
    const rs = new RayScene(scene), h = newHit();
    const pt = (az: number, el: number): V3 | null => {
      const d: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
      if (!rs.cast(0, 0, zs, d[0], d[1], d[2], 0.05, 80, h)) return null;
      return [d[0] * h.t, d[1] * h.t, zs + d[2] * h.t];
    };
    const runs = (pts: (V3 | null)[]): V3[][] => {
      const out: V3[][] = []; let cur: V3[] = [];
      for (const p of pts) { if (p) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
      if (cur.length > 1) out.push(cur);
      return out;
    };
    const full = hFov >= 360, N = full ? 144 : 48, M = 24;
    const a0 = (-hFov / 2) * D2R, a1 = (hFov / 2) * D2R, e0 = (-vFov / 2) * D2R, e1 = (vFov / 2) * D2R;
    const row = (el: number) => runs(Array.from({ length: N + 1 }, (_, k) => pt(a0 + ((a1 - a0) * k) / N, el)));
    const col = (az: number) => runs(Array.from({ length: M + 1 }, (_, k) => pt(az, e0 + ((e1 - e0) * k) / M)));
    return { edges: [...row(e1), ...row(e0), ...(full ? [] : [...col(a0), ...col(a1)])] };
  }, [scene, hFov, vFov]);
  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(beams.length * 6);
    beams.forEach((b, i) => { p.set([0, 0, zs, ...b.p], i * 6); });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, [beams]);
  useEffect(() => () => { hitGeom.dispose(); lineGeom.dispose(); }, [hitGeom, lineGeom]);

  // intensity vs range for the selected surface (model curve)
  const curve = useMemo(() => {
    const cosv = focus?.hit ? focus.cos : 1, rh = focus?.hit ? focus.rho : rho;
    return Array.from({ length: 40 }, (_, k) => { const r = 1 + k * (Math.max(D * 1.3, 20) / 39); return (rh * cosv) / (1 + (r / 15) ** 2); });
  }, [focus, rho, D]);
  const spotCurve = useMemo(() => Array.from({ length: 40 }, (_, k) => spot(1 + k * (Math.max(D * 1.5, 30) / 39)) * 100), [div, D]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewport = (
    <Viewport home={[-5, -13, 8]} target={[D / 2, 0, 1.6]} threshold={0.18} id="concept" hideGrid hideAxes>
      <SceneLayer scene={scene} opacity={0.55} showCeiling interactive={false} highlight={['person']} />
      {/* sensor */}
      <group position={[0, 0, zs]}>
        <mesh raycast={() => null}><boxGeometry args={[0.28, 0.28, 0.3]} /><meshStandardMaterial color="#007aff" /></mesh>
        <mesh position={[0.17, 0, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}><coneGeometry args={[0.07, 0.16, 12]} /><meshStandardMaterial color="#1d1d1f" /></mesh>
      </group>

      {/* live measurements: they light up orange when you change the matching slider */}
      <AngleArc active={active === 'h'} color="#007aff" label={`${hFov}° horizontal FOV`} labelAt={[Math.min(3.4, D * 0.5) * 1.12, 0, zs + 0.3]}
        pts={Array.from({ length: 33 }, (_, k) => { const a = (-hFov / 2 + (hFov * k) / 32) * D2R, R = Math.min(3.4, D * 0.5); return [R * Math.cos(a), R * Math.sin(a), zs] as V3; })} />
      <AngleArc active={active === 'v'} color="#8e3fd1" label={`${vFov}° vertical FOV`} labelAt={[Math.min(2.8, D * 0.42) * Math.cos(vFov * D2R / 2) + 0.2, 0, zs + Math.min(2.8, D * 0.42) * Math.sin(vFov * D2R / 2) + 0.35]}
        pts={Array.from({ length: 25 }, (_, k) => { const e = (-vFov / 2 + (vFov * k) / 24) * D2R, R = Math.min(2.8, D * 0.42); return [R * Math.cos(e), 0, zs + R * Math.sin(e)] as V3; })} />
      <TextSprite text={`${nH} × ${nV} beams`} position={[0.4, 1.4, zs - 0.7]} bg={active === 'beams' ? 'rgba(217,122,0,0.95)' : 'rgba(0,70,160,0.9)'} />
      {focus?.hit && (() => { const sp = spot(focus.r), up = new THREE.Vector3(...focus.n).cross(new THREE.Vector3(0, 0, 1)).length() > 0.01 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); const a: V3 = [focus.p[0] - focus.n[0] * 0.0 + 0.03, focus.p[1], focus.p[2] - (up.z ? sp / 2 : 0)], b: V3 = [a[0], a[1], a[2] + sp]; return <DimArrow a={a} b={b} label={`spot ${(sp * 100).toFixed(1)} cm`} active={active === 'spot'} color="#1f9d3d" labelOnActive />; })()}
      {showAxes && (
        <group position={[0, 0, zs]}>
          {([['X (forward)', [2.2, 0, 0], '#e0362c'], ['Y (left)', [0, 2.2, 0], '#1f9d3d'], ['Z (up)', [0, 0, 2.2], '#0a60c9']] as [string, V3, string][]).map(([name, end, col]) => (
            <group key={name}>
              <Line points={[[0, 0, 0], end]} color={col} lineWidth={3} depthTest={false} />
              <Head at={end} dir={end} color={col} size={0.3} />
              <TextSprite text={name} position={[end[0] * 1.14, end[1] * 1.14, end[2] * 1.14 + 0.12]} bg={col} />
            </group>
          ))}
        </group>
      )}
      <TextSprite text="Sensor" position={[0, -1.1, zs - 0.1]} bg="rgba(0,70,160,0.9)" />
      {fovOutline.edges.map((pts, i) => <Line key={`e${i}`} points={pts} color="#000000" lineWidth={1.8} depthTest={false} />)}
      <lineSegments geometry={lineGeom} raycast={() => null}><lineBasicMaterial color="#007aff" transparent opacity={0.2} /></lineSegments>
      {/* beam divergence cone for the focused beam */}
      {focus?.hit && lesson !== 'fov' && (
        <mesh position={[focus.p[0] / 2, focus.p[1] / 2, zs + (focus.p[2] - zs) / 2]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(focus.p[0], focus.p[1], focus.p[2] - zs).normalize())} raycast={() => null}>
          <cylinderGeometry args={[Math.max(0.01, spot(focus.r) / 2), 0.012, focus.r, 24, 1, true]} />
          <meshBasicMaterial color={'#34c759'} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {lesson === 'div' && beams.length <= 520 && beams.filter((b) => b.hit).map((b) => <Footprint key={b.i} b={b} radius={spot(b.r) / 2} />)}
      <points geometry={hitGeom} frustumCulled={false} onClick={(e) => { e.stopPropagation(); if (e.index !== undefined) setSel(e.index); }}>
        <pointsMaterial vertexColors size={6} sizeAttenuation={false} map={roundPointTexture()} alphaTest={0.5} />
      </points>
      {focus?.hit && <mesh position={focus.p} raycast={() => null}><ringGeometry args={[0.14, 0.2, 24]} /><meshBasicMaterial color="#ff9f0a" side={THREE.DoubleSide} depthTest={false} /></mesh>}
      {focus?.hit && <Pulse from={new THREE.Vector3(0, 0, zs)} to={new THREE.Vector3(...focus.p)} slow={slow} playing={playing} onTick={setPhase} />}
    </Viewport>
  );

  const t0 = dtNs;
  const tofNow = lesson === 'tof' ? (phase < 0.5 ? phase * 2 * t0 / 2 * 1 : (phase * 2 - 1) * t0 / 2 + t0 / 2) : 0;
  void tofNow;
  const clock = phase * t0; // 0 → Δt over the whole round trip

  const info = focus && !focus.hit && focus.rGeo > 0 ? (
    <div className="callout bad" data-testid="concept-point-info"><b>No return</b><span>This beam hit a surface with reflectivity {focus.rho.toFixed(2)} but only {focus.IGeo.toFixed(3)} of the light came back, below the detection level ({DETECT}). The sensor sees nothing, so there is no point. Try a more reflective material or a shorter range.</span></div>
  ) : focus?.hit ? (
    <div className="callout" data-testid="concept-point-info" style={{ gap: 6 }}>
      <b>{sel !== null ? `Point #${focus.i + 1}` : 'Middle beam'} <span className="caption">· click any dot to see its details</span></b>
      <table className="table"><tbody>
        <tr><td>Position (x, y, z)</td><td className="mono">{focus.p.map((v) => v.toFixed(3)).join(', ')} m</td></tr>
        <tr><td>Range</td><td className="mono">{focus.r.toFixed(3)} m</td></tr>
        <tr><td>Reflectivity</td><td className="mono">{focus.rho.toFixed(2)}</td></tr>
        <tr><td><b>Intensity</b></td><td className="mono"><b>{focus.I.toFixed(3)}</b></td></tr>
      </tbody></table>
      <span className="caption">Intensity is higher for reflective, close surfaces.</span>
      <MiniChart series={[{ name: 'intensity vs range', color: '#007aff', values: curve }]} height={100} xLabel="range (m)" />
    </div>
  ) : null;

  const lessonBox = {
    tof: (
      <>
        <p className="hint">The sensor sends a short laser pulse and measures the time of flight: how long the light takes to bounce back. Longer time = longer range.</p>
        <Eq note="range = speed of light × time of flight ÷ 2 (the light goes there and back)">R = c · Δt ⁄ 2</Eq>
        <TofChart dt={dtNs} pw={pw} tres={tres} I={focus && geoHit ? (focus.hit ? focus.I : focus.IGeo) : 0} clock={clock} />
      </>
    ),
    div: (
      <>
        <p className="hint">Beam divergence is how much the laser beam spreads out, like a flashlight. The longer the range, the bigger the spot on the surface.</p>
        <Eq note="spot size = range × beam divergence">spot ≈ r × θ</Eq>
        <DivergenceFigure D={D} div={div} dAz={dAz} />
        <p className="hint">Not the same as resolution: <b>resolution</b> is the gap between beams, <b>divergence</b> is the size of each beam's spot. If the spot is bigger than the gap, fine details blur.</p>
      </>
    ),
    fov: (
      <>
        <p className="hint">Field of view (FOV) is the angle the sensor can see. The horizontal FOV is left-right and the vertical FOV is up-down. Resolution is how many beams fill that angle.</p>
        <Eq note="width covered at range r">width = 2 · r · tan(FOV ⁄ 2)</Eq>
        <FovDiagrams hFov={hFov} vFov={vFov} D={D} nH={nH} nV={nV} />
      </>
    ),
  }[lesson];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'notes', label: 'Notes' }, { value: 'controls', label: 'Controls' }]} label="Panel section" />
      {pane === 'notes' && (
        <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}>
          <Seg value={lesson} onChange={setLesson} options={[{ value: 'tof', label: 'Time of flight' }, { value: 'div', label: 'Beam divergence' }, { value: 'fov', label: 'Field of view' }]} label="Lesson" />
          {lessonBox}
          {info}
        </div>
      )}
      {pane === 'controls' && <>
      <Section title="Sensor">
        <Slider label="Horizontal field of view" value={hFov} min={5} max={360} step={1} unit="°" onChange={setHFov} />
        <Slider label="Vertical field of view" value={vFov} min={0} max={90} step={1} unit="°" onChange={setVFov} />
        <Slider label="Horizontal resolution (columns of beams)" value={nH} min={1} max={81} step={1} onChange={setNH} />
        <Slider label="Vertical resolution (beams per column)" value={nV} min={1} max={41} step={1} onChange={setNV} />
        <Slider label="Beam divergence" value={div} min={0.5} max={100} step={0.5} unit=" mrad" onChange={setDiv} />
      </Section>
      <Section title="Surface">
        <Slider label="Range to the wall" value={D} min={2} max={30} step={0.5} unit=" m" onChange={setD} />
        <div className="field"><label>Wall material (reflectivity)</label>
          <div className="chip-row">{MATERIALS.map((m) => <button key={m.id} className="chip" aria-pressed={rho === m.rho} onClick={() => setRho(m.rho)} data-testid={`mat-${m.id}`}>{m.label}</button>)}</div>
          <span className="caption">Dark or clear surfaces return too little light: no return, no point.</span></div>
      </Section>
      <Section title="More settings" open={false}>
        <Slider label="Range noise" value={noiseMm} min={0} max={200} step={1} unit=" mm" onChange={setNoiseMm} />
        {lesson === 'tof' && <Slider label="Slow motion" value={slow} min={0.25} max={3} step={0.25} unit="×" format={(v) => v.toFixed(2)} onChange={setSlow} />}
        <Btn sm onClick={() => setSel(null)} disabled={sel === null}>Back to middle beam</Btn>
      </Section>
      </>}
    </>
  );

  return (
    <TabFrame
      title="What is LiDAR?"
      tab={0}
      viewport={viewport}
      controls={controls}
      learn={null}
      simple
      overlays={
        <>
          <KindLegend items={[{ color: '#007aff', label: 'Laser beams' }, { color: '#34c759', label: 'Beam divergence / spot' }, { color: '#ff9f0a', label: 'Selected point' }]} />
          <FrontInsets beams={beams} scene={scene} hFov={hFov} vFov={vFov} D={D} zs={zs} />
          <button className="btn primary overlay" style={{ left: '50%', bottom: 14, transform: 'translateX(-50%)', minWidth: 120 }} onClick={() => setPlaying(!playing)} data-testid="play-pause" aria-label={playing ? 'Pause the light pulse' : 'Play the light pulse'}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'Pause' : 'Play'}</button>
          <div className="overlay" style={{ right: 12, bottom: 12, display: 'grid', gap: 8, justifyItems: 'end' }} data-testid="stats-card">
            {lesson === 'tof' && focus?.hit && <div className="glass card" style={{ minWidth: 210 }}><div className="caption">Stopwatch (slowed down)</div><div className="mono" style={{ fontSize: '1.5rem', fontWeight: 650 }}>{clock.toFixed(1)} ns</div><div className="caption">{phase < 0.5 ? 'light going out' : 'light coming back'}</div></div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="glass card" style={{ minWidth: 170 }}><div className="caption">Time of flight</div><div style={{ fontSize: '1.3rem', fontWeight: 650 }}>{focus?.hit ? `${dtNs.toFixed(1)} ns` : '—'}</div><div className="caption">{focus?.hit ? `range ${focus.r.toFixed(2)} m` : 'no return'}</div></div>
              <div className="glass card" style={{ minWidth: 170 }}><div className="caption">Coverage</div><div style={{ fontSize: '1.3rem', fontWeight: 650 }}>{(2 * D * Math.tan(hFov * D2R / 2)).toFixed(1)} × {(2 * D * Math.tan(vFov * D2R / 2)).toFixed(1)} m</div><div className="caption">{hFov}° × {vFov}° FOV</div></div>
            </div>
          </div>
        </>
      }
    />
  );
}


/** Front views: only the points that landed on the person, and only the points that landed on the wall. */
function FrontInsets({ beams, scene, hFov, vFov, D, zs }: { beams: Beam[]; scene: SceneDef; hFov: number; vFov: number; D: number; zs: number }) {
  const ref = useRef<HTMLCanvasElement>(null), ref2 = useRef<HTMLCanvasElement>(null);
  const idx = scene.objects.findIndex((o) => o.id === 'person'), widx = scene.objects.findIndex((o) => o.id === 'wall');
  const pts = beams.filter((b) => b.hit && b.obj === idx), wpts = beams.filter((b) => b.hit && b.obj === widx);
  useEffect(() => {
    const cv = ref.current; if (!cv || idx < 0) return;
    const W = 150, H = 205, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const sc = 88, X = (y: number) => W / 2 - y * sc, Y = (z: number) => H - 22 - z * sc;
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.setLineDash([4, 3]); g.lineWidth = 1;
    for (const p of scene.objects[idx].parts) {
      if (p.kind === 'sphere') { g.beginPath(); g.arc(X(p.c[1]), Y(p.c[2]), p.r! * sc, 0, 7); g.stroke(); }
      else if (p.kind === 'box') g.strokeRect(X(p.c[1] + p.size![1] / 2), Y(p.c[2] + p.size![2] / 2), p.size![1] * sc, p.size![2] * sc);
      else g.strokeRect(X(p.c[1] + p.r!), Y(p.c[2] + p.h! / 2), 2 * p.r! * sc, p.h! * sc);
    }
    g.setLineDash([]);
    g.strokeStyle = '#ccc'; g.beginPath(); g.moveTo(10, Y(0)); g.lineTo(W - 10, Y(0)); g.stroke();
    g.fillStyle = '#e61e28';
    for (const b of pts) { g.beginPath(); g.arc(X(b.p[1]), Y(b.p[2]), 3.2, 0, 7); g.fill(); }
  }, [pts.length, beams, scene, idx]);
  useEffect(() => {
    const cv = ref2.current; if (!cv) return;
    const W = 150, H = 110, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const w = Math.min(60, 2 * D * Math.tan(Math.min(hFov, 170) * Math.PI / 360)), hh = 2 * D * Math.tan(vFov * Math.PI / 360) || 1;
    const sc = Math.min((W - 16) / w, (H - 16) / hh), X = (y: number) => W / 2 - y * sc, Y = (z: number) => H / 2 - (z - zs) * sc;
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(W / 2 - (w * sc) / 2, H / 2 - (hh * sc) / 2, w * sc, hh * sc);
    g.fillStyle = '#e61e28';
    for (const b of wpts) { g.beginPath(); g.arc(X(b.p[1]), Y(b.p[2]), 2.3, 0, 7); g.fill(); }
    if (!wpts.length) { g.fillStyle = '#666'; g.font = '13px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('no return from the wall', W / 2, H / 2 + 4); }
  }, [wpts.length, beams, hFov, vFov, D, zs]);
  return (
    <div className="overlay" style={{ right: 12, top: 70, display: 'grid', gap: 8, width: 176 }} data-testid="person-points">
      <div className="glass card" style={{ padding: 9 }}>
        <div style={{ fontWeight: 650, fontSize: '0.95rem' }}>Points on the person</div>
        <div className="caption" style={{ marginBottom: 6 }}>{pts.length} points = the person's point cloud</div>
        <canvas ref={ref} style={{ width: 150, height: 205, borderRadius: 10, display: 'block' }} aria-label="Points that landed on the person" />
        <div className="caption" style={{ marginTop: 4 }}>More beams = more points = clearer shape.</div>
      </div>
      <div className="glass card" style={{ padding: 9 }}>
        <div style={{ fontWeight: 650, fontSize: '0.95rem' }}>Points on the wall</div>
        <div className="caption" style={{ marginBottom: 6 }}>{wpts.length} points · gap = person's shadow</div>
        <canvas ref={ref2} style={{ width: 150, height: 110, borderRadius: 10, display: 'block' }} aria-label="Points that landed on the wall" />
      </div>
    </div>
  );
}

function TofChart({ dt, pw, tres, I, clock }: { dt: number; pw: number; tres: number; I: number; clock: number }) {
  const W = 340, H = 150, pad = { l: 34, r: 10, t: 10, b: 28 };
  const tmax = Math.max(40, dt * 1.35 + pw * 2);
  const X = (t: number) => pad.l + (t / tmax) * (W - pad.l - pad.r), Y = (a: number) => H - pad.b - a * (H - pad.t - pad.b);
  const pulse = (t: number, c: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * (pw / 2.355) ** 2));
  const pts = (c: number, a: number) => Array.from({ length: 160 }, (_, k) => { const t = (k / 159) * tmax; return `${X(t)},${Y(pulse(t, c, a))}`; }).join(' ');
  const ret = Math.max(0.01, Math.min(0.9, I * 2.2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tmax);
  const PADR = 0;
  void PADR;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Emitted and returned pulse" style={{ background: 'var(--fill)', borderRadius: 12 }}>
      <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--sep)" />
      <line x1={pad.l} x2={W - pad.r} y1={Y(DETECT * 2.2)} y2={Y(DETECT * 2.2)} stroke="var(--red)" strokeDasharray="4 3" opacity={0.7} />
      <text x={W - pad.r} y={Y(DETECT * 2.2) - 3} textAnchor="end" fontSize="12" fill="var(--red)">detection level</text>
      <polyline fill="none" stroke="#d97a00" strokeWidth="2.2" points={pts(pw, 0.95)} />
      <polyline fill="none" stroke="#007aff" strokeWidth="2.2" points={pts(dt + pw, ret)} />
      <line x1={X(pw)} x2={X(dt + pw)} y1={Y(0.55)} y2={Y(0.55)} stroke="var(--text)" markerEnd="url(#tarr)" markerStart="url(#tarr)" />
      <text x={(X(pw) + X(dt + pw)) / 2} y={Y(0.55) - 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">time = {dt.toFixed(1)} ns</text>
      <rect x={X(dt + pw) - (tres / tmax) * (W - pad.l - pad.r) / 2} y={Y(DETECT * 2.2) - 6} width={(tres / tmax) * (W - pad.l - pad.r)} height={12} fill="rgba(52,199,89,.45)" />
      <line x1={X(clock + pw)} x2={X(clock + pw)} y1={pad.t} y2={Y(0)} stroke="var(--text3)" strokeDasharray="2 3" />
      {ticks.map((t) => <text key={t} x={X(t)} y={H - 8} textAnchor={t === ticks[4] ? 'end' : 'middle'} fontSize="12" fill="var(--text2)">{t.toFixed(0)}{t === ticks[4] ? ' ns' : ''}</text>)}
      <text x={pad.l + 4} y={pad.t + 8} textAnchor="start" fontSize="12" fill="#d97a00">flash sent</text>
      <text x={X(dt + pw)} y={Y(ret) - 6} textAnchor="middle" fontSize="12" fill="#007aff">light back</text>
      <defs><marker id="tarr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker></defs>
    </svg>
  );
}

/** Beam footprint vs angular spacing, drawn like a textbook figure. */
function DivergenceFigure({ D, div, dAz }: { D: number; div: number; dAz: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spot = D * (div / 1000), spacing = D * Math.tan(dAz * D2R);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = 340, H = 230, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#fbfbfd'; g.fillRect(0, 0, W, H);
    const sx = 38, sy = 118, ex = 280;
    const k = 62 / Math.max(spot, spacing, 1e-6);
    const sp = Math.max(6, spacing * k), st = Math.max(5, spot * k);
    const cone = (yc: number, col: string, fill: string) => {
      g.fillStyle = fill; g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.moveTo(sx + 12, sy); g.lineTo(ex, yc - st / 2); g.lineTo(ex, yc + st / 2); g.closePath(); g.fill(); g.stroke();
      g.setLineDash([7, 5]); g.beginPath(); g.moveTo(sx + 12, sy); g.lineTo(ex, yc); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.beginPath(); g.roundRect(ex - 3, yc - st * 0.42, 9, st * 0.84, 4); g.fill();
    };
    const yG = sy - sp / 2, yB = sy + sp / 2;
    cone(yG, '#3d9080', 'rgba(61,144,128,.14)');
    cone(yB, '#4a80f0', 'rgba(74,128,240,.14)');
    g.fillStyle = '#6b7690'; g.beginPath(); g.arc(sx, sy, 13, 0, 7); g.fill();
    // spacing bracket
    const bx = ex + 30;
    g.strokeStyle = '#444'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(bx, yG); g.lineTo(bx, yB); g.moveTo(bx - 8, yG); g.lineTo(bx + 8, yG); g.moveTo(bx - 8, yB); g.lineTo(bx + 8, yB); g.stroke();
    g.font = '600 13px -apple-system, sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#3d9080'; g.fillText(`Beam footprint · ${(spot * 100).toFixed(1)} cm`, 190, Math.max(18, yG - st / 2 - 12));
    g.fillStyle = '#4a80f0'; g.fillText(`Angular spacing · ${(spacing * 100).toFixed(1)} cm`, 190, Math.min(H - 30, yB + st / 2 + 22));
    g.fillStyle = '#1d1d1f'; g.fillText('LiDAR', sx, sy + 34);
    g.textAlign = 'right'; g.fillText(`${D} m`, W - 8, H - 8);
    g.textAlign = 'left'; g.font = '13px -apple-system, sans-serif'; g.fillStyle = spot > spacing ? '#c4163f' : '#1f7a3d';
    g.fillText(spot > spacing ? 'Footprints overlap: details blur' : 'Gaps between beams: details can be missed', 8, H - 8);
  }, [D, div, dAz, spot, spacing]);
  return <canvas ref={ref} style={{ width: '100%', height: 230, borderRadius: 12 }} aria-label="Beam footprint compared with angular spacing" />;
}

/** One annotated figure: the sensor, the rectangle it covers at the wall, both FOV angles and the size covered. */
function FovDiagrams({ hFov, vFov, D, nH, nV }: { hFov: number; vFov: number; D: number; nH: number; nV: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = 340, H = 250, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#f7f7fa'; g.fillRect(0, 0, W, H);
    const wy = Math.min(1.7, Math.tan(Math.min(hFov, 170) * D2R / 2)), wz = Math.min(1.5, Math.tan(vFov * D2R / 2));
    const X0 = 34, Y0 = 138;
    const P = (x: number, y: number, z: number): [number, number] => [X0 + x * 140 - y * (96 / Math.max(1, wy)), Y0 - z * (118 / Math.max(0.8, wz)) + y * (10 / Math.max(1, wy))];
    const c = [P(1, wy, wz), P(1, -wy, wz), P(1, -wy, -wz), P(1, wy, -wz)];
    const label = (t: string, x: number, y: number, bg: string) => { g.font = '600 13px -apple-system, sans-serif'; const w = g.measureText(t).width + 12; g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - 11, w, 22, 11); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(t, x, y + 4); };
    // covered rectangle
    g.fillStyle = 'rgba(0,122,255,.12)'; g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    // beams = dots on the rectangle
    g.fillStyle = '#e61e28';
    const cols = Math.min(nH, 25), rows = Math.min(nV, 13);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const y = cols === 1 ? 0 : wy - (2 * wy * i) / (cols - 1), z = rows === 1 ? 0 : wz - (2 * wz * j) / (rows - 1); const q = P(1, y, z); g.beginPath(); g.arc(q[0], q[1], 1.8, 0, 7); g.fill(); }
    // edges of the field of view
    g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; g.setLineDash([4, 3]);
    for (const p of c) { g.beginPath(); g.moveTo(X0, Y0); g.lineTo(p[0], p[1]); g.stroke(); }
    g.setLineDash([]);
    // angle arcs at the sensor
    const arc = (f: (t: number) => [number, number], a: number, col: string) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); for (let k = 0; k <= 30; k++) { const t = -a / 2 + (a * k) / 30, q = f(t * D2R); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); } g.stroke(); };
    arc((t) => P(0.42 * Math.cos(t), 0.42 * Math.sin(t) * Math.min(1.7, 1), 0), Math.min(hFov, 170), '#0a60c9');
    arc((t) => P(0.5 * Math.cos(t), 0, 0.5 * Math.sin(t)), vFov, '#8e3fd1');
    g.fillStyle = '#007aff'; g.beginPath(); g.arc(X0, Y0, 6, 0, 7); g.fill();
    label(`${hFov}° horizontal FOV`, X0 + 70, Y0 + 70, '#0a60c9');
    label(`${vFov}° vertical FOV`, X0 + 62, Y0 - 66, '#8e3fd1');
    // size covered at the wall
    const top = P(1, 0, wz), right = P(1, -wy, 0);
    label(`${(2 * D * Math.tan(Math.min(hFov, 170) * D2R / 2)).toFixed(1)} m wide at ${D} m`, Math.min(W - 80, Math.max(80, top[0] + 20)), 22, '#1d1d1f');
    label(`${(2 * D * Math.tan(vFov * D2R / 2)).toFixed(1)} m high`, W - 52, Y0 + 4, '#1d1d1f');
  }, [hFov, vFov, D, nH, nV]);
  return <canvas ref={ref} style={{ width: '100%', height: 250, borderRadius: 12 }} aria-label="Field of view: horizontal and vertical angle and the area covered" />;
}
