import { useMemo } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { SceneLayer, CloudLayer, PickLayer } from '../ui/three';
import { PointCloud } from '../core/pointcloud';
import { KDTree } from '../core/kdtree';
import { ColorOpts } from '../core/colorize';

/** Scene meshes using the current view options. */
export function SceneFromStore({ annotate = false, highlight = [] as string[], hide = [] as string[], interactive = true }: { annotate?: boolean; highlight?: string[]; hide?: string[]; interactive?: boolean }) {
  const sceneId = useLab((s) => s.sceneId);
  const v = useLab((s) => s.view);
  if (!v.showScene) return null;
  return <SceneLayer scene={getScene(sceneId)} opacity={v.sceneOpacity} showCeiling={v.showCeiling} annotate={annotate} highlight={highlight} hide={hide} interactive={interactive} />;
}

export function CloudFromStore({ cloud, colorOpts, mode, pickable = true }: { cloud: PointCloud; colorOpts?: ColorOpts; mode?: Parameters<typeof CloudLayer>[0]['mode']; pickable?: boolean }) {
  const v = useLab((s) => s.view);
  return <CloudLayer cloud={cloud} mode={mode ?? v.colorMode} size={v.pointSize} budget={v.renderBudget} colorOpts={colorOpts} clip={{ on: v.clipOn, min: v.clipMin, max: v.clipMax }} pickable={pickable} />;
}

export { PickLayer };

/** Median nearest-neighbour spacing (m) from a subsample, a good proxy for point spacing. */
export function useSpacing(c: PointCloud | undefined | null): number | null {
  return useMemo(() => {
    if (!c || c.count < 10) return null;
    const stride = Math.max(1, Math.ceil(c.count / 30000));
    const n = Math.ceil(c.count / stride);
    const sub = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) sub.set(c.positions.subarray(i * stride * 3, i * stride * 3 + 3), i * 3);
    const tree = new KDTree(sub, n);
    const d: number[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 1500))) {
      const r = tree.knn(sub[i * 3], sub[i * 3 + 1], sub[i * 3 + 2], 2);
      if (r.d2.length > 1) d.push(Math.sqrt(r.d2[1]));
    }
    d.sort((a, b) => a - b);
    return (d[d.length >> 1] ?? 0) * Math.cbrt(stride); // rescale for the thinning (approximate)
  }, [c]);
}

export const targetOf = (sceneId: Parameters<typeof getScene>[0]) => {
  const sc = getScene(sceneId);
  return sc.objects.find((o) => o.id === sc.targetObjectId) ?? null;
};

export function countInstance(c: PointCloud | undefined, instanceId: number | undefined) {
  if (!c?.instances || instanceId === undefined) return 0;
  let n = 0;
  for (let i = 0; i < c.count; i++) if (c.instances[i] === instanceId) n++;
  return n;
}

export function MiniChart({ series, height = 120, yLabel, xLabel }: { series: { name: string; color: string; values: number[] }[]; height?: number; yLabel?: string; xLabel?: string }) {
  const W = 340, H = height, pad = { l: 44, r: 8, t: 8, b: 24 };
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (!all.length) return null;
  const hi = Math.max(...all, 1e-9) * 1.08, lo = Math.min(0, ...all);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const X = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r), Y = (v: number) => H - pad.b - ((v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={yLabel ?? 'chart'} style={{ background: 'var(--fill)', borderRadius: 12 }}>
        {[0, 0.5, 1].map((f) => { const v = lo + (hi - lo) * f; return <g key={f}><line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--sep)" /><text x={pad.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--text2)">{v < 1 ? v.toFixed(3) : v.toFixed(1)}</text></g>; })}
        {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />)}
        {xLabel && <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="var(--text2)">{xLabel}</text>}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>{series.map((s) => <span key={s.name} className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 12, height: 3, background: s.color, display: 'inline-block', borderRadius: 2 }} />{s.name}</span>)}{yLabel && <span className="caption">· {yLabel}</span>}</div>
    </div>
  );
}
