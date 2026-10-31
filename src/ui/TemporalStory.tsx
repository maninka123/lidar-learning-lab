import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Btn } from './controls';
import { Pause, Play } from './icons';
import { DT, EGO, N_FRAMES, Track, trackName } from '../apps/moving';

const STEPS = [
  { title: 'A scene graph for every scan', text: 'Each scan becomes a graph: a circle for every object, a line between objects that are close to each other.' },
  { title: 'The next scan', text: `0.8 s later the LiDAR scans again and makes another scene graph. The objects have moved a little.` },
  { title: 'Link the same object', text: 'For each object, look for the same kind of object near where it should be now. A link means: this is the same object.' },
  { title: 'What the links tell us', text: 'A link gives speed (distance ÷ 0.8 s). An object with no link is new (it just appeared) or gone.' },
  { title: 'Repeat for every scan', text: 'The links chain together. One row per object, one circle per scan it was seen in: the temporal scene graph.' },
];
const W = 520, H = 440, COLW = 240, XA = 8, XB = 272, SC = 9.4;

/** The story of how scans become a temporal scene graph, one picture at a time: two frames, their graphs, the links between them, then all frames stacked. */
export function TemporalStory({ tracks, k, colors, timeline }: { tracks: Track[]; k: number; colors: Record<string, string>; timeline: ReactNode }) {
  const [phase, setPhase] = useState(0), [play, setPlay] = useState(false);
  const f = Math.min(Math.max(0, k), N_FRAMES - 2);
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => setPhase((p) => { if (p >= STEPS.length - 1) { setPlay(false); return p; } return p + 1; }), 1900);
    return () => clearInterval(t);
  }, [play]);

  const at = (fr: number) => tracks.flatMap((t) => t.obs.filter((o) => o.frame === fr).map((o) => ({ t, o })));
  const A = useMemo(() => at(f), [tracks, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const B = useMemo(() => at(f + 1), [tracks, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const ego = EGO(f * DT), egoB = EGO((f + 1) * DT);
  // the same window of the street in both columns: things that do not move stay where they are, things that move shift
  const pos = (col: number, x: number, y: number) => ({ u: (col ? XB : XA) + COLW / 2 + (y + 2) * SC, v: H / 2 + 20 - (x - ego.x) * SC });
  const inside = (p: { u: number; v: number }) => p.v > 66 && p.v < H - 22 && ((p.u - XA) % (XB - XA) > 16 || p.u > XB) && p.u > XA + 14 && p.u < XB + COLW - 14 && !(p.u > XA + COLW - 14 && p.u < XB + 14);
  const links = B.flatMap((b) => { const a = A.find((q) => q.t.id === b.t.id); return a ? [{ a, b }] : []; });
  const isNew = B.filter((b) => !A.some((q) => q.t.id === b.t.id)), isGone = A.filter((a) => !B.some((q) => q.t.id === a.t.id));
  const near = (list: typeof A) => list.flatMap((p, i) => list.slice(i + 1).filter((q) => Math.hypot(p.o.seg.centre[0] - q.o.seg.centre[0], p.o.seg.centre[1] - q.o.seg.centre[1]) < 4.5).map((q) => [p, q] as const));

  const Graph = ({ list, col, label, ghost }: { list: typeof A; col: number; label: string; ghost?: boolean }) => {
    const e = col ? egoB : ego, ep = pos(col, e.x, e.y);
    return (
      <g opacity={ghost ? 0.55 : 1}>
        <rect x={col ? XB : XA} y={34} width={COLW} height={H - 44} rx={12} fill="#f7f7fa" stroke="#e1e1e6" />
        <text x={(col ? XB : XA) + 12} y={54} fontSize={12.5} fontWeight={700} fill="#1d1d1f">{label}</text>
        {near(list).map(([p, q], i) => { const a = pos(col, p.o.seg.centre[0], p.o.seg.centre[1]), b = pos(col, q.o.seg.centre[0], q.o.seg.centre[1]); return inside(a) && inside(b) ? <line key={i} x1={a.u} y1={a.v} x2={b.u} y2={b.v} stroke="#c7c7cc" strokeWidth={1.4} /> : null; })}
        <path d={`M${ep.u},${ep.v - 9} L${ep.u + 7},${ep.v + 6} L${ep.u - 7},${ep.v + 6} Z`} fill="#0a84ff" opacity={0.9} />
        <text x={ep.u + 11} y={ep.v + 4} fontSize={10.5} fill="#0a84ff">our vehicle</text>
        {list.map(({ t, o }) => { const p = pos(col, o.seg.centre[0], o.seg.centre[1]); if (!inside(p)) return null; return (
          <g key={t.id}><circle cx={p.u} cy={p.v} r={8} fill={colors[t.cls]} stroke="#fff" strokeWidth={2} /><text x={p.u} y={p.v + 20} fontSize={11} fontWeight={600} textAnchor="middle" fill="#3a3a3c" style={{ paintOrder: 'stroke', stroke: '#f7f7fa', strokeWidth: 3 }}>{trackName(t)}</text></g>
        ); })}
      </g>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#fff', padding: '10px 12px 18px', display: 'grid', gap: 8, alignContent: 'start' }} data-testid="temporal-story">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: '0.9375rem' }}>How the temporal scene graph is made</b>
        <span className="caption">scan {f} → scan {f + 1}</span>
        <span style={{ flex: 1 }} />
        <Btn sm onClick={() => { setPlay(false); setPhase(Math.max(0, phase - 1)); }} disabled={phase === 0} testId="story-back">Back</Btn>
        <Btn sm variant="primary" icon={play ? <Pause size={14} /> : <Play size={14} />} onClick={() => { if (phase >= STEPS.length - 1) setPhase(0); setPlay(!play); }} testId="story-play">{play ? 'Pause' : 'Play'}</Btn>
        <Btn sm onClick={() => { setPlay(false); setPhase(Math.min(STEPS.length - 1, phase + 1)); }} disabled={phase >= STEPS.length - 1} testId="story-next">Next</Btn>
      </div>
      <div style={{ display: 'flex', gap: 6 }} aria-label="Steps">{STEPS.map((s, i) => <button key={i} onClick={() => { setPlay(false); setPhase(i); }} aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === phase} style={{ flex: 1, height: 6, borderRadius: 3, border: 0, cursor: 'pointer', background: i <= phase ? '#0a84ff' : '#d1d1d6' }} />)}</div>
      <div data-testid="story-caption"><b>{phase + 1}. {STEPS[phase].title}</b><div className="hint" style={{ margin: 0 }}>{STEPS[phase].text}</div></div>
      {phase < 4 ? (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Two scene graphs and the links between them" style={{ width: '100%', maxHeight: 560 }} data-testid="story-svg">
          <defs><marker id="lk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#1d1d1f" /></marker></defs>
          <Graph list={A} col={0} label={`Scan ${f}  ·  t ${(f * DT).toFixed(1)} s`} />
          {phase >= 1 && <Graph list={B} col={1} label={`Scan ${f + 1}  ·  t ${((f + 1) * DT).toFixed(1)} s`} />}
          {phase === 1 && <text x={W / 2} y={H / 2} fontSize={22} textAnchor="middle" fill="#8e8e93">→</text>}
          {phase >= 2 && links.map(({ a, b }) => {
            const p = pos(0, a.o.seg.centre[0], a.o.seg.centre[1]), q = pos(1, b.o.seg.centre[0], b.o.seg.centre[1]);
            if (!inside(p) || !inside(q)) return null;
            const d = Math.hypot(b.o.seg.centre[0] - a.o.seg.centre[0], b.o.seg.centre[1] - a.o.seg.centre[1]), sp = d / DT, moving = b.t.moving;
            return (
              <g key={a.t.id}>
                <line x1={p.u + 9} y1={p.v} x2={q.u - 11} y2={q.v} stroke={moving ? colors[a.t.cls] : '#8e8e93'} strokeWidth={moving ? 2.8 : 1.6} strokeDasharray={moving ? undefined : '5 4'} markerEnd="url(#lk)" />
                {phase >= 3 && moving && <text x={(p.u + q.u) / 2} y={(p.v + q.v) / 2 - 7} fontSize={11} fontWeight={700} textAnchor="middle" fill="#1d1d1f" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 4 }}>{sp.toFixed(1)} m/s</text>}
              </g>
            );
          })}
          {phase >= 3 && isNew.map(({ t, o }) => { const p = pos(1, o.seg.centre[0], o.seg.centre[1]); return inside(p) ? <g key={`n${t.id}`}><circle cx={p.u} cy={p.v} r={14} fill="none" stroke="#30d158" strokeWidth={2.5} /><text x={p.u + 18} y={p.v - 12} fontSize={10.5} fontWeight={700} fill="#248a3d">new</text></g> : null; })}
          {phase >= 3 && isGone.map(({ t, o }) => { const p = pos(0, o.seg.centre[0], o.seg.centre[1]); return inside(p) ? <g key={`g${t.id}`}><circle cx={p.u} cy={p.v} r={14} fill="none" stroke="#ff453a" strokeWidth={2.5} strokeDasharray="4 3" /><text x={p.u + 18} y={p.v - 12} fontSize={10.5} fontWeight={700} fill="#d70015">gone</text></g> : null; })}
        </svg>
      ) : (
        <div style={{ position: 'relative', height: Math.min(460, 90 + Math.max(1, tracks.filter((t) => t.obs.length >= 3).length) * 28), border: '1px solid #e1e1e6', borderRadius: 12, overflow: 'hidden' }}>{timeline}</div>
      )}
      {phase < 4 && <span className="caption">Top view, the street runs up the page. Thick coloured arrows = moving, grey dashed = not moving. Colours: <b style={{ color: colors.person }}>people</b>, <b style={{ color: colors.car }}>cars</b>, <b style={{ color: colors['large vehicle'] }}>large vehicles</b>, <b style={{ color: colors['pole / tree'] }}>poles and trees</b>.</span>}
    </div>
  );
}
