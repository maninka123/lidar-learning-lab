import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Badge, Btn, Callout, Section, Select, Seg, Slider, fmtN } from '../ui/controls';
import { RawViewer } from '../ui/RawViewer';
import { CloudLayer, PickLayer } from '../ui/three';
import { Crosshair, Download, FileText, Trash2, Undo2, Upload, Play } from '../ui/icons';
import { clearPicks, exportCloudFile, uploadCloud } from '../state/actions';
import { cloudBounds, PointCloud, attributesOf, transformCloud } from '../core/pointcloud';
import { availableModes, COLOR_MODE_LABEL, ColorMode } from '../core/colorize';
import { parsePointCloud } from '../io/load';
import { writePCD } from '../io/pcd';
import { runTask } from '../engine/client';
import { useSpacing } from './common';
import { getScene } from '../scenes';
import { FAMILIES, getPreset, presetToConfig } from '../sensor/presets';
import { staticPose, PoseSample } from '../sensor/simulate';
import { autoRays } from '../state/actions';

const simCache = new Map<string, PointCloud>();
const SIM_SETS: RealSet[] = [
  { id: 'sim-tls', label: 'TLS (tripod), same room', file: '', blurb: 'Simulated tripod laser scanner in Scene A: one static station, very dense, with colour.' },
  { id: 'sim-mls', label: 'MLS (walking), same room', file: '', blurb: 'Simulated mobile scanner (32-channel) walked across Scene A: many sweeps from a moving pose, sparser, no colour.' },
];

function Pictogram({ kind }: { kind: 'tls' | 'mls' }) {
  return kind === 'tls' ? (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-label="Tripod scanner"><path d="M32 30 L18 58 M32 30 L46 58 M32 30 L32 58" stroke="#444" strokeWidth="2.5" fill="none" strokeLinecap="round" /><rect x="22" y="10" width="20" height="20" rx="5" fill="#0a84ff" /><circle cx="32" cy="20" r="5" fill="#fff" /></svg>
  ) : (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-label="Moving scanner"><rect x="8" y="38" width="48" height="12" rx="4" fill="#8e8e93" /><circle cx="18" cy="52" r="5" fill="#333" /><circle cx="46" cy="52" r="5" fill="#333" /><rect x="26" y="22" width="12" height="12" rx="3" fill="#ff9f0a" /><path d="M20 20 L12 16 M44 20 L52 16 M20 28 L10 28 M44 28 L54 28" stroke="#ff9f0a" strokeWidth="2" strokeLinecap="round" /></svg>
  );
}

interface RealSet { id: string; label: string; file: string; blurb: string }

const SETS: RealSet[] = [
  { id: 'room1', label: 'Room scan 1', file: 'room_scan1.pcd', blurb: 'A real scan of a room (112 586 points) from the Point Cloud Library tutorial data. Only x, y, z were recorded: no colour, no intensity.' },
  { id: 'room2', label: 'Room scan 2', file: 'room_scan2.pcd', blurb: 'A second real scan of the same room from a different pose (112 624 points). Compare it with scan 1: the two overlap but are not aligned.' },
  { id: 'lamp', label: 'Lamppost', file: 'lamppost.pcd', blurb: 'A very small real scan (1 771 points): you can see individual points and how sparse a LiDAR sample can be.' },
];

const cache = new Map<string, PointCloud>();
async function loadSet(set: RealSet): Promise<PointCloud> {
  const hit = cache.get(set.id);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}data/${set.file}`);
  if (!res.ok) throw new Error(`Could not load ${set.file}`);
  const c = parsePointCloud(await res.arrayBuffer(), set.file);
  c.name = set.label;
  c.meta = { ...c.meta, kind: 'measured', source: `Point Cloud Library sample data: ${set.file}`, license: 'BSD-3-Clause (PointCloudLibrary/data)', description: set.blurb, coordinateFrame: 'Sensor frame as recorded, metres' };
  cache.set(set.id, c);
  return c;
}

const centre = (c: PointCloud): [number, number, number] => { const b = cloudBounds(c); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]; };
const sizeOf = (c: PointCloud) => { const b = cloudBounds(c); return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 0.5); };

export default function Tab2() {
  const s = useLab();
  const [aId, setAId] = useState('room1');
  const [bId, setBId] = useState('room2');
  const [mode, setMode] = useState<'single' | 'split' | 'overlay'>('single');
  const [A, setA] = useState<PointCloud | null>(null);
  const [B, setB] = useState<PointCloud | null>(null);
  const [uploaded, setUploaded] = useState<PointCloud | null>(null);
  const [aligned, setAligned] = useState<{ cloud: PointCloud; before: number; after: number } | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [colour, setColour] = useState<ColorMode | 'auto'>('auto');
  const [size, setSize] = useState(2.5);

  const [simReady, setSimReady] = useState(simCache.size === 2);
  const sets = useMemo<RealSet[]>(() => [...SETS, ...(simReady ? SIM_SETS : []), ...(uploaded ? [{ id: 'upload', label: uploaded.name, file: '', blurb: 'Your own file.' }] : [])], [uploaded, simReady]);
  const resolve = (id: string) => (id === 'upload' && uploaded ? Promise.resolve(uploaded) : simCache.has(id) ? Promise.resolve(simCache.get(id)!) : loadSet(SETS.find((x) => x.id === id)!));

  useEffect(() => { let on = true; resolve(aId).then((c) => { if (on) { setA(c); setAligned(null); useLab.getState().setCloud('explorer', c); } }).catch((e) => useLab.getState().notify(e.message, 'error')); return () => { on = false; }; }, [aId, uploaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'single') return; let on = true; resolve(bId).then((c) => { if (on) { setB(c); setAligned(null); } }).catch((e) => useLab.getState().notify(e.message, 'error')); return () => { on = false; }; }, [bId, mode, uploaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode !== 'single' && aId !== bId) useLab.setState({ realCompared: true }); }, [mode, aId, bId]);

  const info = sets.find((x) => x.id === aId);
  const spacing = useSpacing(A);
  const spacingB = useSpacing(B);
  const modes = A ? availableModes(A).filter((m) => ['height', 'xyz', 'rgb', 'flat'].includes(m)) : (['height'] as ColorMode[]);
  const effMode: ColorMode = colour !== 'auto' && modes.includes(colour) ? colour : A?.colors ? 'rgb' : 'height';
  const home = useMemo<[number, number, number]>(() => { if (!A) return [4, -4, 3]; const c = centre(A), k = sizeOf(A); return [c[0] + k * 0.9, c[1] - k * 0.9, c[2] + k * 0.7]; }, [A]);
  const target = useMemo<[number, number, number]>(() => (A ? centre(A) : [0, 0, 0]), [A]);
  const threshold = A ? Math.max(0.01, sizeOf(A) / 350) : 0.05;
  const budget = s.view.renderBudget;

  const last = s.picks[s.picks.length - 1];
  const dists = s.picks.slice(1).map((p, i) => Math.hypot(p.pos[0] - s.picks[i].pos[0], p.pos[1] - s.picks[i].pos[1], p.pos[2] - s.picks[i].pos[2]));

  const rawText = useMemo(() => {
    if (!rawOpen || !A) return '';
    const slim = { id: 'raw', name: A.name, count: A.count, positions: A.positions, meta: A.meta, ...(A.colors ? { colors: A.colors } : {}) } as PointCloud;
    return new TextDecoder().decode(writePCD(slim, false));
  }, [rawOpen, A]);

  async function tlsVsMls() {
    setBusy(true);
    try {
      const scene = getScene('A');
      const tlsCfg = presetToConfig(getPreset('tls')), mlsCfg = presetToConfig(getPreset('rot32'));
      const traj: PoseSample[] = [{ t: 0, x: -3, y: -1.8, z: 1.5, yaw: 0.45, pitch: 0, roll: 0 }, { t: 8, x: 3, y: 1.8, z: 1.5, yaw: 0.45, pitch: 0, roll: 0 }];
      const [tls, mls] = await Promise.all([
        runTask('scan', { scene, sensor: tlsCfg, trajectory: staticPose(0, 0, 1.5, 0), sweeps: 1, seed: 3, maxRays: autoRays(tlsCfg), distortion: false, scanId: 0, name: SIM_SETS[0].label }),
        runTask('scan', { scene, sensor: mlsCfg, trajectory: traj, sweeps: 80, seed: 4, maxRays: autoRays(mlsCfg, 80), distortion: false, scanId: 0, name: SIM_SETS[1].label }),
      ]);
      const mlsCloud = { ...mls.cloud, colors: undefined };
      simCache.set('sim-tls', tls.cloud); simCache.set('sim-mls', mlsCloud);
      setSimReady(true); setAId('sim-tls'); setBId('sim-mls'); setMode('split');
    } finally { setBusy(false); }
  }

  async function align() {
    if (!A || !B) return;
    setBusy(true);
    try {
      const r = await runTask('icp', { src: B.positions, nSrc: B.count, dst: A.positions, nDst: A.count, opts: { maxIterations: 60, tolerance: 1e-6, maxCorrDist: Math.max(0.2, sizeOf(A) / 8), sampleMax: 4000 } });
      setAligned({ cloud: transformCloud(B, r.T, `${B.name} (aligned)`), before: r.history[0]?.rmse ?? 0, after: r.finalRmse });
    } finally { setBusy(false); }
  }

  const layer = (c: PointCloud | null, m: ColorMode, flat?: [number, number, number], pickable = true): ReactNode =>
    c ? <CloudLayer cloud={c} mode={m} colorOpts={{ flat }} size={size} budget={budget} pickable={pickable} /> : null;

  const viewport = mode === 'split' ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <div style={{ position: 'relative' }}><Viewport id="real-a" group="real" label={`A · ${info?.label ?? ''}`} labelPos="bl" home={home} target={target} threshold={threshold}>{layer(A, effMode)}<PickLayer radius={threshold * 1.5} /></Viewport></div>
      <div style={{ position: 'relative' }}><Viewport id="real-b" group="real" primary={false} label={`B · ${sets.find((x) => x.id === bId)?.label ?? ''}`} labelPos="bl" home={home} target={target} threshold={threshold}>{layer(B, B?.colors ? 'rgb' : 'height', undefined, false)}</Viewport></div>
    </div>
  ) : (
    <Viewport home={home} target={target} threshold={threshold}>
      {mode === 'overlay' ? <>{layer(A, 'flat', [10, 132, 255])}{layer(aligned?.cloud ?? B, 'flat', aligned ? [48, 180, 80] : [255, 159, 10], false)}</> : layer(A, effMode, [10, 132, 255])}
      <PickLayer radius={threshold * 1.5} />
    </Viewport>
  );

  const stats = [
    { k: 'Points', v: A ? fmtN(A.count) : '…', s: A ? ['x y z', ...(A.colors ? ['rgb'] : []), ...(A.intensity ? ['intensity'] : [])].join(' + ').replace(' + ', ' ') : undefined },
    { k: 'Typical point spacing', v: spacing ? (spacing < 0.1 ? `${(spacing * 100).toFixed(1)} cm` : `${spacing.toFixed(2)} m`) : '—' },
  ];

  const controls = (
    <>
      <Section title="Real point clouds">
        <div className="chip-row" data-testid="real-sets">{sets.map((x) => <button key={x.id} className="chip" aria-pressed={aId === x.id} onClick={() => setAId(x.id)} data-testid={`real-${x.id}`}>{x.label}</button>)}</div>
        {A && (
          <div className="callout" data-testid="dataset-info" style={{ gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{A.name}</b><Badge kind={A.meta.kind === 'measured' ? 'measured' : 'sim'} /></div>
            <span>{info?.blurb ?? A.meta.description}</span>
            <span className="caption">{A.meta.license ?? (A.meta.kind === 'simulated' ? 'Simulated by this app' : 'Your own file')} · columns: {['x', 'y', 'z', ...(A.colors ? ['rgb'] : []), ...(A.intensity ? ['intensity'] : [])].join(' ')}</span>
          </div>
        )}
        <label className="btn" style={{ cursor: 'pointer' }}><Upload size={16} />Upload your own (PLY, PCD, LAS)
          <input type="file" accept=".ply,.pcd,.las,.laz" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const c = await uploadCloud(f); if (c) { setUploaded(c); setAId('upload'); } } e.target.value = ''; }} />
        </label>
      </Section>

      <Section title="MLS vs TLS (same room)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, textAlign: 'center' }}>
          <div className="callout" style={{ justifyItems: 'center' }}><Pictogram kind="tls" /><b>TLS</b><span className="caption">tripod, static, one long scan</span></div>
          <div className="callout" style={{ justifyItems: 'center' }}><Pictogram kind="mls" /><b>MLS</b><span className="caption">moving, many short sweeps</span></div>
        </div>
        <Btn icon={<Play size={16} />} onClick={tlsVsMls} busy={busy} testId="tls-vs-mls">Scan the same room both ways</Btn>
        {simReady && A && B && aId === 'sim-tls' && bId === 'sim-mls' && (
          <table className="table" data-testid="tls-mls-table"><thead><tr><th></th><th>TLS</th><th>MLS</th></tr></thead><tbody>
            <tr><td>Points</td><td>{fmtN(A.count)}</td><td>{fmtN(B.count)}</td></tr>
            <tr><td>Point spacing</td><td>{spacing ? `${(spacing * 100).toFixed(1)} cm` : '—'}</td><td>{spacingB ? `${(spacingB * 100).toFixed(1)} cm` : '—'}</td></tr>
            <tr><td>Colour</td><td>yes (RGB)</td><td>no</td></tr>
            <tr><td>Acquisition</td><td>≈ 50 s, static</td><td>8 s, moving</td></tr>
            <tr><td>Strength</td><td>fine detail</td><td>fast, large areas</td></tr>
          </tbody></table>
        )}
        <span className="caption">The two bundled room scans above are real data; this comparison is simulated so both are the same room.</span>
      </Section>

      <Section title="Compare">
        <Seg value={mode} onChange={setMode} options={[{ value: 'single', label: 'One' }, { value: 'split', label: 'Side by side' }, { value: 'overlay', label: 'Overlay' }]} label="Compare mode" />
        {mode !== 'single' && (
          <>
            <Select label="Compare with (B)" value={bId} options={sets.map((x) => ({ value: x.id, label: x.label }))} onChange={setBId} />
            {mode === 'overlay' && (
              <>
                <p className="hint">Blue = A, orange = B. Two scans from different viewpoints do not line up until they are registered.</p>
                <Btn icon={<Play size={16} />} onClick={align} busy={busy} disabled={!A || !B || aId === bId} testId="real-align">Align B to A (ICP)</Btn>
                {aligned && <Callout kind="good" title="Registered with ICP">Alignment error (RMSE) {aligned.before.toFixed(3)} → {aligned.after.toFixed(3)} m. Green = B after alignment.</Callout>}
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Look & measure">
        <Select label="Colour by" value={effMode} options={modes.map((m) => ({ value: m, label: COLOR_MODE_LABEL[m] }))} onChange={(m) => setColour(m)} />
        <Slider label="Point size" value={size} min={1} max={8} step={0.5} unit=" px" onChange={setSize} />
        <Btn icon={<Crosshair size={16} />} variant={s.interaction === 'pick-points' ? 'primary' : ''} onClick={() => s.patch({ interaction: s.interaction === 'pick-points' ? 'select' : 'pick-points' })} testId="pick-mode" block>
          {s.interaction === 'pick-points' ? 'Picking… click points in the view' : 'Pick points to measure'}
        </Btn>
        <div className="btn-row">
          <Btn sm icon={<Undo2 size={15} />} onClick={() => s.patch({ picks: s.picks.slice(0, -1) })} disabled={!s.picks.length}>Remove last</Btn>
          <Btn sm icon={<Trash2 size={15} />} onClick={clearPicks} disabled={!s.picks.length}>Clear</Btn>
        </div>
        {last && (
          <table className="table" data-testid="point-info"><thead><tr><th>x (m)</th><th>y (m)</th><th>z (m)</th></tr></thead>
            <tbody><tr>{last.pos.map((v, i) => <td key={i} className="mono">{v.toFixed(3)}</td>)}</tr></tbody></table>
        )}
        {dists.length > 0 && (
          <table className="table" data-testid="distance-table"><thead><tr><th>Segment</th><th>Distance</th></tr></thead>
            <tbody>{dists.map((d, i) => <tr key={i}><td>P{i + 1} → P{i + 2}</td><td className="mono">{d.toFixed(3)} m</td></tr>)}</tbody></table>
        )}
      </Section>

      <Section title="File">
        <div className="btn-row">
          <Btn icon={<Download size={16} />} onClick={() => A && exportCloudFile(A, 'ply')} disabled={!A}>PLY</Btn>
          <Btn icon={<Download size={16} />} onClick={() => A && exportCloudFile(A, 'pcd')} disabled={!A}>PCD</Btn>
        </div>
      </Section>
    </>
  );

  return (
    <TabFrame
      title="Real Point Clouds"
      tab={2}
      viewport={viewport}
      controls={controls}
      learn={null}
      stats={stats}
      statsRow
      noPanelTabs
      viewExtras={<Btn sm icon={<FileText size={15} />} variant={rawOpen ? 'primary' : ''} onClick={() => setRawOpen(!rawOpen)} disabled={!A} testId="raw-toggle">Raw</Btn>}
      overlays={rawOpen && A ? <RawViewer text={rawText} filename={`${A.name.replace(/\W+/g, '_')}.pcd`} onClose={() => setRawOpen(false)} /> : null}
    />
  );
}
