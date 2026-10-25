import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Seg, Section, Slider, Toggle, fmtN } from '../ui/controls';
import { SceneFromStore } from './common';
import { CloudLayer, Marker, PolyLine } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Crosshair, Dots, Play, Trash2 } from '../ui/icons';
import { getPreset, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { concatClouds, PointCloud, transformCloud } from '../core/pointcloud';
import { makeRng } from '../core/rng';
import { D2R, R2D, Rigid, rigidApply, rigidCompose, rigidFromEuler, rigidInverse, rotationAngle } from '../core/math';

type Method = 'point' | 'plane';
type View = 'truth' | 'before' | 'after';
interface Stn { x: number; y: number }
interface Scanned { local: PointCloud; truth: Rigid /* local → frame of station 1 */; world: Rigid /* local → world */ }
interface Reg { est: Rigid; errT: number; errDeg: number; ptErr: number; fitness: number; iters: number }

const COLOURS: [number, number, number][] = [[230, 57, 70], [29, 120, 220], [40, 170, 90], [244, 162, 30], [140, 80, 200], [0, 180, 190]];
const MAX_POINTS = 70000;

export default function TabTls() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const [stations, setStations] = useState<Stn[]>([]);
  const [tool, setTool] = useState(false);
  const [tripod, setTripod] = useState(1.5);
  const [step, setStep] = useState(0.5);
  const [scans, setScans] = useState<Scanned[] | null>(null);
  const initErr = { t: 0.5, deg: 5 }; // how wrong the rough first guess for each station is: a medium, realistic value
  const [method, setMethod] = useState<Method>('plane');
  const [maxDist, setMaxDist] = useState(1.5);
  const [regs, setRegs] = useState<Reg[] | null>(null);
  const [inits, setInits] = useState<Rigid[] | null>(null);
  const [view, setView] = useState<View>('truth');
  const [byStation, setByStation] = useState(true), [cov, setCov] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pointsOnly, setPointsOnly] = useState(false);
  const b = scene.bounds;

  // the Environment menu offers Room, Workshop and Street; this tab never uses the small street
  useEffect(() => {
    const prev = useLab.getState().sceneId;
    if (prev === 'C') useLab.getState().setScene('A');
    // leaving the tab: stop adding stations, and put the usual environment back if the city was picked here
    return () => { useLab.getState().patch({ interaction: 'select' }); if (useLab.getState().sceneId === 'D') useLab.getState().setScene(prev === 'D' ? 'C' : prev === 'C' ? 'C' : prev); };
  }, []);
  useEffect(() => { setStations([]); setScans(null); setRegs(null); setInits(null); setCov(null); }, [s.sceneId]);
  useEffect(() => { s.patch({ interaction: tool ? 'add-station' : 'select' }); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.pendingStation) { add(s.pendingStation[0], s.pendingStation[1]); s.patch({ pendingStation: null }); } }, [s.pendingStation]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearResults = () => { setScans(null); setRegs(null); setInits(null); setCov(null); };
  function add(x: number, y: number) { setStations((l) => (l.length >= 6 ? l : [...l, { x: +x.toFixed(2), y: +y.toFixed(2) }])); clearResults(); }

  const presets: { label: string; pts: Stn[] }[] = useMemo(() => {
    if (s.sceneId === 'D') return [{ label: 'Along the road (3)', pts: [{ x: -22, y: 0 }, { x: -6, y: 0 }, { x: 12, y: 0 }] }, { label: 'Around a block (4)', pts: [{ x: -14, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 24 }, { x: -14, y: 24 }] }];
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, w = (b.max[0] - b.min[0]) * 0.28, h = (b.max[1] - b.min[1]) * 0.28;
    return [{ label: 'In a line (3)', pts: [{ x: cx - w, y: cy }, { x: cx, y: cy }, { x: cx + w, y: cy }] }, { label: 'Four corners', pts: [{ x: cx - w, y: cy - h }, { x: cx + w, y: cy - h }, { x: cx + w, y: cy + h }, { x: cx - w, y: cy + h }] }];
  }, [s.sceneId, b]);

  const tlsSensor: SensorConfig = useMemo(() => ({ ...presetToConfig(getPreset('tls')), hRes: step, channels: Math.round(150 / step) }), [step]);
  const rays = Math.round(360 / step) * Math.round(150 / step);
  const pose = (st: Stn) => rigidFromEuler(st.x, st.y, tripod, 0, 0, 0);

  async function scanAll() {
    if (stations.length < 1) return;
    setBusy('scan'); setRegs(null); setInits(null); setCov(null);
    try {
      const out: Scanned[] = [];
      const T0 = pose(stations[0]), T0inv = rigidInverse(T0);
      for (let k = 0; k < stations.length; k++) {
        s.patch({ busy: `Scanning station ${k + 1} of ${stations.length}…` });
        const res = await runTask('scan', { scene, sensor: tlsSensor, trajectory: staticPose(stations[k].x, stations[k].y, tripod, 0), sweeps: 1, seed: 40 + k, maxRays: rays, distortion: false, scanId: k + 1, name: `Station ${k + 1}` });
        // the scanner records in its own frame: the origin is the scanner, and nobody tells us where it stood
        const Tk = pose(stations[k]), Tinv = rigidInverse(Tk);
        let c: PointCloud = res.cloud;
        if (c.count > MAX_POINTS) { const stride = Math.ceil(c.count / MAX_POINTS), ids: number[] = []; for (let i = 0; i < c.count; i += stride) ids.push(i); const p = new Float32Array(ids.length * 3); ids.forEach((j, q) => p.set(c.positions.subarray(j * 3, j * 3 + 3), q * 3)); c = { ...c, count: ids.length, positions: p, colors: undefined, intensity: undefined, ranges: undefined, labels: undefined, instances: undefined, normals: undefined, times: undefined, scanIds: undefined, tags: undefined } as PointCloud; }
        const local = transformCloud(c, Tinv, `Station ${k + 1}`);
        out.push({ local, truth: rigidCompose(T0inv, Tk), world: Tk });
      }
      setScans(out); setView('truth');
      // how much of the scene these scans see (their true positions are known)
      const cr = await runTask('coverage', { scene, clouds: out.map((q) => { const c = transformCloud(q.local, q.world); return { positions: c.positions, count: c.count }; }), radius: 0.15 });
      setCov((100 * cr.covered) / cr.total);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); s.patch({ busy: null }); }
  }

  /** What the operator would know: roughly where each scanner stood. */
  const makeInits = (sc: Scanned[]) => sc.map((q, k) => {
    if (k === 0) return q.truth;
    const r = makeRng(900 + k);
    return rigidCompose(q.truth, rigidFromEuler(initErr.t * r.gauss(), initErr.t * r.gauss(), initErr.t * 0.3 * r.gauss(), initErr.deg * D2R * r.gauss(), 0, 0));
  });

  async function register() {
    if (!scans) return;
    setBusy('register'); setView('before');
    try {
      const init = makeInits(scans); setInits(init);
      const est: Rigid[] = [init[0]], out: Reg[] = [{ est: init[0], errT: 0, errDeg: 0, ptErr: 0, fitness: 1, iters: 0 }];
      const placed: PointCloud[] = [transformCloud(scans[0].local, init[0])];
      for (let k = 1; k < scans.length; k++) {
        const ref = concatClouds(placed, 'ref');
        const r = await runTask('icp', { src: scans[k].local.positions, nSrc: scans[k].local.count, dst: ref.positions, nDst: ref.count, opts: { maxIterations: 60, tolerance: 1e-7, maxCorrDist: maxDist, sampleMax: 20000, init: init[k], method } });
        est.push(r.T); placed.push(transformCloud(scans[k].local, r.T));
        // compare with the truth: pose difference and the average distance between where a point is and where it should be
        const d = rigidCompose(rigidInverse(scans[k].truth), r.T);
        let pe = 0; const n = 400; for (let i = 0; i < n; i++) { const j = Math.floor((i / n) * scans[k].local.count), p: [number, number, number] = [scans[k].local.positions[j * 3], scans[k].local.positions[j * 3 + 1], scans[k].local.positions[j * 3 + 2]]; const a = rigidApply(r.T, p), t = rigidApply(scans[k].truth, p); pe += Math.hypot(a[0] - t[0], a[1] - t[1], a[2] - t[2]); }
        out.push({ est: r.T, errT: Math.hypot(...d.t), errDeg: rotationAngle(d.R) * R2D, ptErr: pe / n, fitness: r.fitness, iters: r.history.length });
      }
      setRegs(out); setView('after');
      const T0 = scans[0].world;
      const world = scans.map((q, k) => transformCloud(q.local, rigidCompose(T0, out[k].est)));
      const r = await runTask('coverage', { scene, clouds: world.map((c) => ({ positions: c.positions, count: c.count })), radius: 0.15 });
      setCov((100 * r.covered) / r.total);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(null); }
  }

  // clouds for the current view, placed in the world
  const placed = useMemo(() => {
    if (!scans) return [];
    const T0 = scans[0].world;
    return scans.map((q, k) => {
      const T = view === 'truth' ? q.world : view === 'before' ? (inits ? rigidCompose(T0, inits[k]) : q.world) : regs ? rigidCompose(T0, regs[k].est) : q.world;
      return transformCloud(q.local, T);
    });
  }, [scans, view, inits, regs]);
  const merged = useMemo(() => (placed.length ? concatClouds(placed, 'merged') : null), [placed]);

  const worst = regs ? Math.max(...regs.map((r) => r.ptErr)) : null;
  const stats = [
    { k: 'Stations', v: String(stations.length), s: scans ? `${fmtN(scans.reduce((a, q) => a + q.local.count, 0))} points scanned` : stations.length < 1 ? 'place a station' : 'ready to scan' },
    { k: 'Registration error', v: worst !== null ? `${(worst * 100).toFixed(1)} cm` : '—', s: worst !== null ? 'worst station, vs the true pose' : stations.length === 1 ? 'one station: nothing to register' : 'average point distance from where it should be' },
    { k: 'Scene covered', v: cov !== null ? `${cov.toFixed(0)} %` : '—', s: 'of the surfaces' },
  ];
  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} bgOverride={pointsOnly ? '#ffffff' : undefined} hideGrid={pointsOnly} hideAxes={pointsOnly}>
      {!pointsOnly && <SceneFromStore interactive={true} />}
      {!pointsOnly && stations.length > 1 && <PolyLine pts={stations.map((q) => [q.x, q.y, 0.05] as [number, number, number])} color="#ff9f0a" width={2} dashed />}
      {!pointsOnly && stations.map((q, i) => <Marker key={i} p={[q.x, q.y, tripod]} color={`rgb(${COLOURS[i % 6].join(',')})`} r={s.sceneId === 'D' ? 0.7 : 0.15} label={`Station ${i + 1}`} />)}
      {(!byStation || placed.length < 2) && merged && <CloudLayer cloud={merged} mode="height" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 400000)} pickable={false} />}
      {byStation && placed.length > 1 && placed.map((c, i) => <CloudLayer key={i} cloud={c} mode="flat" colorOpts={{ flat: COLOURS[i % 6] }} size={Math.max(2, s.view.pointSize - 1)} budget={200000} pickable={false} />)}
    </Viewport>
  );

  const controls = (
    <>
      <Callout kind="edu" title="Scanning from a tripod">
        A terrestrial scanner (TLS) stands still, scans in every direction, then is carried to the next <b>station</b>. Every scan is recorded in the scanner's <b>own frame</b>: it does not know where it stood. <b>Registration</b> works out how to fit the scans together. Here we also know the <b>true positions</b>, so you can see how close registration gets.
      </Callout>
      <Section title="1 · Place the stations">
        <div className="btn-row">
          <Btn sm variant={tool ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => setTool((v) => !v)} testId="add-stations-tool">{tool ? 'Click the scene or plan…' : 'Add stations'}</Btn>
          <Btn sm icon={<Trash2 size={15} />} onClick={() => { setStations([]); clearResults(); }} disabled={!stations.length}>Clear</Btn>
        </div>
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>{presets.map((p) => <Btn key={p.label} sm onClick={() => { setStations(p.pts); clearResults(); }} testId={`tls-preset-${p.pts.length}`}>{p.label}</Btn>)}</div>
        <Plan2D scene={scene} height={200} onClick={(x, y) => tool && add(x, y)} layers={{ paths: stations.length > 1 ? [{ pts: stations.map((q) => [q.x, q.y] as [number, number]), color: '#ff9f0a', dashed: true }] : [], markers: stations.map((q, i) => ({ x: q.x, y: q.y, color: `rgb(${COLOURS[i % 6].join(',')})`, label: String(i + 1), r: 6 })) }} />
        <p className="hint">One station is enough to get a point cloud. Add more to see the places the first one cannot see; up to 6. Keep neighbouring stations in sight of each other: the scans need to overlap to be registered.</p>
      </Section>
      <Section title="2 · Scan">
        <Seg value={String(step)} onChange={(v) => setStep(parseFloat(v))} label="Detail" options={[{ value: '0.7', label: 'Coarse' }, { value: '0.5', label: 'Medium' }, { value: '0.35', label: 'Fine' }]} />
        <Slider label="Tripod height" value={tripod} min={0.8} max={Math.max(1.8, b.max[2] - 0.3)} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => { setTripod(v); clearResults(); }} />
        <span className="caption">{fmtN(rays)} beams per station, 360° × 150° (Leica RTC360 style)</span>
        <Btn variant="primary" icon={<Play size={16} />} onClick={scanAll} busy={busy === 'scan'} disabled={stations.length < 1} testId="scan-stations">{stations.length === 1 ? 'Scan' : 'Scan all stations'}</Btn>
      </Section>
      {stations.length > 1 && (
      <Section title="3 · Register the scans">
        <p className="hint">Each scan sits in its own frame. We start from a rough guess of where each station stood (about 0.5 m and 5° off, like a sketch or a phone GPS) and let ICP fit the scans together.</p>
        <Seg value={method} onChange={setMethod} label="ICP type" options={[{ value: 'point', label: 'Point-to-point' }, { value: 'plane', label: 'Point-to-plane' }]} />
        <Slider label="Match distance" value={maxDist} min={0.2} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={setMaxDist} hint="ICP only pairs points closer than this." />
        <Btn variant="primary" onClick={register} busy={busy === 'register'} disabled={!scans || scans.length < 2} testId="register-tls">Register with ICP</Btn>
      </Section>
      )}
      {scans && scans.length > 1 && (
        <Section title="View">
          <Seg value={view} onChange={setView} options={[{ value: 'truth', label: 'True positions' }, { value: 'before', label: 'First guess' }, { value: 'after', label: 'Registered' }]} />
          <Toggle label="Colour each station" checked={byStation} onChange={setByStation} />
          <p className="hint">{view === 'truth' ? 'Where every scan really belongs (we know this because it is a simulation).' : view === 'before' ? 'Scans placed using your rough first guess: they do not fit yet.' : 'Scans placed by ICP.'}</p>
        </Section>
      )}
      {regs && (
        <Section title="4 · How close did it get?">
          <table className="table"><thead><tr><td>Station</td><td>Position error</td><td>Turn error</td><td>Overlap</td></tr></thead><tbody>
            {regs.map((r, i) => <tr key={i}><td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 6, background: `rgb(${COLOURS[i % 6].join(',')})` }} />{i + 1}{i === 0 ? ' (reference)' : ''}</td><td className="mono">{i === 0 ? '0' : (r.errT * 100).toFixed(1)} cm</td><td className="mono">{i === 0 ? '0' : r.errDeg.toFixed(2)}°</td><td className="mono">{i === 0 ? '—' : `${(r.fitness * 100).toFixed(0)} %`}</td></tr>)}
          </tbody></table>
          <p className="hint">Station 1 sets the frame. Try a larger first guess error or a short match distance and watch ICP get stuck.</p>
        </Section>
      )}
    </>
  );
  return <TabFrame title="TLS Scanning & Registration" tab={5} viewport={viewport} controls={controls} learn={null} noPanelTabs envIds={['A', 'B', 'D']} statsRow stats={stats}
    viewExtras={<>
      <Btn sm variant="primary" icon={<Play size={15} />} onClick={scanAll} busy={busy === 'scan'} disabled={stations.length < 1} testId="scan-toolbar">Scan</Btn>
      <Btn sm icon={<Dots size={15} />} variant={pointsOnly ? 'primary' : ''} onClick={() => setPointsOnly(!pointsOnly)} testId="points-only">{pointsOnly ? 'Show scene' : 'Point cloud'}</Btn>
    </>} />;
}
