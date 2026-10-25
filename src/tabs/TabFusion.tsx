import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Slider } from '../ui/controls';
import { CloudLayer, PolyLine, SceneLayer, SensorMarker, TextSprite } from '../ui/three';
import { Play, Download } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { PointCloud, selectPoints } from '../core/pointcloud';
import { renderView } from '../recon/recon';
import { buildFusionHall } from '../scenes/fusion';
import { makeRng } from '../core/rng';
import { Vec3 } from '../core/math';
import { Extrinsic, FOV, IMG_H, IMG_W, Image, SavedCalibration, TRUTH, ZERO, cameraPose, colourise, loadCalibration, project, reprojection, rmsPx, saveCalibration, solveExtrinsic } from '../apps/fusion';
import FusionMapping from './FusionMapping';

interface Match { X: Vec3; m: [number, number] }
interface Calc { dx: number; dy: number; dz: number; dyaw: number; dpitch: number; total: number; deg: number; colours: number | null; est: Extrinsic }

/** A small camera: a body and a lens, pointing the way the camera looks. */
function CameraModel({ pose, color, opacity = 1, label, scale }: { pose: ReturnType<typeof cameraPose>; color: string; opacity?: number; label?: string; scale: number }) {
  const m = useMemo(() => {
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(...pose.f), new THREE.Vector3(-pose.r[0], -pose.r[1], -pose.r[2]), new THREE.Vector3(...pose.u));
    M.setPosition(pose.pos[0], pose.pos[1], pose.pos[2]);
    return M;
  }, [pose]);
  const k = scale;
  return (
    <>
      <group matrixAutoUpdate={false} matrix={m}>
        <mesh raycast={() => null}><boxGeometry args={[0.1 * k, 0.15 * k, 0.09 * k]} /><meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} /></mesh>
        <mesh position={[0.085 * k, 0, 0]} rotation={[0, 0, Math.PI / 2]} raycast={() => null}><cylinderGeometry args={[0.035 * k, 0.045 * k, 0.07 * k, 24]} /><meshStandardMaterial color="#1d1d1f" transparent={opacity < 1} opacity={opacity} /></mesh>
      </group>
      {label && <TextSprite text={label} position={[pose.pos[0], pose.pos[1], pose.pos[2] + 0.32]} height={0.022} bg={color} />}
    </>
  );
}

/** The camera's place relative to the LiDAR as one 4 × 4 matrix: the rotation block (circled in blue) and the translation column (circled in orange). It follows the sliders. */
function TransformCard({ e }: { e: Extrinsic }) {
  const c = cameraPose({ x: 0, y: 0, z: 0, yaw: 0 }, e); // axes of the camera written in the LiDAR frame
  const R = [[c.f[0], -c.r[0], c.u[0]], [c.f[1], -c.r[1], c.u[1]], [c.f[2], -c.r[2], c.u[2]]]; // columns: forward, left, up
  const t = [e.tx, e.ty, e.tz];
  const num = (v: number) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums', textAlign: 'right' };
  return (
    <div style={{ background: '#fff', padding: '8px 12px', display: 'grid', gap: 4 }} data-testid="transform-card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}><b style={{ fontSize: '0.875rem' }}>Camera relative to the LiDAR</b><span className="caption">LiDAR frame → camera frame</span></div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ border: '2.5px solid #0a84ff', borderRadius: 20, padding: '8px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 4.1em)', gap: '3px 4px', color: '#0a60c9', ...mono }}>
              {R.flat().map((v, i) => <span key={i}>{num(v)}</span>)}
            </div>
            <div style={{ border: '2.5px solid #ff9f0a', borderRadius: 20, padding: '8px 14px', display: 'grid', gridTemplateColumns: '4.1em', gap: '3px 4px', color: '#c77700', ...mono }}>
              {t.map((v, i) => <span key={i}>{num(v)}</span>)}
            </div>
          </div>
          <div style={{ ...mono, color: '#9a9aa2', textAlign: 'left', paddingLeft: 14, whiteSpace: 'pre' }}>{'0.000  0.000  0.000     1'}</div>
        </div>
        <div style={{ display: 'grid', gap: 6, fontSize: '0.8125rem' }}>
          <span style={{ color: '#0a60c9' }}><b>Rotation</b> (blue)<br />turn {e.yawDeg.toFixed(1)}° · tilt {e.pitchDeg.toFixed(1)}°<br /><span className="caption">columns: forward, left, up</span></span>
          <span style={{ color: '#c77700' }}><b>Translation</b> (orange, metres)<br />{(e.tx * 100).toFixed(1)}, {(e.ty * 100).toFixed(1)}, {(e.tz * 100).toFixed(1)} cm<br /><span className="caption">forward, left, up</span></span>
        </div>
      </div>
    </div>
  );
}

export default function TabFusion() {
  const s = useLab();
  const scene = useMemo(() => buildFusionHall(), []);
  const rig = useMemo(() => ({ x: scene.defaultPose.x, y: scene.defaultPose.y, z: scene.defaultPose.z, yaw: scene.defaultPose.yaw }), [scene]);
  const lidar: SensorConfig = useMemo(() => ({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.4, noise: 0.003 }), []);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [img, setImg] = useState<Image | null>(null);
  const [est, setEst] = useState<Extrinsic>(ZERO);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [solved, setSolved] = useState<{ e: Extrinsic; rms: number } | null>(null);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [saved, setSaved] = useState<SavedCalibration | null>(() => loadCalibration());
  const [mapOpen, setMapOpen] = useState(false);
  const [showCloud, setShowCloud] = useState<'colour' | 'height'>('colour');
  const [busy, setBusy] = useState(false);

  async function capture() {
    setBusy(true);
    try {
      const res = await runTask('scan', { scene, sensor: lidar, trajectory: staticPose(rig.x, rig.y, rig.z, rig.yaw), sweeps: 1, seed: 21, maxRays: 120000, distortion: false, scanId: 1, name: 'LiDAR scan' });
      const cam = cameraPose(rig, TRUTH);
      const v = renderView(scene, { pos: cam.pos, target: [cam.pos[0] + cam.f[0], cam.pos[1] + cam.f[1], cam.pos[2] + cam.f[2]], fovDeg: FOV }, IMG_W, IMG_H);
      setCloud(res.cloud); setImg({ w: IMG_W, h: IMG_H, fovDeg: FOV, rgb: v.rgb, depth: v.depth, hitMask: v.hitMask }); setMatches(null); setSolved(null); setCalc(null);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  useEffect(() => { void capture(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the colour result updates as the sliders move
  // colouring ~50 000 points on every slider tick would make dragging jerky: the cloud follows a moment later and always ends up matching the sliders
  const estShown = useDeferredValue(est);
  const updating = estShown !== est;
  const col = useMemo(() => (cloud && img ? colourise(cloud.positions, cloud.count, rig, estShown, img, true, 2.5) : null), [cloud, img, estShown, rig]);
  const colTrue = useMemo(() => (cloud && img ? colourise(cloud.positions, cloud.count, rig, TRUTH, img) : null), [cloud, img, rig]);
  // the point cloud views leave out the walls and the ceiling (class 2 and 3): the objects are easier to see
  const keep = useMemo(() => { if (!cloud) return null; const ids: number[] = []; for (let i = 0; i < cloud.count; i++) { const l = cloud.labels ? cloud.labels[i] : 0; if (l !== 2 && l !== 3) ids.push(i); } return Int32Array.from(ids); }, [cloud]);
  const withColours = useMemo<PointCloud | null>(() => { if (!cloud || !col || !keep) return null; const seen = keep.filter((i) => col.valid[i]); return seen.length ? selectPoints({ ...cloud, colors: col.colors }, seen) : null; }, [cloud, col, keep]);
  const plainCloud = useMemo<PointCloud | null>(() => (cloud && keep ? selectPoints(cloud, keep) : null), [cloud, keep]);
  const colourAccuracy = () => {
    if (!cloud || !img || !colTrue) return null;
    const now = colourise(cloud.positions, cloud.count, rig, est, img, true, 2.5); // always from the current sliders
    let ok = 0, tot = 0;
    for (let i = 0; i < cloud.count; i++) if (colTrue.valid[i]) { tot++; const d = Math.max(Math.abs(now.colors[i * 3] - colTrue.colors[i * 3]), Math.abs(now.colors[i * 3 + 1] - colTrue.colors[i * 3 + 1]), Math.abs(now.colors[i * 3 + 2] - colTrue.colors[i * 3 + 2])); if (now.valid[i] && d < 30) ok++; }
    return tot ? ok / tot : null;
  };

  function calculate() {
    const t = Math.hypot(est.tx - TRUTH.tx, est.ty - TRUTH.ty, est.tz - TRUTH.tz) * 100;
    setCalc({ dx: (est.tx - TRUTH.tx) * 100, dy: (est.ty - TRUTH.ty) * 100, dz: (est.tz - TRUTH.tz) * 100, dyaw: est.yawDeg - TRUTH.yawDeg, dpitch: est.pitchDeg - TRUTH.pitchDeg, total: t, deg: Math.hypot(est.yawDeg - TRUTH.yawDeg, est.pitchDeg - TRUTH.pitchDeg), colours: colourAccuracy(), est: { ...est } });
  }

  // ---- optional helper: automatic matching + solve
  function findMatches() {
    if (!cloud || !img) return;
    const cam = cameraPose(rig, TRUTH), r = makeRng(5);
    const gray = (k: number) => 0.3 * img.rgb[k * 4] + 0.59 * img.rgb[k * 4 + 1] + 0.11 * img.rgb[k * 4 + 2];
    const cand: { X: Vec3; u: number; v: number; sc: number }[] = [];
    for (let i = 0; i < cloud.count; i += 3) {
      const X: Vec3 = [cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]];
      const q = project(cam, X, IMG_W, IMG_H, FOV); if (!q) continue;
      const iu = Math.round(q.u), iv = Math.round(q.v); if (iu < 3 || iv < 3 || iu >= IMG_W - 3 || iv >= IMG_H - 3) continue;
      const k = iv * IMG_W + iu; if (!img.hitMask[k] || Math.abs(q.z - img.depth[k]) > 0.1) continue;
      const sc = Math.abs(gray(k + 3) - gray(k - 3)) + Math.abs(gray(k + 3 * IMG_W) - gray(k - 3 * IMG_W));
      if (sc > 30) cand.push({ X, u: q.u, v: q.v, sc });
    }
    cand.sort((a, b) => b.sc - a.sc);
    const chosen: typeof cand = [];
    for (const c of cand) { if (chosen.length >= 24) break; if (chosen.every((o) => Math.hypot(o.u - c.u, o.v - c.v) > 14)) chosen.push(c); }
    if (chosen.length < 6) { s.notify('Not enough clear features to match.', 'warn'); return; }
    setMatches(chosen.map((c) => ({ X: c.X, m: [c.u + 0.6 * r.gauss(), c.v + 0.6 * r.gauss()] as [number, number] }))); setSolved(null);
  }
  function solve() {
    if (!matches) return;
    const r = solveExtrinsic(rig, matches.map((q) => q.X), matches.map((q) => q.m), est, IMG_W, IMG_H, FOV);
    setSolved(r); setEst(r.e); setCalc(null);
  }
  const resNow = matches ? reprojection(rig, est, matches.map((q) => q.X), matches.map((q) => q.m), IMG_W, IMG_H, FOV) : null;
  const rmsNow = resNow ? rmsPx(resNow) : null;

  // ---- zoomed offsets: where the camera really is and where you put it, in centimetres around the LiDAR
  const zc = useRef<HTMLCanvasElement>(null), zbox = useRef<HTMLDivElement>(null);
  const [zsize, setZsize] = useState({ w: 600, h: 260 });
  useEffect(() => { const el = zbox.current; if (!el) return; const ro = new ResizeObserver(() => setZsize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const c = zc.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; c.width = zsize.w * dpr; c.height = zsize.h * dpr;
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.fillStyle = '#ffffff'; g.fillRect(0, 0, zsize.w, zsize.h);
    g.font = '600 13px -apple-system, sans-serif'; g.fillStyle = '#1d1d1f'; g.textAlign = 'left'; g.fillText('Zoomed offsets (cm)', 12, 20);
    if (!calc) { g.fillStyle = '#6e6e73'; g.font = '13px -apple-system, sans-serif'; g.fillText('Press Calculate to see how far off your numbers are.', 12, 48); return; }
    const E = calc.est, T = TRUTH;
    const span = Math.max(8, Math.ceil((Math.max(Math.abs(T.tx), Math.abs(E.tx), Math.abs(T.ty), Math.abs(E.ty), Math.abs(T.tz), Math.abs(E.tz)) * 100 + 4) / 5) * 5);
    const panel = (x0: number, title: string, hv: (e: Extrinsic) => [number, number], hl: string, vl: string) => {
      const w = (zsize.w - 36) / 2, h = zsize.h - 84, y0 = 52, S = Math.min(w, h) / (2 * span);
      const cx = x0 + w / 2, cy = y0 + h / 2, X = (v: number) => cx + v * 100 * S, Y = (v: number) => cy - v * 100 * S;
      g.fillStyle = '#fafafc'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#e1e1e6'; g.lineWidth = 1;
      for (let v = -span; v <= span; v += 5) { g.beginPath(); g.moveTo(cx + v * S, y0); g.lineTo(cx + v * S, y0 + h); g.moveTo(x0, cy + v * S); g.lineTo(x0 + w, cy + v * S); g.stroke(); }
      g.strokeStyle = '#b8b8c0'; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + h); g.moveTo(x0, cy); g.lineTo(x0 + w, cy); g.stroke();
      g.fillStyle = '#6e6e73'; g.font = '12px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText(title, cx, y0 + h + 16); g.fillText(`grid 5 cm · ${hl} →  ${vl} ↑`, cx, y0 + h + 30);
      const [tx, ty] = hv(T), [ex, ey] = hv(E);
      g.strokeStyle = '#ff2d55'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(tx), Y(ty)); g.lineTo(X(ex), Y(ey)); g.stroke();
      g.fillStyle = '#0a84ff'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
      g.fillStyle = '#ff9f0a'; g.fillRect(X(tx) - 6, Y(ty) - 6, 12, 12);
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.fillStyle = '#30d158'; g.beginPath(); g.arc(X(ex), Y(ey), 4.5, 0, 7); g.fill(); g.stroke();
    };
    // legend
    const legend: [string, string, string][] = [['#0a84ff', 'circle', 'LiDAR'], ['#ff9f0a', 'square', 'camera: true place'], ['#30d158', 'circle', 'camera: your estimate']];
    let lx = 12; g.font = '12px -apple-system, sans-serif'; g.textAlign = 'left';
    for (const [col2, shape, text] of legend) { g.fillStyle = col2; if (shape === 'square') g.fillRect(lx, 30, 10, 10); else { g.beginPath(); g.arc(lx + 5, 35, 5, 0, 7); g.fill(); } g.fillStyle = '#3a3a3c'; g.fillText(text, lx + 16, 39); lx += g.measureText(text).width + 36; }
    panel(12, 'Top view', (e) => [-e.ty, e.tx], 'right', 'forward');
    panel(24 + (zsize.w - 36) / 2, 'Side view', (e) => [e.tx, e.tz], 'forward', 'up');
  }, [zsize, calc]);

  const modelScale = 1.8;
  // no walls in the scene view: the sensors and objects are easier to see
  const WALLS = ['wall-red', 'wall-yellow', 'wall-blue', 'wall-left', 'wall-right', 'wall-back'];
  const camTrue = cameraPose(rig, TRUTH);
  const cloudHome: [number, number, number] = [rig.x - 2.2, rig.y - 5.2, rig.z + 3.2], cloudTarget: [number, number, number] = [rig.x + 4.2, rig.y, 0.6];
  const sceneHome: [number, number, number] = [rig.x + 1.3, rig.y - 3.0, rig.z + 1.2], sceneTarget: [number, number, number] = [rig.x + 0.4, rig.y, rig.z - 0.3];
  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="fusion-cloud" hideGrid hideAxes bgOverride="#ffffff" label={showCloud === 'colour' ? (updating ? 'Colouring…' : 'Coloured point cloud') : 'Point cloud before colouring'} labelPos="tl" labelTop={12} home={cloudHome} target={cloudTarget} threshold={0.05}>
          {plainCloud && <CloudLayer cloud={showCloud === 'colour' && withColours ? withColours : plainCloud} mode={showCloud === 'colour' && withColours ? 'rgb' : 'height'} size={Math.max(2, s.view.pointSize)} budget={Math.max(s.view.renderBudget, 200000)} pickable={false} />}
        </Viewport>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto 0.8fr', gap: 2, minHeight: 0 }}>
        <div style={{ position: 'relative' }}>
          <Viewport id="fusion-scene" hideGrid bgOverride="#ffffff" label="The scene with the two sensors" labelPos="tl" labelTop={12} home={sceneHome} target={sceneTarget} threshold={0.05}>
            <SceneLayer scene={scene} opacity={0.6} showCeiling={false} interactive={false} hide={WALLS} />
            <SensorMarker x={rig.x} y={rig.y} z={rig.z} yaw={rig.yaw} sensor={lidar} color="#0a84ff" showFov={false} scale={modelScale} />
            <PolyLine pts={[[rig.x, rig.y, rig.z], camTrue.pos]} color="#ff9f0a" width={3} dashed />
            <CameraModel pose={camTrue} color="#ff9f0a" scale={modelScale} />
            {img && <CameraModel pose={cameraPose(rig, est)} color="#30d158" opacity={0.55} scale={modelScale} />}
          </Viewport>
          <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 8, background: 'rgba(255,255,255,.92)', borderRadius: 10, padding: '3px 9px', fontSize: '0.75rem', boxShadow: '0 1px 6px rgba(0,0,0,.12)', pointerEvents: 'none', whiteSpace: 'nowrap' }} data-testid="sensor-legend">
            <span><b style={{ color: '#0a84ff' }}>●</b> LiDAR</span><span><b style={{ color: '#ff9f0a' }}>■</b> camera (real)</span><span><b style={{ color: '#30d158' }}>●</b> camera (yours)</span>
          </div>
        </div>
        <TransformCard e={est} />
        <div ref={zbox} style={{ position: 'relative', background: '#fff' }}><canvas ref={zc} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Zoomed offsets" data-testid="fusion-zoom" /></div>
      </div>
    </div>
  );

  const sl = (label: string, value: number, key: keyof Extrinsic, unit: string, min: number, max: number, step: number, scale = 1) => (
    <Slider label={label} value={value * scale} min={min} max={max} step={step} unit={unit} format={(v) => v.toFixed(1)} onChange={(v) => { setEst({ ...est, [key]: v / scale }); setCalc(null); }} />
  );
  const controls = (
    <>
      <Callout kind="edu" title="Giving a point cloud its colours">
        A LiDAR measures <b>where</b> things are; a camera sees <b>what colour</b> they are. To colour the points you must know how the two sensors sit relative to each other: this is the <b>calibration</b>, an offset (x, y, z) and a turn. A wrong offset puts colours on the wrong things: look at the edges of the red cube and the coloured wall panels.
      </Callout>
      <Section title="1 · The two sensors">
        <p className="hint">A camera is bolted to the LiDAR. <b style={{ color: '#ff9f0a' }}>Orange</b> is where the camera really is. <b style={{ color: '#1f9d3f' }}>Green</b> is where your numbers put it. The scene is a hall with coloured panels and objects so colour mistakes are easy to see.</p>
        <div className="btn-row">
          <Btn sm icon={<Play size={15} />} onClick={capture} busy={busy} testId="fusion-capture">Scan again</Btn>
        </div>
      </Section>
      <Section title="2 · Move the camera into place">
        <p className="hint">Estimate the offset of the camera from the LiDAR. The coloured cloud changes as you go.</p>
        {sl('Forward', est.tx, 'tx', ' cm', -30, 30, 0.5, 100)}
        {sl('Left', est.ty, 'ty', ' cm', -30, 30, 0.5, 100)}
        {sl('Up', est.tz, 'tz', ' cm', -30, 30, 0.5, 100)}
        {sl('Turn left (yaw)', est.yawDeg, 'yawDeg', '°', -10, 10, 0.1)}
        {sl('Tilt up (pitch)', est.pitchDeg, 'pitchDeg', '°', -10, 10, 0.1)}
        <table className="table" data-testid="fusion-stats"><tbody>
          <tr><td>Your offset</td><td className="mono">{(est.tx * 100).toFixed(1)}, {(est.ty * 100).toFixed(1)}, {(est.tz * 100).toFixed(1)} cm</td></tr>
          <tr><td>Error</td><td className="mono">{calc ? `${calc.total.toFixed(1)} cm · ${calc.deg.toFixed(1)}°` : 'press Calculate'}</td></tr>
          <tr><td>Colours right</td><td className="mono">{calc?.colours != null ? `${(calc.colours * 100).toFixed(0)} %` : '—'}</td></tr>
          <tr><td>Points coloured</td><td className="mono">{col && cloud ? `${col.count.toLocaleString()} of ${cloud.count.toLocaleString()}` : '—'}</td></tr>
        </tbody></table>
        <div className="btn-row">
          <Btn variant="primary" onClick={calculate} disabled={!cloud} testId="fusion-calculate">Calculate</Btn>
          <Btn sm onClick={() => { setEst(ZERO); setCalc(null); }}>Reset</Btn>
        </div>
      </Section>
      {calc && (
        <Section title="3 · How far off are you?">
          <table className="table" data-testid="fusion-errors"><tbody>
            <tr><td>Forward</td><td className="mono">{calc.dx >= 0 ? '+' : ''}{calc.dx.toFixed(1)} cm</td></tr>
            <tr><td>Left</td><td className="mono">{calc.dy >= 0 ? '+' : ''}{calc.dy.toFixed(1)} cm</td></tr>
            <tr><td>Up</td><td className="mono">{calc.dz >= 0 ? '+' : ''}{calc.dz.toFixed(1)} cm</td></tr>
            <tr><td>Turn</td><td className="mono">{calc.dyaw >= 0 ? '+' : ''}{calc.dyaw.toFixed(2)}°</td></tr>
            <tr><td>Tilt</td><td className="mono">{calc.dpitch >= 0 ? '+' : ''}{calc.dpitch.toFixed(2)}°</td></tr>
            <tr><td><b>Total</b></td><td className="mono"><b>{calc.total.toFixed(1)} cm · {calc.deg.toFixed(2)}°</b></td></tr>
          </tbody></table>
          <p className="hint">{calc.total < 1 && calc.deg < 0.5 ? 'Excellent: the colours now land on the right surfaces.' : 'A plus sign means your number is too big. Adjust the sliders and press Calculate again until the error is under 1 cm and 0.5°. The zoomed picture shows the gap.'}</p>
        </Section>
      )}
      <Section title="Or let the computer solve it">
        <p className="hint">Match points between the scan and the photo (corners and edges), then find the offset that makes all matches agree.</p>
        <div className="btn-row">
          <Btn sm onClick={findMatches} disabled={!img} testId="find-matches">Find matches</Btn>
          <Btn sm variant="primary" onClick={solve} disabled={!matches} testId="solve-calibration">Solve calibration</Btn>
        </div>
        {matches && <p className="hint">{matches.length} matches{rmsNow !== null ? `, average gap ${rmsNow.toFixed(1)} px` : ''}. {solved ? `Solved: the matches now agree to ${solved.rms.toFixed(2)} px. Press Calculate to see the real error.` : 'The gap is how far, in the photo, each matched point lands from where it should.'}</p>}
      </Section>
      <Section title="4 · Save it and use it">
        <div className="btn-row">
          <Btn variant="primary" onClick={() => { const c: SavedCalibration = { e: { ...est }, savedAt: Date.now(), errCm: calc?.total ?? Math.hypot(est.tx - TRUTH.tx, est.ty - TRUTH.ty, est.tz - TRUTH.tz) * 100, errDeg: calc?.deg ?? Math.hypot(est.yawDeg - TRUTH.yawDeg, est.pitchDeg - TRUTH.pitchDeg) }; saveCalibration(c); setSaved(c); s.notify('Calibration saved on this computer.', 'ok'); }} disabled={!cloud} testId="save-calibration">Save calibration</Btn>
          <Btn icon={<Download size={16} />} onClick={() => setMapOpen(true)} disabled={!saved} testId="open-mapping">Map with it</Btn>
        </div>
        <p className="hint">{saved ? `Saved: ${(saved.e.tx * 100).toFixed(1)}, ${(saved.e.ty * 100).toFixed(1)}, ${(saved.e.tz * 100).toFixed(1)} cm, turn ${saved.e.yawDeg.toFixed(1)}°, tilt ${saved.e.pitchDeg.toFixed(1)}° (${saved.errCm.toFixed(1)} cm, ${saved.errDeg.toFixed(1)}° off). “Map with it” opens a mobile mapping window that colours a whole walk with this calibration.` : 'Save your numbers to use them in the mobile mapping window.'}</p>
      </Section>
      <Section title="View">
        <div className="btn-row">
          <Btn sm variant={showCloud === 'colour' ? 'primary' : ''} onClick={() => setShowCloud('colour')}>Coloured</Btn>
          <Btn sm variant={showCloud === 'height' ? 'primary' : ''} onClick={() => setShowCloud('height')}>Points only</Btn>
        </div>
      </Section>
    </>
  );
  return (
    <>
      <TabFrame title="LiDAR + Camera Fusion" tab={8} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv hideViewControls />
      {mapOpen && saved && <FusionMapping calib={saved} onClose={() => setMapOpen(false)} />}
    </>
  );
}
