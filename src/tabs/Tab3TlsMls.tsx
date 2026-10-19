import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab, pushUndo, Station } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Seg, Section, Select, Slider, Toggle, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, CloudFromStore } from './common';
import { SensorMarker, PolyLine, Marker, CloudLayer } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Crosshair, Pause, Play, Plus, Trash2, Route as RouteIcon } from '../ui/icons';
import { PRESETS, getPreset, presetToConfig, SensorConfig, pointsPerSecond } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose, PoseSample } from '../sensor/simulate';
import { concatClouds, selectPoints, PointCloud, transformCloud } from '../core/pointcloud';
import { makeRng } from '../core/rng';
import { D2R, Rigid, eulerToR, Vec3, rigidApply } from '../core/math';
import { CoverageInfo } from '../state/store';
import { colorize } from '../core/colorize';

type Mode = 'tls' | 'mls' | 'compare';

async function coverageOf(clouds: PointCloud[], radius: number) {
  const s = useLab.getState();
  const r = await runTask('coverage', { scene: getScene(s.sceneId), clouds: clouds.map((c) => ({ positions: c.positions, count: c.count })), radius, });
  const missing: number[] = [], overlap: number[] = [];
  for (let i = 0; i < r.samples.count; i++) {
    const p = [r.samples.pos[i * 3], r.samples.pos[i * 3 + 1], r.samples.pos[i * 3 + 2]];
    if (!r.union[i]) missing.push(...p); else if (r.times[i] > 1) overlap.push(...p);
  }
  const info: CoverageInfo & { overlapPositions: Float32Array; unobservedArea: number } = {
    total: r.total, covered: r.covered, coveredPct: (100 * r.covered) / r.total, area: r.area, coveredArea: r.coveredArea, overlapPct: (100 * r.overlap) / Math.max(1, r.covered),
    missingPositions: Float32Array.from(missing), overlapPositions: Float32Array.from(overlap), unobservedArea: r.area - r.coveredArea,
  };
  return { info, perStation: r.perStation };
}

function applyError(c: PointCloud, center: Vec3, err: Rigid): PointCloud {
  const out = transformCloud(c, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });
  for (let i = 0; i < out.count; i++) {
    const q = rigidApply({ R: err.R, t: [0, 0, 0] }, [c.positions[i * 3] - center[0], c.positions[i * 3 + 1] - center[1], c.positions[i * 3 + 2] - center[2]]);
    out.positions[i * 3] = q[0] + center[0] + err.t[0]; out.positions[i * 3 + 1] = q[1] + center[1] + err.t[1]; out.positions[i * 3 + 2] = q[2] + center[2] + err.t[2];
  }
  return out;
}

function buildTrajectory(wps: [number, number][], speed: number, z: number): { traj: PoseSample[]; duration: number; length: number } {
  const traj: PoseSample[] = [];
  let t = 0, len = 0;
  const yawOf = (i: number) => { const a = wps[Math.min(i, wps.length - 2)], b = wps[Math.min(i + 1, wps.length - 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  wps.forEach((w, i) => {
    if (i > 0) { const d = Math.hypot(w[0] - wps[i - 1][0], w[1] - wps[i - 1][1]); len += d; t += d / speed; }
    traj.push({ t, x: w[0], y: w[1], z, yaw: yawOf(i), pitch: 0, roll: 0 });
  });
  return { traj, duration: t, length: len };
}

export default function Tab3() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const [mode, setMode] = useState<Mode>('tls');
  const [tlsId, setTlsId] = useState('tls');
  const [tlsRes, setTlsRes] = useState(0.5);
  const [tripod, setTripod] = useState(1.5);
  const [mlsId, setMlsId] = useState('rot32');
  const [tool, setTool] = useState<'station' | 'waypoint' | null>(null);
  const [missingOn, setMissingOn] = useState(true);
  const [overlapOn, setOverlapOn] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [stationYaw, setStationYaw] = useState(0);
  const [cov, setCov] = useState<ReturnType<typeof Object> | null>(null);
  const covInfo = (cov as unknown as { info: CoverageInfo & { overlapPositions: Float32Array; unobservedArea: number }; perStation: number[] } | null);
  const [mlsCov, setMlsCov] = useState<(CoverageInfo & { unobservedArea: number }) | null>(null);
  const b = scene.bounds;

  const tlsSensor: SensorConfig = useMemo(() => ({ ...presetToConfig(getPreset(tlsId)), hRes: tlsRes, channels: Math.round(120 / (tlsRes * 3.2)) }), [tlsId, tlsRes]);
  const mlsSensor: SensorConfig = useMemo(() => presetToConfig(getPreset(mlsId)), [mlsId]);

  // Tool clicks (3D scene or plan) arrive through the shared interaction state
  useEffect(() => {
    if (s.pendingStation) { void addStation(s.pendingStation[0], s.pendingStation[1]); s.patch({ pendingStation: null }); }
  }, [s.pendingStation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { s.patch({ interaction: tool === 'station' ? 'add-station' : tool === 'waypoint' ? 'add-waypoint' : 'select' }); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshTls = async (stations: Station[]) => {
    const merged = stations.length ? concatClouds(stations.map((st) => st.cloud), 'TLS merged scans', { kind: 'simulated' }) : null;
    useLab.getState().setCloud('tls', merged, !!merged);
    if (!stations.length) { setCov(null); useLab.setState({ tlsCoverage: null }); return; }
    const r = await coverageOf(stations.map((st) => st.cloud), 0.12);
    setCov(r as never);
    useLab.setState({ tlsCoverage: r.info });
  };

  async function addStation(x: number, y: number) {
    const st = useLab.getState();
    if (st.busy) return;
    const id = st.stations.length + 1;
    st.patch({ busy: `Scanning station ${id}…` });
    try {
      const res = await runTask('scan', { scene: getScene(st.sceneId), sensor: tlsSensor, trajectory: staticPose(x, y, tripod, stationYaw * D2R), sweeps: 1, seed: st.scanOpts.seed + id, maxRays: 120000, distortion: false, scanId: id, name: `Station ${id}` });
      const rng = makeRng(1000 + id);
      const e = st.stationRegErr;
      const err: Rigid = { R: eulerToR(e.deg * D2R * rng.gauss(), e.deg * D2R * rng.gauss() * 0.3, 0), t: [e.t * rng.gauss(), e.t * rng.gauss(), e.t * rng.gauss() * 0.3] };
      const cloud = e.t > 0 || e.deg > 0 ? applyError(res.cloud, [x, y, tripod], err) : res.cloud;
      cloud.name = `Station ${id}`;
      const station: Station = { id, pose: { x, y, z: tripod, yaw: stationYaw * D2R, pitch: 0 }, cloud, trueCloud: res.cloud, err: { t: Math.hypot(...err.t), deg: e.deg } };
      const stations = [...useLab.getState().stations, station];
      useLab.setState({ stations });
      pushUndo(`station ${id}`, () => { const ss = useLab.getState().stations.slice(0, -1); useLab.setState({ stations: ss }); void refreshTls(ss); });
      await refreshTls(stations);
    } catch (err) { useLab.getState().notify((err as Error).message, 'error'); }
    finally { useLab.getState().patch({ busy: null }); }
  }

  async function registerStations() {
    const st = useLab.getState();
    if (st.stations.length < 2) return;
    st.patch({ busy: 'Registering stations with ICP…' });
    const out: Station[] = [st.stations[0]];
    for (let k = 1; k < st.stations.length; k++) {
      const ref = concatClouds(out.map((q) => q.cloud), 'ref');
      const cur = st.stations[k];
      const r = await runTask('icp', { src: cur.cloud.positions, nSrc: cur.cloud.count, dst: ref.positions, nDst: ref.count, opts: { maxIterations: 60, tolerance: 1e-6, maxCorrDist: 0.8, sampleMax: 3000 } });
      const cloud = transformCloud(cur.cloud, r.T, cur.cloud.name);
      let d = 0; const n = Math.min(cloud.count, 400);
      for (let i = 0; i < n; i++) { const j = Math.floor((i / n) * cloud.count); d += Math.hypot(cloud.positions[j * 3] - cur.trueCloud.positions[j * 3], cloud.positions[j * 3 + 1] - cur.trueCloud.positions[j * 3 + 1], cloud.positions[j * 3 + 2] - cur.trueCloud.positions[j * 3 + 2]); }
      out.push({ ...cur, cloud, err: { t: d / n, deg: 0 } });
    }
    useLab.setState({ stations: out });
    await refreshTls(out);
    useLab.getState().patch({ busy: null });
    useLab.getState().notify('Stations registered with ICP.', 'ok');
  }

  const [mlsBusy, setMlsBusy] = useState(false);
  async function runMls() {
    const st = useLab.getState();
    if (st.waypoints.length < 2) { st.notify('Add at least two waypoints.', 'warn'); return; }
    setMlsBusy(true);
    try {
      const { traj, duration, length } = buildTrajectory(st.waypoints, st.mlsOpts.speed, st.mlsOpts.height);
      const sweeps = Math.max(1, Math.ceil(duration * mlsSensor.frequency));
      const res = await runTask('scan', { scene: getScene(st.sceneId), sensor: mlsSensor, trajectory: traj, sweeps, seed: st.scanOpts.seed + 77, maxRays: 220000, distortion: st.mlsOpts.distortion, scanId: 0, name: 'MLS accumulated scan' });
      const cloud = res.cloud;
      cloud.meta = { ...cloud.meta, description: `Moving sensor along ${st.waypoints.length} waypoints at ${st.mlsOpts.speed} m/s; sweep poses applied per point${st.mlsOpts.distortion ? ' (distortion mode: one pose per sweep)' : ''}.` };
      useLab.setState({ mls: { cloud, coverage: null, sceneId: st.sceneId, seconds: duration, length } });
      useLab.getState().setCloud('mls', cloud);
      if (res.stats.reduced) useLab.getState().notify(`Point budget reached: angular step thinned to ${res.stats.effectiveHRes.toFixed(2)}°.`, 'warn');
      const r = await coverageOf([cloud], 0.12);
      setMlsCov({ ...r.info, unobservedArea: r.info.unobservedArea });
      useLab.setState({ mls: { cloud, coverage: r.info, sceneId: st.sceneId, seconds: duration, length } });
    } catch (e) { useLab.getState().notify((e as Error).message, 'error'); }
    finally { setMlsBusy(false); }
  }

  // MLS playback
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000; last = t;
      const cur = useLab.getState().mlsAnim < 0 ? 0 : useLab.getState().mlsAnim;
      const nv = cur + dt / 8;
      if (nv >= 1) { useLab.setState({ mlsAnim: 1 }); setPlaying(false); return; }
      useLab.setState({ mlsAnim: nv });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  const traj = useMemo(() => (s.waypoints.length > 1 ? buildTrajectory(s.waypoints, s.mlsOpts.speed, s.mlsOpts.height) : null), [s.waypoints, s.mlsOpts.speed, s.mlsOpts.height]);
  const platformAt = useMemo(() => {
    if (!traj || s.mlsAnim < 0) return null;
    const t = s.mlsAnim * traj.duration;
    let i = 0;
    while (i < traj.traj.length - 2 && traj.traj[i + 1].t < t) i++;
    const a = traj.traj[i], bb = traj.traj[i + 1];
    const f = Math.min(1, Math.max(0, (t - a.t) / (bb.t - a.t || 1)));
    return { x: a.x + (bb.x - a.x) * f, y: a.y + (bb.y - a.y) * f, z: a.z, yaw: a.yaw, t };
  }, [traj, s.mlsAnim]);
  const mlsShown = useMemo(() => {
    const c = s.mls?.cloud;
    if (!c) return null;
    if (!playing && s.mlsAnim < 0) return c;
    if (!c.times || !platformAt) return c;
    const q = Math.round(s.mlsAnim * 40) / 40, T = q * (traj?.duration ?? 0) + 1e-3;
    const idx: number[] = [];
    for (let i = 0; i < c.count; i++) if (c.times[i] <= T) idx.push(i);
    return selectPoints(c, idx, c.name);
  }, [s.mls, Math.round(s.mlsAnim * 40), playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = s.clouds['tls'];
  const wpPts: Vec3[] = s.waypoints.map(([x, y]) => [x, y, s.mlsOpts.height]);

  const missingCloud = useMemo(() => {
    const c = covInfo?.info.missingPositions;
    return c && c.length ? ({ id: 'missing', name: 'missing', count: c.length / 3, positions: c, meta: { kind: 'estimated', source: 'coverage', units: 'm' } } as PointCloud) : null;
  }, [covInfo]);
  const overlapCloud = useMemo(() => {
    const c = covInfo?.info.overlapPositions;
    return c && c.length ? ({ id: 'overlap', name: 'overlap', count: c.length / 3, positions: c, meta: { kind: 'estimated', source: 'coverage', units: 'm' } } as PointCloud) : null;
  }, [covInfo]);

  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget}>
      <SceneFromStore />
      {mode !== 'mls' && merged && <CloudFromStore cloud={merged} mode={s.view.colorMode === 'height' ? 'scan' : s.view.colorMode} pickable={false} />}
      {mode === 'mls' && mlsShown && <CloudFromStore cloud={mlsShown} pickable={false} />}
      {mode === 'compare' && s.mls && <CloudFromStore cloud={s.mls.cloud} mode="flat" colorOpts={{ flat: [255, 159, 10] }} pickable={false} />}
      {mode !== 'mls' && missingOn && missingCloud && <CloudLayer cloud={missingCloud} mode="flat" colorOpts={{ flat: [255, 69, 58] }} size={4} budget={40000} pickable={false} />}
      {mode !== 'mls' && overlapOn && overlapCloud && <CloudLayer cloud={overlapCloud} mode="flat" colorOpts={{ flat: [48, 209, 88] }} size={3} budget={20000} pickable={false} />}
      {s.stations.map((st) => <SensorMarker key={st.id} x={st.pose.x} y={st.pose.y} z={st.pose.z} yaw={st.pose.yaw} sensor={tlsSensor} label={`Station ${st.id}`} showFov={false} color="#0a84ff" />)}
      {(mode === 'mls' || mode === 'compare') && <PolyLine pts={wpPts} color="#ff9f0a" width={3} />}
      {(mode === 'mls' || mode === 'compare') && wpPts.map((p, i) => <Marker key={i} p={p} color="#ff9f0a" r={0.07} label={`${i + 1}`} />)}
      {mode === 'mls' && platformAt && <SensorMarker x={platformAt.x} y={platformAt.y} z={platformAt.z} yaw={platformAt.yaw} sensor={mlsSensor} color="#30d158" label="Platform" />}
    </Viewport>
  );

  const plan = (
    <Plan2D scene={scene} height={250}
      layers={{
        points: mode === 'mls' && s.mls ? [{ pos: s.mls.cloud.positions, count: s.mls.cloud.count, color: '#64d2ff' }] : merged ? [{ pos: merged.positions, count: merged.count, color: '#64d2ff' }] : [],
        paths: mode !== 'tls' ? [{ pts: s.waypoints, color: '#ff9f0a', width: 2.5 }] : [],
        markers: [...s.stations.map((st) => ({ x: st.pose.x, y: st.pose.y, color: '#0a84ff', label: `S${st.id}`, r: 6 })), ...(mode !== 'tls' ? s.waypoints.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: String(i + 1), r: 4 })) : [])],
      }}
      onClick={(x, y) => {
        if (tool === 'station') void addStation(x, y);
        else if (tool === 'waypoint') { s.patch({ waypoints: [...s.waypoints, [x, y]] }); pushUndo('add waypoint', () => useLab.setState({ waypoints: useLab.getState().waypoints.slice(0, -1) })); }
      }} />
  );

  const loopWps = (): [number, number][] => { const hx = (b.max[0] - b.min[0]) * 0.34, hy = (b.max[1] - b.min[1]) * 0.3, cx = (b.max[0] + b.min[0]) / 2, cy = (b.max[1] + b.min[1]) / 2; return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy], [cx - hx, cy - hy]]; };
  const zigWps = (): [number, number][] => { const hx = (b.max[0] - b.min[0]) * 0.36, hy = (b.max[1] - b.min[1]) * 0.3, cx = (b.max[0] + b.min[0]) / 2, cy = (b.max[1] + b.min[1]) / 2; return [[cx - hx, cy - hy], [cx + hx, cy - hy * 0.4], [cx - hx, cy + hy * 0.2], [cx + hx, cy + hy]]; };

  const tlsStats = covInfo?.info;
  const stats = mode === 'mls'
    ? [
      { k: 'MLS points', v: s.mls ? fmtN(s.mls.cloud.count) : '—', s: s.mls ? `${s.mls.seconds.toFixed(1)} s · ${s.mls.length.toFixed(1)} m path` : undefined },
      { k: 'Coverage', v: mlsCov ? `${mlsCov.coveredPct.toFixed(1)} %` : '—' },
      { k: 'Waypoints', v: s.waypoints.length, s: traj ? `${traj.duration.toFixed(1)} s at ${s.mlsOpts.speed} m/s` : undefined },
      { k: 'Distortion', v: s.mlsOpts.distortion ? 'ON (1 pose/sweep)' : 'off', s: 'per-point poses when off' },
    ]
    : [
      { k: 'Stations', v: s.stations.length, s: merged ? `${fmtN(merged.count)} points merged` : undefined },
      { k: 'Coverage', v: tlsStats ? `${tlsStats.coveredPct.toFixed(1)} %` : '—', s: tlsStats ? `${tlsStats.unobservedArea.toFixed(1)} m² unobserved` : undefined },
      { k: 'Overlap', v: tlsStats ? `${(tlsStats.overlapPct ?? 0).toFixed(0)} %` : '—', s: 'of covered area seen ≥ 2×' },
      { k: 'Reg. error', v: s.stations.length ? `${(Math.max(...s.stations.map((q) => q.err.t)) * 100).toFixed(1)} cm` : '—', s: 'worst station' },
    ];

  const controls = (
    <>
      <Seg value={mode} onChange={(m) => { setMode(m); setTool(null); }} options={[{ value: 'tls', label: 'Static (TLS)' }, { value: 'mls', label: 'Moving (MLS)' }, { value: 'compare', label: 'Compare' }]} label="Mode" />
      <Callout kind="edu" title="Deployment vs sensing">TLS and MLS are <b>deployment methods</b> (tripod vs moving platform). Mechanical, MEMS, flash and rotating-mirror describe the <b>sensing architecture</b> inside the scanner.</Callout>
      <Section title="Floor plan">{plan}</Section>

      {mode === 'tls' && (
        <>
          <Section title="Scanner on tripod">
            <Select label="Scanner" value={tlsId} options={['tls', 'rot64', 'vlp16'].map((id) => ({ value: id, label: getPreset(id).name }))} onChange={setTlsId} />
            <Slider label="Angular step" value={tlsRes} min={0.2} max={2} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={setTlsRes} hint={`${fmtN(Math.round(360 / tlsRes) * tlsSensor.channels)} rays per station (budget 120 000)`} />
            <Slider label="Tripod height" value={tripod} min={0.5} max={Math.max(1.6, b.max[2] - 0.3)} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={setTripod} />
            <Slider label="Station heading" value={stationYaw} min={-180} max={180} step={5} unit="°" onChange={setStationYaw} />
            <div className="btn-row">
              <Btn variant={tool === 'station' ? 'primary' : ''} icon={<Crosshair size={16} />} onClick={() => setTool(tool === 'station' ? null : 'station')} testId="tool-station">{tool === 'station' ? 'Click the plan or scene…' : 'Place station by clicking'}</Btn>
              <Btn icon={<Plus size={16} />} onClick={() => addStation(s.pose.x, s.pose.y)} busy={!!s.busy} testId="add-station-here">Scan at scanner pose</Btn>
            </div>
            <span className="caption">The scanner pose is the one set in Tab 1 ({s.pose.x.toFixed(1)}, {s.pose.y.toFixed(1)}).</span>
          </Section>
          <Section title="Registration quality">
            <Slider label="Pose error per station (translation)" value={s.stationRegErr.t} min={0} max={0.3} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(t) => s.patch({ stationRegErr: { ...s.stationRegErr, t } })} />
            <Slider label="Pose error per station (rotation)" value={s.stationRegErr.deg} min={0} max={3} step={0.1} unit="°" format={(v) => v.toFixed(1)} onChange={(deg) => s.patch({ stationRegErr: { ...s.stationRegErr, deg } })} hint="Applies to the next stations. With 0 the merged cloud is perfectly registered." />
            <Btn onClick={registerStations} disabled={s.stations.length < 2 || !!s.busy} testId="register-stations">Register stations with ICP</Btn>
          </Section>
          <Section title="Stations">
            {s.stations.length === 0 && <p className="hint">No stations yet. Place two or three so that their views overlap.</p>}
            {s.stations.map((st) => (
              <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>Station {st.id} <span className="caption">({st.pose.x.toFixed(1)}, {st.pose.y.toFixed(1)}) · {fmtN(st.cloud.count)} pts{st.err.t > 0 ? ` · err ${(st.err.t * 100).toFixed(1)} cm` : ''}</span></span>
              </div>
            ))}
            <div className="btn-row">
              <Btn sm icon={<Trash2 size={15} />} onClick={() => { useLab.setState({ stations: [] }); void refreshTls([]); }} disabled={!s.stations.length}>Remove all</Btn>
            </div>
          </Section>
          <Section title="Overlay">
            <Toggle label="Missing regions (red)" checked={missingOn} onChange={setMissingOn} hint="Surface samples with no measured point within 12 cm." />
            <Toggle label="Overlap between stations (green)" checked={overlapOn} onChange={setOverlapOn} />
          </Section>
        </>
      )}

      {mode !== 'tls' && (
        <>
          <Section title="Mobile platform">
            <Select label="Scanner" value={mlsId} options={['rot16', 'rot32', 'vlp16', 'rot64'].map((id) => ({ value: id, label: getPreset(id).name }))} onChange={setMlsId} />
            <Seg value={String(s.mlsOpts.height)} onChange={(v) => s.patch({ mlsOpts: { ...s.mlsOpts, height: parseFloat(v) } })} options={[{ value: '1', label: 'Trolley 1.0 m' }, { value: '1.5', label: 'Handheld 1.5 m' }, { value: '1.8', label: 'Vehicle 1.8 m' }]} />
            <Slider label="Platform speed" value={s.mlsOpts.speed} min={0.2} max={4} step={0.1} unit=" m/s" format={(v) => v.toFixed(1)} onChange={(speed) => s.patch({ mlsOpts: { ...s.mlsOpts, speed } })} />
            <Toggle label="Show motion distortion" checked={s.mlsOpts.distortion} onChange={(distortion) => s.patch({ mlsOpts: { ...s.mlsOpts, distortion } })} hint="ON: every point of a sweep is placed with the sweep-start pose, as if the platform did not move during the rotation. Compare with OFF (each point uses its own time-stamped pose)." />
          </Section>
          <Section title="Trajectory">
            <div className="btn-row">
              <Btn variant={tool === 'waypoint' ? 'primary' : ''} icon={<RouteIcon size={16} />} onClick={() => setTool(tool === 'waypoint' ? null : 'waypoint')} testId="tool-waypoint">{tool === 'waypoint' ? 'Click plan or scene…' : 'Add waypoints'}</Btn>
              <Btn sm onClick={() => s.patch({ waypoints: loopWps() })}>Loop preset</Btn>
              <Btn sm onClick={() => s.patch({ waypoints: zigWps() })}>Zig-zag preset</Btn>
              <Btn sm icon={<Trash2 size={15} />} onClick={() => s.patch({ waypoints: [] })} disabled={!s.waypoints.length}>Clear</Btn>
            </div>
            <ol style={{ margin: 0, paddingLeft: '1.3rem', display: 'grid', gap: 2 }}>{s.waypoints.map(([x, y], i) => <li key={i} className="mono" style={{ fontSize: '0.875rem' }}>{x.toFixed(2)}, {y.toFixed(2)}</li>)}</ol>
            {traj && <p className="hint">{traj.length.toFixed(1)} m · {traj.duration.toFixed(1)} s · ~{fmtN(Math.round(pointsPerSecond(mlsSensor) * traj.duration))} nominal points</p>}
            <div className="btn-row">
              <Btn variant="primary" icon={<Play size={16} />} onClick={runMls} busy={mlsBusy} disabled={s.waypoints.length < 2} testId="run-mls">Generate moving scan</Btn>
              <Btn icon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={() => { if (!playing && s.mlsAnim >= 1) useLab.setState({ mlsAnim: 0 }); setPlaying(!playing); }} disabled={!traj}>{playing ? 'Pause' : 'Animate'}</Btn>
            </div>
            {traj && <Slider label="Playback" value={Math.max(0, s.mlsAnim)} min={0} max={1} step={0.01} format={(v) => `${(v * (traj.duration)).toFixed(1)} s`} onChange={(v) => s.patch({ mlsAnim: v })} />}
          </Section>
        </>
      )}

      {mode === 'compare' && (
        <Section title="Stationary vs moving">
          <table className="table" data-testid="compare-table">
            <thead><tr><th></th><th>TLS</th><th>MLS</th></tr></thead>
            <tbody>
              <tr><td>Deployment</td><td>{s.stations.length} stations</td><td>{s.mls ? `${s.mls.length.toFixed(1)} m path` : '—'}</td></tr>
              <tr><td>Points</td><td>{merged ? fmtN(merged.count) : '—'}</td><td>{s.mls ? fmtN(s.mls.cloud.count) : '—'}</td></tr>
              <tr><td>Coverage</td><td>{tlsStats ? `${tlsStats.coveredPct.toFixed(1)} %` : '—'}</td><td>{mlsCov ? `${mlsCov.coveredPct.toFixed(1)} %` : '—'}</td></tr>
              <tr><td>Density (pts/m² covered)</td><td>{tlsStats && merged ? fmtN(Math.round(merged.count / Math.max(0.1, tlsStats.coveredArea))) : '—'}</td><td>{mlsCov && s.mls ? fmtN(Math.round(s.mls.cloud.count / Math.max(0.1, mlsCov.coveredArea))) : '—'}</td></tr>
              <tr><td>Unobserved area</td><td>{tlsStats ? `${tlsStats.unobservedArea.toFixed(1)} m²` : '—'}</td><td>{mlsCov ? `${mlsCov.unobservedArea.toFixed(1)} m²` : '—'}</td></tr>
              <tr><td>Acquisition time</td><td>{s.stations.length ? `${s.stations.length} × ${(1 / tlsSensor.frequency / 60).toFixed(1)} min` : '—'}</td><td>{s.mls ? `${s.mls.seconds.toFixed(0)} s` : '—'}</td></tr>
            </tbody>
          </table>
          <p className="hint">Orange points = MLS, per-station colours = TLS. Red points mark regions the TLS stations never saw.</p>
        </Section>
      )}
      <DisplaySection cloud={merged ?? s.mls?.cloud} />
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="Static scanning (TLS)">A tripod scanner measures from fixed stations. Occlusions are filled by adding stations; overlapping areas allow the scans to be registered (ICP or targets) into one frame.</Callout>
      <Callout kind="edu" title="Mobile scanning (MLS)">The scanner moves while it rotates, so every point has its own sensor pose. If you place all points of a sweep with one pose you get motion distortion.</Callout>
      <Callout title="Registration errors">Use the pose-error sliders to simulate imperfect station poses. The merged cloud then shows doubled walls until ICP repairs it.</Callout>
      <Callout kind="warn" title="Teaching approximation">MLS poses here come from the ideal trajectory. A real system estimates them with SLAM / GNSS-IMU, which adds drift (see Tab 4).</Callout>
    </>
  );

  return (
    <TabFrame
      title="TLS & MLS Laboratory"
      tab={3}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={<KindLegend items={[{ color: '#8e8e93', label: 'Original mesh', style: 'wire' }, { color: '#64d2ff', label: 'Simulated scans (per-station colour)' }, { color: '#ff453a', label: 'Missing regions' }, { color: '#30d158', label: 'Overlap' }, { color: '#ff9f0a', label: 'Trajectory / MLS' }]} />}
    />
  );
  void colorize;
}
