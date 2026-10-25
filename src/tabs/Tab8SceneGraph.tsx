import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { loadClassroomForSegmentation, nodesFromClassroom, paintClasses } from '../apps/classroom';
import { askDeepSeek, DEEPSEEK_MODEL, estimateTokens, loadOwnKey, NoKeyError, pointCloudToText, saveOwnKey, AiResult } from '../apps/deepseek';
import { PointCloud } from '../core/pointcloud';
import { Markdown } from '../ui/Markdown';
import { className, classColor } from '../scenes/classes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { CloudLayer, BoxOutline, SensorMarker } from '../ui/three';
import { ExternalLink, Cpu, Play } from '../ui/icons';
import { buildGraph, nodesFromLabelledClusters, REL_LABEL, RelType, SceneGraph, GraphNode, scannerGap } from '../graph/sceneGraph';
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
              <circle r={sel ? 20 : 16} fill={`rgb(${c.join(',')})`} fillOpacity={0.9} stroke={sel ? '#fff' : hl ? '#ffd60a' : 'rgba(0,0,0,.4)'} strokeWidth={sel || hl ? 3 : 1.5} strokeDasharray={estimated ? '4 3' : undefined} />
              <text y={31} fontSize="13.5" fontWeight={600} textAnchor="middle" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3.5 }}>{n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Shows the exact prompt that is sent, laid out as a chat: the system message, then the user message. Long data is cut short on screen (all of it is sent). */
function PromptView({ system, user, testId }: { system: string; user: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const cut = (t: string) => { const lines = t.split('\n'); return lines.length > 14 ? `${lines.slice(0, 12).join('\n')}\n… (${lines.length - 12} more lines, all are sent)` : t; };
  const box: React.CSSProperties = { margin: 0, padding: '8px 10px', borderRadius: 10, whiteSpace: 'pre-wrap', fontSize: '0.8125rem', maxHeight: 260, overflow: 'auto' };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Btn sm onClick={() => setOpen(!open)} testId={testId}>{open ? 'Hide the prompt' : 'Show the prompt'}</Btn>
      {open && (
        <div className="callout" style={{ gap: 8 }} data-testid={`${testId}-text`}>
          <b>The prompt sent to {DEEPSEEK_MODEL}</b>
          <div><span className="caption"><b>1 · System</b> (sets the role)</span><pre className="mono" style={{ ...box, background: '#eef3ff' }}>{system}</pre></div>
          <div><span className="caption"><b>2 · User</b> (the question and the data)</span><pre className="mono" style={{ ...box, background: '#f5f5f7' }}>{cut(user)}</pre></div>
        </div>
      )}
    </div>
  );
}

export default function Tab8() {
  const s = useLab();
  // the same classroom scan as the Clustering & Segmentation tab
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  useEffect(() => { void loadClassroomForSegmentation().then(setCloud).catch((e) => s.notify((e as Error).message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const classCloud = useMemo(() => (cloud ? paintClasses(cloud) : null), [cloud]);
  const truthNodes = useMemo(() => (cloud ? nodesFromClassroom(cloud) : []), [cloud]);
  const [vp, setVp] = useState({ x: 0, y: 0 }); // where the "scanner" stands in the room
  const scannerPos: Vec3 = [vp.x, vp.y, 1.2];
  const g = s.graph;
  const setG = (patch: Partial<typeof g>) => useLab.setState({ graph: { ...useLab.getState().graph, ...patch } });
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [showStructural, setShowStructural] = useState(false);
  const [showLLM, setShowLLM] = useState(false);
  const [pane, setPane] = useState<'direct' | 'graph' | 'ai'>('direct');
  const [showFit, setShowFit] = useState(false);
  const seg = s.seg.result;
  // direct inference with DeepSeek
  const [nPts, setNPts] = useState(800), [withColour, setWithColour] = useState(true);
  const [ownKey, setOwnKey] = useState(() => loadOwnKey());
  const [needKey, setNeedKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<(AiResult & { sent: number }) | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const preview = useMemo(() => (cloud ? pointCloudToText(cloud, nPts, withColour) : null), [cloud, nPts, withColour]);
  const directPrompt = useMemo(() => ({
    system: 'You are given raw LiDAR point cloud data as plain text. Be honest and short: say what you can and cannot tell from numbers alone.',
    user: preview ? `Below are ${preview.count} points sampled from a LiDAR scan of one room. Each line is one point: x y z (metres)${withColour ? ' then r g b (0-255)' : ''}.\n\nWhat kind of room is this, and which objects are in it? Give each object with an approximate position.\n\n${preview.text}` : '',
  }), [preview, withColour]);
  async function sendToAi() {
    if (!preview || !cloud) return;
    setAiBusy(true); setAiErr(null);
    const { system, user } = directPrompt;
    try { const r = await askDeepSeek(system, user, 2500, ownKey); setAi({ ...r, sent: preview.count }); setNeedKey(false); }
    catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setAiErr('This site has no DeepSeek key of its own. Paste your key below (it stays in your browser) and press Send again.'); } else setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  }

  const graph = g.graph;
  useEffect(() => {
    if (!truthNodes.length) return;
    const nodes = g.source === 'segmentation' && seg ? nodesFromLabelledClusters(seg, s.seg.names) : truthNodes;
    const gr = buildGraph(nodes, { pos: scannerPos, yaw: 0 }, undefined, g.nearThreshold);
    setG({ graph: gr });
  }, [g.source, g.nearThreshold, truthNodes, vp.x, vp.y, seg, s.seg.names]); // eslint-disable-line react-hooks/exhaustive-deps

  // step 3: the scene graph as text
  const [gBusy, setGBusy] = useState(false), [gErr, setGErr] = useState<string | null>(null), [gAns, setGAns] = useState<{ q: string; r: AiResult } | null>(null);
  const graphText = useMemo(() => {
    if (!graph) return '';
    const f = (v: number) => v.toFixed(2), lab = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
    const objs = graph.nodes.filter((n) => !n.structural);
    const L = [`Scanner at (${f(graph.scanner.pos[0])}, ${f(graph.scanner.pos[1])}, ${f(graph.scanner.pos[2])}) m. Units are metres; z is up.`, 'OBJECTS (name: centre x y z; size x y z; distance from the scanner to its surface):'];
    objs.forEach((n) => L.push(`${n.label}: ${n.position.map(f).join(' ')}; ${n.dimensions.map(f).join(' ')}; ${f(scannerGap(graph.scanner.pos, n))} m from the scanner`));
    L.push('RELATIONS:');
    graph.edges.filter((e) => ['near', 'above', 'below'].includes(e.type)).slice(0, 700).forEach((e) => L.push(`${lab(e.from)} ${REL_LABEL[e.type]} ${lab(e.to)}${e.value !== undefined ? ` (${f(e.value)} m)` : ''}`));
    return L.join('\n');
  }, [graph, g.filters]);
  const graphPrompt = (question: string) => ({
    system: 'You answer spatial questions about a room using ONLY the scene graph given. Quote numbers from it. If the graph does not say, say so. Be brief.',
    user: `SCENE GRAPH\n${graphText}\n\nQUESTION: ${question}`,
  });
  async function askGraphAi(question: string) {
    setGBusy(true); setGErr(null);
    const p = graphPrompt(question);
    try { const r = await askDeepSeek(p.system, p.user, 1200, ownKey); setGAns({ q: question, r }); setNeedKey(false); }
    catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setGErr('This site has no DeepSeek key of its own. Paste your key below (it stays in your browser) and press Ask again.'); } else setGErr((e as Error).message); }
    finally { setGBusy(false); }
  }
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

  const selectNode = (id: string | null) => setG({ selectedNode: id });
  const hlIds = [...new Set([...(sel ? [sel.id] : []), ...highlight])];

  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="sg3d" home={[8, -10, 6.5]} target={[0, 0, 1.2]} hideGrid hideAxes bgOverride="#ffffff">
          {classCloud && <CloudLayer cloud={classCloud} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} clip={{ on: true, min: -1, max: 2.28 }} />}
          {graph && nodes.filter((n) => !n.structural).map((n) => <BoxOutline key={n.id} bbox={n.bbox} color={hlIds.includes(n.id) ? '#ffd60a' : g.source === 'segmentation' ? '#ff375f' : '#0a84ff'} dashed={g.source === 'segmentation'} />)}
          <SensorMarker x={scannerPos[0]} y={scannerPos[1]} z={scannerPos[2]} yaw={0} sensor={s.sensor} label="Scanner" showFov={false} scale={1.4} />
        </Viewport>
      </div>
      <div style={{ position: 'relative', background: 'var(--bg)' }}>
        {graph && <GraphView graph={graph} filters={g.filters} selected={g.selectedNode} onSelect={selectNode} showStructural={showStructural} highlight={highlight} />}
        <div className="overlay glass card" style={{ top: 12, left: 12, padding: '0.3rem 0.7rem', fontSize: '0.875rem', fontWeight: 600 }}>Graph · tap an object</div>
      </div>
    </div>
  );

  const stats = [
    { k: 'Objects', v: objs.length, s: `${graph ? graph.edges.length : 0} relations` },
    { k: 'Closest to scanner', v: closest ? closest.label : '—', s: closest && graph ? `${scannerGap(graph.scanner.pos, closest).toFixed(2)} m away` : undefined },
  ];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'direct', label: '1 · Direct AI' }, { value: 'graph', label: '2 · Scene graph' }, { value: 'ai', label: '3 · Graph → AI' }]} label="Section" />
      {pane === 'direct' && (<>
      <Section title="Direct inference: give the point cloud to an AI">
        <p className="hint">Skip the pipeline: send the raw points, as text, straight to <b>DeepSeek Flash</b> (<span className="mono">{DEEPSEEK_MODEL}</span>).</p>
        <Slider label="Points to send" value={nPts} min={100} max={3000} step={100} onChange={setNPts} hint="Every point costs tokens (the model's unit of reading). More points cost more and can run over its limit." />
        <Toggle label="Include the colours" checked={withColour} onChange={setWithColour} />
        {preview && cloud && (
          <div className="callout" style={{ gap: 6 }} data-testid="ds-preview">
            <b>What is sent</b>
            <pre className="mono" style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{preview.text.split('\n').slice(0, 5).join('\n')}{'\n…'}</pre>
            <span className="caption">{fmtN(preview.count)} of {fmtN(cloud.count)} points · about {fmtN(estimateTokens(preview.count, withColour))} tokens. The whole cloud would be about {fmtN(estimateTokens(cloud.count, withColour))} tokens, far more than the model can read at once.</span>
          </div>
        )}
        {needKey && <label className="field"><span>Your DeepSeek key (kept only in this browser)</span><input type="password" value={ownKey} onChange={(e) => { setOwnKey(e.target.value); saveOwnKey(e.target.value); }} placeholder="sk-…" data-testid="ds-key" autoComplete="off" /></label>}
        <PromptView system={directPrompt.system} user={directPrompt.user} testId="ds-prompt" />
        <Btn variant="primary" onClick={sendToAi} busy={aiBusy} disabled={!preview} testId="ds-send">Send to DeepSeek Flash ({DEEPSEEK_MODEL})</Btn>
        {aiErr && <Callout kind="warn">{aiErr}</Callout>}
        {ai && (
          <div className="callout fade-in" style={{ gap: 8 }} data-testid="ds-answer">
            <b>DeepSeek's answer (raw)</b>
            <Markdown text={ai.text} />
            <span className="caption">{fmtN(ai.sent)} points sent · {fmtN(ai.promptTokens)} tokens read · {fmtN(ai.completionTokens)} written · {(ai.ms / 1000).toFixed(1)} s · {ai.via === 'server' ? 'key held by the server' : 'your own key'} · model: DeepSeek Flash ({DEEPSEEK_MODEL})</span>
          </div>
        )}
        <Callout kind="edu" title="Why this is not real point cloud inference">
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: 3 }}>
            <li>A language model reads <b>text</b>; a point cloud is just numbers with no order and no neighbours.</li>
            <li>It cannot <i>see</i> shape, only guess from patterns (“z ≈ 0, so a floor”).</li>
            <li>It can read only a sparse handful of points.</li>
            <li>Positions it gives are approximate or made up; it cannot count or measure reliably.</li>
            <li>Real 3D AI uses models built for 3D (point-based or voxel networks).</li>
            <li>Or a pipeline, as in this tab: segment, build a scene graph with exact geometry, and let the language model only <b>ask</b> that graph.</li>
          </ul>
        </Callout>
      </Section>
      </>)}
      {pane === 'graph' && (<>
      <Section title="Objects">
        <Seg value={g.source} onChange={(source) => setG({ source })} options={[{ value: 'ground-truth', label: 'True objects' }, { value: 'segmentation', label: 'My labelled clusters' }]} />
        {g.source === 'segmentation' && (!seg || !Object.values(s.seg.names).some(Boolean)) && <Callout kind="warn">Run Clustering & Segmentation (tab 11) and label the clusters in its Results. The clusters you named become the objects of this graph.</Callout>}
        <Slider label="“Near” threshold" value={g.nearThreshold} min={0.1} max={2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(nearThreshold) => setG({ nearThreshold })}  />
        <Slider label="Scanner position, left–right" value={vp.x} min={-3.5} max={3.5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(x) => setVp({ ...vp, x })} />
        <Slider label="Scanner position, front–back" value={vp.y} min={-5.5} max={5.5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(y) => setVp({ ...vp, y })} />
        <Toggle label="Show floor / walls" checked={showStructural} onChange={setShowStructural} />
      </Section>
      <Section title="Relations shown">
        <div className="chip-row">{(Object.keys(REL_LABEL) as RelType[]).map((t) => <button key={t} className="chip" aria-pressed={!!g.filters[t]} onClick={() => setG({ filters: { ...g.filters, [t]: !g.filters[t] } })}><span style={{ color: g.filters[t] ? '#fff' : REL_COLOR[t] }}>●</span> {REL_LABEL[t]}</button>)}</div>
        <span className="caption">Left/right are as seen from the scanner. Boxes are axis-aligned, so “intersects” is conservative.</span>
      </Section>
      </>)}
      {pane === 'ai' && (<>
      <Section title="Give the scene graph to an AI">
        <p className="hint">Now the AI reads the <b>scene graph</b> as text: named objects with exact positions and sizes, and relations worked out by geometry.</p>
        {graphText && <div className="callout" style={{ gap: 6 }} data-testid="gs-preview"><b>What is sent</b><pre className="mono" style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{graphText.split('\n').slice(0, 6).join('\n')}{'\n…'}</pre><span className="caption">{fmtN(graphText.split('\n').length)} lines · about {fmtN(Math.round(graphText.length / 3.5))} tokens: far fewer than the raw points, and every number is exact.</span></div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input type="text" value={q} placeholder="Ask a spatial question…" onChange={(e) => setQ(e.target.value)} aria-label="Question for the AI" data-testid="gs-question" />
          <Btn variant="primary" onClick={() => void askGraphAi(q || 'What objects are in the room?')} busy={gBusy} disabled={!graphText} testId="gs-send">Ask DeepSeek Flash</Btn>
        </div>
        <PromptView system={graphPrompt(q || 'What objects are in the room?').system} user={graphPrompt(q || 'What objects are in the room?').user} testId="gs-prompt" />
        <div className="chip-row">{SUPPORTED_QUESTIONS.map((t) => <button key={t} className="chip" onClick={() => setQ(t)}>{t}</button>)}</div>
        {needKey && <label className="field"><span>Your DeepSeek key (kept only in this browser)</span><input type="password" value={ownKey} onChange={(e) => { setOwnKey(e.target.value); saveOwnKey(e.target.value); }} placeholder="sk-…" autoComplete="off" /></label>}
        {gErr && <Callout kind="warn">{gErr}</Callout>}
        {gAns && (<div className="callout good fade-in" style={{ gap: 6 }} data-testid="gs-answer"><b>DeepSeek's answer</b><Markdown text={gAns.r.text} /><span className="caption">{fmtN(gAns.r.promptTokens)} tokens read · {fmtN(gAns.r.completionTokens)} written · {(gAns.r.ms / 1000).toFixed(1)} s · model: DeepSeek Flash ({DEEPSEEK_MODEL})</span><b>The graph's own answer</b><div>{answerQuery(graph!, gAns.q).answer}</div><span className="caption">Computed directly from the geometry, no AI involved. Compare the two: the AI is only as good as the graph it reads, and it can still slip on numbers.</span></div>)}
      </Section>
      <Section title="Or ask the graph directly (no AI)">
        <p className="caption">Offline demo: a fixed set of question patterns, not an AI model. Every number comes from the graph geometry.</p>
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
              <tr><td>Semantic label</td><td>{sel.classLabel ?? className(sel.classId)}</td></tr>
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
        <span className="caption">Move the scanner in the Graph section to change the answer.</span>
      </Section>
      <Section title="Using a real LLM">
        <p className="hint">Not active in this app. A real LLM would call tools on a server that read this graph and do the geometry, so it never invents a measurement.</p>
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
      </>)}
    </>
  );

  return <TabFrame title="Scene Graph" tab={11} viewport={viewport} controls={controls} learn={null} noPanelTabs statsRow stats={stats} hideViewControls />;
  void Badge; void fmtN; void ({} as GraphNode);
}
