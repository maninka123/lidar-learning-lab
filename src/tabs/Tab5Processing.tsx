import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab, pushUndo } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Select, Slider, Toggle, Badge, cloudBadge, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore } from './common';
import { CloudLayer } from '../ui/three';
import { Download, Play, Plus, Trash2, RotateCcw } from '../ui/icons';
import { runTask } from '../engine/client';
import { OpSpec, OpType, OP_LABEL, defaultOp, PipelineResult } from '../processing/pipeline';
import { cloudBounds, PointCloud } from '../core/pointcloud';
import { exportCloudFile, runScan, activeCloud } from '../state/actions';
import { ColorMode } from '../core/colorize';

const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-US'));
const OP_TYPES: OpType[] = ['crop', 'voxel', 'random', 'noise', 'outliers', 'dropout', 'sor', 'ror', 'normals', 'rigid'];
const OP_HELP: Record<OpType, string> = {
  crop: 'Keep only points inside an axis-aligned box.',
  voxel: 'One averaged point per occupied voxel — even density, fewer points.',
  random: 'Keep each point with the given probability (seeded).',
  noise: 'Add Gaussian noise to every coordinate (σ in metres).',
  outliers: 'Inject uniformly distributed random points around the cloud (tagged so we can score cleaning).',
  dropout: 'Randomly delete points to imitate missing returns.',
  sor: 'Remove points whose mean distance to their k neighbours is more than mean + ratio·σ.',
  ror: 'Remove points with fewer than N neighbours inside a radius.',
  normals: 'PCA of the k nearest neighbours; normals face the cloud centre.',
  rigid: 'Translate/rotate the whole cloud.',
};

function OpEditor({ op, onChange }: { op: OpSpec; onChange: (o: OpSpec) => void }) {
  switch (op.type) {
    case 'crop':
      return (
        <>
          {(['X', 'Y', 'Z'] as const).map((ax, a) => (
            <div key={ax} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <NumberField label={`${ax} min`} value={op.min[a]} step={0.1} onChange={(v) => onChange({ ...op, min: op.min.map((m, k) => (k === a ? v : m)) as typeof op.min })} />
              <NumberField label={`${ax} max`} value={op.max[a]} step={0.1} onChange={(v) => onChange({ ...op, max: op.max.map((m, k) => (k === a ? v : m)) as typeof op.max })} />
            </div>
          ))}
          <Toggle label="Remove inside instead" checked={!!op.invert} onChange={(invert) => onChange({ ...op, invert })} />
        </>
      );
    case 'voxel': return <Slider label="Voxel size" value={op.size} min={0.01} max={0.5} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(size) => onChange({ ...op, size })} />;
    case 'random': return <Slider label="Keep ratio" value={op.ratio} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(ratio) => onChange({ ...op, ratio })} />;
    case 'noise': return <Slider label="Noise σ" value={op.sigma} min={0} max={0.15} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(sigma) => onChange({ ...op, sigma })} />;
    case 'outliers': return <Slider label="Outlier fraction" value={op.fraction} min={0.005} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(fraction) => onChange({ ...op, fraction })} />;
    case 'dropout': return <Slider label="Dropout probability" value={op.p} min={0} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(p) => onChange({ ...op, p })} />;
    case 'sor':
      return (<>
        <Slider label="Neighbours k" value={op.k} min={4} max={64} step={1} onChange={(k) => onChange({ ...op, k })} />
        <Slider label="Std-dev ratio" value={op.std} min={0.3} max={4} step={0.1} format={(v) => v.toFixed(1)} onChange={(std) => onChange({ ...op, std })} hint="Lower = more aggressive." />
      </>);
    case 'ror':
      return (<>
        <Slider label="Radius" value={op.radius} min={0.02} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(radius) => onChange({ ...op, radius })} />
        <Slider label="Min neighbours" value={op.minN} min={1} max={30} step={1} onChange={(minN) => onChange({ ...op, minN })} />
      </>);
    case 'normals': return <Slider label="Neighbours k" value={op.k} min={5} max={50} step={1} onChange={(k) => onChange({ ...op, k })} />;
    case 'rigid':
      return (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <NumberField label="tx (m)" value={op.tx} onChange={(tx) => onChange({ ...op, tx })} /><NumberField label="ty (m)" value={op.ty} onChange={(ty) => onChange({ ...op, ty })} /><NumberField label="tz (m)" value={op.tz} onChange={(tz) => onChange({ ...op, tz })} />
          <NumberField label="yaw °" value={op.yaw} step={1} onChange={(yaw) => onChange({ ...op, yaw })} /><NumberField label="pitch °" value={op.pitch} step={1} onChange={(pitch) => onChange({ ...op, pitch })} /><NumberField label="roll °" value={op.roll} step={1} onChange={(roll) => onChange({ ...op, roll })} />
        </div>
      </>);
  }
}

export default function Tab5() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const proc = s.proc;
  const ids = Object.keys(s.clouds).filter((k) => !k.startsWith('proc'));
  const original: PointCloud | null = (proc.sourceId && s.clouds[proc.sourceId]) || (ids.length ? s.clouds[ids[0]] : null);
  const [running, setRunning] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const [addType, setAddType] = useState<OpType>('noise');
  const reqId = useRef(0);
  const setProc = (patch: Partial<typeof proc>) => useLab.setState({ proc: { ...useLab.getState().proc, ...patch } });

  // keep the source pinned
  useEffect(() => { if (original && proc.sourceId !== Object.keys(s.clouds).find((k) => s.clouds[k] === original)) setProc({ sourceId: Object.keys(s.clouds).find((k) => s.clouds[k] === original) ?? null }); }, [original]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepsKey = JSON.stringify(proc.steps) + proc.seed + (original?.id ?? '');
  useEffect(() => {
    if (!original) { setProc({ result: null, quality: null }); return; }
    if (!proc.steps.length) { setProc({ result: null, quality: null, viewStep: -1 }); s.setCloud('proc-final', null, false); return; }
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setRunning(true);
      try {
        const res = await runTask('pipeline', { original, steps: proc.steps, seed: proc.seed });
        if (my !== reqId.current) return;
        let injected = 0;
        for (const st of res.steps) { if (st.cloud.tags) { let n = 0; for (let i = 0; i < st.cloud.count; i++) n += st.cloud.tags[i]; injected = Math.max(injected, n); } }
        let left = 0;
        if (res.final.tags) for (let i = 0; i < res.final.count; i++) left += res.final.tags[i];
        const quality = injected > 0 ? { injected, injectedLeft: left, originalKept: Math.min(1, (res.final.count - left) / Math.max(1, original.count)) } : null;
        const final = res.final; final.name = 'Processed cloud';
        useLab.setState({ proc: { ...useLab.getState().proc, result: res, quality, viewStep: Math.min(useLab.getState().proc.viewStep, res.steps.length - 1) < 0 ? res.steps.length - 1 : Math.min(useLab.getState().proc.viewStep, res.steps.length - 1) } });
        useLab.getState().setCloud('proc-final', final, false);
      } finally { if (my === reqId.current) setRunning(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [stepsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const res: PipelineResult | null = proc.result;
  const viewIdx = res ? Math.min(Math.max(proc.viewStep, 0), res.steps.length - 1) : -1;
  const processed = res && viewIdx >= 0 ? res.steps[viewIdx].cloud : null;
  const leftCloud = original;
  const rightCloud = processed ?? original;
  const mode: ColorMode = highlight && rightCloud?.tags ? 'cluster' : s.view.colorMode;
  const b = original ? cloudBounds(original) : null;
  const heightRange: [number, number] | undefined = b ? [b.min[2], b.max[2]] : undefined;
  const tagLabels = (c: PointCloud | null) => (c?.tags ? Int32Array.from(c.tags) : null);

  const update = (i: number, o: OpSpec) => setProc({ steps: proc.steps.map((x, k) => (k === i ? o : x)) });
  const addStep = () => {
    const op = defaultOp(addType);
    if (op.type === 'crop' && b) { op.min = [b.min[0] + 0.5, b.min[1] + 0.5, b.min[2]]; op.max = [b.max[0] - 0.5, b.max[1] - 0.5, b.max[2]]; }
    const prev = proc.steps;
    setProc({ steps: [...prev, op], viewStep: prev.length });
    pushUndo(`add ${OP_LABEL[addType]}`, () => setProc({ steps: prev }));
  };
  const removeStep = (i: number) => { const prev = proc.steps; setProc({ steps: prev.filter((_, k) => k !== i), viewStep: -1 }); pushUndo('remove step', () => setProc({ steps: prev })); };
  const move = (i: number, d: -1 | 1) => { const a = [...proc.steps]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setProc({ steps: a }); };

  const stats = res && processed
    ? [
      { k: 'Points before → after', v: `${compact(res.steps[viewIdx].before)} → ${compact(res.steps[viewIdx].after)}`, s: `step ${viewIdx + 1}: ${OP_LABEL[res.steps[viewIdx].op.type]}` },
      { k: 'Original → final', v: `${compact(original!.count)} → ${compact(res.final.count)}`, s: `${res.steps.length} step(s)` },
      { k: 'Processing time', v: `${res.steps[viewIdx].ms.toFixed(0)} ms`, s: `${res.totalMs.toFixed(0)} ms for the pipeline` },
      { k: 'Outlier score', v: proc.quality ? `${((1 - proc.quality.injectedLeft / proc.quality.injected) * 100).toFixed(0)}% removed` : '—', s: proc.quality ? `${(proc.quality.originalKept * 100).toFixed(0)}% of original kept` : 'inject outliers to score' },
    ]
    : [{ k: 'Points', v: original ? fmtN(original.count) : '—', s: 'original (immutable)' }, { k: 'Steps', v: proc.steps.length }, { k: 'Seed', v: proc.seed }, { k: 'Status', v: running ? 'running…' : 'ready' }];

  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="proc-a" group="proc" primary label="Original (immutable)" home={scene.cameraHome} target={scene.cameraTarget}>
          <SceneFromStore interactive={false} />
          {leftCloud && <CloudLayer cloud={leftCloud} mode={mode} size={s.view.pointSize} budget={s.view.renderBudget} colorOpts={{ heightRange, clusterLabels: tagLabels(leftCloud) }} pickable={false} />}
        </Viewport>
      </div>
      <div style={{ position: 'relative' }}>
        <Viewport id="proc-b" group="proc" primary={false} labelPos="bl" label={res && viewIdx >= 0 ? `Processed · step ${viewIdx + 1}: ${OP_LABEL[res.steps[viewIdx].op.type]}` : 'Processed'} home={scene.cameraHome} target={scene.cameraTarget}>
          <SceneFromStore interactive={false} />
          {rightCloud && <CloudLayer cloud={rightCloud} mode={mode} size={s.view.pointSize} budget={s.view.renderBudget} colorOpts={{ heightRange, clusterLabels: tagLabels(rightCloud) }} pickable={false} />}
        </Viewport>
      </div>
    </div>
  );

  const controls = (
    <>
      <Section title="Original data">
        {ids.length ? (
          <Select value={proc.sourceId ?? ids[0]} options={ids.map((k) => ({ value: k, label: `${s.clouds[k].name} (${fmtN(s.clouds[k].count)})` }))} onChange={(k) => setProc({ sourceId: k, steps: [], result: null, quality: null })} />
        ) : <p className="hint">Create a point cloud first.</p>}
        <Btn icon={<Play size={16} />} onClick={() => runScan({ withCoverage: false })} busy={!!s.busy}>Scan current scene</Btn>
        {original && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge kind={cloudBadge(original.meta.kind)} /><span className="caption">{fmtN(original.count)} points · never modified</span></div>}
      </Section>

      <Section title="Pipeline" hint="Steps run top to bottom on the immutable original. Change, reorder or remove any step; nothing accumulates unless you choose Apply.">
        <div style={{ display: 'grid', gap: 10 }}>
          {proc.steps.map((op, i) => (
            <div key={i} className="callout" style={{ gap: 8, outline: viewIdx === i ? '2px solid var(--accent)' : 'none' }} data-testid={`step-${i}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b style={{ flex: 1 }}>{i + 1}. {OP_LABEL[op.type]}</b>
                <Btn sm onClick={() => setProc({ viewStep: i })} title="Show this step on the right">View</Btn>
                <Btn sm onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</Btn>
                <Btn sm onClick={() => move(i, 1)} disabled={i === proc.steps.length - 1} title="Move down">↓</Btn>
                <Btn sm variant="danger" icon={<Trash2 size={14} />} onClick={() => removeStep(i)} title="Remove step" />
              </div>
              <span className="caption">{OP_HELP[op.type]}</span>
              <OpEditor op={op} onChange={(o) => update(i, o)} />
              {res?.steps[i] && <span className="caption mono">{fmtN(res.steps[i].before)} → {fmtN(res.steps[i].after)} pts · {res.steps[i].ms.toFixed(0)} ms{res.steps[i].injectedRemoved !== undefined ? ` · outliers removed ${res.steps[i].injectedRemoved} · original lost ${res.steps[i].originalLost}` : ''}</span>}
            </div>
          ))}
          {!proc.steps.length && <p className="hint">No steps yet — add one below.</p>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <Select value={addType} options={OP_TYPES.map((t) => ({ value: t, label: OP_LABEL[t] }))} onChange={setAddType} />
          <Btn icon={<Plus size={16} />} onClick={addStep} disabled={!original} testId="add-step">Add</Btn>
        </div>
        <div className="btn-row">
          {([['Noise + outliers', ['noise', 'outliers']], ['Noise + outliers + clean', ['noise', 'outliers', 'sor']]] as [string, OpType[]][]).map(([label, types]) => (
            <Btn key={label} sm onClick={() => { const prev = proc.steps; setProc({ steps: types.map((t) => defaultOp(t)), viewStep: types.length - 1 }); pushUndo('preset', () => setProc({ steps: prev })); }} disabled={!original}>{label}</Btn>
          ))}
        </div>
      </Section>

      <Section title="Randomness & result">
        <NumberField label="Seed (deterministic)" value={proc.seed} step={1} onChange={(seed) => setProc({ seed: Math.round(seed) || 0 })} />
        <Toggle label="Colour injected outliers" checked={highlight} onChange={setHighlight} hint="Shows which points were injected (orange/pink) vs original (cyan/green)." />
        <div className="btn-row">
          <Btn icon={<RotateCcw size={16} />} onClick={() => { const prev = proc.steps; setProc({ steps: [], result: null, quality: null }); pushUndo('reset to original', () => setProc({ steps: prev })); }} disabled={!proc.steps.length} testId="reset-original">Reset to original</Btn>
          <Btn icon={<Download size={16} />} onClick={() => res && exportCloudFile(res.final, 'ply')} disabled={!res}>PLY</Btn>
          <Btn icon={<Download size={16} />} onClick={() => res && exportCloudFile(res.final, 'pcd')} disabled={!res}>PCD</Btn>
        </div>
        <Btn onClick={() => {
          if (!res || !original) return;
          const id = `processed-${Object.keys(s.clouds).length}`;
          const prevSource = proc.sourceId, prevSteps = proc.steps;
          s.setCloud(id, { ...res.final, name: `Applied: ${res.final.name}` }, false);
          setProc({ sourceId: id, steps: [], result: null, quality: null });
          pushUndo('apply result', () => { useLab.getState().setCloud(id, null, false); setProc({ sourceId: prevSource, steps: prevSteps }); });
          s.notify('Result applied as a new dataset. The previous original is still available.', 'ok');
        }} disabled={!res} block>Apply result as new original…</Btn>
        <p className="hint">Applying is explicit and undoable; the earlier original stays in the dataset list.</p>
        {res && proc.quality && (
          <Callout kind={1 - proc.quality.injectedLeft / proc.quality.injected >= 0.9 && proc.quality.originalKept >= 0.85 ? 'good' : ''} title="Cleaning quality">
            Injected outliers: {fmtN(proc.quality.injected)} → {fmtN(proc.quality.injectedLeft)} left. Original points kept: {(proc.quality.originalKept * 100).toFixed(0)} %. Aim: ≥ 90 % removed and ≥ 85 % kept.
          </Callout>
        )}
      </Section>
      <DisplaySection cloud={rightCloud} />
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="Immutable original">Every run starts from the untouched dataset, so you can experiment freely. Use “Apply” only when you want a processed cloud to become the new starting point.</Callout>
      <Eq note="Statistical outlier removal: d̄ᵢ is the mean distance of point i to its k neighbours">remove i if d̄ᵢ &gt; μ(d̄) + α · σ(d̄)</Eq>
      <Eq note="Voxel downsampling">pᵥ = (1/|V|) Σ p, p ∈ voxel v</Eq>
      <Callout title="Filter trade-offs">Radius filters depend on point density: a radius that works at 3 cm spacing deletes everything at 30 cm. SOR adapts to the local statistics but can eat sparse true geometry (thin legs, edges).</Callout>
      <Callout title="Reproducibility">Noise, outliers, dropout and random downsampling use a seeded generator — same seed, same result.</Callout>
    </>
  );

  return <TabFrame title="Point Cloud Processing" tab={4} viewport={viewport} controls={controls} learn={learn} stats={stats} hideViewControls={false} overlays={<KindLegend items={[{ color: '#64d2ff', label: 'Original / processed points' }, { color: '#ff6b8a', label: 'Injected outliers (when highlighted)' }]} />} />;
  void activeCloud;
}
