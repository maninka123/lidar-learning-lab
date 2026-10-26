import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { CLASSROOM_CLASSES, loadClassroomForSegmentation, paintClasses } from '../apps/classroom';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { RawViewer } from '../ui/RawViewer';
import { writePCD } from '../io/pcd';
import { FileText } from '../ui/icons';
import { MiniChart } from './common';
import { Credit } from '../ui/VideoCard';
import { CloudLayer, BoxOutline } from '../ui/three';
import { selectPoints } from '../core/pointcloud';
import { Play, RotateCcw, Plus } from '../ui/icons';
import { runTask } from '../engine/client';
import { SegParams, SegResult } from '../segmentation/segment';
import { PointCloud } from '../core/pointcloud';
import { distinctColor } from '../core/colorize';
import { Vec3 } from '../core/math';

type Show = 'result' | 'instances' | 'semantic' | 'rgb';

function PickedCard({ p, id, index, name, onName, onClose }: { p: { cl?: SegResult['clusters'][number]; pl?: SegResult['planes'][number]; pts: PointCloud; mn: number[]; mx: number[]; classes: [string, number][]; n: number }; id: number; index: number; name: string; onName: (v: string) => void; onClose: () => void }) {
  const size = p.mx.map((v, i) => v - p.mn[i]), ext = Math.max(0.5, ...size), c = p.mn.map((v, i) => (v + p.mx[i]) / 2);
  return (
    <div className="overlay glass card fade-in" style={{ left: 12, top: 66, width: 300, padding: 10, display: 'grid', gap: 8 }} data-testid="picked-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ flex: 1 }}>{p.cl ? `Cluster #${index + 1}` : `Plane: ${p.pl?.kind ?? ''}`}</b>
        <button className="btn sm icon" onClick={onClose} aria-label="Close" data-testid="picked-close">×</button>
      </div>
      <div style={{ position: 'relative', height: 190, borderRadius: 10, overflow: 'hidden', background: '#fff', border: '1px solid #e1e1e6' }}>
        <Viewport id="picked" hideGrid hideAxes bgOverride="#ffffff" home={[c[0] + ext * 1.3, c[1] - ext * 1.5, c[2] + ext * 0.9]} target={[c[0], c[1], c[2]]} threshold={0.02}>
          <CloudLayer cloud={p.pts} mode={p.pts.colors ? 'rgb' : 'height'} size={3} budget={60000} pickable={false} />
        </Viewport>
      </div>
      <table className="table"><tbody>
        <tr><td>Points</td><td className="mono">{fmtN(p.n)}</td></tr>
        <tr><td>Size</td><td className="mono">{size.map((v) => v.toFixed(2)).join(' × ')} m</td></tr>
        <tr><td>Centre</td><td className="mono">{c.map((v) => v.toFixed(1)).join(', ')}</td></tr>
        <tr><td>In the scan file</td><td>{p.classes.slice(0, 3).map(([n, k]) => `${n} ${Math.round((100 * k) / p.n)}%`).join(', ') || '—'}</td></tr>
      </tbody></table>
      {p.cl && <label className="field"><span>Your label</span><select value={name} onChange={(e) => onName(e.target.value)} data-testid="picked-label"><option value="">Unlabelled</option><option>Chair</option><option>Table</option><option>Cabinet</option><option>Other</option></select></label>}
      <span className="caption">Drag to turn it around. This is the cluster {id >= 0 ? 'on its own' : ''}, in the scan's real colours.</span>
    </div>
  );
}

export default function Tab6() {
  const s = useLab();
  const seg = s.seg;
  const p = seg.params;
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Show>('result');
  const [boxes, setBoxes] = useState(true);
  const [sel, setSel] = useState<number | null>(null); // the cluster or plane that was clicked (its id in the result)
  const [hideCeiling, setHideCeiling] = useState(true);
  const [pane, setPane] = useState<'setup' | 'results'>('setup');
  const [rawOpen, setRawOpen] = useState(false);
  const [sweep, setSweep] = useState<{ x: number[]; clusters: number[]; over: number[]; under: number[]; recovered: number[]; label: string } | null>(null);
  const [slots, setSlots] = useState<{ A?: { params: SegParams; clusters: number; recovered: number; over: number; under: number; noise: number }; B?: { params: SegParams; clusters: number; recovered: number; over: number; under: number; noise: number } }>({});
  // the classroom scan, with its furniture as the "true objects"
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  useEffect(() => { void loadClassroomForSegmentation().then(setCloud).catch((e) => s.notify((e as Error).message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const classCloud = useMemo(() => (cloud ? paintClasses(cloud) : null), [cloud]);
  const res: SegResult | null = seg.result;
  const gt = seg.gt;
  const ignore = useMemo(() => [0], []); // floor, walls and ceiling are not counted as objects
  const setP = (patch: Partial<SegParams>) => { if ('planeMax' in patch || 'planeMinPct' in patch || 'planeConfidence' in patch) setPlaneRes(null); setP0(patch); };
  const setP0 = (patch: Partial<SegParams>) => useLab.setState({ seg: { ...useLab.getState().seg, params: { ...p, ...patch } } });
  const hasGT = !!cloud?.instances;

  // two stages: 1) planes (RANSAC)  2) clusters (unsupervised) on what is left
  const [planeRes, setPlaneRes] = useState<SegResult | null>(null);
  const planesOnly = (r: SegResult): SegResult => { const d = r.display.slice(); for (let i = 0; i < d.length; i++) if (d[i] >= r.planes.length) d[i] = -1; return { ...r, display: d, clusters: [], noise: d.reduce((a, v) => a + (v < 0 ? 1 : 0), 0) }; };
  async function runPlanes() {
    if (!cloud) return;
    const out = await run({ ...p, algo: 'none' });
    if (!out) return;
    setPlaneRes(out.result);
    useLab.setState({ seg: { ...useLab.getState().seg, result: out.result, gt: null, cloudId: cloud.id, names: {} } });
    setShow('result');
  }
  async function runCluster() {
    if (!cloud) return;
    const out = await run(p, planeRes ?? undefined);
    if (!out) return;
    useLab.setState({ seg: { ...useLab.getState().seg, result: out.result, gt: out.gt as never, cloudId: cloud.id, names: {} } });
    setShow('result');
  }
  async function run(params = p, fromPlanes?: SegResult) {
    if (!cloud) return null;
    setBusy(true);
    try {
      const out = await runTask('segment', { cloud, params, ignore, fromPlanes });
      return out;
    } catch (e) { s.notify((e as Error).message, 'error'); return null; } finally { setBusy(false); }
  }
  async function runMain() {
    const out = await run();
    if (!out) return;
    setPlaneRes(planesOnly(out.result));
    useLab.setState({ seg: { ...useLab.getState().seg, result: out.result, gt: out.gt as never, cloudId: cloud!.id, names: {} } });
    setShow('result');
  }
  async function runSweep() {
    if (!cloud) return;
    setBusy(true);
    try {
      const values = p.algo === 'dbscan' ? [0.03, 0.06, 0.1, 0.15, 0.25, 0.4, 0.7] : [0.03, 0.06, 0.1, 0.15, 0.25, 0.4, 0.7];
      const x: number[] = [], clusters: number[] = [], over: number[] = [], under: number[] = [], recovered: number[] = [];
      for (const v of values) {
        const o = await runTask('segment', { cloud, params: { ...p, ...(p.algo === 'dbscan' ? { eps: v } : { radius: v }) }, ignore });
        x.push(v); clusters.push(o.result.clusters.length); over.push(o.gt?.overSegmented ?? 0); under.push(o.gt?.underSegmented ?? 0); recovered.push(o.gt?.recovered.length ?? 0);
      }
      setSweep({ x, clusters, over, under, recovered, label: p.algo === 'dbscan' ? 'ε (m)' : 'radius (m)' });
    } finally { setBusy(false); }
  }
  const snapshot = (slot: 'A' | 'B') => { if (!res || !gt) return; setSlots({ ...slots, [slot]: { params: { ...p }, clusters: res.clusters.length, recovered: gt.recovered.length, over: gt.overSegmented, under: gt.underSegmented, noise: res.noise } }); };

  // the main class (from the scan file) of the points in each cluster
  const guesses = useMemo(() => {
    if (!res || !cloud?.labels) return null;
    return res.clusters.map((c) => {
      const votes = new Map<number, number>();
      for (const i of c.indices) votes.set(cloud.labels![i], (votes.get(cloud.labels![i]) ?? 0) + 1);
      let truth = 0, best = 0;
      for (const [k, v] of votes) if (v > best) { best = v; truth = k; }
      return { c, truth };
    });
  }, [res, cloud]);

  const resultLabels = useMemo(() => (res ? res.display : null), [res]);
  const instLabels = useMemo(() => (cloud?.instances ? cloud.instances : null), [cloud]);
  const stale = res && cloud && seg.cloudId !== cloud.id;

  const viewport = (
    <Viewport home={[8, -10, 6.5]} target={[0, 0, 1.2]} hideGrid hideAxes bgOverride="#ffffff" threshold={0.09}>
      {cloud && (show === 'result' && resultLabels && !stale
        ? <CloudLayer cloud={cloud} mode="cluster" colorOpts={{ clusterLabels: resultLabels }} size={s.view.pointSize} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} onPick={(i) => { const id = resultLabels[i]; setSel(id >= 0 ? id : null); }} clip={{ on: hideCeiling, min: -1, max: 2.28 }} />
        : show === 'instances' && instLabels
          ? <CloudLayer cloud={cloud} mode="cluster" colorOpts={{ clusterLabels: instLabels }} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} clip={{ on: hideCeiling, min: -1, max: 2.28 }} />
          : <CloudLayer cloud={show === 'semantic' && classCloud ? classCloud : cloud} mode={show === 'semantic' || show === 'rgb' ? 'rgb' : 'height'} size={s.view.pointSize} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} clip={{ on: hideCeiling, min: -1, max: 2.28 }} />)}
      {boxes && res && !stale && res.clusters.map((c) => <BoxOutline key={c.id} bbox={{ min: c.min, max: c.max }} color={sel === c.id ? '#ffd60a' : `rgb(${distinctColor(c.id).map(Math.round).join(',')})`} dashed={sel !== c.id} />)}
    </Viewport>
  );

  // the clicked cluster: its own points in the scan's real colours, so you can see what it is
  const picked = useMemo(() => {
    if (sel === null || !res || !cloud || stale) return null;
    const cl = res.clusters.find((c) => c.id === sel);
    const pl = res.planes[sel];
    const ids = cl ? cl.indices : (() => { const a: number[] = []; res.display.forEach((d, i) => { if (d === sel) a.push(i); }); return Int32Array.from(a); })();
    if (!ids.length) return null;
    const pts = selectPoints(cloud, ids, 'picked');
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.count; i++) for (let a = 0; a < 3; a++) { const v = pts.positions[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    const classes = new Map<string, number>();
    if (cloud.labels) for (const i of ids) { const n = CLASSROOM_CLASSES[cloud.labels[i]]?.name ?? 'Other'; classes.set(n, (classes.get(n) ?? 0) + 1); }
    return { cl, pl, pts, mn, mx, classes: [...classes.entries()].sort((a, b) => b[1] - a[1]), n: ids.length };
  }, [sel, res, cloud, stale]);
  useEffect(() => { setSel(null); }, [res]);
  const stats = [
    { k: 'Clusters', v: res ? `${res.clusters.length}` : '—', s: res ? `${res.planes.length} planes removed · ${fmtN(res.noise)} unassigned` : 'press Segment' },
    { k: 'Objects found', v: gt ? `${gt.recovered.length} / ${gt.gtObjects}` : '—', s: gt ? `${gt.overSegmented} split · ${gt.underSegmented} merged` : hasGT ? 'press Segment' : 'needs labelled data' },
  ];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'setup', label: 'Settings' }, { value: 'results', label: 'Results' }]} label="Section" />
      {pane === 'setup' && (<>
      <Section title="Point cloud">
        {cloud ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span>{cloud.name}</span><Badge kind={cloud.meta.kind === 'simulated' ? 'sim' : 'measured'} /><span className="caption">{fmtN(cloud.count)} pts{hasGT ? ' · GT labels' : ''}</span></div> : <p className="hint">Loading the classroom…</p>}
        <p className="caption">“True” classes and objects come from the scan file, not from AI.</p>
      </Section>
      <Section title="1 · Plane detection (RANSAC)">
        <p className="hint">RANSAC finds the floor, walls and ceiling and takes them out first, so the objects can be clustered. Its distance and tries are measured from the data.</p>
        <Slider label="Planes to find, at most" value={p.planeMax} min={0} max={20} step={1} onChange={(planeMax) => setP({ planeMax })} hint="0 skips plane detection." />
        <Slider label="Smallest plane" value={p.planeMinPct} min={0.5} max={10} step={0.5} unit=" % of points" onChange={(planeMinPct) => setP({ planeMinPct })} hint="Stop when the best plane left is smaller than this." />
        <Slider label="Confidence" value={p.planeConfidence * 100} min={90} max={99.9} step={0.1} unit=" %" format={(v) => v.toFixed(1)} onChange={(v) => setP({ planeConfidence: v / 100 })} hint="How sure to be of finding each plane. Higher means more tries." />
        <Btn variant="primary" icon={<Play size={16} />} onClick={runPlanes} busy={busy} disabled={!cloud || p.planeMax === 0} testId="run-planes">Detect planes</Btn>
        {planeRes && <span className="caption">{planeRes.planes.length} planes found in {planeRes.ms.toFixed(0)} ms. Now cluster what is left.</span>}
      </Section>
      <Section title="2 · Clustering (unsupervised)">
        <Seg value={p.algo} onChange={(algo) => setP({ algo })} options={[{ value: 'euclidean', label: 'Euclidean' }, { value: 'dbscan', label: 'DBSCAN' }, { value: 'none', label: 'None' }]} />
        {p.algo === 'euclidean' && <Slider label="Cluster radius" value={p.radius} min={0.02} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(radius) => setP({ radius })} hint="Too small → one object breaks into pieces (over-segmentation). Too large → neighbours merge (under-segmentation)." />}
        {p.algo === 'dbscan' && (<>
          <Slider label="Epsilon ε" value={p.eps} min={0.02} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(eps) => setP({ eps })} />
          <Slider label="Min points" value={p.minPts} min={2} max={40} step={1} onChange={(minPts) => setP({ minPts })} hint="Points with fewer neighbours become noise." />
        </>)}
        <Slider label="Min cluster size" value={p.minCluster} min={5} max={500} step={5} onChange={(minCluster) => setP({ minCluster })} />
              <Btn variant="primary" icon={<Play size={16} />} onClick={runCluster} busy={busy} disabled={!cloud || (p.planeMax > 0 && !planeRes)} testId="run-cluster">Cluster</Btn>
        {p.planeMax > 0 && !planeRes && <span className="caption">Detect the planes first (stage 1).</span>}
      </Section>
      <Section title="Tutorial"><Credit keys={['ransac']} title="" /></Section>
      <Section title="Show">
        <Seg value={show} onChange={setShow} options={[{ value: 'result', label: 'Result' }, { value: 'instances', label: 'True objects' }, { value: 'semantic', label: 'True classes' }]} />
        <Toggle label="Cluster bounding boxes (estimated)" checked={boxes} onChange={setBoxes} />
        <Toggle label="Hide the ceiling" checked={hideCeiling} onChange={setHideCeiling} />
        {stale && <Callout kind="warn">The cloud changed since the last run — press Segment again.</Callout>}
      </Section>
      </>)}
      {pane === 'results' && (<>
        {!res && <p className="hint" style={{ paddingTop: 12 }}>Press Segment in the toolbar to see results here.</p>}
      {res && (
        <Section title="Result">
          <table className="table"><thead><tr><th>Plane</th><th>Normal</th><th>Pts</th><th>RMSE</th></tr></thead><tbody>
            {res.planes.map((pl, i) => <tr key={i}><td><span style={{ color: `rgb(${distinctColor(i).map(Math.round).join(',')})` }}>●</span> {pl.kind}</td><td className="mono">{pl.normal.map((v) => v.toFixed(2)).join(', ')}</td><td>{fmtN(pl.count)}</td><td className="mono">{(pl.rmse * 100).toFixed(1)} cm</td></tr>)}
          </tbody></table>
          <p className="hint"><b>Label the clusters.</b> The clusters only say “these points belong together”; they do not know what they are. Name each one yourself (look at its colour and size). The names you give are used as the objects of the scene graph in the next tab.</p>
          <table className="table" data-testid="label-table"><thead><tr><th>Cluster</th><th>Pts</th><th>Size (m)</th><th>Label</th></tr></thead><tbody>
            {res.clusters.map((c, i) => (
              <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: 'pointer', background: sel === c.id ? '#fff6d6' : undefined }} data-testid={`cluster-row-${i}`}><td><span style={{ color: `rgb(${distinctColor(c.id).map(Math.round).join(',')})` }}>●</span> #{i + 1}</td><td>{fmtN(c.count)}</td><td className="mono">{(c.max[0] - c.min[0]).toFixed(1)}×{(c.max[1] - c.min[1]).toFixed(1)}×{(c.max[2] - c.min[2]).toFixed(1)}</td>
                <td><select value={seg.names[c.id] ?? ''} aria-label={`Label for cluster ${i + 1}`} onChange={(e) => useLab.setState({ seg: { ...useLab.getState().seg, names: { ...useLab.getState().seg.names, [c.id]: e.target.value } } })} data-testid={`label-${i}`} style={{ minHeight: '1.9rem' }}>
                  <option value="">Unlabelled</option><option>Chair</option><option>Table</option><option>Cabinet</option><option>Other</option>
                </select></td></tr>
            ))}
          </tbody></table>
          <span className="caption">{Object.values(seg.names).filter(Boolean).length} of {res.clusters.length} clusters labelled.</span>
          <Callout kind="edu" title="Labelling by hand does not scale">Here you named every cluster yourself. In real projects a <b>semantic segmentation model</b> (a neural network trained on labelled point clouds, for example PointNet++, KPConv or Point Transformer) gives every point a class automatically, so no one has to label by hand. Your hand labels are exactly the kind of data such a model is trained on.</Callout>
          {gt && (
            <Callout kind={gt.recovered.length >= 3 ? 'good' : ''} title="Compared with ground-truth instances">
              Recovered {gt.recovered.length} of {gt.gtObjects} objects (IoU ≥ 0.5, purity ≥ 0.7). <b>{gt.overSegmented}</b> objects split across clusters (over-segmentation), <b>{gt.underSegmented}</b> clusters merge several objects (under-segmentation).
            </Callout>
          )}
        </Section>
      )}
      <Section title="Parameter sensitivity">
        <Btn onClick={runSweep} busy={busy} disabled={!cloud} icon={<Play size={16} />}>Sweep {p.algo === 'dbscan' ? 'ε' : 'radius'} (7 values)</Btn>
        {sweep && (<>
          <MiniChart series={[{ name: 'clusters', color: '#0a84ff', values: sweep.clusters }, { name: 'objects recovered', color: '#30d158', values: sweep.recovered }, { name: 'split', color: '#ff9f0a', values: sweep.over }, { name: 'merged', color: '#ff453a', values: sweep.under }]} yLabel={`vs ${sweep.label}: ${sweep.x.join(' · ')}`} />
          <span className="caption">Small values shatter objects (many clusters, many splits); large values merge them (few clusters, merges). A sweet spot recovers the most objects.</span>
        </>)}
      </Section>
      <Section title="Compare two configurations">
        <div className="btn-row"><Btn sm icon={<Plus size={14} />} onClick={() => snapshot('A')} disabled={!res}>Save current as A</Btn><Btn sm icon={<Plus size={14} />} onClick={() => snapshot('B')} disabled={!res}>Save current as B</Btn></div>
        {(slots.A || slots.B) && (
          <table className="table" data-testid="seg-compare"><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody>
            {(['clusters', 'recovered', 'over', 'under', 'noise'] as const).map((k) => <tr key={k}><td>{{ clusters: 'Clusters', recovered: 'Objects recovered', over: 'Split objects', under: 'Merged clusters', noise: 'Unassigned pts' }[k]}</td><td>{slots.A ? fmtN(slots.A[k]) : '—'}</td><td>{slots.B ? fmtN(slots.B[k]) : '—'}</td></tr>)}
            <tr><td>Settings</td><td className="caption">{slots.A ? `${slots.A.params.algo} ${slots.A.params.algo === 'dbscan' ? `ε${slots.A.params.eps}/${slots.A.params.minPts}` : `r${slots.A.params.radius}`} min${slots.A.params.minCluster}` : '—'}</td><td className="caption">{slots.B ? `${slots.B.params.algo} ${slots.B.params.algo === 'dbscan' ? `ε${slots.B.params.eps}/${slots.B.params.minPts}` : `r${slots.B.params.radius}`} min${slots.B.params.minCluster}` : '—'}</td></tr>
          </tbody></table>
        )}
      </Section>
      </>)}
    </>
  );

  const rawText = useMemo(() => (rawOpen && cloud ? new TextDecoder().decode(writePCD({ id: 'raw', name: 'segmented', count: cloud.count, positions: cloud.positions, meta: cloud.meta, ...(res ? { labels: res.display } : {}) } as PointCloud, false)) : ''), [rawOpen, cloud, res]);

  return (
    <TabFrame title="Clustering & Segmentation" tab={10} noEnv viewport={viewport} controls={controls} learn={null} noPanelTabs statsRow stats={stats}
      viewExtras={<><Btn sm variant="primary" icon={<Play size={15} />} onClick={runMain} busy={busy} disabled={!cloud} testId="run-seg">Segment</Btn><Btn sm icon={<FileText size={15} />} variant={rawOpen ? 'primary' : ''} onClick={() => setRawOpen(!rawOpen)} disabled={!cloud} testId="raw-toggle">Raw</Btn></>}
      overlays={picked ? <PickedCard p={picked} id={sel!} index={res!.clusters.findIndex((c) => c.id === sel)} name={seg.names[sel!] ?? ''} onName={(v) => useLab.setState({ seg: { ...useLab.getState().seg, names: { ...useLab.getState().seg.names, [sel!]: v } } })} onClose={() => setSel(null)} /> : rawOpen && cloud ? <RawViewer text={rawText} filename="segmented.pcd" onClose={() => setRawOpen(false)} /> : null} />
  );
}
