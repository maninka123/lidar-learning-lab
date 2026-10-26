import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Callout, Section, Seg, Select, Slider, Toggle } from '../ui/controls';
import { CloudLayer } from '../ui/three';
import { useLab } from '../state/store';
import { useClassroom } from '../apps/useClassroom';
import { makeSeries, cloudToCloud, detectChanges, ChangeResult } from '../apps/change';
import { PointCloud } from '../core/pointcloud';
import { turbo } from '../core/colorize';
import { Credit } from '../ui/VideoCard';

type View = 'heat' | 'kind' | 'from' | 'to';
const QUIET: [number, number, number] = [205, 209, 218];
const START = ['2026-03-02T09:00', '2026-03-09T09:00', '2026-03-16T14:30', '2026-03-30T09:00', '2026-04-13T09:00'];
const GRADIENT = `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => { const c = turbo(i / 8); return `rgb(${c[0]},${c[1]},${c[2]})`; }).join(',')})`;

const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
const when = (t: string) => new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const gap = (d: number) => (Math.abs(d) < 1 ? `${Math.round(Math.abs(d) * 24)} h` : `${Math.round(Math.abs(d) * 10) / 10} days`);

export default function TabChange() {
  const s = useLab();
  const { cloud: c1 } = useClassroom(0.05);
  const series = useMemo(() => (c1 ? makeSeries(c1) : null), [c1]);
  const [stamps, setStamps] = useState(START);
  const [from, setFrom] = useState(0), [to, setTo] = useState(4);
  const [thr, setThr] = useState(0.06), [minPts, setMinPts] = useState(40), [maxCm, setMaxCm] = useState(40);
  const [view, setView] = useState<View>('heat');
  const [hideCeiling, setHideCeiling] = useState(true);
  const dist = useRef(new Map<string, { dOld: Float32Array; dNew: Float32Array }>());
  const [ready, setReady] = useState(0); // bumps whenever more distances are measured
  const [busy, setBusy] = useState(false);

  const measure = (a: number, b: number) => {
    const key = `${a}-${b}`;
    if (!series) return null;
    if (!dist.current.has(key)) dist.current.set(key, { dOld: cloudToCloud(series[a].cloud, series[b].cloud), dNew: cloudToCloud(series[b].cloud, series[a].cloud) });
    return dist.current.get(key)!;
  };
  // measure the four neighbouring pairs one after another so the page never freezes
  useEffect(() => {
    if (!series) return;
    let alive = true, k = 0;
    setBusy(true);
    const next = () => {
      if (!alive) return;
      if (k >= 4) { setBusy(false); return; }
      measure(k, k + 1); k++; setReady((r) => r + 1);
      setTimeout(next, 20);
    };
    setTimeout(next, 30);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  const truthOf = (a: number, b: number) => (series ? series.slice(a + 1, b + 1).flatMap((e) => e.truth) : []);
  const pair = (a: number, b: number): ChangeResult | null => {
    if (!series) return null;
    const d = dist.current.get(`${a}-${b}`) ?? measure(a, b);
    return d ? detectChanges(series[a].cloud, series[b].cloud, thr, minPts, truthOf(a, b), d) : null;
  };
  const [lo, hi] = from < to ? [from, to] : [to, from];
  const res = useMemo(() => (series && lo !== hi ? pair(lo, hi) : null), [series, lo, hi, thr, minPts]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = useMemo(() => {
    if (!series) return [];
    return [0, 1, 2, 3].map((k) => {
      const r = dist.current.has(`${k}-${k + 1}`) ? pair(k, k + 1) : null;
      const n = series[k].cloud.count + series[k + 1].cloud.count;
      const changed = r ? r.removed.reduce((q, v) => q + v, 0) + r.added.reduce((q, v) => q + v, 0) : 0;
      return { r, pct: r ? (100 * changed) / n : 0, dt: days(stamps[k], stamps[k + 1]) };
    });
  }, [series, ready, thr, minPts, stamps]); // eslint-disable-line react-hooks/exhaustive-deps

  const layers = useMemo(() => {
    if (!series) return { base: null as PointCloud | null, extra: null as PointCloud | null };
    const A = series[lo].cloud, B = series[hi].cloud;
    if (view === 'from') return { base: A, extra: null };
    if (view === 'to') return { base: B, extra: null };
    if (!res) return { base: B, extra: null };
    const d = dist.current.get(`${lo}-${hi}`)!, max = maxCm / 100;
    const paint = (c: PointCloud, f: (i: number) => [number, number, number]) => { const col = new Uint8Array(c.count * 3); for (let i = 0; i < c.count; i++) col.set(f(i), i * 3); return { ...c, colors: col } as PointCloud; };
    const heat = (v: number): [number, number, number] => { const c = turbo(Math.min(1, v / max)); return [c[0], c[1], c[2]]; };
    // the gone points of the earlier visit, drawn on top of the later one
    const goneOnly = () => {
      const ids: number[] = []; for (let i = 0; i < A.count; i++) if (res.removed[i]) ids.push(i);
      const pos = new Float32Array(ids.length * 3), col = new Uint8Array(ids.length * 3);
      ids.forEach((j, k) => { pos.set(A.positions.subarray(j * 3, j * 3 + 3), k * 3); col.set(view === 'heat' ? heat(d.dOld[j]) : [235, 50, 50], k * 3); });
      return { ...A, count: ids.length, positions: pos, colors: col, labels: undefined, intensity: undefined, normals: undefined } as PointCloud;
    };
    if (view === 'heat') return { base: paint(B, (i) => (res.added[i] ? heat(d.dNew[i]) : QUIET)), extra: goneOnly() };
    return { base: paint(B, (i) => (res.added[i] ? [40, 190, 90] : QUIET)), extra: goneOnly() };
  }, [series, lo, hi, res, view, maxCm, ready]);

  const clip = { on: hideCeiling, min: -1, max: 2.28 };
  const viewport = (
    <Viewport home={[8, -10, 6.5]} target={[0, 0, 1.2]} gridSize={1} hideAxes bgOverride="#ffffff">
      {layers.base && <CloudLayer cloud={layers.base} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 300000)} pickable={false} clip={clip} />}
      {layers.extra && layers.extra.count > 0 && <CloudLayer cloud={layers.extra} mode="rgb" size={Math.max(3, s.view.pointSize)} budget={200000} pickable={false} clip={clip} />}
    </Viewport>
  );

  const nGone = res ? res.removed.reduce((a, v) => a + v, 0) : 0, nNew = res ? res.added.reduce((a, v) => a + v, 0) : 0;
  const stats = [
    { k: 'Changed regions', v: res ? String(res.regions.length) : '—', s: res ? `${truthOf(lo, hi).length} real edits between them` : undefined },
    { k: 'Time between', v: gap(days(stamps[lo], stamps[hi])), s: `${series?.[lo].name ?? ''} → ${series?.[hi].name ?? ''}` },
  ];
  const maxPct = Math.max(1, ...steps.map((q) => q.pct));
  const opts = (series ?? []).map((e, i) => ({ value: String(i), label: `${e.name} · ${when(stamps[i])}` }));

  const controls = (
    <>
      <Callout kind="edu" title="Change detection over time">
        The same classroom was scanned five times. For each point in one visit we find the <b>nearest point in the other visit</b>: a large distance means something was there only once. The distance becomes a <b>heatmap</b>: grey is unchanged, blue to red is how far (in cm) the surface moved or disappeared.
      </Callout>
      <Section title="1 · The five visits">
        <p className="hint">Already scanned and aligned. Set the date and time of each visit; they only change the time between visits.</p>
        <div style={{ display: 'grid', gap: 6 }}>
          {(series ?? []).map((e, i) => (
            <div key={e.name} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 2, alignItems: 'center' }}>
              <b style={{ fontSize: 13 }}>{e.name}</b>
              <input type="datetime-local" value={stamps[i]} aria-label={`${e.name} time`} data-testid={`stamp-${i}`}
                onChange={(ev) => ev.target.value && setStamps((q) => q.map((v, j) => (j === i ? ev.target.value : v)))} style={{ font: 'inherit', fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #d0d4dc' }} />
              <span />
              <span className="caption">{e.note}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="2 · How much changed between visits">
        <svg viewBox="0 0 320 120" width="100%" role="img" aria-label="Share of the room that changed between neighbouring visits" data-testid="change-chart">
          {steps.map((q, k) => {
            const h = (q.pct / maxPct) * 70, x = 14 + k * 76, on = lo === k && hi === k + 1;
            return (
              <g key={k} style={{ cursor: 'pointer' }} onClick={() => { setFrom(k); setTo(k + 1); }}>
                <rect x={x} y={86 - h} width={58} height={Math.max(2, h)} rx={5} fill={on ? '#0a84ff' : '#9db7d9'} />
                <text x={x + 29} y={80 - h} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1d1d1f">{q.r ? `${q.pct.toFixed(1)}%` : '…'}</text>
                <text x={x + 29} y={102} textAnchor="middle" fontSize="10" fill="#6e6e73">{k + 1} → {k + 2}</text>
                <text x={x + 29} y={114} textAnchor="middle" fontSize="9" fill="#8e8e93">{gap(q.dt)}</text>
              </g>
            );
          })}
        </svg>
        <p className="hint">Share of points that changed from one visit to the next. Click a bar to look at that pair.{busy ? ' Measuring…' : ''}</p>
      </Section>
      <Section title="3 · Compare two visits">
        <Select label="From" value={String(from)} options={opts} onChange={(v) => setFrom(Number(v))} />
        <Select label="To" value={String(to)} options={opts} onChange={(v) => setTo(Number(v))} />
        <Slider label="Counts as changed above" value={thr * 100} min={2} max={20} step={0.5} unit=" cm" format={(v) => v.toFixed(1)} onChange={(v) => setThr(v / 100)} hint="Scanner noise is about 1 cm, so anything under this is treated as the same surface." />
        <Slider label="Smallest change" value={minPts} min={10} max={300} step={10} unit=" points" onChange={setMinPts} />
      </Section>
      <Section title="Heatmap">
        <Seg value={view} onChange={setView} options={[{ value: 'heat', label: 'Heatmap' }, { value: 'kind', label: 'Gone / new' }]} />
        <Seg value={view} onChange={setView} options={[{ value: 'from', label: 'Earlier visit' }, { value: 'to', label: 'Later visit' }]} />
        {view === 'heat' && (
          <>
            <div style={{ height: 12, borderRadius: 6, background: GRADIENT, marginTop: 4 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6e6e73' }}><span>0 cm</span><span>{Math.round(maxCm / 2)} cm</span><span>{maxCm}+ cm</span></div>
            <Slider label="Colour scale ends at" value={maxCm} min={10} max={100} step={5} unit=" cm" onChange={setMaxCm} />
            <p className="hint">Grey = unchanged. Colours show the distance to the nearest point of the other visit, on the later visit and on whatever was taken away.</p>
          </>
        )}
        {view === 'kind' && <p className="hint"><b style={{ color: '#eb3232' }}>Red</b>: in the earlier visit, gone later. <b style={{ color: '#28be5a' }}>Green</b>: new. Grey: unchanged. A moved object is red at its old place and green at its new one.</p>}
        <Toggle label="Hide the ceiling" checked={hideCeiling} onChange={setHideCeiling} />
      </Section>
      {res && (
        <Section title="What changed">
          <table className="table"><thead><tr><td>Region</td><td>Points</td><td>Size (m)</td><td>Real edit</td></tr></thead><tbody>
            {res.regions.slice(0, 10).map((r, i) => (
              <tr key={i}><td><b style={{ color: r.kind === 'removed' ? '#eb3232' : '#28be5a' }}>{r.kind === 'removed' ? 'Gone' : 'New'}</b> · {r.label}</td><td className="mono">{r.points}</td><td className="mono">{r.size.map((v) => v.toFixed(1)).join(' × ')}</td><td>{r.matched ?? <span className="caption">none</span>}</td></tr>
            ))}
          </tbody></table>
          <p className="hint">{nGone.toLocaleString()} points gone, {nNew.toLocaleString()} new. {Math.round(res.recall * truthOf(lo, hi).length)} of {truthOf(lo, hi).length} real edits found.</p>
        </Section>
      )}
      <Section title="Tutorial"><Credit keys={['change']} title="" /></Section>
    </>
  );
  return <TabFrame title="Change Detection" tab={14} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} />;
}
