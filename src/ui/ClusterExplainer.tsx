import { useEffect, useMemo, useState } from 'react';
import { makeRng } from '../core/rng';
import { Btn } from './controls';
import { Play, Pause } from './icons';

/** A tiny 2D point set (metres): three blobs and a few stray points, so the effect of the radius is easy to see. */
export function toyPoints(): [number, number][] {
  const r = makeRng(7), pts: [number, number][] = [];
  for (const [cx, cy, n] of [[0.55, 0.55, 20], [1.55, 0.7, 18], [2.35, 1.5, 16]] as const) for (let i = 0; i < n; i++) pts.push([cx + r.gauss() * 0.1, cy + r.gauss() * 0.1]);
  for (const p of [[0.2, 1.5], [1.1, 1.6], [2.9, 0.4], [1.9, 0.1], [0.9, 0.05]] as const) pts.push([p[0], p[1]]);
  return pts;
}

export interface ClusterStep { labels: number[]; cur: number; caption: string; clusters: number }
/** Replays Euclidean clustering (region growing) or DBSCAN one point at a time. labels: -2 not looked at yet, -1 noise, 0.. cluster id. */
export function clusterSteps(pts: [number, number][], eps: number, minPts: number, algo: 'euclidean' | 'dbscan'): ClusterStep[] {
  const n = pts.length, lab = new Array<number>(n).fill(-2);
  const near = (i: number) => { const o: number[] = []; for (let j = 0; j < n; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= eps) o.push(j); return o; };
  const steps: ClusterStep[] = [{ labels: [...lab], cur: -1, clusters: 0, caption: 'Every point starts without a group.' }];
  const snap = (cur: number, caption: string, clusters: number) => steps.push({ labels: [...lab], cur, caption, clusters });
  let cid = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -2) continue;
    const nb = near(s);
    if (algo === 'dbscan' && nb.length < minPts) { lab[s] = -1; snap(s, `Only ${nb.length} points within the circle, fewer than ${minPts}: noise for now (a dense cluster may still reach it).`, cid); continue; }
    const id = cid++; lab[s] = id;
    snap(s, `New cluster ${id + 1}: start at this point${algo === 'dbscan' ? ` (${nb.length} neighbours, enough to be a core point)` : ''}.`, cid);
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q], np = near(p);
      if (algo === 'dbscan' && np.length < minPts) { if (q > 0) snap(p, 'This point is on the edge: it joins the cluster but does not grow it.', cid); continue; }
      const fresh = np.filter((j) => lab[j] === -2 || (algo === 'dbscan' && lab[j] === -1));
      fresh.forEach((j) => { lab[j] = id; queue.push(j); });
      if (fresh.length || q === 0) snap(p, fresh.length ? `Everything within the circle joins cluster ${id + 1}: ${fresh.length} new point${fresh.length > 1 ? 's' : ''}. Each of them is checked next.` : 'No new points in reach.', cid);
    }
  }
  const noise = lab.filter((l) => l === -1).length;
  snap(-1, `Done: ${cid} cluster${cid === 1 ? '' : 's'}${noise ? ` and ${noise} noise point${noise > 1 ? 's' : ''}` : ''}. ${cid > 3 ? 'The radius is small, so the objects were split.' : cid < 3 ? 'The radius is large, so neighbouring objects were merged.' : 'One cluster per object.'}`, cid);
  return steps;
}

const COL = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#64d2ff', '#ffd60a', '#ac8e68'];
const W = 330, H = 190, SX = 105, OX = 18, OY = 14;

export function ClusterExplainer({ algo, eps, minPts, runKey = 0 }: { algo: 'euclidean' | 'dbscan'; eps: number; minPts: number; runKey?: number }) {
  const pts = useMemo(toyPoints, []);
  const steps = useMemo(() => clusterSteps(pts, eps, minPts, algo), [pts, eps, minPts, algo]);
  const [i, setI] = useState(0), [play, setPlay] = useState(false);
  useEffect(() => { setI(0); setPlay(false); }, [steps]);
  useEffect(() => { if (runKey > 0) { setI(0); setPlay(true); } }, [runKey]); // pressing Cluster / Segment replays the story
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => setI((k) => { if (k >= steps.length - 1) { setPlay(false); return k; } return k + 1; }), 260);
    return () => clearInterval(t);
  }, [play, steps]);
  const st = steps[Math.min(i, steps.length - 1)];
  const px = (p: [number, number]) => [OX + p[0] * SX, H - OY - p[1] * SX] as const;
  return (
    <div style={{ display: 'grid', gap: 6 }} data-testid="cluster-explainer">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Step-by-step clustering of a small 2D point set" style={{ width: '100%', background: '#fff', borderRadius: 12, border: '1px solid var(--line, #e5e5ea)' }}>
        {st.cur >= 0 && (() => { const [cx, cy] = px(pts[st.cur]); return <circle cx={cx} cy={cy} r={eps * SX} fill="rgba(10,132,255,0.10)" stroke="#0a84ff" strokeWidth={1.5} strokeDasharray="5 3" />; })()}
        {pts.map((p, k) => {
          const [x, y] = px(p), l = st.labels[k];
          const fill = l >= 0 ? COL[l % COL.length] : l === -1 ? '#8e8e93' : '#d1d1d6';
          return <circle key={k} cx={x} cy={y} r={k === st.cur ? 5.5 : 3.8} fill={fill} stroke={k === st.cur ? '#1d1d1f' : l === -1 ? '#636366' : 'none'} strokeWidth={k === st.cur ? 2 : 1} />;
        })}
      </svg>
      <p className="hint" style={{ minHeight: '2.6em', margin: 0, fontSize: '0.8125rem' }} data-testid="cluster-caption">{st.caption}</p>
      <div className="btn-row">
        <Btn sm onClick={() => { setPlay(false); setI(Math.max(0, i - 1)); }} disabled={i === 0}>Back</Btn>
        <Btn sm variant="primary" icon={play ? <Pause size={14} /> : <Play size={14} />} onClick={() => { if (i >= steps.length - 1) setI(0); setPlay(!play); }} testId="cluster-play">{play ? 'Pause' : 'Play'}</Btn>
        <Btn sm onClick={() => { setPlay(false); setI(Math.min(steps.length - 1, i + 1)); }} disabled={i >= steps.length - 1} testId="cluster-next">Next</Btn>
      </div>
      <span className="caption">Step {Math.min(i, steps.length - 1) + 1} of {steps.length} · {st.clusters} cluster{st.clusters === 1 ? '' : 's'}. Dashed circle = radius ({eps.toFixed(2)} m).</span>
    </div>
  );
}
