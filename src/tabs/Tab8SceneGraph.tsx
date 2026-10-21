import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { className, classColor } from '../scenes/classes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, BoxOutline, CorridorVolume, SensorMarker } from '../ui/three';
import { ExternalLink, Cpu, Play } from '../ui/icons';
import { buildGraph, nodesFromScene, nodesFromSegmentation, REL_LABEL, RelType, SceneGraph, GraphNode, scannerGap } from '../graph/sceneGraph';
import { answerQuery, QueryAnswer, SUPPORTED_QUESTIONS, LLM_TOOL_SCHEMA } from '../graph/query';
import { circularLayout } from '../graph/layout';
import { Vec3 } from '../core/math';

const REL_COLOR: Record<RelType, string> = { near: '#64d2ff', above: '#30d158', below: '#a3e635', inside: '#bf5af2', left_of: '#ff9f0a', right_of: '#ffd60a', intersects: '#ff453a', blocks_path: '#ff375f' };
const LLM_FIT_URL = 'https://maninka123.github.io/local-llm-fit/';
const LLM_FIT_REPO = 'https://github.com/maninka123/local-llm-fit';

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [sz, setSz] = useState({ w: 520, h: 520 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSz({ w: Math.max(240, el.clientWidth), h: Math.max(240, el.clientHeight) }));
    ro.observe(el);
    setSz({ w: Math.max(240, el.clientWidth), h: Math.max(240, el.clientHeight) });
    return () => ro.disconnect();
  }, [ref]);
  return sz;
}

function GraphView({ graph, filters, selected, onSelect, showStructural, highlight }: { graph: SceneGraph; filters: Record<string, boolean>; selected: string | null; onSelect: (id: string | null) => void; showStructural: boolean; highlight: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useMemo(() => graph.nodes.filter((n) => showStructural || !n.structural), [graph, showStructural]);
  const edges = useMemo(() => graph.edges.filter((e) => filters[e.type] && nodes.some((n) => n.id === e.from) && (nodes.some((n) => n.id === e.to) || e.to === 'corridor')), [graph, filters, nodes]);
  const ids = useMemo(() => [...nodes.map((n) => n.id), ...(edges.some((e) => e.to === 'corridor') ? ['corridor'] : [])], [nodes, edges]);
  const layout = useMemo(() => {
    const seen = new Set<string>();
    const pairs = edges.map((e) => ({ a: e.from, b: e.to })).filter((e) => { const k = [e.a, e.b].sort().join('|'); if (e.a === e.b || seen.has(k)) return false; seen.add(k); return true; });
    const S = Math.min(w, h * 0.92);
    const L = circularLayout(ids, pairs, S, S);
    const ox = (w - S) / 2, oy = (h - S) / 2;
    return new Map(L.map((n) => [n.id, { ...n, x: n.x + ox, y: n.y + oy }]));
  }, [ids, edges, w, h]);
  const focus = hover ?? selected;
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }} data-testid="graph-view">
      <svg width={w} height={h} role="img" aria-label="Scene graph" onClick={() => onSelect(null)}>
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke" /></marker></defs>
        {edges.map((e, i) => {
          const a = layout.get(e.from), b = layout.get(e.to);
          if (!a || !b || e.from === e.to) return null;
          const on = !focus || e.from === focus || e.to === focus;
          const off = ((i % 3) - 1) * 4;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
          const ox = (-dy / d) * off, oy = (dx / d) * off;
          const dir = e.type === 'near' || e.type === 'intersects';
          return (
            <g key={i} opacity={on ? 0.95 : 0.12}>
              <line x1={a.x + ox} y1={a.y + oy} x2={b.x + ox - (dx / d) * 24} y2={b.y + oy - (dy / d) * 24} stroke={REL_COLOR[e.type]} strokeWidth={on && focus ? 2.4 : 1.6} markerEnd={dir ? undefined : 'url(#arr)'} />
              {focus && on && <text x={(a.x + b.x) / 2 + ox} y={(a.y + b.y) / 2 + oy - 3} fontSize="12.5" fill={REL_COLOR[e.type]} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.55)', strokeWidth: 3 }}>{REL_LABEL[e.type]}{e.value !== undefined && e.type !== 'blocks_path' ? ` ${e.value.toFixed(2)} m` : ''}</text>}
            </g>
          );
        })}
        {ids.map((id) => {
          const p = layout.get(id)!;
          if (id === 'corridor') return <g key={id}><rect x={p.x - 26} y={p.y - 14} width={52} height={28} rx={8} fill="rgba(48,209,88,.25)" stroke="#30d158" /><text x={p.x} y={p.y + 5} fontSize="12.5" textAnchor="middle" fill="#30d158">corridor</text></g>;
          const n = nodes.find((q) => q.id === id)!;
          const c = classColor(n.classId);
          const sel = selected === id, hl = highlight.includes(id);
          const estimated = n.source !== 'ground-truth annotation';
          return (
            <g key={id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); onSelect(id); }} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} data-testid={`node-${id}`}>
              <circle r={sel ? 24 : 20} fill={`rgb(${c.join(',')})`} fillOpacity={0.9} stroke={sel ? '#fff' : hl ? '#ffd60a' : 'rgba(0,0,0,.4)'} strokeWidth={sel || hl ? 3 : 1.5} strokeDasharray={estimated ? '4 3' : undefined} />
              <text y={36} fontSize="13.5" fontWeight={600} textAnchor="middle" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3.5 }}>{n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Tab8() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const g = s.graph;
  const setG = (patch: Partial<typeof g>) => useLab.setState({ graph: { ...useLab.getState().graph, ...patch } });
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [showStructural, setShowStructural] = useState(false);
  const [showLLM, setShowLLM] = useState(false);
  const [showFit, setShowFit] = useState(false);
  const seg = s.seg.result;

  const graph = g.graph;
  useEffect(() => {
    const nodes = g.source === 'segmentation' && seg ? nodesFromSegmentation(seg) : nodesFromScene(scene);
    const gr = buildGraph(nodes, { pos: [s.pose.x, s.pose.y, s.pose.z] as Vec3, yaw: s.pose.yaw }, scene.corridor, g.nearThreshold);
    setG({ graph: gr });
  }, [g.source, g.nearThreshold, s.sceneId, s.pose.x, s.pose.y, s.pose.z, s.pose.yaw, seg]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = graph?.nodes ?? [];
  const objs = nodes.filter((n) => !n.structural);
  const sel = nodes.find((n) => n.id === g.selectedNode) ?? null;
  const highlight = answer?.nodeIds ?? [];
  const selRel = graph && sel ? graph.edges.filter((e) => e.from === sel.id || e.to === sel.id) : [];

  const ask = (text: string) => {
    if (!graph) return;
    const a = answerQuery(graph, text);
    setAnswer(a);
    setQ(text);
    setG({ answers: [{ q: text, a: a.answer }, ...g.answers].slice(0, 8), queried: true });
  };
  const closest = graph ? [...objs].sort((a, b) => scannerGap(graph.scanner.pos, a) - scannerGap(graph.scanner.pos, b))[0] : null;

  const selectNode = (id: string | null) => { setG({ selectedNode: id }); s.patch({ selectedObjectId: id && scene.objects.some((o) => o.id === id) ? id : null }); };
  const hlIds = [...new Set([...(sel ? [sel.id] : []), ...highlight])];

  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="sg3d" home={scene.cameraHome} target={scene.cameraTarget} label="3D scene">
          {g.source === 'ground-truth' && <SceneLayer scene={scene} opacity={Math.max(0.35, s.view.sceneOpacity)} showCeiling={s.view.showCeiling} highlight={hlIds} interactive={false} />}
          {g.source === 'segmentation' && s.view.showScene && <SceneLayer scene={scene} opacity={0.15} showCeiling={false} interactive={false} />}
          {graph && nodes.filter((n) => !n.structural && g.source === 'segmentation').map((n) => <BoxOutline key={n.id} bbox={n.bbox} color={hlIds.includes(n.id) ? '#ffd60a' : '#ff375f'} dashed />)}
          {graph?.corridor && <CorridorVolume scene={scene} />}
          <SensorMarker x={s.pose.x} y={s.pose.y} z={s.pose.z} yaw={s.pose.yaw} sensor={s.sensor} label="Scanner" showFov={false} />
        </Viewport>
      </div>
      <div style={{ position: 'relative', background: 'var(--bg)' }}>
        {graph && <GraphView graph={graph} filters={g.filters} selected={g.selectedNode} onSelect={selectNode} showStructural={showStructural} highlight={highlight} />}
        <div className="overlay glass card" style={{ top: 12, left: 12, padding: '0.3rem 0.7rem', fontSize: '0.875rem', fontWeight: 600 }}>Scene graph · {objs.length} objects · {graph?.edges.filter((e) => g.filters[e.type]).length ?? 0} relations</div>
      </div>
    </div>
  );

  const stats = [
    { k: 'Nodes', v: objs.length, s: g.source === 'ground-truth' ? 'ground-truth annotations' : 'rule-based estimates' },
    { k: 'Relations', v: graph ? graph.edges.length : 0, s: 'computed from bounding boxes' },
    { k: 'Closest to scanner', v: closest ? closest.label : '—', s: closest && graph ? `${scannerGap(graph.scanner.pos, closest).toFixed(2)} m` : undefined },
    { k: 'Blocking corridor', v: graph ? graph.edges.filter((e) => e.type === 'blocks_path').length : 0 },
  ];

  const controls = (
    <>
      <Section title="Graph source">
        <Seg value={g.source} onChange={(source) => setG({ source })} options={[{ value: 'ground-truth', label: 'Scene objects (GT)' }, { value: 'segmentation', label: 'From segmentation' }]} />
        {g.source === 'segmentation' && !seg && <Callout kind="warn">Run Tab 6 (segmentation) first. Clusters will become nodes with <b>estimated</b> labels from a crude size rule.</Callout>}
        {g.source === 'segmentation' && seg && <Callout>Nodes come from {seg.clusters.length} geometric clusters. Labels are rule-based guesses with low confidence, not AI predictions.</Callout>}
        {g.source === 'ground-truth' && <Callout>Nodes are the simulator’s annotated objects: label and size are ground truth (confidence not applicable).</Callout>}
        <Slider label="“Near” threshold" value={g.nearThreshold} min={0.1} max={2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(nearThreshold) => setG({ nearThreshold })} hint="Surface-to-surface gap between bounding boxes." />
        <Toggle label="Show floor / walls" checked={showStructural} onChange={setShowStructural} />
      </Section>
      <Section title="Relations shown">
        <div className="chip-row">{(Object.keys(REL_LABEL) as RelType[]).map((t) => <button key={t} className="chip" aria-pressed={!!g.filters[t]} onClick={() => setG({ filters: { ...g.filters, [t]: !g.filters[t] } })}><span style={{ color: g.filters[t] ? '#fff' : REL_COLOR[t] }}>●</span> {REL_LABEL[t]}</button>)}</div>
        <span className="caption">Left/right are relative to the scanner heading. Corridor test and “intersects” use axis-aligned bounding boxes (conservative).</span>
      </Section>
      <Section title="Ask the scene (offline demo)">
        <Callout kind="warn" title="Not an LLM">A deterministic pattern matcher with a fixed list of intents. Every number comes from the graph geometry. It cannot understand free-form language.</Callout>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input type="text" value={q} placeholder="Ask a spatial question…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(q)} aria-label="Question" data-testid="query-input" />
          <Btn variant="primary" onClick={() => ask(q)} testId="ask">Ask</Btn>
        </div>
        <div className="chip-row">{SUPPORTED_QUESTIONS.map((t) => <button key={t} className="chip" onClick={() => ask(t)}>{t}</button>)}</div>
        {answer && (
          <div className="callout good fade-in" data-testid="answer">
            <b>Answer</b>
            <div>{answer.answer}</div>
            <span className="caption">intent: {answer.intent}</span>
            {answer.evidence.length > 0 && <table className="table"><tbody>{answer.evidence.slice(0, 8).map((e, i) => <tr key={i}><td>{e.label}</td><td className="mono">{e.value}</td></tr>)}</tbody></table>}
          </div>
        )}
      </Section>
      {sel && (
        <Section title="Selected node">
          <div className="callout" data-testid="node-details">
            <b>{sel.label}</b>
            <table className="table"><tbody>
              <tr><td>ID</td><td className="mono">{sel.id}</td></tr>
              <tr><td>Semantic label</td><td>{className(sel.classId)}</td></tr>
              <tr><td>Position</td><td className="mono">{sel.position.map((v) => v.toFixed(2)).join(', ')} m</td></tr>
              <tr><td>Dimensions</td><td className="mono">{sel.dimensions.map((v) => v.toFixed(2)).join(' × ')} m</td></tr>
              <tr><td>Bounding box</td><td className="mono">{sel.bbox.min.map((v) => v.toFixed(2)).join(', ')} → {sel.bbox.max.map((v) => v.toFixed(2)).join(', ')}</td></tr>
              <tr><td>Source</td><td>{sel.source}</td></tr>
              <tr><td>Confidence</td><td>{sel.confidence === null ? 'n/a (ground truth)' : sel.confidence.toFixed(2)}</td></tr>
            </tbody></table>
            {selRel.slice(0, 10).map((e, i) => <span key={i} className="caption">{e.from === sel.id ? sel.label : nodes.find((n) => n.id === e.from)?.label} <b style={{ color: REL_COLOR[e.type] }}>{REL_LABEL[e.type]}</b> {e.to === sel.id ? sel.label : e.to === 'corridor' ? 'the corridor' : nodes.find((n) => n.id === e.to)?.label ?? e.to}</span>)}
          </div>
        </Section>
      )}
      <Section title="Challenge question">
        <p>Which object is closest to the scanner?</p>
        <Select value={g.quizAnswer || ''} options={[{ value: '', label: 'Choose…' }, ...objs.map((o) => ({ value: o.id, label: o.label }))]} onChange={(quizAnswer) => setG({ quizAnswer })} />
        {g.quizAnswer && closest && <Callout kind={g.quizAnswer === closest.id ? 'good' : 'bad'}>{g.quizAnswer === closest.id ? `Correct — ${closest.label}, ${graph ? scannerGap(graph.scanner.pos, closest).toFixed(2) : ''} m from the scanner surface.` : 'Not quite. Ask the graph: “Which object is closest to the scanner?”'}</Callout>}
        <span className="caption">Move the scanner in Tab 1 to change the answer.</span>
      </Section>
      <Section title="3D AI with a real LLM" open={false}>
        <Callout kind="edu" title="Future capability (not active)">
          A real LLM would call <b>tools</b> on a secure server endpoint that read this scene graph and run the geometry (distances, relations). The model never invents measurements: every number in its answer must come from a tool result. This app ships only the offline matcher above.
        </Callout>
        <Btn sm onClick={() => setShowLLM(!showLLM)}>{showLLM ? 'Hide' : 'Show'} example tool contract</Btn>
        {showLLM && <pre className="mono" style={{ fontSize: '0.8125rem', background: 'var(--fill)', padding: 10, borderRadius: 12, overflow: 'auto', margin: 0 }}>{JSON.stringify(LLM_TOOL_SCHEMA, null, 2)}</pre>}
        <div className="callout" data-testid="llm-fit-card" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Cpu size={18} /><b>What local LLM can you actually run?</b></div>
          <p>If you want to try the LLM route on your own machine, <b>Model Fit Explorer</b> (local-llm-fit) checks which local AI models your computer can run — it estimates VRAM/RAM use and ranks 430+ models by how well they fit your hardware, or lets you build a model in a playground and see how its memory fits your GPU and RAM.</p>
          <span className="caption">Open-source (MIT) by maninka123. The browser version estimates your hardware, so it is less accurate than the desktop app (Windows / macOS / Linux).</span>
          <div className="btn-row">
            <a className="btn primary" href={LLM_FIT_URL} target="_blank" rel="noreferrer noopener" data-testid="llm-fit-link"><ExternalLink size={16} />Open Model Fit Explorer</a>
            <a className="btn" href={LLM_FIT_REPO} target="_blank" rel="noreferrer noopener">GitHub repo</a>
            <Btn onClick={() => setShowFit(!showFit)} icon={<Play size={16} />} testId="llm-fit-embed">{showFit ? 'Hide embedded view' : 'Show embedded here'}</Btn>
          </div>
          {showFit && <iframe title="Model Fit Explorer (local-llm-fit)" src={LLM_FIT_URL} style={{ width: '100%', height: 560, border: '1px solid var(--sep)', borderRadius: 14, background: '#fff' }} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" loading="lazy" referrerPolicy="no-referrer" />}
          <span className="caption">Embedded only on request: nothing is loaded from the external site until you click.</span>
        </div>
      </Section>
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="From points to a scene graph">Segmentation gives object-sized chunks of points. Each chunk becomes a <b>node</b> (id, label, position, size, bounding box, source). <b>Edges</b> are spatial relations computed from the geometry.</Callout>
      <Callout title="How each relation is computed">
        <b>near</b>: bounding-box gap ≤ threshold · <b>above/below</b>: lies over the other’s footprint and its bottom is at/above the other’s top · <b>inside</b>: fully contained · <b>left/right</b>: sign of the offset along the scanner’s left axis · <b>intersects</b>: boxes overlap in x, y and z · <b>blocks path</b>: box overlaps the corridor volume.
      </Callout>
      <Callout kind="warn" title="Offline demo vs a true LLM">The query box matches fixed patterns and calls geometry functions. A true LLM would parse arbitrary language, but must still obtain distances and relations from the same tools — otherwise it may invent numbers.</Callout>
    </>
  );

  return <TabFrame title="Scene Graphs & 3D AI" tab={9} viewport={viewport} controls={controls} learn={learn} stats={stats} hideViewControls overlays={<KindLegend items={[{ color: '#ff9f0a', label: 'Selected / answer objects' }, { color: '#30d158', label: 'Walking corridor' }, { color: '#ff375f', label: 'Estimated boxes (dashed)', style: 'dash' }]} />} />;
  void Badge; void fmtN; void ({} as GraphNode);
}
