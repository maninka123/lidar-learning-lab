import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Callout, Eq, Section, Seg, Slider, Toggle, Btn } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, TextSprite } from '../ui/three';
import { MiniChart } from './common';
import { box, cyl, finalize, RayScene, newHit, SceneDef, primAABB } from '../scenes/geometry';
import { makeRng } from '../core/rng';
import { viridis, turbo } from '../core/colorize';
import { D2R } from '../core/math';
import { useLab } from '../state/store';
import { Play, Pause } from '../ui/icons';

const C = 299_792_458; // m/s
type Lesson = 'tof' | 'div' | 'fov';

interface Beam { i: number; az: number; el: number; hit: boolean; r: number; p: [number, number, number]; n: [number, number, number]; obj: number; mixed: boolean; cos: number; rho: number; I: number }

function conceptScene(D: number, wallYawDeg: number, rho: number): SceneDef {
  const mat = (r: number) => ({ color: [200, 200, 205] as [number, number, number], reflectivity: r });
  const objs = finalize([
    { id: 'wall', name: 'Wall', classId: 2, structural: true, color: [205, 208, 214], reflectivity: rho, parts: [box([D + 0.1, 0, 2], [0.2, 14, 6], wallYawDeg * D2R)] },
    { id: 'box', name: 'Box', classId: 6, color: [239, 120, 100], reflectivity: rho, parts: [box([D * 0.55, 0.9, 0.5], [0.8, 0.8, 1.0], 0.3)] },
    { id: 'pole', name: 'Pole', classId: 18, color: [250, 190, 70], reflectivity: rho, parts: [cyl([D * 0.4, -1.6, 1.0], 0.14, 2, 'z')] },
    { id: 'ground', name: 'Ground', classId: 1, structural: true, color: [225, 225, 230], reflectivity: rho, parts: [box([(D + 6) / 2 - 3, 0, -0.05], [D + 6, 14, 0.1])] },
  ] as never);
  void mat;
  return { id: 'concept', name: 'concept', description: '', objects: objs, bounds: { min: [0, -7, 0], max: [D + 3, 7, 5] }, defaultPose: { x: 0, y: 0, z: 1.5, yaw: 0 }, cameraHome: [0, 0, 0], cameraTarget: [0, 0, 0] };
}


type V3 = [number, number, number];
function Head({ at, dir, color, size = 0.18 }: { at: V3; dir: V3; color: string; size?: number }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), [dir[0], dir[1], dir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <mesh position={at} quaternion={q} raycast={() => null}><coneGeometry args={[size * 0.45, size, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>;
}
/** Double-headed dimension arrow with a label. */
function DimArrow({ a, b, label, active, color = '#1d1d1f' }: { a: V3; b: V3; label: string; active: boolean; color?: string }) {
  const c = active ? '#ff9f0a' : color;
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, u: V3 = [d[0] / L, d[1] / L, d[2] / L];
  return (
    <group>
      <Line points={[a, b]} color={c} lineWidth={active ? 4 : 2} depthTest={false} />
      <Head at={a} dir={[-u[0], -u[1], -u[2]]} color={c} />
      <Head at={b} dir={u} color={c} />
      <TextSprite text={label} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.28]} bg={active ? 'rgba(217,122,0,0.95)' : 'rgba(29,29,31,0.85)'} />
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
      <TextSprite text={label} position={labelAt} bg={active ? 'rgba(217,122,0,0.95)' : 'rgba(29,29,31,0.85)'} />
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
  const [nH, setNH] = useState(13), [nV, setNV] = useState(7);
  const [div, setDiv] = useState(20); // full-angle divergence, mrad
  const [D, setD] = useState(12);
  const [noiseMm, setNoiseMm] = useState(0);
  const [rho, setRho] = useState(0.7);
  const [wallYaw, setWallYaw] = useState(0);
  const [pw, setPw] = useState(5), [tres, setTres] = useState(1);
  const [slow, setSlow] = useState(1);
  const [colourBy, setColourBy] = useState<'intensity' | 'range'>('intensity');
  const [sel, setSel] = useState<number | null>(null);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);
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
      const az = (nH === 1 ? 0 : -hFov / 2 + (hFov * i) / (nH - 1)) * D2R, el = (nV === 1 ? 0 : -vFov / 2 + (vFov * j) / (nV - 1)) * D2R;
      const d = dirOf(az, el);
      const ok = rs.cast(0, 0, zs, d[0], d[1], d[2], 0.05, 80, h);
      const jitter = noiseMm / 1000 * rng.gauss();
      if (!ok) { out.push({ i: out.length, az, el, hit: false, r: 80, p: [d[0] * 20, d[1] * 20, zs + d[2] * 20], n: [1, 0, 0], obj: -1, mixed: false, cos: 0, rho: 0, I: 0 }); continue; }
      const r = h.t + jitter;
      let nx = h.nx, ny = h.ny, nz = h.nz;
      let cos = -(nx * d[0] + ny * d[1] + nz * d[2]);
      if (cos < 0) { nx = -nx; ny = -ny; nz = -nz; cos = -cos; }
      const mixed = false;
      const o = scene.objects[h.obj];
      const I = Math.min(1, Math.max(0, (o.reflectivity * cos) / (1 + (r / r0) ** 2)));
      out.push({ i: out.length, az, el, hit: true, r, p: [d[0] * r, d[1] * r, zs + d[2] * r], n: [nx, ny, nz], obj: h.obj, mixed, cos, rho: o.reflectivity, I });
    }
    return out;
  }, [scene, hFov, vFov, nH, nV, div, noiseMm]);

  const centre = beams[Math.floor(nV / 2) * nH + Math.floor(nH / 2)];
  const focus = sel !== null && beams[sel] ? beams[sel] : centre;
  const spot = (r: number) => 2 * r * Math.tan(div / 2000);
  const dtNs = focus?.hit ? ((2 * focus.r) / C) * 1e9 : 0;
  const dAz = nH > 1 ? hFov / (nH - 1) : 0, dEl = nV > 1 ? vFov / (nV - 1) : 0;
  const spacingH = focus ? focus.r * Math.tan(dAz * D2R) : 0;
  const hits = beams.filter((b) => b.hit);
  
  const hitGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(beams.length * 3), c = new Float32Array(beams.length * 3);
    const rmax = Math.max(1, ...hits.map((b) => b.r));
    beams.forEach((b, i) => {
      p.set(b.p, i * 3);
      const col = b.hit ? (colourBy === 'intensity' ? viridis(b.I / Math.max(0.01, rho)) : turbo(b.r / rmax)) : [200, 200, 200];
      c.set([col[0] / 255, col[1] / 255, col[2] / 255], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeBoundingSphere();
    return g;
  }, [beams, colourBy, rho]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <Viewport home={[-5, -13, 8]} target={[D / 2, 0, 1.6]} threshold={0.18} id="concept">
      <SceneLayer scene={scene} opacity={0.55} showCeiling interactive={false} />
      {/* sensor */}
      <group position={[0, 0, zs]}>
        <mesh raycast={() => null}><boxGeometry args={[0.28, 0.28, 0.3]} /><meshStandardMaterial color="#007aff" /></mesh>
        <mesh position={[0.17, 0, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}><coneGeometry args={[0.07, 0.16, 12]} /><meshStandardMaterial color="#1d1d1f" /></mesh>
      </group>

      {/* live measurements: they light up orange when you change the matching slider */}
      <AngleArc active={active === 'h'} color="#007aff" label={`${hFov}° left-right`} labelAt={[Math.min(3.4, D * 0.5) * 1.12, 0, zs + 0.3]}
        pts={Array.from({ length: 33 }, (_, k) => { const a = (-hFov / 2 + (hFov * k) / 32) * D2R, R = Math.min(3.4, D * 0.5); return [R * Math.cos(a), R * Math.sin(a), zs] as V3; })} />
      <AngleArc active={active === 'v'} color="#8e3fd1" label={`${vFov}° up-down`} labelAt={[Math.min(2.8, D * 0.42) * Math.cos(vFov * D2R / 2) + 0.2, 0, zs + Math.min(2.8, D * 0.42) * Math.sin(vFov * D2R / 2) + 0.35]}
        pts={Array.from({ length: 25 }, (_, k) => { const e = (-vFov / 2 + (vFov * k) / 24) * D2R, R = Math.min(2.8, D * 0.42); return [R * Math.cos(e), 0, zs + R * Math.sin(e)] as V3; })} />
      <DimArrow a={[0, -2.6, 0.12]} b={[D, -2.6, 0.12]} label={`${D} m to the wall`} active={active === 'dist'} color="#1d1d1f" />
      <TextSprite text={`${nH} × ${nV} beams`} position={[0.2, 0, zs - 0.55]} bg={active === 'beams' ? 'rgba(217,122,0,0.95)' : 'rgba(0,70,160,0.9)'} />
      {focus?.hit && (() => { const sp = spot(focus.r), up = new THREE.Vector3(...focus.n).cross(new THREE.Vector3(0, 0, 1)).length() > 0.01 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); const a: V3 = [focus.p[0] - focus.n[0] * 0.0 + 0.03, focus.p[1], focus.p[2] - (up.z ? sp / 2 : 0)], b: V3 = [a[0], a[1], a[2] + sp]; return <DimArrow a={a} b={b} label={`spot ${(sp * 100).toFixed(1)} cm`} active={active === 'spot'} color="#1f9d3d" />; })()}
      <TextSprite text="Sensor" position={[0, 0, zs + 0.5]} bg="rgba(0,70,160,0.9)" />
      <lineSegments geometry={lineGeom} raycast={() => null}><lineBasicMaterial color="#007aff" transparent opacity={0.32} /></lineSegments>
      {/* beam divergence cone for the focused beam */}
      {focus?.hit && lesson !== 'fov' && (
        <mesh position={[focus.p[0] / 2, focus.p[1] / 2, zs + (focus.p[2] - zs) / 2]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(focus.p[0], focus.p[1], focus.p[2] - zs).normalize())} raycast={() => null}>
          <cylinderGeometry args={[Math.max(0.01, spot(focus.r) / 2), 0.012, focus.r, 24, 1, true]} />
          <meshBasicMaterial color={'#34c759'} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {lesson === 'div' && beams.length <= 260 && beams.filter((b) => b.hit).map((b) => <Footprint key={b.i} b={b} radius={spot(b.r) / 2} />)}
      <points geometry={hitGeom} frustumCulled={false} onClick={(e) => { e.stopPropagation(); if (e.index !== undefined) setSel(e.index); }}>
        <pointsMaterial vertexColors size={9} sizeAttenuation={false} />
      </points>
      {focus?.hit && <mesh position={focus.p} raycast={() => null}><ringGeometry args={[0.14, 0.2, 24]} /><meshBasicMaterial color="#ff9f0a" side={THREE.DoubleSide} depthTest={false} /></mesh>}
      {lesson === 'tof' && focus?.hit && <Pulse from={new THREE.Vector3(0, 0, zs)} to={new THREE.Vector3(...focus.p)} slow={slow} playing={playing} onTick={setPhase} />}
    </Viewport>
  );

  const t0 = dtNs;
  const tofNow = lesson === 'tof' ? (phase < 0.5 ? phase * 2 * t0 / 2 * 1 : (phase * 2 - 1) * t0 / 2 + t0 / 2) : 0;
  void tofNow;
  const clock = phase * t0; // 0 → Δt over the whole round trip

  const stats = [
    { k: 'Time for light to return', v: focus?.hit ? `${dtNs.toFixed(1)} ns` : '—', s: focus?.hit ? `distance ${focus.r.toFixed(2)} m` : 'nothing hit' },
    { k: 'Area the sensor sees', v: `${(2 * D * Math.tan(hFov * D2R / 2)).toFixed(1)} × ${(2 * D * Math.tan(vFov * D2R / 2)).toFixed(1)} m`, s: `${hFov}° × ${vFov}°` },
    { k: 'Gap between beams', v: focus?.hit ? `${(spacingH * 100).toFixed(1)} cm` : '—', s: `${dAz.toFixed(1)}° apart` },
  ];

  const info = focus?.hit ? (
    <div className="callout" data-testid="concept-point-info" style={{ gap: 6 }}>
      <b>{sel !== null ? `Point #${focus.i + 1}` : 'Middle beam'} <span className="caption">· click any dot to see its details</span></b>
      <table className="table"><tbody>
        <tr><td>Position (x, y, z)</td><td className="mono">{focus.p.map((v) => v.toFixed(3)).join(', ')} m</td></tr>
        <tr><td>Distance</td><td className="mono">{focus.r.toFixed(3)} m</td></tr>
        <tr><td>Wall shininess</td><td className="mono">{focus.rho.toFixed(2)}</td></tr>
        <tr><td><b>Brightness</b> (intensity)</td><td className="mono"><b>{focus.I.toFixed(3)}</b></td></tr>
      </tbody></table>
      <span className="caption">Brighter when the surface is shiny and close.</span>
      <MiniChart series={[{ name: 'brightness vs distance', color: '#007aff', values: curve }]} height={100} xLabel="distance (m)" />
    </div>
  ) : <p className="hint">This beam hit nothing. Click a coloured dot.</p>;

  const lessonBox = {
    tof: (
      <>
        <p className="hint">The sensor sends a flash of laser light and times how long it takes to bounce back. Longer time = farther away.</p>
        <Btn variant="primary" icon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={() => setPlaying(!playing)} testId="play-pause">{playing ? 'Pause' : 'Play'}</Btn>
        <Eq note="distance = speed of light × time ÷ 2 (the light goes there and back)">R = c · Δt ⁄ 2</Eq>
        <TofChart dt={dtNs} pw={pw} tres={tres} I={focus?.hit ? focus.I : 0} clock={clock} />
      </>
    ),
    div: (
      <>
        <p className="hint">A laser beam slowly spreads out, like a flashlight. The farther it goes, the bigger the spot it makes.</p>
        <Eq note="spot size = distance × spread">spot ≈ r × θ</Eq>
        <MiniChart series={[{ name: 'spot diameter (cm)', color: '#34c759', values: spotCurve }]} height={110} xLabel="distance (m)" />
      </>
    ),
    fov: (
      <>
        <p className="hint">The view angle (FOV) is how much the sensor can see. Wide angle = sees more. It has a left-right angle and an up-down angle.</p>
        <Eq note="width seen at distance r">width = 2 · r · tan(angle ⁄ 2)</Eq>
        <FovDiagrams beams={beams} scene={scene} hFov={hFov} vFov={vFov} D={D} zs={zs} />
      </>
    ),
  }[lesson];

  const controls = (
    <>
      <Seg value={lesson} onChange={setLesson} options={[{ value: 'tof', label: 'Time of flight' }, { value: 'div', label: 'Beam spread' }, { value: 'fov', label: 'View angle' }]} label="Lesson" />
      <div style={{ display: 'grid', gap: 10, paddingTop: 12 }}>{lessonBox}</div>
      {info}
      <Section title="Sensor">
        <Slider label="Left-right angle" value={hFov} min={5} max={170} step={1} unit="°" onChange={setHFov} />
        <Slider label="Up-down angle" value={vFov} min={0} max={90} step={1} unit="°" onChange={setVFov} />
        <Slider label="Beams left-right" value={nH} min={1} max={41} step={1} onChange={setNH} />
        <Slider label="Beams up-down" value={nV} min={1} max={21} step={1} onChange={setNV} />
        <Slider label="Beam spread" value={div} min={0.5} max={100} step={0.5} unit=" mrad" onChange={setDiv} />
      </Section>
      <Section title="Wall">
        <Slider label="Distance to wall" value={D} min={2} max={30} step={0.5} unit=" m" onChange={setD} />
        <Slider label="Shininess of wall" value={rho} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setRho} />
      </Section>
      <Section title="More settings" open={false}>
        <Slider label="Measuring error" value={noiseMm} min={0} max={200} step={1} unit=" mm" onChange={setNoiseMm} />
        <Slider label="Flash length" value={pw} min={1} max={20} step={1} unit=" ns" onChange={setPw} />
        <Slider label="Timer accuracy" value={tres} min={0.1} max={5} step={0.1} unit=" ns" format={(v) => v.toFixed(1)} onChange={setTres} />
        {lesson === 'tof' && <Slider label="Slow motion" value={slow} min={0.25} max={3} step={0.25} unit="×" format={(v) => v.toFixed(2)} onChange={setSlow} />}
        <Seg value={colourBy} onChange={setColourBy} options={[{ value: 'intensity', label: 'Colour: brightness' }, { value: 'range', label: 'Colour: distance' }]} />
        <Btn sm onClick={() => setSel(null)} disabled={sel === null}>Back to middle beam</Btn>
      </Section>
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
      stats={stats}
      overlays={
        <>
          <KindLegend items={[{ color: '#007aff', label: 'Laser beams' }, { color: '#34c759', label: 'Beam and its spot' }, { color: '#ff9f0a', label: 'Selected point' }]} />
          {lesson === 'tof' && focus?.hit && <div className="overlay glass card" style={{ right: 12, bottom: 12, minWidth: 200 }}><div className="caption" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>Stopwatch (slowed down)<button className="btn sm icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button></div><div className="mono" style={{ fontSize: '1.5rem', fontWeight: 650 }}>{clock.toFixed(1)} ns</div><div className="caption">{phase < 0.5 ? 'light going out' : 'light coming back'} · total {dtNs.toFixed(1)} ns</div></div>}
        </>
      }
    />
  );
}

function TofChart({ dt, pw, tres, I, clock }: { dt: number; pw: number; tres: number; I: number; clock: number }) {
  const W = 340, H = 150, pad = { l: 34, r: 10, t: 10, b: 28 };
  const tmax = Math.max(40, dt * 1.35 + pw * 2);
  const X = (t: number) => pad.l + (t / tmax) * (W - pad.l - pad.r), Y = (a: number) => H - pad.b - a * (H - pad.t - pad.b);
  const pulse = (t: number, c: number, a: number) => a * Math.exp(-((t - c) ** 2) / (2 * (pw / 2.355) ** 2));
  const pts = (c: number, a: number) => Array.from({ length: 160 }, (_, k) => { const t = (k / 159) * tmax; return `${X(t)},${Y(pulse(t, c, a))}`; }).join(' ');
  const ret = Math.max(0.08, Math.min(0.9, I * 2.2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tmax);
  const PADR = 0;
  void PADR;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Emitted and returned pulse" style={{ background: 'var(--fill)', borderRadius: 12 }}>
      <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--sep)" />
      <line x1={pad.l} x2={W - pad.r} y1={Y(0.15)} y2={Y(0.15)} stroke="var(--red)" strokeDasharray="4 3" opacity={0.7} />
      <text x={W - pad.r} y={Y(0.15) - 3} textAnchor="end" fontSize="12" fill="var(--red)">detection level</text>
      <polyline fill="none" stroke="#d97a00" strokeWidth="2.2" points={pts(pw, 0.95)} />
      <polyline fill="none" stroke="#007aff" strokeWidth="2.2" points={pts(dt + pw, ret)} />
      <line x1={X(pw)} x2={X(dt + pw)} y1={Y(0.55)} y2={Y(0.55)} stroke="var(--text)" markerEnd="url(#tarr)" markerStart="url(#tarr)" />
      <text x={(X(pw) + X(dt + pw)) / 2} y={Y(0.55) - 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">time = {dt.toFixed(1)} ns</text>
      <rect x={X(dt + pw) - (tres / tmax) * (W - pad.l - pad.r) / 2} y={Y(0.15) - 6} width={(tres / tmax) * (W - pad.l - pad.r)} height={12} fill="rgba(52,199,89,.45)" />
      <line x1={X(clock + pw)} x2={X(clock + pw)} y1={pad.t} y2={Y(0)} stroke="var(--text3)" strokeDasharray="2 3" />
      {ticks.map((t) => <text key={t} x={X(t)} y={H - 8} textAnchor={t === ticks[4] ? 'end' : 'middle'} fontSize="12" fill="var(--text2)">{t.toFixed(0)}{t === ticks[4] ? ' ns' : ''}</text>)}
      <text x={pad.l + 4} y={pad.t + 8} textAnchor="start" fontSize="12" fill="#d97a00">flash sent</text>
      <text x={X(dt + pw)} y={Y(ret) - 6} textAnchor="middle" fontSize="12" fill="#007aff">light back</text>
      <defs><marker id="tarr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text)" /></marker></defs>
    </svg>
  );
}

function FovDiagrams({ beams, scene, hFov, vFov, D, zs }: { beams: Beam[]; scene: SceneDef; hFov: number; vFov: number; D: number; zs: number }) {
  const a = useRef<HTMLCanvasElement>(null), b = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = (cv: HTMLCanvasElement | null, mode: 'top' | 'side') => {
      if (!cv) return;
      const W = 340, H = 150, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d')!; g.scale(dpr, dpr);
      g.fillStyle = '#f7f7fa'; g.fillRect(0, 0, W, H);
      const xmax = D + 2, span = mode === 'top' ? 7 : 4;
      const sc = Math.min((W - 30) / xmax, (H - 24) / (2 * span / (mode === 'top' ? 1 : 1.0)));
      const ox = 14, oy = mode === 'top' ? H / 2 : H - 22;
      const X = (x: number) => ox + x * sc, Y = (v: number) => (mode === 'top' ? oy - v * sc : oy - v * sc);
      g.strokeStyle = '#ccc'; g.beginPath(); g.moveTo(ox, mode === 'top' ? oy : oy); g.lineTo(W - 6, oy); g.stroke();
      for (const o of scene.objects) for (const p of o.parts) {
        const bb = primAABB(p);
        const y0 = mode === 'top' ? bb.min[1] : bb.min[2], y1 = mode === 'top' ? bb.max[1] : bb.max[2];
        g.fillStyle = o.structural ? 'rgba(120,120,130,.25)' : `rgba(${o.color.join(',')},.7)`;
        g.fillRect(X(bb.min[0]), Y(y1), Math.max(1.5, (bb.max[0] - bb.min[0]) * sc), Math.max(1.5, (y1 - y0) * sc));
      }
      const half = (mode === 'top' ? hFov : vFov) / 2 * D2R, R = xmax;
      const zo = mode === 'top' ? 0 : zs;
      g.fillStyle = 'rgba(0,122,255,.12)'; g.strokeStyle = 'rgba(0,122,255,.8)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(0), Y(zo)); g.lineTo(X(R * Math.cos(half)), Y(zo + R * Math.sin(half))); g.lineTo(X(R * Math.cos(half)), Y(zo - R * Math.sin(half))); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(0,122,255,.35)'; g.lineWidth = 1;
      for (const bm of beams) { if (!bm.hit) continue; g.beginPath(); g.moveTo(X(0), Y(zo)); g.lineTo(X(bm.p[0]), Y(mode === 'top' ? bm.p[1] : bm.p[2])); g.stroke(); }
      g.fillStyle = '#007aff'; g.beginPath(); g.arc(X(0), Y(zo), 5, 0, 7); g.fill();
      g.fillStyle = '#1d1d1f'; g.font = '600 12px -apple-system, sans-serif';
      g.fillText(mode === 'top' ? `Top view · horizontal FOV ${hFov}°` : `Side view · vertical FOV ${vFov}°`, 8, 14);
    };
    draw(a.current, 'top'); draw(b.current, 'side');
  }, [beams, scene, hFov, vFov, D, zs]);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <canvas ref={a} style={{ width: '100%', height: 150, borderRadius: 12 }} aria-label="Top view of the field of view" />
      <canvas ref={b} style={{ width: '100%', height: 150, borderRadius: 12 }} aria-label="Side view of the field of view" />
    </div>
  );
}
