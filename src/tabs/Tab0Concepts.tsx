import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
import { Check } from '../ui/icons';

const C = 299_792_458; // m/s
type Lesson = 'tof' | 'div' | 'fov' | 'sandbox';

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

function Pulse({ from, to, slow, onTick }: { from: THREE.Vector3; to: THREE.Vector3; slow: number; onTick: (phase: number) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const acc = useRef(0), last = useRef(0);
  useFrame((_, dt) => {
    acc.current = (acc.current + dt / (3.2 / slow)) % 1.15;
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
      <meshBasicMaterial color={b.mixed ? '#ff9f0a' : '#0a84ff'} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Quiz({ q, answer, unit, tol, done, onDone }: { q: string; answer: number; unit: string; tol: number; done: boolean; onDone: () => void }) {
  const [v, setV] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="callout" style={{ gap: 8 }} data-testid="quiz">
      <b>Check yourself {done && <Check size={16} color="var(--green)" />}</b>
      <div>{q}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' }}>
        <input type="text" inputMode="decimal" value={v} placeholder={`answer in ${unit}`} onChange={(e) => setV(e.target.value)} aria-label="Answer" />
        <span className="caption">{unit}</span>
        <Btn sm onClick={() => { const x = parseFloat(v); if (!isFinite(x)) return setMsg('Enter a number.'); if (Math.abs(x - answer) <= Math.abs(answer) * tol) { setMsg(`Correct — ${answer} ${unit}.`); onDone(); } else setMsg('Not quite — use the slider and read the numbers in the statistics card.'); }}>Check</Btn>
      </div>
      {msg && <span className="caption" style={{ color: msg.startsWith('Correct') ? 'var(--green)' : 'var(--text2)' }}>{msg}</span>}
    </div>
  );
}

export default function Tab0() {
  const concepts = useLab((s) => s.concepts);
  const markDone = (k: 'tof' | 'div' | 'fov') => useLab.setState({ concepts: { ...useLab.getState().concepts, [k]: true } });
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
  const zs = 1.5;

  const scene = useMemo(() => conceptScene(D, wallYaw, rho), [D, wallYaw, rho]);
  const beams: Beam[] = useMemo(() => {
    const rs = new RayScene(scene), h = newHit(), rng = makeRng(5);
    const out: Beam[] = [];
    const half = (div / 1000) / 2;
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
      // mixed pixel test: rays at the rim of the divergence cone
      let mixed = false;
      for (let k = 0; k < 6 && half > 1e-4; k++) {
        const a = (k / 6) * Math.PI * 2;
        const d2 = dirOf(az + Math.cos(a) * half, el + Math.sin(a) * half);
        const ok2 = rs.cast(0, 0, zs, d2[0], d2[1], d2[2], 0.05, 80, h);
        if (!ok2 || Math.abs(h.t - r) > 0.15) { mixed = true; break; }
      }
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
  const mixedCount = hits.filter((b) => b.mixed).length;

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
      <TextSprite text="LiDAR sensor" position={[0, 0, zs + 0.5]} bg="rgba(0,70,160,0.9)" />
      <lineSegments geometry={lineGeom} raycast={() => null}><lineBasicMaterial color="#007aff" transparent opacity={0.32} /></lineSegments>
      {/* beam divergence cone for the focused beam */}
      {focus?.hit && lesson !== 'fov' && (
        <mesh position={[focus.p[0] / 2, focus.p[1] / 2, zs + (focus.p[2] - zs) / 2]} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(focus.p[0], focus.p[1], focus.p[2] - zs).normalize())} raycast={() => null}>
          <cylinderGeometry args={[Math.max(0.01, spot(focus.r) / 2), 0.012, focus.r, 24, 1, true]} />
          <meshBasicMaterial color={focus.mixed ? '#ff9f0a' : '#34c759'} transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {(lesson === 'div' || lesson === 'sandbox') && beams.length <= 260 && beams.filter((b) => b.hit).map((b) => <Footprint key={b.i} b={b} radius={spot(b.r) / 2} />)}
      <points geometry={hitGeom} frustumCulled={false} onClick={(e) => { e.stopPropagation(); if (e.index !== undefined) setSel(e.index); }}>
        <pointsMaterial vertexColors size={9} sizeAttenuation={false} />
      </points>
      {focus?.hit && <mesh position={focus.p} raycast={() => null}><ringGeometry args={[0.14, 0.2, 24]} /><meshBasicMaterial color="#ff9f0a" side={THREE.DoubleSide} depthTest={false} /></mesh>}
      {lesson === 'tof' && focus?.hit && <Pulse from={new THREE.Vector3(0, 0, zs)} to={new THREE.Vector3(...focus.p)} slow={slow} onTick={setPhase} />}
    </Viewport>
  );

  const t0 = dtNs;
  const tofNow = lesson === 'tof' ? (phase < 0.5 ? phase * 2 * t0 / 2 * 1 : (phase * 2 - 1) * t0 / 2 + t0 / 2) : 0;
  void tofNow;
  const clock = phase * t0; // 0 → Δt over the whole round trip

  const stats = [
    { k: 'Time of flight Δt', v: focus?.hit ? `${dtNs.toFixed(1)} ns` : '—', s: focus?.hit ? `range ${focus.r.toFixed(2)} m` : 'no return' },
    { k: 'Spot diameter', v: focus?.hit ? `${(spot(focus.r) * 100).toFixed(1)} cm` : '—', s: `divergence ${div} mrad (${(div * 0.0573).toFixed(2)}°)` },
    { k: 'Area at the wall', v: `${(2 * D * Math.tan(hFov * D2R / 2)).toFixed(1)} × ${(2 * D * Math.tan(vFov * D2R / 2)).toFixed(1)} m`, s: `FOV ${hFov}° × ${vFov}°` },
    { k: 'Beam spacing', v: focus?.hit ? `${(spacingH * 100).toFixed(1)} cm` : '—', s: `${dAz.toFixed(2)}° × ${dEl.toFixed(2)}° steps` },
  ];

  const info = focus?.hit ? (
    <div className="callout" data-testid="concept-point-info" style={{ gap: 6 }}>
      <b>{sel !== null ? `Selected point #${focus.i + 1}` : 'Centre beam'} <span className="caption">(click any dot in the 3D view to inspect it)</span></b>
      <table className="table"><tbody>
        <tr><td>Position X, Y, Z</td><td className="mono">{focus.p.map((v) => v.toFixed(3)).join(', ')} m</td></tr>
        <tr><td>Range r</td><td className="mono">{focus.r.toFixed(3)} m</td></tr>
        <tr><td>Time of flight</td><td className="mono">{dtNs.toFixed(2)} ns</td></tr>
        <tr><td>Beam direction</td><td className="mono">az {(focus.az / D2R).toFixed(1)}°, el {(focus.el / D2R).toFixed(1)}°</td></tr>
        <tr><td>Surface</td><td>{scene.objects[focus.obj].name} · reflectivity ρ = {focus.rho.toFixed(2)}</td></tr>
        <tr><td>Incidence angle θ</td><td className="mono">{(Math.acos(Math.min(1, focus.cos)) / D2R).toFixed(1)}° (cos θ = {focus.cos.toFixed(2)})</td></tr>
        <tr><td><b>Intensity</b></td><td className="mono"><b>{focus.I.toFixed(3)}</b> = {focus.rho.toFixed(2)} × {focus.cos.toFixed(2)} ÷ {(1 + (focus.r / 15) ** 2).toFixed(2)}</td></tr>
        <tr><td>Spot / mixed pixel</td><td>{(spot(focus.r) * 100).toFixed(1)} cm{focus.mixed ? ' — straddles an edge (mixed pixel)' : ''}</td></tr>
      </tbody></table>
      <span className="caption">Intensity grows with reflectivity and shrinks with distance and with the angle between the beam and the surface normal. Try the sliders below and watch these numbers change.</span>
      <MiniChart series={[{ name: 'intensity vs range (this surface & angle)', color: '#007aff', values: curve }]} height={110} yLabel="relative intensity" xLabel={`range 1 → ${Math.round(Math.max(D * 1.3, 20))} m`} />
    </div>
  ) : <p className="hint">This beam has no return (it missed everything). Click a coloured dot on the wall.</p>;

  const lessonBox = {
    tof: (
      <>
        <Callout kind="edu" title="Time of flight">The sensor fires a short laser pulse and starts a stopwatch. The pulse hits a surface, a little light comes back, and the stopwatch stops. Light travels at <b>c ≈ 0.3 m per ns</b>, and it covers the distance twice (out and back), so <b>every metre of range costs 6.7 ns</b>.</Callout>
        <Eq note="R = range, c = speed of light, Δt = measured round-trip time">R = c · Δt ⁄ 2</Eq>
        <TofChart dt={dtNs} pw={pw} tres={tres} I={focus?.hit ? focus.I : 0} clock={clock} />
        <table className="table"><tbody>
          <tr><td>Timing resolution {tres} ns</td><td className="mono">→ range resolution {(C * tres * 1e-9 / 2 * 100).toFixed(1)} cm</td></tr>
          <tr><td>Pulse width {pw} ns</td><td className="mono">→ pulse length {(C * pw * 1e-9).toFixed(2)} m (two surfaces closer than half of it merge)</td></tr>
        </tbody></table>
        <Quiz q="How long does a pulse take to travel to a target 15 m away and come back?" answer={100} unit="ns" tol={0.05} done={concepts.tof} onDone={() => markDone('tof')} />
      </>
    ),
    div: (
      <>
        <Callout kind="edu" title="Beam divergence">A laser beam is not a perfect line — it spreads like a very thin cone. The spot it paints on a surface grows with distance, so the same sensor sees fine detail up close and blurs far away. When a spot straddles an object edge the sensor receives light from two distances at once: a <b>mixed pixel</b> (orange).</Callout>
        <Eq note="θ = full divergence angle, d₀ = exit aperture, r = range">d(r) ≈ d₀ + 2 r tan(θ ⁄ 2) ≈ d₀ + r · θ</Eq>
        <MiniChart series={[{ name: 'spot diameter (cm)', color: '#34c759', values: spotCurve }]} height={110} yLabel="spot diameter (cm)" xLabel={`range 1 → ${Math.round(Math.max(D * 1.5, 30))} m`} />
        <table className="table"><tbody>
          <tr><td>Spot at the target</td><td className="mono">{focus?.hit ? `${(spot(focus.r) * 100).toFixed(1)} cm` : '—'}</td></tr>
          <tr><td>Neighbour spacing</td><td className="mono">{(spacingH * 100).toFixed(1)} cm</td></tr>
          <tr><td>Spot ÷ spacing</td><td className="mono">{spacingH > 0 && focus?.hit ? (spot(focus.r) / spacingH).toFixed(2) : '—'} {spacingH > 0 && focus?.hit ? (spot(focus.r) > spacingH ? '(footprints overlap)' : '(gaps between spots)') : ''}</td></tr>
          <tr><td>Mixed-pixel beams</td><td className="mono">{mixedCount} of {hits.length}</td></tr>
        </tbody></table>
        <p className="hint">Real sensors are roughly 0.1–3 mrad; the slider goes higher so you can see the effect.</p>
        <Quiz q="A sensor has 3 mrad beam divergence. Roughly how wide is the spot at 100 m (ignore the exit aperture)?" answer={0.3} unit="m" tol={0.1} done={concepts.div} onDone={() => markDone('div')} />
      </>
    ),
    fov: (
      <>
        <Callout kind="edu" title="Field of view (FOV)">The <b>horizontal FOV</b> is the angle swept left-to-right; the <b>vertical FOV</b> is the angle covered up-and-down (the spread of the laser channels). Together they decide which part of the world is measured. Resolution = FOV ÷ number of beams.</Callout>
        <Eq note="width covered at range r for horizontal FOV φ">W(r) = 2 r tan(φ ⁄ 2)</Eq>
        <FovDiagrams beams={beams} scene={scene} hFov={hFov} vFov={vFov} D={D} zs={zs} />
        <table className="table"><tbody>
          <tr><td>Covered at the wall</td><td className="mono">{(2 * D * Math.tan(hFov * D2R / 2)).toFixed(1)} m wide × {(2 * D * Math.tan(vFov * D2R / 2)).toFixed(1)} m high</td></tr>
          <tr><td>Angular resolution</td><td className="mono">{dAz.toFixed(2)}° horizontal · {dEl.toFixed(2)}° vertical</td></tr>
        </tbody></table>
        <Quiz q="A scanner has a 60° horizontal FOV. How wide an area does it cover at 10 m distance?" answer={11.5} unit="m" tol={0.05} done={concepts.fov} onDone={() => markDone('fov')} />
      </>
    ),
    sandbox: (
      <>
        <Callout kind="edu" title="Sensor sandbox">Change any sensor characteristic and watch the beams, the spots and the numbers react. Click a dot to read its position and intensity, then change the wall reflectivity or tilt to see how intensity responds.</Callout>
      </>
    ),
  }[lesson];

  const controls = (
    <>
      <Seg value={lesson} onChange={setLesson} options={[{ value: 'tof', label: 'Time of flight' }, { value: 'div', label: 'Divergence' }, { value: 'fov', label: 'FOV' }, { value: 'sandbox', label: 'Sandbox' }]} label="Lesson" />
      {lessonBox}
      {info}
      <Section title="Sensor characteristics">
        <Slider label="Horizontal FOV" value={hFov} min={5} max={170} step={1} unit="°" onChange={setHFov} />
        <Slider label="Vertical FOV" value={vFov} min={0} max={90} step={1} unit="°" onChange={setVFov} />
        <Slider label="Beams across (horizontal)" value={nH} min={1} max={41} step={1} onChange={setNH} />
        <Slider label="Beams up/down (vertical channels)" value={nV} min={1} max={21} step={1} onChange={setNV} />
        <Slider label="Beam divergence (full angle)" value={div} min={0.5} max={100} step={0.5} unit=" mrad" onChange={setDiv} hint="Real sensors: ≈ 0.1–3 mrad. Exaggerated here for visibility." />
        <Slider label="Range noise (1σ)" value={noiseMm} min={0} max={200} step={1} unit=" mm" onChange={setNoiseMm} hint="Jitters the measured range along each beam." />
        <Slider label="Pulse width" value={pw} min={1} max={20} step={1} unit=" ns" onChange={setPw} />
        <Slider label="Timer resolution" value={tres} min={0.1} max={5} step={0.1} unit=" ns" format={(v) => v.toFixed(1)} onChange={setTres} />
      </Section>
      <Section title="The world">
        <Slider label="Distance to the wall" value={D} min={2} max={30} step={0.5} unit=" m" onChange={setD} />
        <Slider label="Surface reflectivity" value={rho} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setRho} hint="Dark surfaces return little light." />
        <Slider label="Wall tilt" value={wallYaw} min={-70} max={70} step={5} unit="°" onChange={setWallYaw} hint="Tilting the wall increases the angle of incidence and lowers intensity." />
        <Seg value={colourBy} onChange={setColourBy} options={[{ value: 'intensity', label: 'Colour: intensity' }, { value: 'range', label: 'Colour: range' }]} />
        {lesson === 'tof' && <Slider label="Slow-motion" value={slow} min={0.25} max={3} step={0.25} unit="×" format={(v) => v.toFixed(2)} onChange={setSlow} hint="Real round trip: tens of nanoseconds." />}
        <Btn sm onClick={() => setSel(null)} disabled={sel === null}>Back to centre beam</Btn>
      </Section>
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="LiDAR in one sentence">LiDAR (Light Detection And Ranging) measures distance by timing laser pulses, and a scanning mechanism points the pulses in many directions to build a 3D point cloud.</Callout>
      <Callout title="From beams to points">Each beam gives one range <i>r</i> in a known direction (azimuth α, elevation ε): <span className="mono">x = r cos ε cos α, y = r cos ε sin α, z = r sin ε</span>. Many beams → many points.</Callout>
      <Callout title="Why intensity matters">Besides range, each return has a strength (intensity). It depends on how reflective the surface is, how far away it is and the angle of incidence — so it helps tell materials apart, but it is not the same as colour.</Callout>
      <Callout kind="warn" title="Simplifications">This page uses an idealised pulse, a Gaussian range-noise model and the same simplified intensity model as the rest of the lab. It is a teaching aid, not a calibrated sensor model.</Callout>
    </>
  );

  return (
    <TabFrame
      title="What is LiDAR?"
      tab={0}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={
        <>
          <KindLegend items={[{ color: '#007aff', label: 'Laser beams from the sensor' }, { color: '#34c759', label: 'Beam cone / spot (divergence)' }, { color: '#ff9f0a', label: 'Mixed-pixel spot / selected point' }]} />
          {lesson === 'tof' && focus?.hit && <div className="overlay glass card" style={{ right: 12, bottom: 12, minWidth: 200 }}><div className="caption">Stopwatch (slow motion)</div><div className="mono" style={{ fontSize: '1.5rem', fontWeight: 650 }}>{clock.toFixed(1)} ns</div><div className="caption">{phase < 0.5 ? 'pulse going out' : 'light coming back'} · round trip {dtNs.toFixed(1)} ns</div></div>}
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
      <text x={W - pad.r} y={Y(0.15) - 3} textAnchor="end" fontSize="12" fill="var(--red)">detection threshold</text>
      <polyline fill="none" stroke="#d97a00" strokeWidth="2.2" points={pts(pw, 0.95)} />
      <polyline fill="none" stroke="#007aff" strokeWidth="2.2" points={pts(dt + pw, ret)} />
      <line x1={X(pw)} x2={X(dt + pw)} y1={Y(0.55)} y2={Y(0.55)} stroke="var(--text)" markerEnd="url(#tarr)" markerStart="url(#tarr)" />
      <text x={(X(pw) + X(dt + pw)) / 2} y={Y(0.55) - 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">Δt = {dt.toFixed(1)} ns</text>
      <rect x={X(dt + pw) - (tres / tmax) * (W - pad.l - pad.r) / 2} y={Y(0.15) - 6} width={(tres / tmax) * (W - pad.l - pad.r)} height={12} fill="rgba(52,199,89,.45)" />
      <line x1={X(clock + pw)} x2={X(clock + pw)} y1={pad.t} y2={Y(0)} stroke="var(--text3)" strokeDasharray="2 3" />
      {ticks.map((t) => <text key={t} x={X(t)} y={H - 8} textAnchor={t === ticks[4] ? 'end' : 'middle'} fontSize="12" fill="var(--text2)">{t.toFixed(0)}{t === ticks[4] ? ' ns' : ''}</text>)}
      <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" fontSize="12" fill="#d97a00">sent</text>
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
