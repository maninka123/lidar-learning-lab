import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Badge, Callout, MiniSlider, Select, fmtN } from '../ui/controls';
import { RawViewer } from '../ui/RawViewer';
import { CloudLayer } from '../ui/three';
import { Btn } from '../ui/controls';
import { FileText, Play, Pause } from '../ui/icons';
import { cloudBounds, PointCloud } from '../core/pointcloud';
import { parsePointCloud } from '../io/load';
import { writePCD } from '../io/pcd';

interface RealSet {
  frames?: string[];
  id: string; label: string; group: string; file: string; blurb: string; kind: string;
  scanner: string; fov?: { h: number; vMin: number; vMax: number; ch: number }; specs?: string; source: string; license: string;
}
const PCL = 'Point Cloud Library sample data';
/** Only clouds whose scanner is known are shown. */
const ZEN = 'Zenodo';
const OUSTER_SRC = 'Ouster SDK test data (ouster-lidar/ouster-sdk, tests/osfs), real frames decoded from the recorded OSF files';
const VLP_SRC = 'Keio-CSG/lidar-spoofing-artifacts (NDSS 2024), benign "capture_real_human" pcap, decoded with velodyne_decoder';
const vlpFrames = Array.from({ length: 10 }, (_, i) => `velodyne_vlp16_f${i}.ply`);
const livoxFrames = Array.from({ length: 10 }, (_, i) => `livox_mid360_f${i}.ply`);
const REAL: RealSet[] = [
  { id: 'mid360', label: 'Livox MID-360 (real frames)', group: 'Solid-state / non-repetitive scanners', file: livoxFrames[0], frames: livoxFrames, kind: 'Real sensor frames (from a ROS 2 bag, 0.2 s each)', scanner: 'Livox MID-360', fov: { h: 360, vMin: -7, vMax: 52, ch: 40 }, specs: '360° × 59° (-7° to +52°), non-repetitive scan, about 200,000 points per second (datasheet, approx.)', blurb: 'Real frames recorded by a Livox MID-360 on a moving platform and read from a ROS 2 bag. Each frame is 0.2 s of points. Livox scanners do not repeat the same pattern, so the longer you collect, the denser it gets. Press play to see the scene change.', source: 'AIST, Zenodo record 14841855 (rosbag2, topic /livox/lidar)', license: 'CC BY 4.0' },
  { id: 'vlp16', label: 'Velodyne VLP-16 (real frames)', group: 'Rotating multi-channel scanners', file: vlpFrames[0], frames: vlpFrames, kind: 'Real sensor frames (decoded from a pcap packet capture)', scanner: 'Velodyne VLP-16 (Puck)', fov: { h: 360, vMin: -15, vMax: 15, ch: 16 }, specs: '16 channels, 360° × 30°, about 20,000 points per frame at 10 Hz (from the recording)', blurb: 'Real frames recorded by a Velodyne VLP-16 and decoded from its raw network packets (a pcap file). Only 16 rings, so the cloud is sparse between them. Press play to watch a person move through the scene.', source: VLP_SRC, license: 'Research artifact, credit: Keio-CSG' },
  { id: 'os1128', label: 'Ouster OS1-128 (real frames)', group: 'Rotating multi-channel scanners', file: 'ouster_os1128_f0.ply', frames: ['ouster_os1128_f0.ply', 'ouster_os1128_f1.ply', 'ouster_os1128_f2.ply'], kind: 'Real sensor frames (mobile / spinning lidar)', scanner: 'Ouster OS1-128', fov: { h: 360, vMin: -21.8, vMax: 21, ch: 128 }, specs: '128 channels, 360° × 45°, 1024 columns per frame (from the recording)', blurb: 'Real frames recorded by an Ouster OS1-128: each frame is one full rotation. Note the ring pattern, the gaps where nothing was hit, and how the cloud thins out with range. Intensity (reflectivity) is available.', source: OUSTER_SRC, license: 'BSD-3-Clause' },
  { id: 'os0128', label: 'Ouster OS0-128 (real frames)', group: 'Rotating multi-channel scanners', file: 'ouster_os0128_f0.ply', frames: ['ouster_os0128_f0.ply', 'ouster_os0128_f1.ply'], kind: 'Real sensor frames (mobile / spinning lidar)', scanner: 'Ouster OS0-128 (wide-view model)', fov: { h: 360, vMin: -46.1, vMax: 45.2, ch: 128 }, specs: '128 channels, 360° × 91°, 1024 columns per frame (from the recording)', blurb: 'Real frames from the wide-field-of-view OS0-128, which sees almost straight up and straight down. Compare its shape with the OS1.', source: OUSTER_SRC, license: 'BSD-3-Clause' },
  { id: 'riegl', label: 'Tree · RIEGL VZ-400 (TLS)', group: 'Terrestrial laser scanning (TLS)', file: 'riegl_vz400_tree.ply', kind: 'Terrestrial (tripod) scan', scanner: 'RIEGL VZ-400 terrestrial laser scanner', fov: { h: 360, vMin: -40, vMax: 60, ch: 1 }, specs: 'rotating mirror, 360° × 100°, range up to ≈ 600 m (datasheet, approx.)', blurb: 'One tree scanned from a tripod with a RIEGL VZ-400 in Russell Square, London. A TLS scan is very dense and has no colour here: only x, y, z.', source: `${ZEN} record 5076045 (UCL, Phil Wilkes), file RSQ01_2017_T102`, license: 'CC BY 4.0' },
];

const REAL_UP: RealSet = { id: 'upload', label: 'Your file', group: 'Your file', file: '', kind: 'Uploaded file', scanner: 'not specified', blurb: 'The file you opened. Colour and intensity are shown if the file has them.', source: 'Your file', license: 'yours' };
const cache = new Map<string, PointCloud>();
async function loadReal(r: RealSet, file = r.file): Promise<PointCloud> {
  const hit = cache.get(file);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${r.file}`);
  const c = parsePointCloud(await res.arrayBuffer(), file);
  c.name = r.label;
  cache.set(file, c);
  return c;
}

/** Robust framing: the median point and the 90th-percentile distance, so far-away stray points do not shrink the view. */
function robustFrame(c: PointCloud): { c: [number, number, number]; r: number } {
  const n = c.count, step = Math.max(1, Math.floor(n / 20000));
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < n; i += step) { xs.push(c.positions[i * 3]); ys.push(c.positions[i * 3 + 1]); zs.push(c.positions[i * 3 + 2]); }
  const med = (a: number[]) => { const t = [...a].sort((p, q) => p - q); return t[t.length >> 1]; };
  const m: [number, number, number] = [med(xs), med(ys), med(zs)];
  const d = xs.map((x, i) => Math.hypot(x - m[0], ys[i] - m[1], zs[i] - m[2])).sort((p, q) => p - q);
  return { c: m, r: Math.max(0.5, d[Math.floor(d.length * 0.9)]) };
}
const centre = (c: PointCloud): [number, number, number] => { const b = cloudBounds(c); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]; };
const sizeOf = (c: PointCloud) => { const b = cloudBounds(c); return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 0.5); };

/** Little annotated drawing of the sensor: top view (horizontal FOV) and side view (vertical FOV with its channels). */
function ScannerFigure({ p }: { p: { hFov: number; vMin: number; vMax: number; channels: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = 330, H = 150, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    g.fillStyle = '#f7f7fa'; g.fillRect(0, 0, W, H);
    const D = Math.PI / 180;
    // --- top view
    const cx = 80, cy = 78, R = 56;
    g.fillStyle = 'rgba(10,132,255,.14)'; g.strokeStyle = '#0a60c9'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy);
    if (p.hFov >= 359) g.arc(cx, cy, R, 0, Math.PI * 2); else g.arc(cx, cy, R, -(p.hFov / 2) * D, (p.hFov / 2) * D);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#0a60c9'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
    g.fillStyle = '#1d1d1f'; g.font = '600 13px -apple-system, sans-serif'; g.textAlign = 'center';
    g.fillText('Top view', cx, 16); g.fillText(`${p.hFov >= 359 ? '360' : p.hFov.toFixed(p.hFov % 1 ? 1 : 0)}° horizontal`, cx, H - 8);
    // --- side view with channels
    const sx = 200, sy = 82, L = 58;
    const lo = p.vMin * D, hi = p.vMax * D;
    g.fillStyle = 'rgba(142,63,209,.14)'; g.strokeStyle = '#8e3fd1'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + L * Math.cos(hi), sy - L * Math.sin(hi)); g.lineTo(sx + L * Math.cos(lo), sy - L * Math.sin(lo)); g.closePath(); g.fill(); g.stroke();
    const n = Math.min(p.channels, 32);
    g.strokeStyle = 'rgba(142,63,209,.7)'; g.lineWidth = 1;
    for (let i = 0; i < n; i++) { const a = n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + L * Math.cos(a), sy - L * Math.sin(a)); g.stroke(); }
    g.fillStyle = '#8e3fd1'; g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fill();
    g.fillStyle = '#1d1d1f'; g.fillText('Side view', sx + 36, 16);
    g.fillText(`${(p.vMax - p.vMin).toFixed(p.vMax - p.vMin < 10 && (p.vMax - p.vMin) % 1 ? 1 : 0)}° vertical${p.channels > 1 ? ` · ${p.channels} ch` : ''}`, sx + 36, H - 8);
  }, [p]);
  return <canvas ref={ref} style={{ width: '100%', height: 150, borderRadius: 12 }} aria-label="Scanner field of view and channels" />;
}

export default function Tab2() {
  const s = useLab();
  const [sel, setSel] = useState('os1128')
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spec, setSpec] = useState({ name: '', channels: '', hFov: '', vFov: '' });
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [colour, setColour] = useState<'auto' | 'height' | 'intensity' | 'rgb'>('auto');
  const entry = sel === 'upload' ? REAL_UP : REAL.find((e) => e.id === sel)!;

  useEffect(() => { setFrame(0); setPlaying(false); }, [sel]);
  const nFrames = entry.frames?.length ?? 1;
  useEffect(() => {
    if (!playing || nFrames < 2) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % nFrames), 400);
    return () => clearInterval(t);
  }, [playing, nFrames]);
  useEffect(() => { const v = useLab.getState().galleryViewed; if (!v.includes(sel)) useLab.setState({ galleryViewed: [...v, sel] }); }, [sel]);
  useEffect(() => {
    let on = true; setBusy(true);
    loadReal(entry, entry.frames ? entry.frames[Math.min(frame, entry.frames.length - 1)] : entry.file).then((c) => { if (!on) return; setCloud(c); setBusy(false); }).catch((e) => { useLab.getState().notify(e.message, 'error'); setBusy(false); });
    return () => { on = false; };
  }, [sel, frame]); // eslint-disable-line react-hooks/exhaustive-deps

  const fr = useMemo(() => (cloud ? robustFrame(cloud) : null), [cloud]);
  const home = useMemo<[number, number, number]>(() => { if (!fr) return [4, -4, 3]; const k = fr.r * 1.6; return [fr.c[0] + k * 0.8, fr.c[1] - k * 0.8, fr.c[2] + k * 0.6]; }, [fr]);
  const target = useMemo<[number, number, number]>(() => (fr ? fr.c : [0, 0, 0]), [fr]);
  const rawText = useMemo(() => {
    if (!rawOpen || !cloud) return '';
    return new TextDecoder().decode(writePCD({ id: 'raw', name: cloud.name, count: cloud.count, positions: cloud.positions, meta: cloud.meta, ...(cloud.colors ? { colors: cloud.colors } : {}), ...(cloud.intensity ? { intensity: cloud.intensity } : {}) } as PointCloud, false));
  }, [rawOpen, cloud]);

  const viewport = (
    <Viewport home={home} target={target} threshold={0.05} gridSize={Math.max(0.5, fr ? fr.r / 4 : 1)}>
      {cloud && <CloudLayer cloud={cloud} mode={colour === 'auto' ? (cloud.colors ? 'rgb' : 'height') : colour === 'intensity' && !cloud.intensity ? 'height' : colour === 'rgb' && !cloud.colors ? 'height' : colour} size={2} budget={Math.max(s.view.renderBudget, 400000)} pickable={false} />}
    </Viewport>
  );

  const controls = (
    <div style={{ display: 'grid', gap: 12, paddingTop: 8 }}>
      <div data-testid="gallery-select">
        <Select<string> label="Point cloud" value={sel} onChange={setSel} options={REAL.map((r) => ({ value: r.id, label: r.label }))}
          groups={[...['Rotating multi-channel scanners', 'Solid-state / non-repetitive scanners', 'Terrestrial laser scanning (TLS)'].map((g) => ({ label: g, options: REAL.filter((r) => r.group === g).map((r) => ({ value: r.id, label: r.label })) })), ...(sel === 'upload' ? [{ label: 'Your file', options: [{ value: 'upload', label: REAL_UP.label }] }] : [])]} />
      </div>
      <Select<string> label="Colour by" value={colour} onChange={(v) => setColour(v as typeof colour)} options={[{ value: 'auto', label: 'Automatic' }, { value: 'height', label: 'Height' }, ...(cloud?.intensity ? [{ value: 'intensity', label: 'Intensity' }] : []), ...(cloud?.colors ? [{ value: 'rgb', label: 'RGB colour' }] : [])]} />
      {entry.frames && entry.frames.length > 1 && (
        <div style={{ display: 'grid', gap: 6 }} data-testid="gallery-frames">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Btn sm icon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={() => setPlaying((v) => !v)} title={playing ? 'Pause' : 'Play frames'} testId="gallery-play">{playing ? 'Pause' : 'Play'}</Btn>
            <div style={{ flex: 1 }}><MiniSlider label="Frame" value={Math.min(frame, entry.frames.length - 1) + 1} min={1} max={entry.frames.length} onChange={(v) => { setPlaying(false); setFrame(v - 1); }} format={(v) => `${v} of ${entry.frames!.length}`} /></div>
          </div>
        </div>
      )}
      <div className="callout" data-testid="gallery-info" style={{ gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b style={{ fontSize: '1.05rem' }}>{entry.label}</b><Badge kind="measured" /></div>
        <span>{entry.blurb}</span>
        {(entry.fov || (sel === 'upload' && spec.hFov)) && <ScannerFigure p={sel === 'upload' ? { hFov: parseFloat(spec.hFov) || 360, vMin: -(parseFloat(spec.vFov) || 0) / 2, vMax: (parseFloat(spec.vFov) || 0) / 2, channels: parseInt(spec.channels) || 1 } : { hFov: entry.fov!.h, vMin: entry.fov!.vMin, vMax: entry.fov!.vMax, channels: entry.fov!.ch }} />}
        <table className="table"><tbody>
          <tr><td>Type</td><td>{entry.kind}</td></tr>
          <tr><td>Scanner</td><td>{sel === 'upload' ? (spec.name || 'not specified') : entry.scanner}</td></tr>
          <tr><td>Field of view</td><td>{sel === 'upload' ? (spec.hFov ? `${spec.hFov}° × ${spec.vFov || '?'}°` : 'not specified') : `${entry.fov!.h}° × ${+(entry.fov!.vMax - entry.fov!.vMin).toFixed(1)}°`}</td></tr>
          <tr><td>Channels</td><td>{sel === 'upload' ? (spec.channels || 'not specified') : entry.fov!.ch > 1 ? entry.fov!.ch : '1 (line / mirror scanner)'}</td></tr>
          {entry.specs && sel !== 'upload' && <tr><td>Specs</td><td>{entry.specs}</td></tr>}
          <tr><td>Points</td><td>{cloud ? fmtN(cloud.count) : '…'}</td></tr>
          <tr><td>Columns</td><td>{cloud ? ['x', 'y', 'z', ...(cloud.colors ? ['rgb'] : []), ...(cloud.intensity ? ['intensity'] : [])].join(' ') : '…'}</td></tr>
        </tbody></table>
        <span className="caption">Source: {entry.source} · {entry.license}</span>
        {cloud?.meta.notes?.map((n, i) => <span key={i} className="caption">• {n}</span>)}
      </div>
      <div className="callout" style={{ gap: 8 }}>
        <b>Open your own scan</b>
        <span className="caption">Only scans whose scanner is known are bundled. Open a PLY, PCD or LAS file and tell the gallery what scanner made it.</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Scanner name</label><input type="text" value={spec.name} placeholder="e.g. Ouster OS1-64" onChange={(e) => setSpec({ ...spec, name: e.target.value })} /></div>
          <div className="field"><label>Channels</label><input type="number" value={spec.channels} onChange={(e) => setSpec({ ...spec, channels: e.target.value })} /></div>
          <div className="field"><label>H FOV (°)</label><input type="number" value={spec.hFov} onChange={(e) => setSpec({ ...spec, hFov: e.target.value })} /></div>
          <div className="field"><label>V FOV (°)</label><input type="number" value={spec.vFov} onChange={(e) => setSpec({ ...spec, vFov: e.target.value })} /></div>
        </div>
      <label className="btn" style={{ cursor: 'pointer' }}>Open your own file (PLY, PCD, LAS)
        <input type="file" accept=".ply,.pcd,.las" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const c = parsePointCloud(await f.arrayBuffer(), f.name); c.name = f.name; cache.set('upload', c); REAL_UP.label = f.name; setSel('upload'); setCloud(c); } catch (err) { useLab.getState().notify((err as Error).message, 'error'); } e.target.value = ''; }} />
      </label>
      </div>
    </div>
  );

  return (
    <TabFrame
      title="Point Cloud Gallery"
      tab={3}
      viewport={viewport}
      controls={controls}
      learn={null}
      simple
      noPanelTabs
      viewExtras={<Btn sm icon={<FileText size={15} />} variant={rawOpen ? 'primary' : ''} onClick={() => { setRawOpen(!rawOpen); useLab.setState({ galleryRaw: true }); }} disabled={!cloud} testId="raw-toggle">Raw</Btn>}
      overlays={<>
        {busy && <div className="overlay glass card" style={{ left: 12, bottom: 12 }}>Loading…</div>}
        {rawOpen && cloud && <RawViewer text={rawText} filename={`${entry.file}`} onClose={() => setRawOpen(false)} />}
      </>}
    />
  );
}
