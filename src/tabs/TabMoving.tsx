import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Slider } from '../ui/controls';
import { BoxOutline, CloudLayer, PolyLine, SensorMarker, TextSprite } from '../ui/three';
import { Markdown } from '../ui/Markdown';
import { PromptView } from '../ui/PromptView';
import { Pause, Play } from '../ui/icons';
import { PRESETS, presetToConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { PointCloud } from '../core/pointcloud';
import { askDeepSeek, AiResult, DEEPSEEK_MODEL, loadOwnKey, NoKeyError, saveOwnKey } from '../apps/deepseek';
import { DT, EGO, FrameSeg, N_FRAMES, Track, buildTemporal, sceneAt, segmentFrame, temporalText, trackName, trackObjects } from '../apps/moving';

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
  // asking the AI
  const [q, setQ] = useState(QUESTIONS[0]);
  const [ownKey, setOwnKey] = useState(() => loadOwnKey()), [needKey, setNeedKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false), [aiErr, setAiErr] = useState<string | null>(null), [ai, setAi] = useState<{ q: string; r: AiResult } | null>(null);

  async function drive() {
    setClouds(null); setPlaying(false); setFrame(0); setAi(null);
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
  const prompt = useMemo(() => ({
    system: 'You answer questions about what happened during a drive, using ONLY the temporal scene graph given (tracked objects with their positions per frame, and events). Quote numbers and frame numbers from it. Be brief.',
    user: `TEMPORAL SCENE GRAPH\n${text}\n\nQUESTION: ${q}`,
  }), [text, q]);
  async function askAi() {
    setAiBusy(true); setAiErr(null);
    try { const r = await askDeepSeek(prompt.system, prompt.user, 1500, ownKey); setAi({ q, r }); setNeedKey(false); }
    catch (e) { if (e instanceof NoKeyError) { setNeedKey(true); setAiErr('This site has no DeepSeek key of its own. Paste your key below (it stays in your browser) and press Ask again.'); } else setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  }

  const viewport = (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 2, background: '#d9d9de' }}>
      <div style={{ position: 'relative' }}>
        <Viewport id="mv-3d" bgOverride="#ffffff" label={cur ? `Frame ${frame + 1} of ${N_FRAMES} · t ${(frame * DT).toFixed(1)} s` : progress ?? 'Scanning…'} labelPos="tl" labelTop={12} home={[-6, -34, 22]} target={[-6, 0, 0]} gridSize={5}>
          {cur && <CloudLayer cloud={cur.points} mode="cluster" colorOpts={{ clusterLabels: cur.labels }} size={Math.max(2, s.view.pointSize)} budget={200000} pickable={false} />}
          <PolyLine pts={Array.from({ length: N_FRAMES }, (_, k) => [EGO(k * DT).x, EGO(k * DT).y, 0.05] as [number, number, number])} color="#0a84ff" width={2} dashed />
          <SensorMarker x={ego.x} y={ego.y} z={ego.z} yaw={0} sensor={sensor} color="#0a84ff" showFov={false} scale={2} />
          {shown.map((t) => {
            const o = t.obs.find((q2) => q2.frame === frame);
            return (
              <group key={t.id}>
                {trails && t.moving && <PolyLine pts={t.obs.filter((q2) => q2.frame <= frame).map((q2) => [q2.seg.centre[0], q2.seg.centre[1], 0.1] as [number, number, number])} color={CLS_COLOR[t.cls]} width={3} />}
                {o && <BoxOutline bbox={{ min: o.seg.min, max: o.seg.max }} color={CLS_COLOR[t.cls]} dashed={!t.moving} />}
                {o && <TextSprite text={`${trackName(t)}${t.moving ? ` · ${t.speed.toFixed(1)} m/s` : ''}`} position={[o.seg.centre[0], o.seg.centre[1], o.seg.max[2] + 0.5]} height={0.02} bg={CLS_COLOR[t.cls]} />}
              </group>
            );
          })}
        </Viewport>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '1fr 0.8fr', gap: 2, minHeight: 0 }}>
        <Timeline tracks={shown} frame={frame} onFrame={setFrame} />
        <div style={{ background: '#fff', overflow: 'auto', padding: '8px 12px' }} data-testid="events">
          <b style={{ fontSize: '0.875rem' }}>Events between frames</b>
          {graph?.events.length ? graph.events.map((e, i) => (
            <button key={i} onClick={() => setFrame(e.frame)} style={{ display: 'flex', gap: 8, width: '100%', textAlign: 'left', border: 0, background: e.frame === frame ? '#e8f1ff' : 'transparent', padding: '3px 4px', borderRadius: 6, cursor: 'pointer', fontSize: '0.8125rem' }}>
              <span className="mono" style={{ color: '#6e6e73', minWidth: 74, whiteSpace: 'nowrap' }}>f{e.frame} · {(e.frame * DT).toFixed(1)}s</span><span>{e.text}</span>
            </button>
          )) : <p className="hint">{clouds ? 'No events found.' : 'Scanning…'}</p>}
        </div>
      </div>
    </div>
  );

  const controls = (
    <>
      <Callout kind="edu" title="A moving scene, as a graph over time">
        A <b>scene graph</b> describes one moment: objects and how they relate. A <b>temporal scene graph</b> adds time: the same object is followed from scan to scan (a <b>track</b>), so you can say what moves, how fast, who approaches, who crosses. It is a compact, exact summary that a language model can read.
      </Callout>
      <Section title="1 · Drive and scan">
        <p className="hint">A vehicle with a roof LiDAR (64 channels) drives along a street. Every {DT} s it takes one scan: a <b>point cloud series</b> of {N_FRAMES} frames. Two pedestrians walk, one stands, one car is slower, one oncoming.</p>
        <Btn variant="primary" icon={<Play size={16} />} onClick={drive} busy={!!progress} testId="drive">{progress ?? 'Drive again'}</Btn>
      </Section>
      <Section title="2 · Fast segmentation, frame by frame">
        <p className="hint">Each frame: take out the ground (a plane), thin the points, group the rest into clusters, name each cluster from its size. Nothing is learned; a trained 3D segmentation network would do this better and just as fast.</p>
        <Slider label="Cluster distance" value={radius} min={0.3} max={1.2} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={setRadius} />
        <Slider label="Look this far around the vehicle" value={range} min={10} max={40} step={1} unit=" m" onChange={setRange} />
        {segs && <table className="table" data-testid="seg-stats"><tbody><tr><td>Time per frame</td><td className="mono">{avgMs.toFixed(0)} ms</td></tr><tr><td>Points per frame</td><td className="mono">{Math.round((clouds?.[0].count ?? 0) / 1000)}k → {Math.round(segs[0].kept / 1000)}k kept</td></tr><tr><td>Objects in this frame</td><td className="mono">{cur?.segs.length ?? 0}</td></tr></tbody></table>}
      </Section>
      <Section title="3 · Follow them through time">
        <div className="btn-row">
          <Btn sm icon={playing ? <Pause size={15} /> : <Play size={15} />} onClick={() => setPlaying((v) => !v)} disabled={!segs} testId="mv-play">{playing ? 'Pause' : 'Play'}</Btn>
        </div>
        <Slider label="Frame" value={frame + 1} min={1} max={N_FRAMES} step={1} format={(v) => `${v} of ${N_FRAMES}`} onChange={(v) => { setPlaying(false); setFrame(v - 1); }} />
        <div className="btn-row"><Btn sm variant={trails ? 'primary' : ''} onClick={() => setTrails(!trails)}>Paths of moving objects</Btn></div>
        <p className="hint">Boxes: <b style={{ color: '#ff9f0a' }}>people</b>, <b style={{ color: '#e5484d' }}>cars</b>, <b style={{ color: '#30a46c' }}>poles and trees</b>. Dashed = not moving. The chart on the right is the temporal graph: one row per tracked object, one circle per frame it was seen.</p>
        {graph && <span className="caption" data-testid="track-count">{shown.length} tracked objects · {shown.filter((t) => t.moving).length} moving · {graph.events.length} events</span>}
      </Section>
      <Section title="4 · Ask a language model">
        <p className="hint">The graph is written as text and sent to DeepSeek Flash (<span className="mono">{DEEPSEEK_MODEL}</span>). It reads exact numbers, not raw points, so it can answer about motion.</p>
        <div className="chip-row">{QUESTIONS.map((t) => <button key={t} className="chip" onClick={() => setQ(t)}>{t}</button>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" data-testid="mv-question" />
          <Btn variant="primary" onClick={askAi} busy={aiBusy} disabled={!segs} testId="mv-ask">Ask DeepSeek Flash</Btn>
        </div>
        <PromptView system={prompt.system} user={prompt.user} testId="mv-prompt" />
        {needKey && <label className="field"><span>Your DeepSeek key (kept only in this browser)</span><input type="password" value={ownKey} onChange={(e) => { setOwnKey(e.target.value); saveOwnKey(e.target.value); }} placeholder="sk-…" autoComplete="off" /></label>}
        {aiErr && <Callout kind="warn">{aiErr}</Callout>}
        {ai && <div className="callout good fade-in" style={{ gap: 6 }} data-testid="mv-answer"><b>DeepSeek's answer</b><Markdown text={ai.r.text} /><span className="caption">{ai.r.promptTokens.toLocaleString()} tokens read · {ai.r.completionTokens.toLocaleString()} written · {(ai.r.ms / 1000).toFixed(1)} s</span></div>}
      </Section>
    </>
  );
  return <TabFrame title="Moving Scene & Temporal Graph" tab={12} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv hideViewControls />;
}

/** The temporal graph as a chart: a row per tracked object, a circle where it was seen in a frame, lines between consecutive sightings. */
function Timeline({ tracks, frame, onFrame }: { tracks: Track[]; frame: number; onFrame: (k: number) => void }) {
  const W = 430, left = 112, rowH = 26, top = 34, colW = (W - left - 16) / (N_FRAMES - 1), H = top + Math.max(1, tracks.length) * rowH + 12;
  return (
    <div style={{ background: '#fff', overflow: 'auto', position: 'relative' }}>
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
