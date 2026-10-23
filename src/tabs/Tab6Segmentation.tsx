import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { className } from '../scenes/classes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { RawViewer } from '../ui/RawViewer';
import { writePCD } from '../io/pcd';
import { FileText } from '../ui/icons';
import { SceneFromStore, MiniChart } from './common';
import { CloudLayer, BoxOutline } from '../ui/three';
import { Play, RotateCcw, Plus } from '../ui/icons';
import { runTask } from '../engine/client';
import { runScan } from '../state/actions';
import { SegParams, SegResult } from '../segmentation/segment';
import { PointCloud } from '../core/pointcloud';
import { guessClass } from '../graph/sceneGraph';
import { distinctColor } from '../core/colorize';
import { Vec3 } from '../core/math';

type Show = 'result' | 'instances' | 'semantic' | 'rgb';

export default function Tab6() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const seg = s.seg;
  const p = seg.params;
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Show>('result');
  const [boxes, setBoxes] = useState(true);
  const [pane, setPane] = useState<'setup' | 'results'>('setup');
  const [showRoom, setShowRoom] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [sweep, setSweep] = useState<{ x: number[]; clusters: number[]; over: number[]; under: number[]; recovered: number[]; label: string } | null>(null);
  const [slots, setSlots] = useState<{ A?: { params: SegParams; clusters: number; recovered: number; over: number; under: number; noise: number }; B?: { params: SegParams; clusters: number; recovered: number; over: number; under: number; noise: number } }>({});
  const cloud: PointCloud | null = s.clouds['scan'] ?? s.clouds['explorer'] ?? null;
  // nothing to segment yet: scan the current scene so the tab works straight away
  useEffect(() => { const st = useLab.getState(); if (!st.clouds['scan'] && !st.clouds['explorer'] && !st.busy) void runScan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const res: SegResult | null = seg.result;
  const gt = seg.gt;
  const ignore = useMemo(() => scene.objects.filter((o) => o.structural).map((o) => o.instanceId), [scene]);
  const setP = (patch: Partial<SegParams>) => useLab.setState({ seg: { ...useLab.getState().seg, params: { ...p, ...patch } } });
  const hasGT = !!cloud?.instances;

  async function run(params = p) {
    if (!cloud) return null;
    setBusy(true);
    try {
      const out = await runTask('segment', { cloud, params, ignore });
      return out;
    } catch (e) { s.notify((e as Error).message, 'error'); return null; } finally { setBusy(false); }
  }
  async function runMain() {
    const out = await run();
    if (!out) return;
    useLab.setState({ seg: { ...useLab.getState().seg, result: out.result, gt: out.gt as never, cloudId: cloud!.id } });
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

  // class guesses (rule-based, estimated)
  const guesses = useMemo(() => {
    if (!res || !cloud?.labels) return null;
    return res.clusters.map((c) => {
      const dim: Vec3 = [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
      const g = guessClass(dim, c.min[2]);
      const votes = new Map<number, number>();
      for (const i of c.indices) votes.set(cloud.labels![i], (votes.get(cloud.labels![i]) ?? 0) + 1);
      let truth = 0, best = 0;
      for (const [k, v] of votes) if (v > best) { best = v; truth = k; }
      return { c, guess: g, truth };
    });
  }, [res, cloud]);

  const resultLabels = useMemo(() => (res ? res.display : null), [res]);
  const instLabels = useMemo(() => (cloud?.instances ? cloud.instances : null), [cloud]);
  const stale = res && cloud && seg.cloudId !== cloud.id;

  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} hideGrid hideAxes bgOverride="#ffffff">
      {showRoom && <SceneFromStore interactive={false} />}
      {cloud && (show === 'result' && resultLabels && !stale
        ? <CloudLayer cloud={cloud} mode="cluster" colorOpts={{ clusterLabels: resultLabels }} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />
        : show === 'instances' && instLabels
          ? <CloudLayer cloud={cloud} mode="cluster" colorOpts={{ clusterLabels: instLabels }} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />
          : <CloudLayer cloud={cloud} mode={show === 'semantic' ? 'semantic' : show === 'rgb' ? 'rgb' : 'height'} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />)}
      {boxes && res && !stale && res.clusters.map((c) => <BoxOutline key={c.id} bbox={{ min: c.min, max: c.max }} color={`rgb(${distinctColor(c.id).map(Math.round).join(',')})`} dashed />)}
    </Viewport>
  );

  const stats = [
    { k: 'Clusters', v: res ? `${res.clusters.length}` : '—', s: res ? `${res.planes.length} planes removed · ${fmtN(res.noise)} unassigned` : 'press Segment' },
    { k: 'Objects found', v: gt ? `${gt.recovered.length} / ${gt.gtObjects}` : '—', s: gt ? `${gt.overSegmented} split · ${gt.underSegmented} merged` : hasGT ? 'press Segment' : 'needs labelled data' },
  ];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'setup', label: 'Settings' }, { value: 'results', label: 'Results' }]} label="Section" />
      {pane === 'setup' && (<>
      <Section title="Point cloud">
        {cloud ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span>{cloud.name}</span><Badge kind={cloud.meta.kind === 'simulated' ? 'sim' : 'measured'} /><span className="caption">{fmtN(cloud.count)} pts{hasGT ? ' · GT labels' : ''}</span></div> : <div style={{ display: 'grid', gap: 8 }}><p className="hint">No point cloud yet. Scan the current scene to get one to segment.</p><Btn variant="primary" onClick={() => void runScan()} busy={!!s.busy}>Scan this scene</Btn></div>}
        <p className="caption">Planes are fitted by rule (RANSAC), clusters group nearby points without knowing what they are. Class labels shown are the simulator’s ground truth, not AI predictions.</p>
      </Section>
      <Section title="1 · Ground & planes (RANSAC)">
        <Toggle label="Remove ground plane" checked={p.removeGround} onChange={(removeGround) => setP({ removeGround })} hint="Largest nearly-horizontal plane (≤ 20° tilt)." />
        <Slider label="Extra planes to peel (walls…)" value={p.extraPlanes} min={0} max={8} step={1} onChange={(extraPlanes) => setP({ extraPlanes })} hint="Plane / object separation: remove walls before clustering." />
        <Slider label="Distance threshold" value={p.ransacThreshold} min={0.005} max={0.2} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(ransacThreshold) => setP({ ransacThreshold })} />
        <Slider label="Max iterations" value={p.ransacIterations} min={10} max={1000} step={10} onChange={(ransacIterations) => setP({ ransacIterations })} />
              </Section>
      <Section title="2 · Clustering (unsupervised)">
        <Seg value={p.algo} onChange={(algo) => setP({ algo })} options={[{ value: 'euclidean', label: 'Euclidean' }, { value: 'dbscan', label: 'DBSCAN' }, { value: 'none', label: 'None' }]} />
        {p.algo === 'euclidean' && <Slider label="Cluster radius" value={p.radius} min={0.02} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(radius) => setP({ radius })} hint="Too small → one object breaks into pieces (over-segmentation). Too large → neighbours merge (under-segmentation)." />}
        {p.algo === 'dbscan' && (<>
          <Slider label="Epsilon ε" value={p.eps} min={0.02} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(eps) => setP({ eps })} />
          <Slider label="Min points" value={p.minPts} min={2} max={40} step={1} onChange={(minPts) => setP({ minPts })} hint="Points with fewer neighbours become noise." />
        </>)}
        <Slider label="Min cluster size" value={p.minCluster} min={5} max={500} step={5} onChange={(minCluster) => setP({ minCluster })} />
      </Section>
      <Section title="Show">
        <Seg value={show} onChange={setShow} options={[{ value: 'result', label: 'Result' }, { value: 'instances', label: 'True objects' }, { value: 'semantic', label: 'True classes' }]} />
        <Toggle label="Cluster bounding boxes (estimated)" checked={boxes} onChange={setBoxes} />
        <Toggle label="Show the room" checked={showRoom} onChange={setShowRoom} />
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
          <table className="table"><thead><tr><th>Cluster</th><th>Pts</th><th>Size (m)</th>{guesses && <th>Rule guess</th>}</tr></thead><tbody>
            {res.clusters.slice(0, 14).map((c, i) => {
              const g = guesses?.[i];
              return <tr key={c.id}><td><span style={{ color: `rgb(${distinctColor(c.id).map(Math.round).join(',')})` }}>●</span> #{i + 1}</td><td>{fmtN(c.count)}</td><td className="mono">{(c.max[0] - c.min[0]).toFixed(1)}×{(c.max[1] - c.min[1]).toFixed(1)}×{(c.max[2] - c.min[2]).toFixed(1)}</td>{g && <td>{className(g.guess.classId)}{g.guess.classId === g.truth ? ' ✓' : ` ✗ (${className(g.truth)})`}</td>}</tr>;
            })}
          </tbody></table>
          {res.clusters.length > 14 && <span className="caption">…and {res.clusters.length - 14} more clusters.</span>}
          {gt && (
            <Callout kind={gt.recovered.length >= 3 ? 'good' : ''} title="Compared with ground-truth instances">
              Recovered {gt.recovered.length} of {gt.gtObjects} objects (IoU ≥ 0.5, purity ≥ 0.7). <b>{gt.overSegmented}</b> objects split across clusters (over-segmentation), <b>{gt.underSegmented}</b> clusters merge several objects (under-segmentation).
              {guesses && <div style={{ marginTop: 6 }}>Rule-based class guess correct for {guesses.filter((g) => g.guess.classId === g.truth).length} of {guesses.length} clusters — a crude size heuristic, shown only to contrast with real learned segmentation.</div>}
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
    <TabFrame title="Clustering & Segmentation" tab={7} viewport={viewport} controls={controls} learn={null} noPanelTabs statsRow stats={stats}
      viewExtras={<><Btn sm variant="primary" icon={<Play size={15} />} onClick={runMain} busy={busy} disabled={!cloud} testId="run-seg">Segment</Btn><Btn sm icon={<FileText size={15} />} variant={rawOpen ? 'primary' : ''} onClick={() => setRawOpen(!rawOpen)} disabled={!cloud} testId="raw-toggle">Raw</Btn></>}
      overlays={rawOpen && cloud ? <RawViewer text={rawText} filename="segmented.pcd" onClose={() => setRawOpen(false)} /> : null} />
  );
}
