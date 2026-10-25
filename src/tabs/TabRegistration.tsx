import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Select, Slider, fmtN } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { MiniChart } from './common';
import { CloudLayer } from '../ui/three';
import { Play, Wand } from '../ui/icons';
import { runTask } from '../engine/client';
import { cloudBounds, transformCloud, PointCloud } from '../core/pointcloud';
import { parsePointCloud } from '../io/load';
import { D2R, R2D, rigidFromEuler, rotationAngle, rigidApply, rigidCompose, Rigid, Vec3 } from '../core/math';
import { evaluateAlignment } from '../registration/icp';
import { makeRng } from '../core/rng';

type Method = 'point' | 'plane';
interface Source { id: string; label: string; file: string; note: string }
const SOURCES: Source[] = [
  { id: 'vlp16', label: 'Street scan (Velodyne VLP-16)', file: 'velodyne_vlp16_f0.ply', note: 'A sparse real scan with 16 rings: few points, long distances.' },
  { id: 'os1', label: 'Street scan (Ouster OS1-128)', file: 'ouster_os1128_f0.ply', note: 'A denser real scan with 128 rings.' },
  { id: 'tree', label: 'Tree (RIEGL VZ-400, TLS)', file: 'riegl_vz400_tree.ply', note: 'A very dense scan of one tree: lots of detail, few flat surfaces.' },
];
const BASE_CLOUD = new Map<string, PointCloud>();
async function loadSource(src: Source): Promise<PointCloud> {
  const hit = BASE_CLOUD.get(src.id);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}data/${src.file}`);
  if (!res.ok) throw new Error(`Could not load ${src.file}`);
  const c = parsePointCloud(await res.arrayBuffer(), src.file);
  BASE_CLOUD.set(src.id, c);
  return c;
}

const mkCloud = (id: string, name: string, pts: number[]): PointCloud => ({ id, name, count: pts.length / 3, positions: new Float32Array(pts), meta: { source: 'generated' } as PointCloud['meta'] });

/** Split one real scan into two clouds that sample the same surfaces: A (reference) and B (partly overlapping, noisy). */
function makePair(base: PointCloud, overlap: number, noise: number, seed: number): { A: PointCloud; B: PointCloud } {
  const n = base.count, step = Math.max(1, Math.floor(n / 40000));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) { const x = base.positions[i * 3], y = base.positions[i * 3 + 1], z = base.positions[i * 3 + 2]; if (Number.isFinite(x + y + z)) idx.push(i); }
  // centre on the median so sliders (metres) behave the same for every cloud
  const med = (k: number) => { const a = idx.map((i) => base.positions[i * 3 + k]).sort((p, q) => p - q); return a[a.length >> 1]; };
  const c = [med(0), med(1), med(2)];
  const rng = makeRng(seed);
  const near = idx.filter((i) => Math.hypot(base.positions[i * 3] - c[0], base.positions[i * 3 + 1] - c[1]) < 30);
  const use = near.length > 2000 ? near : idx;
  const a: number[] = [], b: number[] = [];
  const xs = use.map((i) => base.positions[i * 3] - c[0]).sort((p, q) => p - q);
  const cut = xs[Math.floor(xs.length * (1 - overlap))];
  use.forEach((i, j) => {
    const x = base.positions[i * 3] - c[0], y = base.positions[i * 3 + 1] - c[1], z = base.positions[i * 3 + 2] - c[2];
    if (j % 2 === 0) a.push(x, y, z);
    else if (x >= cut) b.push(x + rng.gauss() * noise, y + rng.gauss() * noise, z + rng.gauss() * noise);
  });
  return { A: mkCloud('reg-a', 'Cloud A (reference)', a), B: mkCloud('reg-b', 'Cloud B', b) };
}

const errOf = (r: ReturnType<typeof useLab.getState>['reg']): Rigid => rigidFromEuler(r.errT[0], r.errT[1], r.errT[2], r.errYawDeg * D2R, r.errPitchDeg * D2R, r.errRollDeg * D2R);
interface Run { label: string; before: number; after: number; err: string; iters: number }

export default function TabRegistration() {
  const s = useLab();
  const reg = s.reg;
  const setReg = (patch: Partial<typeof reg>) => s.patch({ reg: { ...useLab.getState().reg, ...patch } });
  const [srcId, setSrcId] = useState('vlp16');
  const overlap = 0.8, noise = 0.02; // fixed: partial overlap and a little sensor noise
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [calc, setCalc] = useState<{ rmse: number; fitness: number; t: number; deg: number } | null>(null);
  const [method, setMethod] = useState<Method>('point');
  const [trim, setTrim] = useState(1);
  const [view, setView] = useState<'before' | 'both' | 'after'>('both');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const source = SOURCES.find((x) => x.id === srcId)!;

  useEffect(() => {
    let on = true;
    setBusy(true);
    loadSource(source).then((base) => {
      if (!on) return;
      const { A, B } = makePair(base, overlap, noise, 21);
      setReg({ A, B, result: null, before: null, after: null, recoveredErr: null, iter: 0 });
    }).catch((e) => useLab.getState().notify((e as Error).message, 'error')).finally(() => on && setBusy(false));
    return () => { on = false; };
  }, [srcId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRuns([]); }, [srcId]);

  const Bmis = useMemo(() => (reg.B ? transformCloud(reg.B, errOf(reg), 'Cloud B (moved)') : null), [reg.B, reg.errT, reg.errYawDeg, reg.errPitchDeg, reg.errRollDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const ident = rigidFromEuler(0, 0, 0, 0, 0, 0);
  const live = useMemo(() => (reg.A && Bmis ? evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, ident, 1.5, 3000) : null), [reg.A, Bmis]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setCalc(null); }, [Bmis]);
  function calculate() {
    if (!reg.A || !Bmis) return;
    const e = evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, ident, 1.5, 3000);
    const E = errOf(reg);
    setCalc({ rmse: e.rmse, fitness: e.fitness, t: Math.hypot(E.t[0], E.t[1], E.t[2]), deg: rotationAngle(E.R) * R2D });
  }

  async function runIcp() {
    if (!reg.A || !Bmis) return;
    setBusy(true);
    try {
      const before = evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, ident, 1.5, 3000);
      const r = await runTask('icp', { src: Bmis.positions, nSrc: Bmis.count, dst: reg.A.positions, nDst: reg.A.count, opts: { maxIterations: reg.icp.maxIterations, tolerance: 1e-6, maxCorrDist: reg.icp.maxCorrDist, sampleMax: reg.icp.sample, method, trim } });
      const after = evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, r.T, 1.5, 3000);
      const total = rigidCompose(r.T, errOf(reg));
      const c: Vec3 = [reg.B!.positions[0], reg.B!.positions[1], reg.B!.positions[2]];
      const pc = rigidApply(total, c);
      const rec = { t: Math.hypot(pc[0] - c[0], pc[1] - c[1], pc[2] - c[2]), deg: rotationAngle(total.R) * R2D };
      setReg({ result: r, before, after, iter: r.history.length - 1, recoveredErr: rec });
      setRuns((l) => [{ label: `${method === 'point' ? 'Point-to-point' : 'Point-to-plane'}${trim < 1 ? `, best ${Math.round(trim * 100)} %` : ''}, dist ${reg.icp.maxCorrDist.toFixed(1)} m`, before: before.rmse, after: after.rmse, err: `${(rec.t * 100).toFixed(1)} cm · ${rec.deg.toFixed(2)}°`, iters: r.history.length }, ...l].slice(0, 6));
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const iterIdx = reg.result ? Math.min(reg.iter, reg.result.history.length - 1) : 0;
  const Bafter = useMemo(() => (mode === 'auto' && reg.result && Bmis ? transformCloud(Bmis, reg.result.history[iterIdx].T, 'Cloud B (aligned)') : null), [mode, reg.result, Bmis, iterIdx]);

  const bounds = useMemo(() => (reg.A ? cloudBounds(reg.A) : null), [reg.A]);
  const size = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 1) : 10;
  const cen: [number, number, number] = bounds ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2] : [0, 0, 0];
  const flat = (rgb: [number, number, number]) => ({ flat: rgb });
  const ps = Math.max(2, s.view.pointSize);

  const viewport = (
    <Viewport home={[cen[0] + size * 0.45, cen[1] - size * 0.45, cen[2] + size * 0.35]} target={cen} gridSize={Math.max(1, size / 10)} bgOverride="#ffffff" threshold={0.05}>
      {reg.A && <CloudLayer cloud={reg.A} mode="flat" colorOpts={flat([10, 132, 255])} size={ps} budget={200000} pickable={false} />}
      {Bmis && (view !== 'after' || !Bafter) && <CloudLayer cloud={Bmis} mode="flat" colorOpts={flat([255, 159, 10])} size={ps} budget={200000} pickable={false} />}
      {Bafter && view !== 'before' && <CloudLayer cloud={Bafter} mode="flat" colorOpts={flat([48, 209, 88])} size={ps} budget={200000} pickable={false} />}
    </Viewport>
  );

  const reset = { result: null, after: null, recoveredErr: null } as const;
  const slide = (k: 0 | 1 | 2, label: string) => <Slider key={label} label={label} value={reg.errT[k]} min={-2} max={2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => { const e = [...reg.errT] as [number, number, number]; e[k] = v; setReg({ errT: e, ...reset }); }} />;

  const auto = mode === 'auto';
  const stats = auto
    ? [
      { k: 'RMSE before', v: reg.before ? `${(reg.before.rmse * 100).toFixed(1)} cm` : '—', s: 'when ICP started' },
      { k: 'RMSE after', v: reg.after ? `${(reg.after.rmse * 100).toFixed(1)} cm` : '—', s: 'average gap between matched points' },
      { k: 'Overlap found', v: reg.after ? `${(reg.after.fitness * 100).toFixed(0)} %` : '—', s: 'points with a match within 1.5 m' },
      { k: 'Error left', v: reg.recoveredErr ? `${(reg.recoveredErr.t * 100).toFixed(1)} cm · ${reg.recoveredErr.deg.toFixed(2)}°` : '—', s: 'compared with the true answer' },
    ]
    : [
      { k: 'RMSE', v: calc ? `${(calc.rmse * 100).toFixed(1)} cm` : '—', s: 'press Calculate' },
      { k: 'Overlap found', v: calc ? `${(calc.fitness * 100).toFixed(0)} %` : '—', s: 'points with a match within 1.5 m' },
      { k: 'B moved by', v: calc ? `${(calc.t * 100).toFixed(1)} cm · ${calc.deg.toFixed(1)}°` : '—', s: 'from its true place' },
    ];

  // matrix shown on the canvas: the move you made (manual) or the move ICP found (automatic)
  const shownT: Rigid | null = auto ? (reg.result ? reg.result.history[iterIdx].T : null) : errOf(reg);
  const matrix = shownT ? [[shownT.R[0], shownT.R[1], shownT.R[2], shownT.t[0]], [shownT.R[3], shownT.R[4], shownT.R[5], shownT.t[1]], [shownT.R[6], shownT.R[7], shownT.R[8], shownT.t[2]], [0, 0, 0, 1]] : null;
  const matrixBox = (
    <div data-testid="transform-matrix" style={{ position: 'absolute', right: 14, bottom: 14, background: 'rgba(255,255,255,.92)', border: '1px solid var(--line, #d2d2d7)', borderRadius: 12, padding: '8px 12px', pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,.08)' }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 4 }}>{auto ? 'Transform found by ICP' : 'Transform you applied to B'}</div>
      {matrix ? (
        <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 3.6rem)', gap: '2px 6px', fontSize: '0.8125rem', textAlign: 'right' }}>
          {matrix.flat().map((v, i) => <span key={i} style={{ opacity: i >= 12 ? 0.5 : 1 }}>{(Math.abs(v) < 5e-4 ? 0 : v).toFixed(3)}</span>)}
        </div>
      ) : <span className="hint">Run ICP to see it.</span>}
    </div>
  );

  const controls = (
    <>
      <Callout kind="edu" title="What is registration?">
        Two scans of the same place start in different positions. <b>Registration</b> finds the move (shift + turn) that lays cloud B (orange) on top of cloud A (blue). ICP does it by repeating: match each B point to its nearest A point, then move B to shrink the gaps.
      </Callout>
      <Section title="1 · Two clouds">
        <Select<string> label="Scene" value={srcId} onChange={setSrcId} options={SOURCES.map((x) => ({ value: x.id, label: x.label }))} />
        <p className="hint">{source.note} A and B use different points of the same scan, and B only sees part of it.</p>
      </Section>
      <Section title="2 · Align the clouds">
        <Seg value={mode} onChange={setMode} label="How" options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automatic (ICP)' }]} />
      </Section>
      {mode === 'manual' ? (
        <Section title="Move cloud B by hand">
        {slide(0, 'Shift X')}
        {slide(1, 'Shift Y')}
        {slide(2, 'Shift Z')}
        <Slider label="Turn (yaw)" value={reg.errYawDeg} min={-45} max={45} step={0.5} unit="°" onChange={(v) => setReg({ errYawDeg: v, ...reset })} />
        <Slider label="Tilt (pitch)" value={reg.errPitchDeg} min={-15} max={15} step={0.25} unit="°" onChange={(v) => setReg({ errPitchDeg: v, ...reset })} />
        <Slider label="Tilt (roll)" value={reg.errRollDeg} min={-15} max={15} step={0.25} unit="°" onChange={(v) => setReg({ errRollDeg: v, ...reset })} />
        <div className="btn-row">
          <Btn sm icon={<Wand size={15} />} onClick={() => { const r = makeRng(Date.now() & 0xffff); setReg({ errT: [r.range(-1, 1), r.range(-1, 1), r.range(-0.2, 0.2)], errYawDeg: r.range(-15, 15), errPitchDeg: r.range(-3, 3), errRollDeg: r.range(-3, 3), ...reset }); }}>Random move</Btn>
          <Btn sm onClick={() => setReg({ errT: [0, 0, 0], errYawDeg: 0, errPitchDeg: 0, errRollDeg: 0, ...reset })}>Put back</Btn>
        </div>
          <Btn variant="primary" onClick={calculate} disabled={!reg.A} testId="calculate">Calculate</Btn>
          <p className="hint">Line B up with A using the sliders, then press Calculate to see the numbers. The matrix in the corner of the view is the move you made.</p>
        </Section>
      ) : (
        <Section title="Let ICP do it">
          <p className="hint">ICP starts from where B is now. Use Manual to give it a start, or press Random move below.</p>
        <Seg value={method} onChange={setMethod} label="Algorithm" options={[{ value: 'point', label: 'Point-to-point' }, { value: 'plane', label: 'Point-to-plane' }]} />
        <p className="hint">{method === 'point' ? 'Pulls each B point towards its nearest A point. Simple and robust.' : 'Only slides B along the surface direction of A (uses surface normals). Converges faster on flat walls and floors.'}</p>
        <Slider label="Match distance" value={reg.icp.maxCorrDist} min={0.1} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(maxCorrDist) => setReg({ icp: { ...reg.icp, maxCorrDist } })} hint="Only pairs closer than this count. Too small: ICP sees nothing. Too large: wrong pairs pull it off." />
        <Slider label="Keep best pairs" value={trim * 100} min={30} max={100} step={5} unit=" %" format={(v) => v.toFixed(0)} onChange={(v) => setTrim(v / 100)} hint="Ignore the worst pairs each round. Helps when the clouds only partly overlap." />
        <Slider label="Max iterations" value={reg.icp.maxIterations} min={5} max={150} step={5} onChange={(maxIterations) => setReg({ icp: { ...reg.icp, maxIterations } })} />
        <Slider label="Points used" value={reg.icp.sample} min={500} max={8000} step={500} format={fmtN} onChange={(sample) => setReg({ icp: { ...reg.icp, sample } })} />
        <Btn variant="primary" icon={<Play size={16} />} onClick={runIcp} busy={busy} disabled={!reg.A} testId="run-icp">Run ICP</Btn>
          <div className="btn-row">
            <Btn sm icon={<Wand size={15} />} onClick={() => { const r = makeRng(Date.now() & 0xffff); setReg({ errT: [r.range(-1, 1), r.range(-1, 1), r.range(-0.2, 0.2)], errYawDeg: r.range(-15, 15), errPitchDeg: r.range(-3, 3), errRollDeg: r.range(-3, 3), ...reset }); }}>Random move</Btn>
            <Btn sm onClick={() => setReg({ errT: [0, 0, 0], errYawDeg: 0, errPitchDeg: 0, errRollDeg: 0, ...reset })}>Put back</Btn>
          </div>
        </Section>
      )}
      {auto && reg.result && (
        <Section title="Result">
          <Seg value={view} onChange={setView} options={[{ value: 'before', label: 'Before' }, { value: 'both', label: 'Overlay' }, { value: 'after', label: 'After' }]} />
          <Slider label="Iteration" value={iterIdx} min={0} max={reg.result.history.length - 1} step={1} onChange={(iter) => setReg({ iter })} format={(v) => `${v + 1} / ${reg.result!.history.length}`} />
          <MiniChart series={[{ name: 'RMSE (cm)', color: '#ff9f0a', values: reg.result.history.map((h) => h.rmse * 100) }]} yLabel="gap between matched points (cm)" xLabel="iteration" />
          <p className="hint">{reg.result.converged ? 'Stopped: the error stopped improving.' : 'Stopped at the iteration limit.'}</p>
        </Section>
      )}
      {auto && runs.length > 0 && (
        <Section title="Compare your runs">
          <table className="table"><thead><tr><td>Settings</td><td>RMSE</td><td>Error left</td></tr></thead><tbody>
            {runs.map((r, i) => <tr key={i}><td>{r.label}</td><td className="mono">{(r.before * 100).toFixed(1)} → {(r.after * 100).toFixed(1)} cm</td><td className="mono">{r.err}</td></tr>)}
          </tbody></table>
          <p className="hint">Change one setting at a time and run again to see what it does.</p>
        </Section>
      )}
    </>
  );

  return (
    <TabFrame
      title="Point Cloud Registration"
      tab={5}
      viewport={viewport}
      controls={controls}
      learn={null}
      noPanelTabs
      noEnv
      stats={stats}
      overlays={<><KindLegend items={[{ color: '#0a84ff', label: 'Cloud A (reference)' }, { color: '#ff9f0a', label: 'Cloud B (to move)' }, { color: '#30d158', label: 'B after ICP' }]} />{matrixBox}</>}
    />
  );
}
