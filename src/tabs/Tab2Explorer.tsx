import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Badge, Callout, Select, fmtN } from '../ui/controls';
import { RawViewer } from '../ui/RawViewer';
import { CloudLayer } from '../ui/three';
import { Btn } from '../ui/controls';
import { FileText } from '../ui/icons';
import { cloudBounds, PointCloud } from '../core/pointcloud';
import { parsePointCloud } from '../io/load';
import { writePCD } from '../io/pcd';

interface RealSet {
  id: string; label: string; group: string; file: string; blurb: string; kind: string;
  scanner: string; fov?: { h: number; vMin: number; vMax: number; ch: number }; specs?: string; source: string; license: string;
}
const PCL = 'Point Cloud Library sample data';
/** Only clouds whose scanner is known are shown. */
const ZEN = 'Zenodo';
const REAL: RealSet[] = [
  { id: 'riegl', label: 'Tree · RIEGL VZ-400 (TLS)', group: 'Terrestrial laser scanning (TLS)', file: 'riegl_vz400_tree.ply', kind: 'Terrestrial (tripod) scan', scanner: 'RIEGL VZ-400 terrestrial laser scanner', fov: { h: 360, vMin: -40, vMax: 60, ch: 1 }, specs: 'rotating mirror, 360° × 100°, range up to ≈ 600 m (datasheet, approx.)', blurb: 'One tree scanned from a tripod with a RIEGL VZ-400 in Russell Square, London. A TLS scan is very dense and has no colour here: only x, y, z.', source: `${ZEN} record 5076045 (UCL, Phil Wilkes), file RSQ01_2017_T102`, license: 'CC BY 4.0' },
  { id: 'orbis', label: 'Tree · FARO Orbis + HESAI XT32 (MLS)', group: 'Mobile laser scanning (MLS)', file: 'faro_orbis_mls_tree.ply', kind: 'Mobile (handheld) scan', scanner: 'FARO Orbis handheld scanner with a HESAI XT32 lidar', fov: { h: 360, vMin: -16, vMax: 15, ch: 32 }, specs: '32 channels, 360° × 31°, range ≈ 120 m (datasheet, approx.)', blurb: 'One hardwood tree in a Québec forest, scanned by a person walking with a handheld mobile scanner (32-channel lidar + camera). The scan was georeferenced, processed and the tree was segmented from the plot, so it is processed data, not a raw sweep. It has colour and intensity.', source: `${ZEN} record 21515256 (Vandendaele, Havreljuk, Roussel et al.), file DUC0001-01_54`, license: 'CC BY 4.0' },
  { id: 'lms400', label: 'Table scene · SICK LMS400 (line scanner)', group: 'Line scanner', file: 'table_scene_lms400.pcd', kind: 'Tabletop scene', scanner: 'SICK LMS400 (named in the file name)', fov: { h: 70, vMin: 0, vMax: 0, ch: 1 }, specs: 'single beam swept over ≈ 70° (datasheet, approx.)', blurb: 'A close-range scene recorded with a SICK LMS400 line scanner. One shot is only a single line (a profile). The 3D shape appears only after many profiles are combined using the scanner’s motion or pan-tilt: that is processing, not a single measurement. How this file was captured is not documented.', source: 'Point Cloud Library sample data (tutorials/table_scene_lms400.pcd)', license: 'BSD-3-Clause' },
];

const REAL_UP: RealSet = { id: 'upload', label: 'Your file', group: 'Your file', file: '', kind: 'Uploaded file', scanner: 'not specified', blurb: 'The file you opened. Colour and intensity are shown if the file has them.', source: 'Your file', license: 'yours' };
const cache = new Map<string, PointCloud>();
async function loadReal(r: RealSet): Promise<PointCloud> {
  const hit = cache.get(r.id);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}data/${r.file}`);
  if (!res.ok) throw new Error(`Could not load ${r.file}`);
  const c = parsePointCloud(await res.arrayBuffer(), r.file);
  c.name = r.label;
  cache.set(r.id, c);
  return c;
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
  const [sel, setSel] = useState('orbis');
  const [spec, setSpec] = useState({ name: '', channels: '', hFov: '', vFov: '' });
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [colour, setColour] = useState<'auto' | 'height' | 'intensity' | 'rgb'>('auto');
  const entry = sel === 'upload' ? REAL_UP : REAL.find((e) => e.id === sel)!;

  useEffect(() => { const v = useLab.getState().galleryViewed; if (!v.includes(sel)) useLab.setState({ galleryViewed: [...v, sel] }); }, [sel]);
  useEffect(() => {
    let on = true; setBusy(true);
    loadReal(entry).then((c) => { if (!on) return; setCloud(c); setBusy(false); }).catch((e) => { useLab.getState().notify(e.message, 'error'); setBusy(false); });
    return () => { on = false; };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const home = useMemo<[number, number, number]>(() => { if (!cloud) return [4, -4, 3]; const c = centre(cloud), k = sizeOf(cloud); return [c[0] + k * 0.8, c[1] - k * 0.8, c[2] + k * 0.6]; }, [cloud]);
  const target = useMemo<[number, number, number]>(() => (cloud ? centre(cloud) : [0, 0, 0]), [cloud]);
  const rawText = useMemo(() => {
    if (!rawOpen || !cloud) return '';
    return new TextDecoder().decode(writePCD({ id: 'raw', name: cloud.name, count: cloud.count, positions: cloud.positions, meta: cloud.meta, ...(cloud.colors ? { colors: cloud.colors } : {}), ...(cloud.intensity ? { intensity: cloud.intensity } : {}) } as PointCloud, false));
  }, [rawOpen, cloud]);

  const viewport = (
    <Viewport home={home} target={target} threshold={0.05} gridSize={Math.max(0.5, cloud ? sizeOf(cloud) / 10 : 1)}>
      {cloud && <CloudLayer cloud={cloud} mode={colour === 'auto' ? (cloud.colors ? 'rgb' : 'height') : colour === 'intensity' && !cloud.intensity ? 'height' : colour === 'rgb' && !cloud.colors ? 'height' : colour} size={2} budget={s.view.renderBudget} pickable={false} />}
    </Viewport>
  );

  const controls = (
    <div style={{ display: 'grid', gap: 12, paddingTop: 8 }}>
      <div data-testid="gallery-select">
        <Select<string> label="Point cloud" value={sel} onChange={setSel} options={REAL.map((r) => ({ value: r.id, label: r.label }))}
          groups={[...['Terrestrial laser scanning (TLS)', 'Mobile laser scanning (MLS)', 'Line scanner'].map((g) => ({ label: g, options: REAL.filter((r) => r.group === g).map((r) => ({ value: r.id, label: r.label })) })), ...(sel === 'upload' ? [{ label: 'Your file', options: [{ value: 'upload', label: REAL_UP.label }] }] : [])]} />
      </div>
      <Select<string> label="Colour by" value={colour} onChange={(v) => setColour(v as typeof colour)} options={[{ value: 'auto', label: 'Automatic' }, { value: 'height', label: 'Height' }, ...(cloud?.intensity ? [{ value: 'intensity', label: 'Intensity' }] : []), ...(cloud?.colors ? [{ value: 'rgb', label: 'RGB colour' }] : [])]} />
      <div className="callout" data-testid="gallery-info" style={{ gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b style={{ fontSize: '1.05rem' }}>{entry.label}</b><Badge kind="measured" /></div>
        <span>{entry.blurb}</span>
        {(entry.fov || (sel === 'upload' && spec.hFov)) && <ScannerFigure p={sel === 'upload' ? { hFov: parseFloat(spec.hFov) || 360, vMin: -(parseFloat(spec.vFov) || 0) / 2, vMax: (parseFloat(spec.vFov) || 0) / 2, channels: parseInt(spec.channels) || 1 } : { hFov: entry.fov!.h, vMin: entry.fov!.vMin, vMax: entry.fov!.vMax, channels: entry.fov!.ch }} />}
        <table className="table"><tbody>
          <tr><td>Type</td><td>{entry.kind}</td></tr>
          <tr><td>Scanner</td><td>{sel === 'upload' ? (spec.name || 'not specified') : entry.scanner}</td></tr>
          <tr><td>Field of view</td><td>{sel === 'upload' ? (spec.hFov ? `${spec.hFov}° × ${spec.vFov || '?'}°` : 'not specified') : `${entry.fov!.h}° × ${entry.fov!.vMax - entry.fov!.vMin}°`}</td></tr>
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
