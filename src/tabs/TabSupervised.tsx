import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, MiniSlider, Seg } from '../ui/controls';
import { MiniChart } from './common';
import { Pause, Play, Plus, RotateCcw, Trash2, X } from '../ui/icons';
import { buildModel, DataKind, layerHint, layerName, LayerSpec, LayerType, Task } from '../ml/nn';
import { CLASS_NAMES, dataset, IMG, PTS, SEG_COLORS, SEG_NAMES, Sample, TEST_IDX } from '../ml/data';
import { EvalResult, FOUND_IOU, iou, nClasses, Pred, Trainer } from '../ml/train';
import { INPUT_SHAPE, spec, starter } from '../ml/presets';

/* ---------- what is remembered while you move between tabs ---------- */
interface Slot { layers: LayerSpec[]; trainer: Trainer | null }
const SLOTS = new Map<string, Slot>();
const MEM = { kind: 'image' as DataKind, task: 'cls' as Task };
const slotOf = (kind: DataKind, task: Task): Slot => { const k = `${kind}:${task}`; if (!SLOTS.has(k)) SLOTS.set(k, { layers: starter(task, kind), trainer: null }); return SLOTS.get(k)!; };

const TASKS: { value: Task; label: string; image: string; points: string }[] = [
  { value: 'cls', label: 'Classification', image: 'What is in the picture?', points: 'What is in the cloud?' },
  { value: 'det', label: 'Detection', image: 'What and where? A 2D box.', points: 'What and where? A 3D box.' },
  { value: 'seg', label: 'Segmentation', image: 'Which pixel is what?', points: 'Which point is what?' },
];
const PALETTE: Record<DataKind, { type: LayerType; size?: number; label: string }[]> = {
  image: [{ type: 'conv', size: 8, label: 'Conv 3×3' }, { type: 'pool', label: 'Max pool' }, { type: 'upsample', label: 'Upsample' }, { type: 'flatten', label: 'Flatten' }, { type: 'dense', size: 16, label: 'Dense' }, { type: 'relu', label: 'ReLU' }, { type: 'tanh', label: 'Tanh' }],
  points: [{ type: 'conv', size: 16, label: 'Point conv' }, { type: 'pool', label: 'Point pool' }, { type: 'upsample', label: 'Point upsample' }, { type: 'globalmax', label: 'Global max' }, { type: 'dense', size: 16, label: 'Dense' }, { type: 'relu', label: 'ReLU' }, { type: 'tanh', label: 'Tanh' }],
};
const TINT: Record<LayerType, string> = { conv: '#0a84ff', pool: '#5e5ce6', upsample: '#5e5ce6', flatten: '#8e8e93', dense: '#30d158', relu: '#ff9f0a', tanh: '#ff9f0a', globalmax: '#bf5af2', context: '#bf5af2' };
const fmtScore = (task: Task, v: number) => (task === 'seg' ? v.toFixed(2) : `${(v * 100).toFixed(0)} %`);
const METRIC_SHORT: Record<Task, string> = { cls: 'accuracy', det: 'found', seg: 'mean IoU' };
const fmtN = (n: number) => n.toLocaleString('en-US');
const shapeText = (s: number[]) => s.join(' × ');

/* ---------- small pictures ---------- */
/** A slightly raised view of the scene: x, y on the ground (0..1), z the height (0..1). Returns canvas coordinates and how far away the point is. */
const AZ = Math.PI / 5.5, EL = Math.PI / 7;
function project(x: number, y: number, z: number, W: number): [number, number, number] {
  const dx = x - 0.5, dy = y - 0.5, X = dx * Math.cos(AZ) - dy * Math.sin(AZ), Y = dx * Math.sin(AZ) + dy * Math.cos(AZ), v = Y * Math.sin(EL) + z * 0.5 * Math.cos(EL);
  return [W * (0.5 + 0.68 * X), W * (0.7 - 0.74 * v), Y];
}

function Thumb({ s, view, task, pred, size = 88 }: { s: Sample; view: 'input' | 'truth' | 'model'; task: Task; pred?: Pred; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const g = c.getContext('2d'); if (!g) return; const W = c.width;
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, W);
    const labels = view === 'truth' ? s.seg : view === 'model' && pred && task === 'seg' ? pred.seg : null;
    if (s.kind === 'image') {
      const sc = W / IMG;
      for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
        const v = s.input[y * IMG + x], l = labels && task === 'seg' ? labels[y * IMG + x] : 0;
        if (l > 0) { g.fillStyle = SEG_COLORS[l]; g.globalAlpha = 0.9; } else { const q = Math.round(255 * (labels && task === 'seg' ? 0.35 + 0.5 * v : v)); g.fillStyle = `rgb(${q},${q},${q})`; g.globalAlpha = 1; }
        g.fillRect(x * sc, y * sc, sc + 0.5, sc + 0.5);
      }
      g.globalAlpha = 1;
      if (task === 'det' && view !== 'input') { const b = view === 'truth' ? s.box : pred?.box; if (b) { g.strokeStyle = view === 'truth' ? '#30d158' : '#ff9f0a'; g.lineWidth = 3; g.strokeRect((b[0] - b[2] / 2) * W, (b[1] - b[3] / 2) * W, b[2] * W, b[3] * W); } }
    } else {
      // a 3D view: the ground as a plane, every point placed by x, y and height
      g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, W, W);
      g.beginPath(); [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => { const [px, py] = project(x, y, 0, W); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fillStyle = '#e6e9ef'; g.fill(); g.strokeStyle = '#c7c7cc'; g.lineWidth = 1.5; g.stroke();
      const order = Array.from({ length: PTS }, (_, i) => i).map((i) => ({ i, p: project(s.input[i * 3], s.input[i * 3 + 1], s.input[i * 3 + 2], W) })).sort((a, b) => b.p[2] - a.p[2]);
      for (const { i, p } of order) {
        const z = s.input[i * 3 + 2];
        g.fillStyle = labels && task === 'seg' ? SEG_COLORS[labels[i]] : `hsl(215, 65%, ${74 - Math.min(1, z) * 46}%)`;
        g.beginPath(); g.arc(p[0], p[1], W * 0.014 + 0.7, 0, 7); g.fill();
      }
      if (task === 'det' && view !== 'input') { // a 3D box: centre (x, y, z) and size (width, depth, height)
        const b = view === 'truth' ? s.box : pred?.box;
        if (b && b.length === 6) {
          g.strokeStyle = view === 'truth' ? '#30d158' : '#ff9f0a'; g.lineWidth = 2.5;
          const P = [0, 1].flatMap((zi) => [0, 1].flatMap((yi) => [0, 1].map((xi) => project(b[0] + (xi - 0.5) * b[3], b[1] + (yi - 0.5) * b[4], b[2] + (zi - 0.5) * b[5], W))));
          for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) { g.beginPath(); g.moveTo(P[i][0], P[i][1]); g.lineTo(P[j][0], P[j][1]); g.stroke(); }
        }
      }
    }
  }, [s, view, task, pred]);
  return <canvas ref={ref} width={size * 2} height={size * 2} style={{ width: size, height: size, borderRadius: 8, border: '1px solid #d1d1d6', imageRendering: s.kind === 'image' ? 'pixelated' : 'auto' }} />;
}

function Glyph({ shape, tint }: { shape: number[]; tint: string }) {
  if (shape.length === 3) { const side = Math.min(46, 8 + shape[0] * 2.4), n = Math.min(shape[2], 5); return <div style={{ position: 'relative', width: side + n * 4, height: side + n * 4 }}>{Array.from({ length: n }, (_, i) => <div key={i} style={{ position: 'absolute', left: i * 4, top: (n - 1 - i) * 4, width: side, height: side, border: `1.5px solid ${tint}`, background: `${tint}22`, borderRadius: 3 }} />)}</div>; }
  if (shape.length === 2) { const side = Math.min(46, 8 + Math.sqrt(shape[0] / 256) * 38), n = Math.min(shape[1], 5); return <div style={{ position: 'relative', width: side + n * 4, height: side + n * 4 }}>{Array.from({ length: n }, (_, i) => <div key={i} style={{ position: 'absolute', left: i * 4, top: (n - 1 - i) * 4, width: side, height: side, border: `1.5px solid ${tint}`, background: `${tint}22`, borderRadius: 3, backgroundImage: `radial-gradient(${tint} 1px, transparent 1.2px)`, backgroundSize: '6px 6px' }} />)}</div>; }
  return <div style={{ width: 12, height: Math.min(46, 8 + Math.log2(shape[0] + 1) * 5), border: `1.5px solid ${tint}`, background: `${tint}33`, borderRadius: 3 }} />;
}



/** Segmentation models drawn as the U they are: stages going down (Pool), then back up (Upsample), with the skip connections between matching levels. */
function UNetView({ kind, shapes, layers, out, K }: { kind: DataKind; shapes: number[][]; layers: LayerSpec[]; out: boolean; K: number }) {
  interface Blk { i: number; l: LayerSpec; sh: number[] }
  interface Stg { level: number; entry?: 'down' | 'up'; blocks: Blk[]; skipFrom?: number }
  const stages: Stg[] = [{ level: 0, blocks: [] }], pools: number[] = []; let level = 0;
  layers.forEach((l, i) => {
    const sh = shapes[i + 1]; if (!sh) return;
    if (l.type === 'pool') { pools.push(stages.length - 1); level++; stages.push({ level, entry: 'down', blocks: [] }); }
    else if (l.type === 'upsample') { level--; stages.push({ level, entry: 'up', blocks: [], skipFrom: pools.pop() }); }
    else stages[stages.length - 1].blocks.push({ i, l, sh });
  });
  const lo = Math.min(...stages.map((q) => q.level)), rows = Math.max(...stages.map((q) => q.level)) - lo + 1;
  const unit = (sh: number[]) => (sh.length === 3 ? `${sh[0]}×${sh[1]}` : `${sh[0]} points`), top = shapes[0];
  const first = stages[0];
  return (
    <div className="nn-profile" data-testid={`nn-${kind}-unet`}>
      <div className="nn-u" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {stages.map((q, k) => (
          <div key={k} className="nn-ustage" style={{ gridColumn: k + 1, gridRow: q.level - lo + 1 }}>
            <div className="nn-uhead">{q.entry === 'down' ? '▼ Pool' : q.entry === 'up' ? '▲ Upsample + skip' : 'Input'} <span className="mono">{unit(q.blocks.length ? q.blocks[q.blocks.length - 1].sh : shapes[Math.min(shapes.length - 1, 1)] ?? top)}</span></div>
            {q.blocks.map((b) => <div key={b.i} className="nn-ublk" style={{ borderColor: TINT[b.l.type] }}><b style={{ color: TINT[b.l.type] }}>{layerName(b.l.type, kind === 'points')}</b>{b.l.size && (b.l.type === 'conv' || b.l.type === 'dense') ? ` ${b.l.size}` : ''}</div>)}
            {k === stages.length - 1 && out && <div className="nn-ublk nn-uout">Output: {K} labels per {kind === 'image' ? 'pixel' : 'point'}</div>}
          </div>
        ))}
        {stages.map((q, k) => q.skipFrom !== undefined ? <div key={`s${k}`} className="nn-uskip" style={{ gridRow: stages[q.skipFrom].level - lo + 1, gridColumn: `${q.skipFrom + 2} / ${k + 1}` }}><span>skip</span></div> : null)}
      </div>
      <span className="caption">Down to see what is there, back up to say where. Dashed line = skip connection.{first.blocks.length === 0 && stages.length === 1 ? ' Add blocks to build the U.' : ''}</span>
    </div>
  );
}

/** The model seen from the side: every bar is the data after one block, as tall as the picture (or cloud) is big. Segmentation models go down and come back up: a U. */
function Profile({ kind, task, shapes, layers, out }: { kind: DataKind; task: Task; shapes: number[][]; layers: LayerSpec[]; out: boolean }) {
  const H = 64, BW = 52, n = shapes.length;
  const barH = (sh: number[]) => (sh.length === 3 ? 10 + (sh[0] / 16) * 46 : sh.length === 2 ? 10 + Math.sqrt(sh[0] / 256) * 46 : 6 + Math.min(40, Math.log2(sh[0] + 1) * 4));
  const barW = (sh: number[]) => 8 + Math.min(26, Math.log2((sh[sh.length - 1] ?? 1) + 1) * 4.2);
  const tints = ['#8e8e93', ...layers.map((l) => TINT[l.type])];
  const hs = shapes.map(barH), lo = hs.indexOf(Math.min(...hs));
  const hasUp = layers.some((l) => l.type === 'upsample'), hasDown = layers.some((l) => l.type === 'pool');
  const u = task === 'seg' && hasDown && hasUp && shapes.length > 2;
  const unit = kind === 'image' ? (sh: number[]) => `${sh[0]}×${sh[1]}` : (sh: number[]) => `${sh[0]} points`, spatialShapes = shapes.filter((q) => q.length === (kind === 'image' ? 3 : 2)), smallest = spatialShapes.reduce((a, q) => (q[0] < a[0] ? q : a), spatialShapes[0] ?? shapes[0]);
  const caption = task === 'seg' ? (u ? 'Down to see what is there, back up to say where: a U-Net.' : 'Needs a label for every ' + (kind === 'image' ? 'pixel' : 'point') + ': go down with Pool, back up with Upsample.') : 'Shrinks down to a short list of numbers, then answers.';
  return (
    <div className="nn-profile" data-testid={`nn-${kind}-profile`}>
      <svg viewBox={`0 0 ${Math.max(n + (out ? 1 : 0), 2) * BW} ${H + 24}`} role="img" aria-label="The model gets smaller and bigger from left to right" style={{ width: '100%', maxHeight: 118 }}>
        {shapes.map((sh, i) => { const x = i * BW + BW / 2, h = hs[i], w = barW(sh); return (<g key={i}>{i > 0 && <line x1={x - BW + w / 2 + 4} y1={H / 2} x2={x - w / 2 - 2} y2={H / 2} stroke="#c7c7cc" strokeWidth={1.5} />}<rect x={x - w / 2} y={(H - h) / 2} width={w} height={h} rx={4} fill={`${tints[i] ?? '#30d158'}33`} stroke={tints[i] ?? '#30d158'} strokeWidth={1.6} /><text x={x} y={H + 12} textAnchor="middle" fontSize={8} fill="#636366">{sh.length === 3 ? `${sh[0]}×${sh[1]}` : sh.length === 2 ? `${sh[0]} pts` : sh[0]}</text></g>); })}
        {out && <g><line x1={(n - 1) * BW + BW / 2 + 12} y1={H / 2} x2={n * BW + BW / 2 - 14} y2={H / 2} stroke="#c7c7cc" strokeWidth={1.5} /><rect x={n * BW + BW / 2 - 14} y={(H - 26) / 2} width={28} height={26} rx={5} fill="#30d15833" stroke="#30d158" strokeWidth={1.6} /><text x={n * BW + BW / 2} y={H + 12} textAnchor="middle" fontSize={8} fill="#636366">output</text></g>}
      </svg>
      {u && <div className="nn-uflow"><span>▼ going down: {unit(shapes[0])} → {unit(smallest)}</span><span>▲ going up: back to {unit(shapes[0])}</span></div>}
      <span className="caption">{caption}</span>
    </div>
  );
}

/* ---------- one column: the model, how it learns, and the ten examples ---------- */
interface Settings { epochs: number; lr: number; aug: boolean }
function Column({ kind, task, set, go, onTick }: { kind: DataKind; task: Task; set: Settings; go: number; onTick: () => void }) {
  const [, setTick] = useState(0), bump = () => { setTick((n) => n + 1); onTick(); };
  const [running, setRunning] = useState(false), [drag, setDrag] = useState<number | null>(null);
  const { epochs, lr, aug } = set;
  const slot = slotOf(kind, task), K = nClasses(kind, task), data = useMemo(() => dataset(kind), [kind]);
  const sig = JSON.stringify(slot.layers.map((l) => [l.type, l.size]));
  const build = useMemo(() => buildModel(INPUT_SHAPE[kind], slot.layers, task, kind, K, 5), [kind, task, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (layers: LayerSpec[]) => { slot.layers = layers; slot.trainer = null; setRunning(false); bump(); };
  useEffect(() => { setRunning(false); }, [task]);

  const tr = slot.trainer, evalAll: EvalResult | null = useMemo(() => (tr ? tr.evaluate(data) : null), [tr, tr?.epochs, data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { const T = slot.trainer; if (!T) return; const t0 = performance.now(); while (T.epochs < epochs) { T.epoch(lr, aug, epochs); if (performance.now() - t0 >= 25) break; } bump(); if (T.epochs >= epochs) setRunning(false); }, 30);
    return () => clearInterval(t);
  }, [running, slot, lr, aug, epochs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setRunning(false), []);
  function train() {
    if (!build.model) return;
    if (!slot.trainer || slot.trainer.epochs >= epochs) slot.trainer = new Trainer(buildModel(INPUT_SHAPE[kind], slot.layers, task, kind, K, 5 + Math.floor(Math.random() * 1000)).model!, task, kind);
    setRunning(true); bump();
  }
  useEffect(() => { if (go > 0) train(); }, [go]); // eslint-disable-line react-hooks/exhaustive-deps

  const addAt = (b: { type: LayerType; size?: number }, at: number) => { const next = [...slot.layers]; next.splice(at, 0, spec(b.type, b.size)); edit(next); };
  const moveTo = (from: number, at: number) => { const next = [...slot.layers], [m] = next.splice(from, 1); next.splice(at > from ? at - 1 : at, 0, m); edit(next); };
  const onDrop = (e: DragEvent, at: number) => {
    e.preventDefault(); setDrag(null);
    const nb = e.dataTransfer.getData('block'), mv = e.dataTransfer.getData('move');
    if (nb) addAt(JSON.parse(nb), at); else if (mv !== '') moveTo(parseInt(mv, 10), at);
  };
  const DropSlot = ({ at }: { at: number }) => <div className={`nn-slot ${drag !== null ? 'on' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, at)} data-testid={`nn-${kind}-slot-${at}`}><span /></div>;
  const resize = (i: number, by: number) => edit(slot.layers.map((l, j) => (j === i ? { ...l, size: Math.min(64, Math.max(2, (l.size ?? 8) + by)) } : l)));

  const last = tr?.history[tr.history.length - 1];
  const diagnosis = (() => {
    if (!build.model) return { kind: 'bad' as const, title: 'The blocks do not fit together yet', text: build.error ?? '' };
    if (!last) return { kind: 'edu' as const, title: 'Ready', text: 'Press Train. The curves should go down and the Model pictures should come to match the Answer pictures.' };
    if (last.train < 0.6) return { kind: 'warn' as const, title: 'Still learning, or too simple', text: 'The training score is low. Train for longer, add a block, or give a block more filters or units.' };
    if (last.train - last.test > 0.25) return { kind: 'warn' as const, title: 'Overfitting: it memorised the training examples', text: 'It does well on what it learned from but not on the held-back examples. Use the extra copies, make the model smaller, or try again.' };
    return { kind: 'good' as const, title: 'A good fit', text: `Learned ${fmtScore(task, last.train)}, never seen ${fmtScore(task, last.test)}: close together, so it works on new examples.` };
  })();
  const label = kind === 'image' ? 'Images' : 'Point clouds';

  return (
    <div className="nn-col" data-testid={`nn-col-${kind}`}>
      <div className="nn-colhead">
        <h2>{label}</h2>
        <div className="btn-row">
          {running ? <Btn variant="primary" icon={<Pause size={15} />} onClick={() => setRunning(false)} testId={`nn-${kind}-pause`}>Pause</Btn> : <Btn variant="primary" icon={<Play size={15} />} onClick={train} disabled={!build.model} testId={`nn-${kind}-train`}>{tr && tr.epochs > 0 && tr.epochs < epochs ? 'Continue' : 'Train'}</Btn>}
          <Btn sm icon={<RotateCcw size={14} />} onClick={() => { setRunning(false); slot.trainer = null; bump(); }} disabled={!tr}>Start over</Btn>
        </div>
      </div>

      <section className="nn-card">
        <div className="nn-title"><b>Your model</b><span className="caption">Drag a block into the line, or click it.</span></div>
        <div className="nn-palette" data-testid={`nn-${kind}-palette`}>
          {PALETTE[kind].map((b) => (
            <button key={b.label} className="nn-chip" style={{ borderColor: TINT[b.type] }} draggable onDragStart={(e) => { e.dataTransfer.setData('block', JSON.stringify(b)); setDrag(-1); }} onDragEnd={() => setDrag(null)} onClick={() => addAt(b, slot.layers.length)} title={layerHint(b.type, kind === 'points')} data-testid={`nn-${kind}-add-${b.type}`}><Plus size={12} /> {b.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <Btn sm onClick={() => edit(starter(task, kind))} testId={`nn-${kind}-starter`}>Starter model</Btn>
          <Btn sm icon={<Trash2 size={14} />} onClick={() => edit([])} disabled={!slot.layers.length} testId={`nn-${kind}-clear`}>Clear</Btn>
        </div>
        {task === 'seg' ? <UNetView kind={kind} shapes={build.shapes} layers={slot.layers.slice(0, Math.max(0, build.shapes.length - 1))} out={!!build.model} K={K} /> : <Profile kind={kind} task={task} shapes={build.shapes} layers={slot.layers.slice(0, Math.max(0, build.shapes.length - 1))} out={!!build.model} />}
        <div className="nn-flow" data-testid={`nn-${kind}-flow`}>
          <div className="nn-end">
            <Thumb s={data[0]} view="input" task={task} size={56} />
            <b>Input</b><span className="caption mono">{kind === 'image' ? `${IMG}×${IMG} image` : `${PTS} points`}</span>
          </div>
          <DropSlot at={0} />
          {slot.layers.map((l, i) => {
            const shape = build.shapes[i + 1], bad = build.errorAt === i && build.error, tint = TINT[l.type], sized = l.type === 'conv' || l.type === 'dense';
            const params = build.model ? build.model.layers[i].params.reduce((a, p) => a + p.w.length, 0) : 0;
            return (
              <div key={l.id} style={{ display: 'contents' }}>
                <div className={`nn-blk ${bad ? 'bad' : ''}`} style={{ borderColor: bad ? '#ff453a' : tint, opacity: drag === i ? 0.4 : 1 }} draggable onDragStart={(e) => { e.dataTransfer.setData('move', String(i)); setDrag(i); }} onDragEnd={() => setDrag(null)} data-testid={`nn-${kind}-block-${i}`} title={layerHint(l.type, kind === 'points')}>
                  <div className="nn-blk-h"><b style={{ color: tint }}>{layerName(l.type, kind === 'points')}</b><button className="nn-x" onClick={() => edit(slot.layers.filter((_, j) => j !== i))} aria-label={`Remove block ${i + 1}`} data-testid={`nn-${kind}-remove-${i}`}><X size={12} /></button></div>
                  {sized && <div className="nn-size"><button onClick={() => resize(i, l.type === 'conv' ? -4 : -8)} aria-label="fewer">−</button><span className="mono">{l.size ?? 8} {l.type === 'conv' ? 'filters' : 'units'}</span><button onClick={() => resize(i, l.type === 'conv' ? 4 : 8)} aria-label="more">+</button></div>}
                  {shape && !bad && <Glyph shape={shape} tint={tint} />}
                  <span className="caption mono">{shape && !bad ? shapeText(shape) : 'no fit'}</span>
                  {params > 0 && <span className="caption">{fmtN(params)} weights</span>}
                </div>
                <DropSlot at={i + 1} />
              </div>
            );
          })}
          <div className="nn-end nn-out" data-testid={`nn-${kind}-out`}>
            <div className="nn-head">{task === 'cls' ? 'Class' : task === 'det' ? 'Class + box' : `Label per ${kind === 'image' ? 'pixel' : 'point'}`}</div>
            <b>Output</b>
            <span className="caption nn-outinfo" data-testid={`nn-${kind}-outinfo`}>
              {task === 'cls' && <>1 of {K}: {CLASS_NAMES[kind].join(', ')}</>}
              {task === 'det' && (kind === 'image' ? <>class + 2D box: centre x, y, width, height</> : <>class + 3D box: centre x, y, z, width, depth, height</>)}
              {task === 'seg' && <>{SEG_NAMES[kind].join(', ')}</>}
            </span>
          </div>
        </div>
        {build.error && <div className="nn-error" role="alert" data-testid={`nn-${kind}-error`}>{build.errorAt !== undefined && build.errorAt >= 0 && build.errorAt < slot.layers.length ? `Block ${build.errorAt + 1} (${layerName(slot.layers[build.errorAt].type, kind === 'points')}): ` : ''}{build.error}</div>}
        {build.model && <span className="caption" data-testid={`nn-${kind}-params`}>{fmtN(build.model.paramCount)} weights to learn from 7 training examples.</span>}
      </section>

      <section className="nn-card" data-testid={`nn-${kind}-learning`}>
        <div className="nn-title"><b>Learning</b><span className="caption mono" data-testid={`nn-${kind}-epoch`}>epoch {tr?.epochs ?? 0} / {epochs}</span></div>
        <div className="nn-score" data-testid={`nn-${kind}-score`}>
          <div><span className="caption">Learned from</span><b>{last ? fmtScore(task, last.train) : '—'}</b><span className="caption">{METRIC_SHORT[task]}</span></div>
          <div><span className="caption">Never seen</span><b>{last ? fmtScore(task, last.test) : '—'}</b><span className="caption">{METRIC_SHORT[task]}</span></div>
        </div>
        <div className="nn-curves">
          <MiniChart height={104} series={[{ name: 'train loss', color: '#0a84ff', values: tr?.history.map((h) => h.trainLoss) ?? [] }, { name: 'test loss', color: '#ff9f0a', values: tr?.history.map((h) => h.testLoss) ?? [] }]} yLabel="loss" xLabel="epoch" />
          <MiniChart height={104} series={[{ name: 'train', color: '#0a84ff', values: tr?.history.map((h) => h.train) ?? [] }, { name: 'test', color: '#ff9f0a', values: tr?.history.map((h) => h.test) ?? [] }]} yLabel={METRIC_SHORT[task]} xLabel="epoch" />
        </div>
        <span className="caption"><span style={{ color: '#0a84ff' }}>●</span> examples it learns from · <span style={{ color: '#ff9f0a' }}>●</span> held-back examples</span>
        <Callout kind={diagnosis.kind} title={diagnosis.title}>{diagnosis.text}</Callout>
      </section>

      <section className="nn-card">
        <div className="nn-title"><b>The ten examples</b><span className="caption"><span className="nn-test">test</span> = held back from training</span></div>
        {kind === 'points' && <span className="caption">Clouds are drawn in 3D: darker blue = higher.</span>}
        <div className="nn-grid" data-testid={`nn-${kind}-gallery`}>
          {data.map((s, i) => {
            const p = evalAll?.preds[i], isTest = TEST_IDX.includes(i);
            const ok = p ? (task === 'cls' ? p.cls === s.cls : task === 'det' ? p.cls === s.cls && iou(p.box, s.box) >= FOUND_IOU(kind) : null) : null;
            const segOk = p && task === 'seg' ? p.seg.reduce((a, v, j) => a + (v === s.seg[j] ? 1 : 0), 0) / s.seg.length : null;
            return (
              <div key={i} className="nn-sample" data-testid={`nn-${kind}-sample-${i}`}>
                <div className="nn-sample-h"><b>{s.name}</b>{isTest ? <span className="nn-test">test</span> : <span className="caption">train</span>}</div>
                <div className="nn-trio">
                  <figure><Thumb s={s} view="input" task={task} size={74} /><figcaption>Input</figcaption></figure>
                  <figure><Thumb s={s} view="truth" task={task} size={74} /><figcaption>Answer<br /><b>{task === 'seg' ? 'labelled' : CLASS_NAMES[kind][s.cls]}</b></figcaption></figure>
                  <figure><Thumb s={s} view="model" task={task} pred={p} size={74} />
                    <figcaption>Model<br />{p ? (task === 'seg' ? <b style={{ color: segOk! > 0.9 ? '#248a3d' : '#c93400' }}>{(segOk! * 100).toFixed(0)} % right</b> : <b style={{ color: ok ? '#248a3d' : '#d70015' }}>{CLASS_NAMES[kind][p.cls]} {ok ? '✓' : '✗'}{task === 'det' ? ` · IoU ${iou(p.box, s.box).toFixed(2)}` : ''}</b>) : <span className="caption">not trained</span>}</figcaption></figure>
                </div>
              </div>
            );
          })}
        </div>
        {task === 'seg' && <div className="nn-legend">{SEG_NAMES[kind].map((n, k) => <span key={n}><i style={{ background: SEG_COLORS[k] }} />{n}</span>)}</div>}
        {task === 'det' && <div className="nn-legend"><span><i style={{ background: '#30d158' }} />true box</span><span><i style={{ background: '#ff9f0a' }} />model's box</span></div>}
      </section>
    </div>
  );
}

/* ---------- the tab: images on the left, point clouds on the right, no side panel ---------- */
export default function TabSupervised() {
  const [task, setTaskS] = useState<Task>(MEM.task);
  const [set, setSet] = useState<Settings>({ epochs: 200, lr: 0.01, aug: true }) // extra copies of the training examples are always on: it is the setting that works best;
  const [go, setGo] = useState(0), [, setTick] = useState(0);
  const setTask = (t: Task) => { MEM.task = t; setTaskS(t); };
  const taskInfo = TASKS.find((t) => t.value === task)!;

  const viewport = (
    <div className="nn-stage" data-testid="nn-stage">
      <div className="nn-bar" data-testid="nn-bar">
        <div className="nn-bar-task">
          <Seg value={task} onChange={setTask} label="Task" options={TASKS.map((t) => ({ value: t.value, label: t.label }))} />
          <span className="caption"><b>Images</b>: {taskInfo.image} · <b>Point clouds</b>: {taskInfo.points}</span>
        </div>
        <div className="nn-bar-train">
          <div style={{ width: 190 }}><MiniSlider label="Rounds" title="How many times the model sees all the training examples" value={set.epochs} min={10} max={300} step={10} onChange={(epochs) => setSet({ ...set, epochs })} /></div>
          <Seg value={String(set.lr)} onChange={(v) => setSet({ ...set, lr: parseFloat(v) })} label="Learning speed" options={[{ value: '0.003', label: 'Slow' }, { value: '0.01', label: 'Normal' }, { value: '0.03', label: 'Fast' }]} block={false} />
          <Btn variant="primary" icon={<Play size={15} />} onClick={() => setGo(go + 1)} testId="nn-train-both">Train both</Btn>
        </div>
        <div className="nn-help" data-testid="nn-help">
          <span><b>Rounds</b>: times the model sees the training examples.</span>
          <span><b>Learning speed</b>: how big each correction is.</span>
          <span>Each round the training examples are also flipped, shifted and noisier.</span>
          <span><b>7 train · 3 <span className="nn-test">test</span></b>: test examples are never learned from.</span>
        </div>
      </div>
      <div className="nn-cols">
        <Column kind="image" task={task} set={set} go={go} onTick={() => setTick((n) => n + 1)} />
        <Column kind="points" task={task} set={set} go={go} onTick={() => setTick((n) => n + 1)} />
      </div>
      <section className="nn-card">
        <div className="nn-title"><b>How the three tasks add up</b><span className="caption">The last result of every model you trained. Change the task above and train again to fill the table.</span></div>
        <table className="table" data-testid="nn-summary"><thead><tr><th>Task</th><th>Images: learned / unseen</th><th>Point clouds: learned / unseen</th></tr></thead><tbody>
          {TASKS.map((t) => (
            <tr key={t.value}><td><b>{t.label}</b> <span className="caption">({METRIC_SHORT[t.value]})</span></td>
              {(['image', 'points'] as const).map((k) => { const h = SLOTS.get(`${k}:${t.value}`)?.trainer?.history; const L = h?.[h.length - 1]; return <td key={k} className="mono">{L ? `${fmtScore(t.value, L.train)} / ${fmtScore(t.value, L.test)}` : '—'}</td>; })}</tr>
          ))}
        </tbody></table>
      </section>
      <details className="nn-card">
        <summary><b>About supervised learning</b></summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <Callout kind="edu" title="Supervised learning">Unlike clustering, every example comes with the right answer. The model guesses, a <b>loss</b> number says how wrong it was, and training nudges the weights to make the loss smaller.</Callout>
          <Callout kind="edu" title="Why hold some examples back?">A model can simply memorise its training examples. The held-back ones show whether it really learned the idea. A big gap between learned and unseen scores is called <b>overfitting</b>.</Callout>
          <Callout kind="edu" title="Images and point clouds">Both sides use the same plan. On images, <b>Conv</b> slides a small window over the pixels. Points have no grid, so <b>Point conv</b> looks at each point and its 8 nearest neighbours instead. <b>Pool</b> and <b>Upsample</b> shrink and grow the picture or the cloud, and <b>Flatten</b> / <b>Global max</b> squeeze everything into a list of numbers.</Callout>
        </div>
      </details>
    </div>
  );
  return <TabFrame title="Supervised Learning · Train your own model" tab={12} viewport={viewport} controls={null} learn={null} noEnv hideViewControls hideExercise noPanel />;
}
