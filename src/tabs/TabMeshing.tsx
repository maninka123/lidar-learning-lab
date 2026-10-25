import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { CloudLayer, MeshLayer } from '../ui/three';
import { Download } from '../ui/icons';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { buildColourHall } from '../apps/colourHall';
import { surfaceMesh } from '../recon/recon';
import { heightMapMesh, meshStats, toOBJ, simplifyMesh, colourFromPoints, Mesh } from '../apps/mesh';
import { PointCloud, cloudBounds, selectPoints } from '../core/pointcloud';
import { parsePointCloud, downloadBlob } from '../io/load';
import { voxelDownsample } from '../processing/ops';
import { Credit } from '../ui/VideoCard';

type Method = 'voxel' | 'smooth' | 'height';
type Src = 'hall' | 'classroom' | 'tree';
const treeCache: { c?: PointCloud } = {};
const DEFAULT_CELL: Record<Src, number> = { hall: 0.06, classroom: 0.06, tree: 0.1 };

export default function TabMeshing() {
  const s = useLab();
  const [src, setSrc] = useState<Src>('hall');
  const { cloud: room } = useClassroom(0.03);
  const [tree, setTree] = useState<PointCloud | null>(treeCache.c ?? null);
  const [hall, setHall] = useState<PointCloud | null>(null);
  const [hallMsg, setHallMsg] = useState('');
  const [method, setMethod] = useState<Method>('smooth');
  const [cell, setCell] = useState(DEFAULT_CELL.hall), [iters, setIters] = useState(6), [closing, setClosing] = useState(0), [simplify, setSimplify] = useState(1), [maxJump, setMaxJump] = useState(0.35);
  const [layer, setLayer] = useState<'both' | 'mesh' | 'points'>('both');
  const [wire, setWire] = useState(false), [hideCeiling, setHideCeiling] = useState(true), [flat, setFlat] = useState(false), [surfaceColour, setSurfaceColour] = useState<'points' | 'plain'>('points');
  const [mesh, setMesh] = useState<{ m: Mesh; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (src === 'tree' && !tree) fetch(`${import.meta.env.BASE_URL}data/riegl_vz400_tree.ply`).then((r) => r.arrayBuffer()).then((b) => { const c = voxelDownsample(parsePointCloud(b, 'tree.ply'), 0.04); treeCache.c = c; setTree(c); });
    if (src === 'hall' && !hall) buildColourHall(setHallMsg).then((c) => { setHall(c); setHallMsg(''); }).catch((e) => s.notify((e as Error).message, 'error'));
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullCloud = src === 'classroom' ? room : src === 'tree' ? tree : hall;
  // "hide the roof" removes the ceiling points before anything is built, so both the points and the surface are open from above
  const cloud = useMemo<PointCloud | null>(() => {
    if (!fullCloud || !hideCeiling || src === 'tree') return fullCloud;
    // the classroom file labels its ceiling points (class 0); the hall's ceiling is its highest flat layer
    const top = cloudBounds(fullCloud).max[2] - 0.15, ids: number[] = [];
    for (let i = 0; i < fullCloud.count; i++) { const roof = src === 'classroom' && fullCloud.labels ? fullCloud.labels[i] === 0 : fullCloud.positions[i * 3 + 2] > top; if (!roof) ids.push(i); }
    return selectPoints(fullCloud, ids, fullCloud.name);
  }, [fullCloud, hideCeiling, src]);
  useEffect(() => { setMesh(null); setCell(DEFAULT_CELL[src]); }, [src]);

  function build(first = false) {
    if (!cloud) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const base = method === 'height' ? heightMapMesh(cloud, cell, maxJump) : surfaceMesh(cloud, { method, voxel: cell, iterations: iters, closing });
        const m = simplifyMesh(base, cell, simplify);
        setMesh({ m, ms: performance.now() - t0 });
        if (first) setLayer('both');
      } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
    }, 30);
  }
  // Build a surface as soon as there are points and whenever a setting changes, so there is always something to see.
  // Big clouds with very small cells would take seconds, so those wait for the button.
  const heavy = !!cloud && cloud.count > 50000 && cell < 0.05 && method !== 'height';
  const firstBuild = useRef(true);
  useEffect(() => { firstBuild.current = true; }, [src]);
  useEffect(() => {
    if (!cloud || heavy) return;
    const t = setTimeout(() => { build(firstBuild.current); firstBuild.current = false; }, 350);
    return () => clearTimeout(t);
  }, [cloud, method, cell, iters, closing, simplify, maxJump]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = mesh ? meshStats(mesh.m) : null;
  const vcolors = useMemo(() => (mesh && cloud && surfaceColour === 'points' ? colourFromPoints(mesh.m, cloud) : null), [mesh, cloud, surfaceColour]);
  const b = cloud ? cloudBounds(cloud) : null;
  const ext = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1) : 3;
  const cen: [number, number, number] = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0];
  const viewport = (
    <Viewport home={[cen[0] + ext * 0.7, cen[1] - ext * 0.8, cen[2] + ext * 0.6]} target={cen} gridSize={Math.max(0.5, ext / 8)} hideAxes bgOverride="#ffffff">
      {cloud && layer !== 'mesh' && <CloudLayer cloud={cloud} mode={cloud.colors ? 'rgb' : 'height'} size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 250000)} pickable={false} opacity={layer === 'both' ? 0.5 : 1} />}
      {mesh && layer !== 'points' && <MeshLayer mesh={mesh.m} colors={vcolors} flat={flat} opacity={layer === 'both' ? 0.9 : 1} wire={wire} />}
      {!cloud && null}
    </Viewport>
  );
  const stats = [
    { k: 'Points', v: cloud ? fmtN(cloud.count) : '…', s: cloud ? 'input cloud' : hallMsg || 'loading' },
    { k: 'Triangles', v: st ? fmtN(st.triangles) : '—', s: st ? `${fmtN(st.vertices)} vertices` : undefined },
    { k: 'Surface area', v: st ? `${st.area.toFixed(1)} m²` : '—', s: mesh ? `built in ${mesh.ms.toFixed(0)} ms` : undefined },
  ];
  const bigWarn = mesh && st && st.triangles > 600000;
  const controls = (
    <>
      <Callout kind="edu" title="From points to a surface">
        A point cloud is just dots. A <b>mesh</b> joins them into triangles, so you get a closed surface you can measure, shade and 3D-print. The cell size is the key setting: <b>small</b> cells keep detail but leave holes where the scan is thin; <b>large</b> cells fill holes but blur detail. The surface is rebuilt as you change a setting.
      </Callout>
      <Section title="1 · Points">
        <Select<Src> label="Point cloud" value={src} onChange={setSrc} options={[{ value: 'hall', label: 'Coloured hall (LiDAR + camera)' }, { value: 'classroom', label: 'Classroom (real colours)' }, { value: 'tree', label: 'Tree (RIEGL TLS)' }]} />
        <p className="hint">{src === 'hall' ? 'Made in this lab: four LiDAR scans of the calibration hall, painted with photos through the camera calibration (tab 9).' : src === 'classroom' ? 'A real classroom scan with its own colours.' : 'A real tree scanned from a tripod. No colour, so the surface is shaded plain.'}</p>
        {!cloud && <p className="hint">{hallMsg || 'Loading…'}</p>}
      </Section>
      <Section title="2 · Method">
        <Seg<Method> value={method} onChange={setMethod} options={[{ value: 'voxel', label: 'Voxel' }, { value: 'smooth', label: 'Smoothed' }, { value: 'height', label: 'Height map' }]} label="Surface method" />
        <p className="hint">
          {method === 'voxel' && 'Fills a 3D grid and keeps the faces that touch empty space. Robust but blocky, like building with cubes.'}
          {method === 'smooth' && 'The voxel surface with its corners welded and smoothed without shrinking it. Looks natural.'}
          {method === 'height' && 'One height per grid square, joined in triangles. Perfect for floors, terrain and roofs, but it cannot show overhangs or the sides of objects.'}
        </p>
        <Slider label="Cell size" value={cell * 100} min={1.5} max={20} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => setCell(v / 100)} hint="Try small, then large, and watch holes and detail change." />
      </Section>
      <Section title="3 · Fine-tune">
        {method !== 'height' && <Slider label="Close gaps" value={closing} min={0} max={3} step={1} unit=" cells" onChange={setClosing} hint="Fills small holes by growing the filled cells and shrinking them back." />}
        {method === 'smooth' && <Slider label="Smoothing rounds" value={iters} min={0} max={20} step={1} onChange={setIters} hint="More rounds make the surface smoother." />}
        {method === 'height' && <Slider label="Biggest step in height" value={maxJump * 100} min={5} max={100} step={5} unit=" cm" onChange={(v) => setMaxJump(v / 100)} hint="Neighbours further apart than this are not joined, so walls and edges stay sharp." />}
        <Slider label="Simplify" value={simplify} min={1} max={6} step={0.5} unit="×" format={(v) => v.toFixed(1)} onChange={setSimplify} hint="Merges nearby vertices into fewer, bigger triangles. 1× keeps everything." />
        {heavy && <p className="hint">These cells are very small for this many points. Press Build surface when you are ready (it takes a few seconds).</p>}
        {bigWarn && <p className="hint">That is a lot of triangles. Use bigger cells or simplify if the view is slow.</p>}
        <Btn variant="primary" onClick={() => build()} busy={busy} disabled={!cloud} testId="build-surface">Build surface</Btn>
      </Section>
      <Section title="4 · Look and export">
        <Seg value={layer} onChange={setLayer} options={[{ value: 'points', label: 'Points' }, { value: 'both', label: 'Both' }, { value: 'mesh', label: 'Surface' }]} />
        {cloud?.colors && <Seg value={surfaceColour} onChange={setSurfaceColour} label="Surface colour" options={[{ value: 'points', label: 'From the points' }, { value: 'plain', label: 'Plain' }]} />}
        <Toggle label="Smooth shading" checked={!flat} onChange={(v) => setFlat(!v)} hint="Off shows every flat triangle." />
        <Toggle label="Show triangle edges" checked={wire} onChange={setWire} />
        {src !== 'tree' && <Toggle label="Hide the roof" checked={hideCeiling} onChange={setHideCeiling} hint="Takes the ceiling out of the points and the surface so you can see in from above." />}
        <Btn icon={<Download size={16} />} onClick={() => mesh && downloadBlob(new Blob([toOBJ(mesh.m, vcolors)], { type: 'text/plain' }), `${src}_surface.obj`)} disabled={!mesh} testId="export-obj">Download OBJ</Btn>
        <p className="hint">OBJ opens in Blender, MeshLab and CloudCompare{vcolors ? ' (vertex colours included)' : ''}.</p>
      </Section>
      <Section title="Videos">
        <Credit keys={['implant', 'library', 'university', 'factory']} title="" />
        <p className="caption">The first video shows points only, without colour; the others have colour from the camera. All videos are by Dr. Florent Poux.</p>
      </Section>
    </>
  );
  return <TabFrame title="Meshing & Surface Reconstruction" tab={9} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} />;
}
