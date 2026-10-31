import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { AiAccess } from '../ui/AiAccess';
import { noKeyMessage } from '../apps/workshop';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Slider } from '../ui/controls';
import { BoxOutline, CloudLayer, PolyLine, SceneLayer, SensorMarker, TextSprite } from '../ui/three';
import { circularLayout } from '../graph/layout';
import { Markdown } from '../ui/Markdown';
import { PromptView } from '../ui/PromptView';
import { Pause, Play } from '../ui/icons';
import { PRESETS, presetToConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { PointCloud } from '../core/pointcloud';
import { chatDeepSeek, ChatMsg, DEEPSEEK_MODEL, loadOwnKey, NoKeyError, saveOwnKey } from '../apps/deepseek';
import { DT, EGO, FrameSeg, N_FRAMES, Seg as SegT, Track, buildTemporal, sceneAt, segmentFrame, temporalText, trackName, trackObjects } from '../apps/moving';

const CLS_COLOR: Record<string, string> = { person: '#ff9f0a', car: '#e5484d', 'large vehicle': '#8e4ec6', 'pole / tree': '#30a46c', 'building / structure': '#8d8d95', object: '#8d8d95' };
const QUESTIONS = ['What is moving, and how fast?', 'Is anything approaching the vehicle?', 'Who crosses the vehicle’s path, and when?', 'Summarise what happened during the drive.'];

export default function TabMoving() {
  const s = useLab();
  const sensor = useMemo(() => ({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.25, noise: 0.01 }), []);
  const [clouds, setClouds] = useState<PointCloud[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [radius, setRadius] = useState(0.6), [range, setRange] = useState(24);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const [trails, setTrails] = useState(true);
  const [step, setStep] = useState<'drive' | 'clouds' | 'graphs' | 'temporal' | 'results' | 'ask'>('drive');
  const scenes = useMemo(() => Array.from({ length: N_FRAMES }, (_, k) => sceneAt(k * DT, true)), []);
  // asking the AI
  const [q, setQ] = useState(QUESTIONS[0]);
  const [ownKey, setOwnKey] = useState(() => loadOwnKey()), [needKey, setNeedKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false), [aiErr, setAiErr] = useState<string | null>(null);
  const [chat, setChat] = useState<{ q: string; text: string; tokens: number; ms: number }[]>([]);

  async function drive() {
    setClouds(null); setPlaying(false); setFrame(0); setChat([]);
    try {
      const out: PointCloud[] = [];
      for (let k = 0; k < N_FRAMES; k++) {
        setProgress(`Scanning frame ${k + 1} of ${N_FRAMES}…`);
        const e = EGO(k * DT);
        const r = await runTask('scan', { scene: sceneAt(k * DT), sensor, trajectory: staticPose(e.x, e.y, e.z, e.yaw), sweeps: 1, seed: 3 + k, maxRays: 130000, distortion: false, scanId: k, name: `Frame ${k}` });
        out.push(r.cloud);
      }
      setClouds(out);
    } catch (err) { s.notify((err as Error).message, 'error'); } finally { setProgress(null); }
  }
  useEffect(() => { void drive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // segmentation is fast, so it is simply redone whenever a setting changes
  const segs = useMemo<FrameSeg[] | null>(() => (clouds ? clouds.map((c, k) => segmentFrame(c, { voxel: 0.12, radius, minPts: 8, range, origin: [EGO(k * DT).x, EGO(k * DT).y] })) : null), [clouds, radius, range]);
  const tracks = useMemo<Track[]>(() => (segs ? trackObjects(segs) : []), [segs]);
  const graph = useMemo(() => (segs ? buildTemporal(segs, tracks) : null), [segs, tracks]);
  const text = useMemo(() => (graph ? temporalText(graph) : ''), [graph]);
  const shown = useMemo(() => tracks.filter((t) => t.cls !== 'building / structure' && t.obs.length >= 3).sort((a, b) => Number(b.moving) - Number(a.moving) || a.id - b.id), [tracks]);

  useEffect(() => {
    if (!playing || !segs) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % N_FRAMES), 700);
    return () => clearInterval(t);
  }, [playing, segs]);

  const cur = segs?.[frame] ?? null, ego = EGO(frame * DT);
  const avgMs = segs ? segs.reduce((a, f) => a + f.ms, 0) / segs.length : 0;
  const system = useMemo(() => `You answer questions about what happened during a drive, using ONLY the temporal scene graph below (tracked objects with their positions per frame, and events). Quote numbers and frame numbers from it. Be brief. If the graph does not say, say so.\n\nTEMPORAL SCENE GRAPH\n${text}`, [text]);
  const history = useMemo<ChatMsg[]>(() => chat.flatMap((c) => [{ role: 'user' as const, content: c.q }, { role: 'assistant' as const, content: c.text }]), [chat]);
  async function askAi(question = q) {
    if (!question.trim() || aiBusy) return;
    setAiBusy(true); setAiErr(null);
    try {
      const r = await chatDeepSeek([{ role: 'system', content: system }, ...history, { role: 'user', content: question }], 1500, ownKey);
      setChat((c) => [...c, { q: question, text: r.text, tokens: r.promptTokens, ms: r.ms }]); setQ(''); setNeedKey(false);
    } catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setAiErr(noKeyMessage('Ask')); } else setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  }

  const egoLine = <PolyLine pts={Array.from({ length: N_FRAMES }, (_, k) => [EGO(k * DT).x, EGO(k * DT).y, 0.05] as [number, number, number])} color="#0a84ff" width={2} dashed />;
  // a blue ring on the ground under our vehicle, so it is easy to find
  const egoMark = (
    <>
      <PolyLine pts={Array.from({ length: 49 }, (_, i) => [ego.x + 2.6 * Math.cos((i / 48) * Math.PI * 2), ego.y + 2.6 * Math.sin((i / 48) * Math.PI * 2), 0.06] as [number, number, number])} color="#0a84ff" width={4} />
      <mesh position={[ego.x, ego.y, 0.04]} raycast={() => null}><circleGeometry args={[2.6, 48]} /><meshBasicMaterial color="#0a84ff" transparent opacity={0.22} depthWrite={false} /></mesh>
      <SensorMarker x={ego.x} y={ego.y} z={ego.z} yaw={0} sensor={sensor} color="#0a84ff" showFov={false} scale={2} />
    </>
  );
  const frameLabel = `Frame ${frame + 1} of ${N_FRAMES} · t ${(frame * DT).toFixed(1)} s`;
  const HOME: [number, number, number] = [-6, -12, 36], TARGET: [number, number, number] = [-6, 1, 0];
  const objectsView = (labelText: string) => (
    <Viewport id="mv-3d" bgOverride="#ffffff" label={labelText} labelPos="tl" labelTop={12} home={HOME} target={TARGET} gridSize={5}>
      {cur && <CloudLayer cloud={cur.points} mode="cluster" colorOpts={{ clusterLabels: cur.labels }} size={Math.max(2, s.view.pointSize)} budget={200000} pickable={false} />}
      {egoLine}{egoMark}
      {shown.map((t) => {
        const o = t.obs.find((q2) => q2.frame === frame);
        return (
          <group key={t.id}>
            {step !== 'graphs' && trails && t.moving && <PolyLine pts={t.obs.filter((q2) => q2.frame <= frame).map((q2) => [q2.seg.centre[0], q2.seg.centre[1], 0.1] as [number, number, number])} color={CLS_COLOR[t.cls]} width={3} />}
            {o && <BoxOutline bbox={{ min: o.seg.min, max: o.seg.max }} color={CLS_COLOR[t.cls]} dashed={!t.moving} />}
            {o && <TextSprite text={`${trackName(t)}${t.moving && step !== 'graphs' ? ` · ${t.speed.toFixed(1)} m/s` : ''}`} position={[o.seg.centre[0], o.seg.centre[1], o.seg.max[2] + 0.5]} height={0.02} bg={CLS_COLOR[t.cls]} />}
          </group>
        );
      })}
    </Viewport>
  );
  const half = (left: React.ReactNode, right: React.ReactNode) => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>{left}</div>
      <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>{right}</div>
    </div>
  );
  const eventsList = (
    <div style={{ background: '#fff', overflow: 'auto', padding: '8px 12px', position: 'absolute', inset: 0 }} data-testid="events">
      <b style={{ fontSize: '0.875rem' }}>Events between frames</b>
      {graph?.events.length ? graph.events.map((e, i) => (
        <button key={i} onClick={() => setFrame(e.frame)} style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', border: 0, background: e.frame === frame ? '#e8f1ff' : 'transparent', padding: '3px 4px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8125rem' }}>
          <span className="mono" style={{ color: '#6e6e73', minWidth: 74, whiteSpace: 'nowrap' }}>f{e.frame} · {(e.frame * DT).toFixed(1)}s</span><span>{e.text}</span>
        </button>
      )) : <p className="hint">{clouds ? 'No events found.' : 'Scanning…'}</p>}
    </div>
  );
  const viewport = step === 'drive' ? (
    <Viewport id="mv-drive" bgOverride="#ffffff" label={`The drive · t ${(frame * DT).toFixed(1)} s`} labelPos="tl" labelTop={12} home={HOME} target={TARGET} gridSize={5}>
      <SceneLayer scene={scenes[frame]} opacity={0.95} showCeiling={false} interactive={false} />
      {egoLine}{egoMark}
    </Viewport>
  ) : step === 'clouds' ? (
    <Viewport id="mv-clouds" bgOverride="#ffffff" label={clouds ? `Point cloud ${frameLabel}` : progress ?? 'Scanning…'} labelPos="tl" labelTop={12} home={HOME} target={TARGET} gridSize={5}>
      {clouds && <CloudLayer cloud={clouds[frame]} mode="height" size={Math.max(2, s.view.pointSize - 0.5)} budget={220000} pickable={false} />}
      {egoLine}{egoMark}
    </Viewport>
  ) : step === 'graphs' ? half(objectsView(`Segmented ${frameLabel}`), <FrameGraph segs={cur?.segs ?? []} ego={ego} frame={frame} tracks={shown} />)
  : step === 'temporal' ? half(objectsView(frameLabel), <Timeline tracks={shown} frame={frame} onFrame={setFrame} />)
  : step === 'results' ? half(objectsView(frameLabel), eventsList)
  : half(objectsView(frameLabel), <Timeline tracks={shown} frame={frame} onFrame={setFrame} />);

  const timeSection = (
    <Section title="Time">
      <div className="btn-row"><Btn sm icon={playing ? <Pause size={15} /> : <Play size={15} />} onClick={() => setPlaying((v) => !v)} testId="mv-play">{playing ? 'Pause' : 'Play'}</Btn></div>
      <Slider label="Frame" value={frame + 1} min={1} max={N_FRAMES} step={1} format={(v) => `${v} of ${N_FRAMES}`} onChange={(v) => { setPlaying(false); setFrame(v - 1); }} />
    </Section>
  );
  const controls = (
    <>
      <div role="group" aria-label="Steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '4px 0 2px' }}>
        {([['drive', '1 Drive'], ['clouds', '2 Clouds'], ['graphs', '3 Graphs'], ['temporal', '4 Over time'], ['results', '5 Results'], ['ask', '6 Ask AI']] as const).map(([v, label]) => (
          <button key={v} aria-pressed={step === v} onClick={() => setStep(v)} className="btn" style={{ whiteSpace: 'nowrap', padding: '0.45rem 0.3rem', fontSize: '0.875rem', background: step === v ? 'var(--accent)' : undefined, color: step === v ? '#fff' : undefined }}>{label}</button>
        ))}
      </div>
      {step !== 'results' && step !== 'ask' && timeSection}
      {step === 'drive' && (
        <Section title="1 · The drive">
          <p className="hint">A vehicle with a roof LiDAR drives along a street at 4 m/s. A pedestrian crosses the road in front of it, one walks along the pavement, one stands, a slower car is ahead and one comes the other way. Press Play to watch.</p>
          <Btn variant="primary" icon={<Play size={16} />} onClick={drive} busy={!!progress} testId="drive">{progress ?? 'Drive again'}</Btn>
        </Section>
      )}
      {step === 'clouds' && (
        <Section title="2 · The point clouds it generates">
          <p className="hint">Every {DT} s the LiDAR (64 channels) takes one scan: a <b>point cloud series</b> of {N_FRAMES} frames, coloured here by height. Play them: the scenery slides past while the moving objects change place.</p>
          {clouds && <span className="caption">{Math.round(clouds[frame].count / 1000)}k points in this frame</span>}
        </Section>
      )}
      {step === 'graphs' && (<>
        <Section title="3 · A scene graph for each frame">
          <p className="hint">Each frame is segmented fast: the ground is taken out with a plane, the points are thinned, the rest is grouped into clusters and each cluster is named from its size (a trained 3D network would do this better). Every frame then gets its own <b>scene graph</b>: the objects as nodes, and relations such as <i>near</i> and <i>ahead of the vehicle</i> as edges.</p>
          <Slider label="Cluster distance" value={radius} min={0.3} max={1.2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={setRadius} />
          <Slider label="Look this far around the vehicle" value={range} min={10} max={40} step={1} unit=" m" onChange={setRange} />
          {segs && <table className="table" data-testid="seg-stats"><tbody><tr><td>Time per frame</td><td className="mono">{avgMs.toFixed(0)} ms</td></tr><tr><td>Points per frame</td><td className="mono">{Math.round((clouds?.[0].count ?? 0) / 1000)}k → {Math.round(segs[0].kept / 1000)}k kept</td></tr><tr><td>Objects in this frame</td><td className="mono">{cur?.segs.length ?? 0}</td></tr></tbody></table>}
        </Section>
      </>)}
      {step === 'temporal' && (
        <Section title="4 · The temporal scene graph">
          <p className="hint">Now the frames are linked: the same object is followed from scan to scan (a <b>track</b>). The chart is the temporal scene graph: one row per tracked object, one circle per frame it was seen. Solid line = moving, dashed = not moving.</p>
          <div className="btn-row"><Btn sm variant={trails ? 'primary' : ''} onClick={() => setTrails(!trails)}>Paths of moving objects</Btn></div>
          {graph && <span className="caption" data-testid="track-count">{shown.length} tracked objects · {shown.filter((t) => t.moving).length} moving · {graph.events.length} events</span>}
          <p className="hint">Boxes: <b style={{ color: '#ff9f0a' }}>people</b>, <b style={{ color: '#e5484d' }}>cars</b>, <b style={{ color: '#30a46c' }}>poles and trees</b>. Dashed = not moving.</p>
        </Section>
      )}
      {step === 'results' && (<>
        <Section title="5 · Results">
          {graph && <span className="caption" data-testid="track-count">{shown.length} tracked objects · {shown.filter((t) => t.moving).length} moving · {graph.events.length} events</span>}
          <table className="table" data-testid="results-table"><thead><tr><th>Object</th><th>State</th><th>Speed</th></tr></thead><tbody>
            {shown.filter((t) => t.moving).map((t) => <tr key={t.id}><td><span style={{ color: CLS_COLOR[t.cls] }}>●</span> {trackName(t)}</td><td>moving</td><td className="mono">{t.speed.toFixed(1)} m/s</td></tr>)}
            {shown.filter((t) => !t.moving).slice(0, 4).map((t) => <tr key={t.id}><td><span style={{ color: CLS_COLOR[t.cls] }}>●</span> {trackName(t)}</td><td>static</td><td className="mono">0</td></tr>)}
          </tbody></table>
          <p className="hint">The events are on the right. Click one to jump to that frame.</p>
        </Section>
        {timeSection}
      </>)}
      {step === 'ask' && (<>
        <Section title="6 · Ask the scene">
          <p className="hint">The temporal graph is given to DeepSeek Flash (<span className="mono">{DEEPSEEK_MODEL}</span>) as text. Keep asking: it remembers the conversation.</p>
          <PromptView system={system} user={q || '(your next question)'} testId="mv-prompt" />
        </Section>
        <div style={{ display: 'grid', gap: 8 }} data-testid="mv-chat">
          {chat.map((c, i) => (
            <div key={i} style={{ display: 'grid', gap: 6 }}>
              <div style={{ justifySelf: 'end', maxWidth: '92%', background: '#0a84ff', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '6px 10px', fontSize: '0.9rem' }}>{c.q}</div>
              <div className="callout good" style={{ gap: 4 }} data-testid={i === chat.length - 1 ? 'mv-answer' : undefined}><Markdown text={c.text} /><span className="caption">{c.tokens.toLocaleString()} tokens read · {(c.ms / 1000).toFixed(1)} s</span></div>
            </div>
          ))}
          {aiBusy && <span className="caption">DeepSeek is thinking…</span>}
          {!chat.length && <div className="chip-row">{QUESTIONS.map((t) => <button key={t} className="chip" onClick={() => void askAi(t)} disabled={!segs}>{t}</button>)}</div>}
          {chat.length > 0 && <div className="chip-row">{QUESTIONS.filter((t) => !chat.some((c) => c.q === t)).map((t) => <button key={t} className="chip" onClick={() => void askAi(t)} disabled={aiBusy}>{t}</button>)}</div>}
        </div>
        {aiErr && <Callout kind="warn">{aiErr}</Callout>}
        <AiAccess needKey={needKey} ownKey={ownKey} setOwnKey={setOwnKey} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '8px 0' }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void askAi()} placeholder="Ask about this drive…" aria-label="Question" data-testid="mv-question" />
          <Btn variant="primary" onClick={() => void askAi()} busy={aiBusy} disabled={!segs || !q.trim()} testId="mv-ask">Ask</Btn>
        </div>
        {chat.length > 0 && <Btn sm onClick={() => setChat([])}>Clear the conversation</Btn>}
      </>)}
    </>
  );
  return <TabFrame title="Moving Scene & Temporal Graph" tab={12} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv hideViewControls />;
}

/** The scene graph of one frame: the vehicle and the objects around it as nodes, relations as edges. */
function FrameGraph({ segs, ego, frame, tracks }: { segs: SegT[]; ego: { x: number; y: number }; frame: number; tracks: Track[] }) {
  const objs = segs.filter((q) => q.cls !== 'building / structure' && q.cls !== 'object').slice(0, 16);
  const name = (q: SegT) => { const t = tracks.find((x) => x.obs.some((o) => o.frame === frame && o.seg.id === q.id)); return t ? trackName(t) : q.cls; };
  const ids = ['vehicle', ...objs.map((q) => `o${q.id}`)];
  const edges: { a: string; b: string; kind: 'near' | 'ahead' | 'behind'; d: number }[] = [];
  objs.forEach((q) => { const dx = q.centre[0] - ego.x, d = Math.hypot(dx, q.centre[1] - ego.y); if (d < 20) edges.push({ a: 'vehicle', b: `o${q.id}`, kind: dx >= 0 ? 'ahead' : 'behind', d }); });
  objs.forEach((p, i) => objs.slice(i + 1).forEach((q) => { const d = Math.hypot(p.centre[0] - q.centre[0], p.centre[1] - q.centre[1]); if (d < 4) edges.push({ a: `o${p.id}`, b: `o${q.id}`, kind: 'near', d }); }));
  const W = 440, H = 400, L = new Map(circularLayout(ids, edges.map((e) => ({ a: e.a, b: e.b })), W, H).map((n) => [n.id, n]));
  const col = (c: string) => CLS_COLOR[c] ?? '#8d8d95';
  return (
    <div style={{ background: '#f5f5f7', position: 'absolute', inset: 0, overflow: 'auto' }}>
      <div style={{ padding: '8px 12px 0' }}><b style={{ fontSize: '0.875rem' }}>Scene graph of frame {frame}</b> <span className="caption">{objs.length} objects · {edges.length} relations</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Scene graph of this frame" data-testid="frame-graph" style={{ display: 'block' }}>
        {edges.map((e, i) => { const A = L.get(e.a)!, B = L.get(e.b)!; return (
          <g key={i}><line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={e.kind === 'near' ? '#64d2ff' : '#30d158'} strokeWidth={e.kind === 'near' ? 1.4 : 1.8} />{e.kind !== 'near' && <text x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 2} fontSize="9" fill="#1f7a3f" textAnchor="middle">{e.kind} {e.d.toFixed(0)} m</text>}</g>
        ); })}
        <g transform={`translate(${L.get('vehicle')!.x},${L.get('vehicle')!.y})`}><circle r={14} fill="#0a84ff" stroke="#fff" strokeWidth={2} /><text y={28} fontSize="11" textAnchor="middle" fontWeight={700} fill="#1d1d1f">vehicle</text></g>
        {objs.map((q) => { const p = L.get(`o${q.id}`)!; return <g key={q.id} transform={`translate(${p.x},${p.y})`}><circle r={10} fill={col(q.cls)} stroke="#fff" strokeWidth={1.5} /><text y={22} fontSize="10" textAnchor="middle" fill="#1d1d1f">{name(q).slice(0, 16)}</text></g>; })}
      </svg>
      <div className="caption" style={{ padding: '0 12px 8px' }}><b style={{ color: '#30d158' }}>green</b> relations are to the vehicle (within 20 m), <b style={{ color: '#64d2ff' }}>blue</b> = two objects less than 4 m apart.</div>
    </div>
  );
}

/** The temporal graph as a chart: a row per tracked object, a circle where it was seen in a frame, lines between consecutive sightings. */
function Timeline({ tracks, frame, onFrame }: { tracks: Track[]; frame: number; onFrame: (k: number) => void }) {
  const W = 430, left = 112, rowH = 26, top = 34, colW = (W - left - 16) / (N_FRAMES - 1), H = top + Math.max(1, tracks.length) * rowH + 12;
  return (
    <div style={{ background: '#fff', overflow: 'auto', position: 'absolute', inset: 0 }}>
      <div style={{ padding: '8px 12px 0' }}><b style={{ fontSize: '0.875rem' }}>Temporal scene graph</b> <span className="caption">objects × time (click a frame)</span></div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temporal scene graph" data-testid="timeline" style={{ display: 'block' }}>
        <rect x={left + frame * colW - colW / 2} y={top - 12} width={colW} height={H - top + 6} fill="#e8f1ff" rx={6} />
        {Array.from({ length: N_FRAMES }, (_, k) => (
          <g key={k} onClick={() => onFrame(k)} style={{ cursor: 'pointer' }}>
            <rect x={left + k * colW - colW / 2} y={top - 24} width={colW} height={H} fill="transparent" />
            <text x={left + k * colW} y={top - 10} textAnchor="middle" fontSize="11" fill="#6e6e73">{k}</text>
          </g>
        ))}
        <text x={8} y={top - 10} fontSize="11" fill="#6e6e73">frame →</text>
        {tracks.map((t, i) => {
          const y = top + i * rowH + 10, col = CLS_COLOR[t.cls];
          return (
            <g key={t.id}>
              <text x={8} y={y + 4} fontSize="12" fill="#1d1d1f" fontWeight={t.moving ? 700 : 400}>{trackName(t).slice(0, 18)}</text>
              {t.obs.slice(1).map((o, j) => o.frame - t.obs[j].frame === 1 && <line key={j} x1={left + t.obs[j].frame * colW} x2={left + o.frame * colW} y1={y} y2={y} stroke={col} strokeWidth={t.moving ? 3 : 1.5} strokeDasharray={t.moving ? undefined : '4 3'} />)}
              {t.obs.map((o) => <circle key={o.frame} cx={left + o.frame * colW} cy={y} r={o.frame === frame ? 6 : 4} fill={col} stroke="#fff" strokeWidth={1.5} onClick={() => onFrame(o.frame)} style={{ cursor: 'pointer' }} />)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
