import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { loadClassroomForSegmentation, nodesFromClassroom, paintClasses } from '../apps/classroom';
import { askDeepSeek, estimateTokens, loadOwnKey, NoKeyError, pointCloudToText, saveOwnKey, AiResult } from '../apps/deepseek';
import { PointCloud } from '../core/pointcloud';
import { Markdown } from '../ui/Markdown';
import { Chat } from '../ui/Chat';
import { PromptView } from '../ui/PromptView';
import { className, classColor } from '../scenes/classes';
import { AiAccess } from '../ui/AiAccess';
import { noKeyMessage } from '../apps/workshop';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { CloudLayer, BoxOutline, TextSprite } from '../ui/three';
import { ExternalLink, Cpu, Play } from '../ui/icons';
import { buildGraph, nodesFromLabelledClusters, REL_LABEL, RelType, SceneGraph, GraphNode } from '../graph/sceneGraph';
import { answerQuery, QueryAnswer, SUPPORTED_QUESTIONS, LLM_TOOL_SCHEMA } from '../graph/query';
import { forceLayout } from '../graph/layout';
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
  const small = ids.length > 22, R = small ? 12 : 16, radius = (id: string, on: boolean) => (id === 'corridor' ? 20 : (on ? R + 4 : R));
  const layout = useMemo(() => {
    const seen = new Set<string>();
    const pairs = edges.map((e) => ({ a: e.from, b: e.to })).filter((e) => { const k = [e.a, e.b].sort().join('|'); if (e.a === e.b || seen.has(k)) return false; seen.add(k); return true; });
    const L = forceLayout(ids, pairs, Math.max(w, 300), Math.max(h, 300), small ? 70 : 90);
    return new Map(L.map((n) => [n.id, n]));
  }, [ids, edges, w, h, small]);
  // several relations between the same two objects are drawn as separate curves, not as doubled lines
  const lanes = useMemo(() => { const cnt = new Map<string, number>(), at = new Map<number, number>(); edges.forEach((e, i) => { const k = [e.from, e.to].sort().join('|'), m = cnt.get(k) ?? 0; at.set(i, m); cnt.set(k, m + 1); }); return { at, cnt }; }, [edges]);
  const focus = hover ?? selected;
  const legend = useMemo(() => { const m = new Map<string, number[]>(); nodes.forEach((n) => { const name = n.classLabel ?? n.label; if (!m.has(name)) m.set(name, classColor(n.classId)); }); return [...m.entries()]; }, [nodes]);
  const types = [...new Set(edges.map((e) => e.type))];
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }} data-testid="graph-view">
      <svg width={w} height={h} role="img" aria-label="Scene graph" onClick={() => onSelect(null)}>
        <defs>{types.map((t) => <marker key={t} id={`arr-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill={REL_COLOR[t]} /></marker>)}</defs>
        {edges.map((e, i) => {
          const a = layout.get(e.from), b = layout.get(e.to);
          if (!a || !b || e.from === e.to) return null;
          const on = !focus || e.from === focus || e.to === focus;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
          const ra = radius(e.from, selected === e.from) + 2, rb = radius(e.to, selected === e.to) + 3;
          const cnt = lanes.cnt.get([e.from, e.to].sort().join('|')) ?? 1, lane = (lanes.at.get(i) ?? 0) - (cnt - 1) / 2, bend = lane * 26 * (e.from < e.to ? 1 : -1);
          const mx = (a.x + b.x) / 2 - uy * bend, my = (a.y + b.y) / 2 + ux * bend;
          // start and end on the rim of the circles, aiming at the curve's control point so the line leaves where it should
          const sx = a.x + ((mx - a.x) / (Math.hypot(mx - a.x, my - a.y) || 1)) * ra, sy = a.y + ((my - a.y) / (Math.hypot(mx - a.x, my - a.y) || 1)) * ra;
          const ex = b.x + ((mx - b.x) / (Math.hypot(mx - b.x, my - b.y) || 1)) * rb, ey = b.y + ((my - b.y) / (Math.hypot(mx - b.x, my - b.y) || 1)) * rb;
          const dir = e.type === 'near' || e.type === 'intersects';
          return (
            <g key={i} opacity={on ? (focus ? 1 : 0.8) : 0.1}>
              <path d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`} fill="none" stroke={REL_COLOR[e.type]} strokeWidth={on && focus ? 2.4 : 1.6} markerEnd={dir ? undefined : `url(#arr-${e.type})`} />
              {focus && on && <text x={(sx + 2 * mx + ex) / 4} y={(sy + 2 * my + ey) / 4 - 4} fontSize="12" fill={REL_COLOR[e.type]} fontWeight={600} textAnchor="middle" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 4 }}>{REL_LABEL[e.type]}{e.value !== undefined && e.type !== 'blocks_path' ? ` ${e.value.toFixed(2)} m` : ''}</text>}
            </g>
          );
        })}
        {ids.map((id) => {
          const p = layout.get(id)!;
          if (id === 'corridor') return <g key={id} transform={`translate(${p.x},${p.y})`}><rect x={-30} y={-14} width={60} height={28} rx={8} fill="rgba(48,209,88,.25)" stroke="#30d158" /><text y={5} fontSize="12.5" textAnchor="middle" fill="#248a3d" fontWeight={600}>corridor</text></g>;
          const n = nodes.find((q) => q.id === id)!;
          const c = classColor(n.classId);
          const sel = selected === id, hl = highlight.includes(id), dim = !!focus && focus !== id && !edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
          const estimated = n.source !== 'ground-truth annotation';
          return (
            <g key={id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.3 : 1} style={{ cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); onSelect(id); }} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} data-testid={`node-${id}`}>
              <circle r={radius(id, sel)} fill={`rgb(${c.join(',')})`} fillOpacity={0.92} stroke={sel ? '#1d1d1f' : hl ? '#ffd60a' : 'rgba(0,0,0,.45)'} strokeWidth={sel || hl ? 3 : 1.5} strokeDasharray={estimated ? '4 3' : undefined} />
              <text y={radius(id, sel) + 14} fontSize={small ? 11.5 : 13} fontWeight={600} textAnchor="middle" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 4 }}>{n.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="overlay glass card" style={{ left: 12, bottom: 12, padding: '0.4rem 0.7rem', display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.75rem', maxWidth: 'calc(100% - 24px)' }} data-testid="graph-legend">
        {legend.map(([name, col]) => <span key={name}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: `rgb(${col.join(',')})`, marginRight: 5, verticalAlign: -1 }} />{name}</span>)}
        {types.map((t) => <span key={t} style={{ color: REL_COLOR[t], fontWeight: 600 }}>— {REL_LABEL[t]}</span>)}
      </div>
    </div>
  );
}

export default function Tab8() {
  const s = useLab();
  // the same classroom scan as the Unsupervised Learning tab
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  useEffect(() => { void loadClassroomForSegmentation().then(setCloud).catch((e) => s.notify((e as Error).message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const classCloud = useMemo(() => (cloud ? paintClasses(cloud) : null), [cloud]);
  const truthNodes = useMemo(() => (cloud ? nodesFromClassroom(cloud) : []), [cloud]);
  const scannerPos: Vec3 = [0, 0, 1.2]; // the graph code wants a viewpoint for left / right; the room centre is used and never shown
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
    catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setAiErr(noKeyMessage('Send')); } else setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  }

  const graph = g.graph;
  const [useGraphInChat, setUseGraphInChat] = useState(true);
  useEffect(() => {
    // the objects come from the clusters you named; the scan's own answer key is only used when asked for explicitly
    const nodes = g.source === 'ground-truth' ? truthNodes : seg && Object.values(s.seg.names).some(Boolean) ? nodesFromLabelledClusters(seg, s.seg.names) : [];
    if (!nodes.length) { if (useLab.getState().graph.graph) setG({ graph: null }); return; }
    const gr = buildGraph(nodes, { pos: scannerPos, yaw: 0 }, undefined, g.nearThreshold);
    setG({ graph: gr });
  }, [g.source, g.nearThreshold, truthNodes, seg, s.seg.names]); // eslint-disable-line react-hooks/exhaustive-deps

  // step 3: the scene graph as text
  const [gBusy, setGBusy] = useState(false), [gErr, setGErr] = useState<string | null>(null), [gAns, setGAns] = useState<{ q: string; r: AiResult } | null>(null);
  const graphText = useMemo(() => {
    if (!graph) return '';
    const f = (v: number) => v.toFixed(2), lab = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
    const objs = graph.nodes.filter((n) => !n.structural);
    const L = ['Units are metres; z is up.', 'OBJECTS (name: centre x y z; size x y z):'];
    objs.forEach((n) => L.push(`${n.label}: ${n.position.map(f).join(' ')}; ${n.dimensions.map(f).join(' ')}`));
    L.push('RELATIONS:');
    graph.edges.filter((e) => ['near', 'above', 'below'].includes(e.type)).slice(0, 700).forEach((e) => L.push(`${lab(e.from)} ${REL_LABEL[e.type]} ${lab(e.to)}${e.value !== undefined ? ` (${f(e.value)} m)` : ''}`));
    return L.join('\n');
  }, [graph, g.filters]);
  const chatSystem = useMemo(() => `You are a friendly, clear assistant inside a LiDAR teaching lab. You can answer any question the user asks, on LiDAR or anything else. Keep answers short, use Markdown, and use a table when comparing several things.${useGraphInChat && graphText ? `\n\nThe user is looking at a scene graph of a classroom. When a question is about this room, use only the graph below for names, positions, sizes and relations, and say so if the graph does not tell. If the question is about something else, ignore the graph.\n\nSCENE GRAPH\n${graphText}` : ''}`, [graphText, useGraphInChat]);
  const graphPrompt = (question: string) => ({
    system: 'You answer spatial questions about a room using ONLY the scene graph given. Quote numbers from it. If the graph does not say, say so. Be brief.',
    user: `SCENE GRAPH\n${graphText}\n\nQUESTION: ${question}`,
  });
  async function askGraphAi(question: string) {
    setGBusy(true); setGErr(null);
    const p = graphPrompt(question);
    try { const r = await askDeepSeek(p.system, p.user, 1200, ownKey); setGAns({ q: question, r }); setNeedKey(false); }
    catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setGErr(noKeyMessage('Ask')); } else setGErr((e as Error).message); }
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

  const selectNode = (id: string | null) => setG({ selectedNode: id });
  const hlIds = [...new Set([...(sel ? [sel.id] : []), ...highlight])];

  // step 1 (direct AI) works on the raw point cloud only: no graph, no boxes
  const rawView = (
    <Viewport id="sg-raw" home={[8, -10, 6.5]} target={[0, 0, 1.2]} hideGrid hideAxes bgOverride="#ffffff" label="The raw point cloud: this is what the AI is given" labelPos="tl" labelTop={12}>
      {classCloud && <CloudLayer cloud={classCloud} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} clip={{ on: true, min: -1, max: 2.28 }} />}
    </Viewport>
  );
  const graphViewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="sg3d" home={[8, -10, 6.5]} target={[0, 0, 1.2]} hideGrid hideAxes bgOverride="#ffffff">
          {classCloud && <CloudLayer cloud={classCloud} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 150000)} pickable={false} clip={{ on: true, min: -1, max: 2.28 }} />}
          {graph && nodes.filter((n) => !n.structural).map((n) => <BoxOutline key={n.id} bbox={n.bbox} color={hlIds.includes(n.id) ? '#ffd60a' : g.source === 'segmentation' ? '#ff375f' : '#0a84ff'} dashed={g.source === 'segmentation'} />)}
          {graph && nodes.filter((n) => !n.structural && (hlIds.includes(n.id) || g.selectedNode === n.id || !/^(Chair|Table)/.test(n.label))).map((n) => <TextSprite key={`t-${n.id}`} text={n.label} position={[n.position[0], n.position[1], n.bbox.max[2] + 0.18]} height={0.022} bg={hlIds.includes(n.id) ? 'rgba(255,214,10,0.95)' : 'rgba(29,29,31,0.72)'} color={hlIds.includes(n.id) ? '#1d1d1f' : '#fff'} />)}
        </Viewport>
      </div>
      <div style={{ position: 'relative', background: 'var(--bg)' }}>
        {!graph && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }} data-testid="graph-empty">
            <div style={{ display: 'grid', gap: 10, maxWidth: 360, justifyItems: 'stretch' }}>
              <b style={{ fontSize: '1.05rem', textAlign: 'center' }}>Where should the objects come from?</b>
              <Btn variant="primary" onClick={() => useLab.getState().setTab(11)} testId="graph-go-cluster">Cluster the room and name the clusters</Btn>
              <Btn onClick={() => useLab.getState().setTab(12)} testId="graph-go-train">Train a segmentation model</Btn>
              <Btn onClick={() => setG({ source: 'ground-truth' })} testId="graph-use-truth">Just try it: use the true objects</Btn>
              <span className="caption" style={{ textAlign: 'center' }}>Clusters you name in Unsupervised Learning become the objects of the graph. The true objects are the scan's own answer key, only for trying things out.</span>
            </div>
          </div>
        )}
        {graph && <GraphView graph={graph} filters={g.filters} selected={g.selectedNode} onSelect={selectNode} showStructural={showStructural} highlight={highlight} />}
        <div className="overlay glass card" style={{ top: 12, left: 12, padding: '0.3rem 0.7rem', fontSize: '0.875rem', fontWeight: 600 }}>Graph · tap an object</div>
      </div>
    </div>
  );

  const viewport = pane === 'direct' ? rawView : graphViewport;
  const stats = [
    { k: 'Objects', v: objs.length, s: `${graph ? graph.edges.length : 0} relations` },
  ];

  const controls = (
    <>
      <Seg value={pane} onChange={setPane} options={[{ value: 'direct', label: '1 Direct AI' }, { value: 'graph', label: '2 Scene graph' }, { value: 'ai', label: '3 Graph → AI' }]} label="Section" />
      {pane === 'direct' && (<>
      <Section title="Direct inference: give the point cloud to an AI">
        <p className="hint">Skip the pipeline: send the raw points, as text, straight to <b>DeepSeek V4 Flash</b>.</p>
        <Slider label="Points to send" value={nPts} min={100} max={3000} step={100} onChange={setNPts} hint="Every point costs tokens (the model's unit of reading). More points cost more and can run over its limit." />
        <Toggle label="Include the colours" checked={withColour} onChange={setWithColour} />
        {preview && cloud && (
          <div className="callout" style={{ gap: 6 }} data-testid="ds-preview">
            <b>What is sent</b>
            <pre className="mono" style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{preview.text.split('\n').slice(0, 5).join('\n')}{'\n…'}</pre>
            <span className="caption">{fmtN(preview.count)} of {fmtN(cloud.count)} points · about {fmtN(estimateTokens(preview.count, withColour))} tokens. The whole cloud would be about {fmtN(estimateTokens(cloud.count, withColour))} tokens, far more than the model can read at once.</span>
          </div>
        )}
        <AiAccess needKey={needKey} ownKey={ownKey} setOwnKey={setOwnKey} testId="ds-key" />
        <PromptView system={directPrompt.system} user={directPrompt.user} testId="ds-prompt" />
        <Btn variant="primary" onClick={sendToAi} busy={aiBusy} disabled={!preview} testId="ds-send">Send</Btn>
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
        <p className="hint">{g.source === 'ground-truth' ? 'The scan\'s own answer key: a quick way to try the graph.' : 'The clusters you named in tab 12 (Unsupervised Learning) become the objects.'}</p>
        <Slider label="“Near” threshold" value={g.nearThreshold} min={0.1} max={2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(nearThreshold) => setG({ nearThreshold })}  />
        <Toggle label="Show floor / walls" checked={showStructural} onChange={setShowStructural} />
      </Section>
      <Section title="Relations shown">
        <div className="chip-row">{(Object.keys(REL_LABEL) as RelType[]).map((t) => <button key={t} className="chip" aria-pressed={!!g.filters[t]} onClick={() => setG({ filters: { ...g.filters, [t]: !g.filters[t] } })}><span style={{ color: g.filters[t] ? '#fff' : REL_COLOR[t] }}>●</span> {REL_LABEL[t]}</button>)}</div>
        <span className="caption">Boxes are axis-aligned, so “intersects” is conservative.</span>
      </Section>
      </>)}
      {pane === 'ai' && (<>
      <Section title="Chat with the AI">
        <Chat id="gs" ownKey={ownKey} setOwnKey={setOwnKey} title="Ask anything" placeholder={useGraphInChat && graphText ? 'Ask about the room, or anything else…' : 'Ask anything…'}
          system={chatSystem}
          suggestions={useGraphInChat && graphText ? ['Describe this room in two sentences', 'Which table has the most chairs near it?', 'What is closest to the whiteboard?', 'List the furniture in a table', 'What is a scene graph?'] : ['What is LiDAR good for?', 'What is a scene graph?', 'Explain ICP like I am new to this', 'How does a point cloud differ from an image?']}
          headerExtra={<button className={`chip ${useGraphInChat ? '' : ''}`} aria-pressed={useGraphInChat} onClick={() => setUseGraphInChat(!useGraphInChat)} title="When on, the AI is given the scene graph as text, so it can answer about the room" data-testid="gs-ground">{useGraphInChat ? 'Scene graph: on' : 'Scene graph: off'}</button>} />
        {useGraphInChat && !graphText && <span className="caption">There are no objects in the graph yet, so the AI cannot know about the room. Choose the objects above first.</span>}
        {graphText && <details className="caption" data-testid="gs-preview"><summary>What the AI is given (about {fmtN(Math.round(graphText.length / 3.5))} tokens)</summary><pre className="mono" style={{ margin: '6px 0 0', fontSize: '0.75rem', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{graphText}</pre></details>}
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

  return <TabFrame title="Scene Graphs & 3D AI" tab={13} noEnv viewport={viewport} controls={controls} learn={null} noPanelTabs statsRow stats={pane === 'direct' ? undefined : stats} hideViewControls />;
  void Badge; void fmtN; void ({} as GraphNode);
}
