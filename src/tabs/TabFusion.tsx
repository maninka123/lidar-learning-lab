import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { SceneFromStore } from './common';
import { CloudLayer, PolyLine, SensorMarker } from '../ui/three';
import { Play, Wand } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { PointCloud } from '../core/pointcloud';
import { renderView } from '../recon/recon';
import { makeRng } from '../core/rng';
import { turbo } from '../core/colorize';
import { Vec3 } from '../core/math';
import { Extrinsic, Image, cameraPose, colourise, project, reprojection, rmsPx, solveExtrinsic } from '../apps/fusion';

/** The real mounting of the camera on the LiDAR. The learner does not see these numbers; they measure and calibrate to find them. */
const TRUTH: Extrinsic = { tx: 0.14, ty: -0.09, tz: 0.11, yawDeg: 2.5, pitchDeg: -4 };
const NOISE = { tape: 0.015, angle: 1.0 };
const IMG_W = 320, IMG_H = 240, FOV = 62;
const ZERO: Extrinsic = { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 };
type Layer = 'points' | 'colour';
interface Match { X: Vec3; m: [number, number] }

export default function TabFusion() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const rig = useMemo(() => ({ x: scene.defaultPose.x, y: scene.defaultPose.y, z: scene.defaultPose.z, yaw: scene.defaultPose.yaw }), [scene]);
  const lidar: SensorConfig = useMemo(() => ({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.4, noise: 0.003 }), []);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [img, setImg] = useState<Image | null>(null);
  const [est, setEst] = useState<Extrinsic>(ZERO);
  const [readings, setReadings] = useState<Record<keyof Extrinsic, number[]>>({ tx: [], ty: [], tz: [], yawDeg: [], pitchDeg: [] });
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [solved, setSolved] = useState<{ e: Extrinsic; rms: number } | null>(null);
  const [layer, setLayer] = useState<Layer>('points');
  const [showDots, setShowDots] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCloud(null); setImg(null); setMatches(null); setSolved(null); setEst(ZERO); setReadings({ tx: [], ty: [], tz: [], yawDeg: [], pitchDeg: [] }); }, [scene]);

  async function capture() {
    setBusy(true);
    try {
      const res = await runTask('scan', { scene, sensor: lidar, trajectory: staticPose(rig.x, rig.y, rig.z, rig.yaw), sweeps: 1, seed: 21, maxRays: 90000, distortion: false, scanId: 1, name: 'LiDAR scan' });
      const cam = cameraPose(rig, TRUTH);
      const v = renderView(scene, { pos: cam.pos, target: [cam.pos[0] + cam.f[0], cam.pos[1] + cam.f[1], cam.pos[2] + cam.f[2]], fovDeg: FOV }, IMG_W, IMG_H);
      setCloud(res.cloud); setImg({ w: IMG_W, h: IMG_H, fovDeg: FOV, rgb: v.rgb, depth: v.depth, hitMask: v.hitMask }); setMatches(null); setSolved(null); setLayer('points');
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ---- 2 · measure with a tape and an angle finder: every reading is a little wrong, so take several
  const rng = useMemo(() => makeRng(77), []);
  const measure = (k: keyof Extrinsic) => {
    const sd = k === 'yawDeg' || k === 'pitchDeg' ? NOISE.angle : NOISE.tape;
    setReadings((r) => ({ ...r, [k]: [...r[k], +(TRUTH[k] + sd * rng.gauss()).toFixed(k === 'yawDeg' || k === 'pitchDeg' ? 1 : 3)] }));
  };
  const avg = (k: keyof Extrinsic) => (readings[k].length ? readings[k].reduce((a, v) => a + v, 0) / readings[k].length : null);
  const useMeasured = () => setEst({ tx: avg('tx') ?? est.tx, ty: avg('ty') ?? est.ty, tz: avg('tz') ?? est.tz, yawDeg: avg('yawDeg') ?? est.yawDeg, pitchDeg: avg('pitchDeg') ?? est.pitchDeg });

  // ---- 3 · matching: the same real-world point found in the scan and in the photo (a corner detector would do this)
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
      const sc = Math.abs(gray(k + 3) - gray(k - 3)) + Math.abs(gray(k + 3 * IMG_W) - gray(k - 3 * IMG_W)); // strong image corner/edge
      if (sc > 30) cand.push({ X, u: q.u, v: q.v, sc });
    }
    cand.sort((a, b) => b.sc - a.sc);
    const chosen: typeof cand = [];
    for (const c of cand) { if (chosen.length >= 24) break; if (chosen.every((o) => Math.hypot(o.u - c.u, o.v - c.v) > 14)) chosen.push(c); }
    if (chosen.length < 6) { s.notify('Not enough clear features in this view. Try another environment.', 'warn'); return; }
    setMatches(chosen.map((c) => ({ X: c.X, m: [c.u + 0.6 * r.gauss(), c.v + 0.6 * r.gauss()] as [number, number] })));
    setSolved(null);
  }
  function solve() {
    if (!matches) return;
    const r = solveExtrinsic(rig, matches.map((q) => q.X), matches.map((q) => q.m), est, IMG_W, IMG_H, FOV);
    setSolved(r); setEst(r.e);
  }

  const resNow = matches ? reprojection(rig, est, matches.map((q) => q.X), matches.map((q) => q.m), IMG_W, IMG_H, FOV) : null;
  const rmsNow = resNow ? rmsPx(resNow) : null;
  const errT = Math.hypot(est.tx - TRUTH.tx, est.ty - TRUTH.ty, est.tz - TRUTH.tz) * 100, errA = Math.hypot(est.yawDeg - TRUTH.yawDeg, est.pitchDeg - TRUTH.pitchDeg);

  const col = useMemo(() => (cloud && img ? colourise(cloud.positions, cloud.count, rig, est, img) : null), [cloud, img, est, rig]);
  const colTrue = useMemo(() => (cloud && img ? colourise(cloud.positions, cloud.count, rig, TRUTH, img) : null), [cloud, img, rig]);
  const accuracy = useMemo(() => {
    if (!col || !colTrue || !cloud) return null;
    let ok = 0, tot = 0;
    for (let i = 0; i < cloud.count; i++) if (colTrue.valid[i]) { tot++; const d = Math.max(Math.abs(col.colors[i * 3] - colTrue.colors[i * 3]), Math.abs(col.colors[i * 3 + 1] - colTrue.colors[i * 3 + 1]), Math.abs(col.colors[i * 3 + 2] - colTrue.colors[i * 3 + 2])); if (col.valid[i] && d < 30) ok++; }
    return tot ? ok / tot : null;
  }, [col, colTrue, cloud]);
  const coloured = useMemo<PointCloud | null>(() => (cloud && col ? { ...cloud, colors: col.colors } : null), [cloud, col]);

  // ---- 2D panel: photo with the LiDAR points drawn on it
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; c.width = size.w * dpr; c.height = size.h * dpr;
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, size.w, size.h);
    g.font = '600 13px -apple-system, sans-serif'; g.fillStyle = '#1d1d1f'; g.textAlign = 'left'; g.fillText('What the camera sees (with the LiDAR points drawn on it)', 12, 22);
    if (!img) { g.fillStyle = '#6e6e73'; g.fillText('Press “Take the scan and the photo”', 12, 48); return; }
    const k = Math.min((size.w - 24) / img.w, (size.h - 60) / img.h), ox = (size.w - k * img.w) / 2, oy = 38;
    const tmp = document.createElement('canvas'); tmp.width = img.w; tmp.height = img.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgb), img.w, img.h), 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(tmp, ox, oy, img.w * k, img.h * k);
    const P = (u: number, v: number): [number, number] => [ox + (u + 0.5) * k, oy + (v + 0.5) * k];
    if (showDots && cloud) {
      const cam = cameraPose(rig, est), stride = Math.max(1, Math.floor(cloud.count / 9000));
      for (let i = 0; i < cloud.count; i += stride) {
        const q = project(cam, [cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]], img.w, img.h, FOV); if (!q || q.u < 0 || q.v < 0 || q.u >= img.w || q.v >= img.h) continue;
        const t = turbo(Math.min(1, q.z / 8)); g.fillStyle = `rgba(${t[0]},${t[1]},${t[2]},.9)`; const [px, py] = P(q.u, q.v); g.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
      }
    }
    if (matches) {
      const cam = cameraPose(rig, est);
      matches.forEach((mt) => {
        const q = project(cam, mt.X, img.w, img.h, FOV), [mx, my] = P(mt.m[0], mt.m[1]);
        if (q) { const [px, py] = P(q.u, q.v); g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(px, py); g.lineTo(mx, my); g.stroke(); g.strokeStyle = '#ff2d9b'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(px, py); g.lineTo(mx, my); g.stroke(); g.fillStyle = '#00d1ff'; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
        g.strokeStyle = '#ff2d9b'; g.lineWidth = 2; g.beginPath(); g.moveTo(mx - 5, my); g.lineTo(mx + 5, my); g.moveTo(mx, my - 5); g.lineTo(mx, my + 5); g.stroke();
      });
    }
  }, [size, img, cloud, est, matches, showDots, rig]);

  // ---- 3D
  const frustum = (e: Extrinsic, color: string, dashed = false) => {
    const c = cameraPose(rig, e), t = Math.tan((FOV * Math.PI) / 360), a = IMG_W / IMG_H, L = 1.4, pts = ([[-1, 1], [1, 1], [1, -1], [-1, -1]] as [number, number][]).map(([x, y]) => [c.pos[0] + (c.f[0] + x * t * a * c.r[0] + y * t * c.u[0]) * L, c.pos[1] + (c.f[1] + x * t * a * c.r[1] + y * t * c.u[1]) * L, c.pos[2] + (c.f[2] + x * t * a * c.r[2] + y * t * c.u[2]) * L] as Vec3);
    return <>{pts.map((p, i) => <PolyLine key={i} pts={[c.pos, p]} color={color} width={2} dashed={dashed} />)}<PolyLine pts={[...pts, pts[0]]} color={color} width={2} dashed={dashed} /></>;
  };
  const camTrue = cameraPose(rig, TRUTH);
  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="fusion-3d" hideGrid bgOverride="#ffffff" label="Two sensors on one mount" labelPos="tl" home={[rig.x - 2.2, rig.y - 3.4, rig.z + 1.6]} target={[rig.x + 2.2, rig.y, rig.z - 0.3]} threshold={0.05}>
          <SceneFromStore interactive={false} />
          <SensorMarker x={rig.x} y={rig.y} z={rig.z} yaw={rig.yaw} sensor={lidar} label="LiDAR" color="#0a84ff" showFov={false} scale={s.sceneId === 'C' ? 2.2 : 1} />
          <PolyLine pts={[camTrue.pos, [camTrue.pos[0] + 0.001, camTrue.pos[1], camTrue.pos[2] + 0.001]]} color="#ff9f0a" />
          {frustum(TRUTH, '#ff9f0a')}
          {img && frustum(est, '#30d158', true)}
          {cloud && <CloudLayer cloud={layer === 'colour' && coloured ? coloured : cloud} mode={layer === 'colour' && coloured ? 'rgb' : 'height'} size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} />}
        </Viewport>
      </div>
      <div ref={box} style={{ position: 'relative', background: '#f5f5f7' }}><canvas ref={cv} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Camera image with LiDAR points" data-testid="fusion-image" /></div>
    </div>
  );

  const stats = [
    { k: 'Match error', v: rmsNow !== null ? `${rmsNow.toFixed(1)} px` : '—', s: matches ? 'average gap between each pair of matched points' : 'find matches first' },
    { k: 'Offset error', v: img ? `${errT.toFixed(1)} cm · ${errA.toFixed(1)}°` : '—', s: 'vs the true mount (simulation only)' },
    { k: 'Colours right', v: accuracy !== null ? `${(accuracy * 100).toFixed(0)} %` : '—', s: col && cloud ? `${fmtN(col.count)} of ${fmtN(cloud.count)} points coloured` : undefined },
  ];
  const num = (v: number, d = 2) => v.toFixed(d);
  const controls = (
    <>
      <Callout kind="edu" title="Giving a point cloud its colours">
        A LiDAR measures <b>where</b> things are; a camera sees <b>what colour</b> they are. To combine them you must know exactly how the two sensors sit relative to each other: this is the <b>calibration</b> (an offset in x, y, z and a turn). Then every LiDAR point is moved into the camera's view and takes the colour of the pixel it lands on.
      </Callout>
      <Section title="1 · The two sensors">
        <p className="hint">A camera is bolted to the LiDAR. The <b style={{ color: '#ff9f0a' }}>orange</b> pyramid is where the camera really is and what it sees. You get two outputs: a point cloud and a photo.</p>
        <Btn variant="primary" icon={<Play size={16} />} onClick={capture} busy={busy} testId="fusion-capture">Take the scan and the photo</Btn>
      </Section>
      <Section title="2 · Measure the offset yourself">
        <p className="hint">Pretend you are at the sensor with a tape and an angle finder. Every reading is slightly wrong, so measure several times and average, as a surveyor would.</p>
        <table className="table"><thead><tr><td>Measure</td><td>Readings</td><td>Average</td><td /></tr></thead><tbody>
          {([['tx', 'Camera forward of the LiDAR', 'm'], ['ty', 'Camera to the left', 'm'], ['tz', 'Camera above', 'm'], ['yawDeg', 'Camera turned left', '°'], ['pitchDeg', 'Camera tilted up', '°']] as [keyof Extrinsic, string, string][]).map(([k, label, u]) => (
            <tr key={k}><td>{label}</td><td className="mono">{readings[k].length}</td><td className="mono">{avg(k) === null ? '—' : `${num(avg(k)!, u === 'm' ? 3 : 1)} ${u}`}</td><td><Btn sm onClick={() => measure(k)} testId={`measure-${k}`}>{u === 'm' ? 'Tape' : 'Angle'}</Btn></td></tr>
          ))}
        </tbody></table>
        <div className="btn-row">
          <Btn sm icon={<Wand size={15} />} onClick={() => { (['tx', 'ty', 'tz', 'yawDeg', 'pitchDeg'] as (keyof Extrinsic)[]).forEach((k) => { for (let i = 0; i < 3; i++) measure(k); }); }}>Measure everything 3×</Btn>
          <Btn sm variant="primary" onClick={useMeasured} disabled={!readings.tx.length && !readings.yawDeg.length} testId="use-measured">Use my measurements</Btn>
        </div>
      </Section>
      <Section title="3 · Fine-tune by eye">
        <Slider label="Forward" value={est.tx} min={-0.5} max={0.5} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(tx) => setEst({ ...est, tx })} />
        <Slider label="Left" value={est.ty} min={-0.5} max={0.5} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(ty) => setEst({ ...est, ty })} />
        <Slider label="Up" value={est.tz} min={-0.5} max={0.5} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(tz) => setEst({ ...est, tz })} />
        <Slider label="Turn left (yaw)" value={est.yawDeg} min={-15} max={15} step={0.1} unit="°" format={(v) => v.toFixed(1)} onChange={(yawDeg) => setEst({ ...est, yawDeg })} />
        <Slider label="Tilt up (pitch)" value={est.pitchDeg} min={-15} max={15} step={0.1} unit="°" format={(v) => v.toFixed(1)} onChange={(pitchDeg) => setEst({ ...est, pitchDeg })} />
        <p className="hint">Look at the photo: the coloured dots are LiDAR points projected with your numbers. They should sit exactly on the edges of the objects. A few centimetres or degrees is enough to smear them.</p>
        <Toggle label="Show the LiDAR points on the photo" checked={showDots} onChange={setShowDots} />
      </Section>
      <Section title="4 · Match points, then solve">
        <p className="hint">Find the same real-world spots (corners, edges) in the scan and in the photo. For each pair, your numbers predict where the LiDAR point lands in the photo (<b style={{ color: '#00a6d6' }}>blue dot</b>) and the photo shows where it really is (<b style={{ color: '#ff2d9b' }}>pink cross</b>). The line between them is the error.</p>
        <div className="btn-row">
          <Btn onClick={findMatches} disabled={!img} testId="find-matches">Find matches</Btn>
          <Btn variant="primary" onClick={solve} disabled={!matches} testId="solve-calibration">Solve calibration</Btn>
        </div>
        {matches && <p className="hint">{matches.length} matches. {solved ? `Solved: the matches now agree to ${solved.rms.toFixed(2)} px. The true mount was ${num(TRUTH.tx * 100, 0)} cm forward, ${num(-TRUTH.ty * 100, 0)} cm right, ${num(TRUTH.tz * 100, 0)} cm up, turned ${TRUTH.yawDeg}° and tilted ${TRUTH.pitchDeg}°.` : 'Move the sliders to shrink the lines, or press Solve to let the computer find the offset that makes them smallest.'}</p>}
      </Section>
      <Section title="5 · Colour the point cloud">
        <Seg value={layer} onChange={setLayer} options={[{ value: 'points', label: 'Points only' }, { value: 'colour', label: 'Coloured' }]} />
        <p className="hint">{layer === 'colour' ? 'Each point takes the colour of the pixel it lands on with your calibration. Grey points are not seen by the camera (outside its view, or hidden behind something). Try a bad calibration and see colours slide onto the wrong objects.' : 'Switch to “Coloured” to apply your calibration.'}</p>
      </Section>
    </>
  );
  return <TabFrame title="LiDAR + Camera Fusion" tab={7} viewport={viewport} controls={controls} learn={null} noPanelTabs statsRow stats={stats} hideViewControls />;
}
