import { useEffect, useMemo, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { CloudLayer, MeshLayer } from '../ui/three';
import { Play, Download } from '../ui/icons';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { surfaceMesh, scanObject } from '../recon/recon';
import { heightMapMesh, meshStats, toOBJ, Mesh } from '../apps/mesh';
import { PointCloud, cloudBounds } from '../core/pointcloud';
import { parsePointCloud, downloadBlob } from '../io/load';
import { voxelDownsample } from '../processing/ops';
import { Credit } from '../ui/VideoCard';

type Method = 'voxel' | 'smooth' | 'height';
type Src = 'classroom' | 'tree' | 'chair';
const treeCache: { c?: PointCloud } = {};

export default function TabMeshing() {
  const s = useLab();
  const [src, setSrc] = useState<Src>('chair');
  const { cloud: room } = useClassroom(0.03);
  const [tree, setTree] = useState<PointCloud | null>(treeCache.c ?? null);
  const [method, setMethod] = useState<Method>('smooth');
  const [cell, setCell] = useState(0.03), [iters, setIters] = useState(6);
  const [layer, setLayer] = useState<'both' | 'mesh' | 'points'>('both');
  const [wire, setWire] = useState(false), [hideCeiling, setHideCeiling] = useState(true);
  const [mesh, setMesh] = useState<{ m: Mesh; ms: number; method: Method } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (src !== 'tree' || tree) return;
    fetch(`${import.meta.env.BASE_URL}data/riegl_vz400_tree.ply`).then((r) => r.arrayBuffer()).then((b) => { const c = voxelDownsample(parsePointCloud(b, 'tree.ply'), 0.04); treeCache.c = c; setTree(c); });
  }, [src, tree]);
  const chair = useMemo(() => scanObject('chair', 5, 2), []);
  const cloud = src === 'classroom' ? room : src === 'tree' ? tree : chair;
  useEffect(() => { setMesh(null); setCell(src === 'chair' ? 0.03 : src === 'tree' ? 0.08 : 0.06); }, [src]);

  function build() {
    if (!cloud) return;
    setBusy(true);
    setTimeout(() => {
      try { const t0 = performance.now(); const m = method === 'height' ? heightMapMesh(cloud, cell) : surfaceMesh(cloud, { method, voxel: cell, iterations: iters }); setMesh({ m, ms: performance.now() - t0, method }); setLayer('mesh'); }
      catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
    }, 30);
  }
  const st = mesh ? meshStats(mesh.m) : null;
  const b = cloud ? cloudBounds(cloud) : null;
  const ext = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1) : 3;
  const cen: [number, number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0];
  const viewport = (
    <Viewport home={[cen[0] + ext * 0.8, cen[1] - ext * 0.9, cen[2] + ext * 0.6]} target={cen} gridSize={Math.max(0.5, ext / 8)} hideAxes bgOverride="#ffffff">
      {cloud && layer !== 'mesh' && <CloudLayer cloud={cloud} mode={cloud.colors ? 'rgb' : 'height'} size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 250000)} pickable={false} opacity={layer === 'both' ? 0.55 : 1} clip={{ on: hideCeiling && src === 'classroom', min: -1, max: 2.55 }} />}
      {mesh && layer !== 'points' && <MeshLayer mesh={mesh.m} opacity={layer === 'both' ? 0.85 : 1} wire={wire} />}
    </Viewport>
  );
  const stats = [
    { k: 'Points', v: cloud ? fmtN(cloud.count) : '…', s: 'input cloud' },
    { k: 'Triangles', v: st ? fmtN(st.triangles) : '—', s: st ? `${fmtN(st.vertices)} vertices` : undefined },
    { k: 'Surface area', v: st ? `${st.area.toFixed(1)} m²` : '—', s: mesh ? `built in ${mesh.ms.toFixed(0)} ms` : undefined },
  ];
  const bigWarn = mesh && st && st.triangles > 600000;
  const controls = (
    <>
      <Callout kind="edu" title="From points to a surface">
        A point cloud is just dots. A <b>mesh</b> joins them into triangles, so you get a closed surface you can measure, shade and 3D-print. The cell size is the key setting: <b>small</b> cells keep detail but leave holes where the scan is thin; <b>large</b> cells fill holes but blur detail.
      </Callout>
      <Section title="From a SLAM scan to a finished model">
        <ol className="hint" style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 2 }}>
          <li><b>SLAM reconstruction</b>: a moving scanner builds the point cloud (tab 6).</li>
          <li><b>Add colour with the camera</b>: each point takes the colour of the photo pixel it falls on.</li>
          <li><b>Surface finish</b>: join the points into a smooth surface (below).</li>
        </ol>
        <Credit keys={['implant', 'library', 'university', 'factory']} title="" />
        <p className="caption">Click a video to play it here. The first one shows points only, without colour; the others have colour from the camera. All videos are by Dr. Florent Poux.</p>
      </Section>
      <Section title="1 · Points">
        <Select<Src> label="Scan" value={src} onChange={setSrc} options={[{ value: 'chair', label: 'Chair (simulated LiDAR)' }, { value: 'tree', label: 'Tree (RIEGL TLS)' }, { value: 'classroom', label: 'Classroom' }]} />
      </Section>
      <Section title="2 · Method">
        <Seg<Method> value={method} onChange={setMethod} options={[{ value: 'voxel', label: 'Voxel' }, { value: 'smooth', label: 'Smoothed' }, { value: 'height', label: 'Height map' }]} label="Surface method" />
        <p className="hint">
          {method === 'voxel' && 'Fills a 3D grid and keeps the faces that touch empty space. Robust but blocky, like building with cubes.'}
          {method === 'smooth' && 'The voxel surface with its corners welded and smoothed. Looks natural, a little shrunk where it is thin.'}
          {method === 'height' && 'One height per grid square, joined in triangles. Perfect for floors, terrain and roofs, but it cannot show overhangs or the sides of objects.'}
        </p>
        <Slider label="Cell size" value={cell * 100} min={1} max={20} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => setCell(v / 100)} hint="Try small, then large, and watch holes and detail change." />
        {method === 'smooth' && <Slider label="Smoothing rounds" value={iters} min={0} max={20} step={1} onChange={setIters} />}
        <Btn variant="primary" icon={<Play size={16} />} onClick={build} busy={busy} disabled={!cloud} testId="build-surface">Build surface</Btn>
        {bigWarn && <p className="hint">That is a lot of triangles. Use bigger cells if the view is slow.</p>}
      </Section>
      {mesh && (
        <Section title="3 · Look and export">
          <Seg value={layer} onChange={setLayer} options={[{ value: 'points', label: 'Points' }, { value: 'both', label: 'Both' }, { value: 'mesh', label: 'Surface' }]} />
          <Toggle label="Show triangle edges" checked={wire} onChange={setWire} />
          {src === 'classroom' && <Toggle label="Hide the ceiling" checked={hideCeiling} onChange={setHideCeiling} />}
          <Btn icon={<Download size={16} />} onClick={() => downloadBlob(new Blob([toOBJ(mesh.m)], { type: 'text/plain' }), `${src}_surface.obj`)} testId="export-obj">Download OBJ</Btn>
          <p className="hint">OBJ opens in Blender, MeshLab and CloudCompare.</p>
        </Section>
      )}
    </>
  );
  return <TabFrame title="Meshing & Surface Reconstruction" tab={13} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} />;
}
