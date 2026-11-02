import { useMemo } from 'react';
import { useLab } from '../state/store';
import { CloudLayer, Marker } from '../ui/three';
import { Btn, Section } from '../ui/controls';
import { ConvergenceChart, GuideClock, GuideNote, GuidePanel, GuideStep } from '../ui/Guide';
import { Arc, Arrow, RigidGroup } from './three';
import { PolyLine } from '../ui/three';
import { useIcpGuide, nav } from './store';
import { tabIndex } from '../tabs/nav';
import { axisAngle, deltaOf, highlightPair, icpVerdict, pairResidual, pairsAt, transformAt } from './replay';
import type { IcpResult } from '../registration/icp';
import type { PointCloud } from '../core/pointcloud';
import { Rigid, Vec3, rigidApply, R2D, add, scale, sub, norm } from '../core/math';

const BLUE = '#0a84ff', ORANGE = '#ff9f0a', AMBER = '#ff375f', GREEN = '#30d158';
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const DUR = [1800, 2400, 2000, 2400, 900];

/** How far the move of the shown iteration has been carried out (0..1) for the current step and progress. */
export function moveFraction(step: number, progress: number): number { return step === 3 || step === 4 ? ease(progress) : 0; }
/** Draw the arrow / arc bigger when the real move is too small to see; the lesson says by how much. */
export const exaggeration = (len: number, extent: number) => (len < 1e-9 ? 1 : Math.min(60, Math.max(1, (0.1 * extent) / len)));
const centroid = (ps: Vec3[]): Vec3 => { const c: Vec3 = [0, 0, 0]; ps.forEach((p) => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }); return scale(c, 1 / Math.max(1, ps.length)); };

/** The move of iteration k as the lesson draws it: where the cloud's centre goes, the turn, and how much bigger than real the arrow and arc are drawn. */
export function estimatedMove(h: IcpResult['history'], k: number, extent: number) {
  const d = deltaOf(h, k), c0 = centroid((h[k].sample ?? []).map((p) => p.p)), moved = sub(rigidApply(d, c0), c0), len = Math.hypot(...moved), aa = axisAngle(d.R);
  return { d, c0, moved, len, aa, ex: exaggeration(len, extent), exR: aa.angle < 1e-9 ? 1 : Math.min(60, Math.max(1, 0.3 / aa.angle)) };
}

/** Everything the lesson draws in the 3D view: A, the moving B, the real correspondences, the estimated move. */
export function IcpGuideScene({ A, B, result, size, extent, ps }: { A: PointCloud; B: PointCloud; result: IcpResult; size: number; extent: number; ps: number }) {
  const step = useIcpGuide((s) => s.step), progress = useIcpGuide((s) => s.progress), iter = useIcpGuide((s) => s.iter), showLines = useIcpGuide((s) => s.showLines);
  const h = result.history, k = Math.min(iter, h.length - 1), a = moveFraction(step, progress);
  const T = useMemo(() => transformAt(h, k, a), [h, k, a]);
  const sample = useMemo(() => pairsAt(h, k, a), [h, k, a]);
  const hi = useMemo(() => highlightPair(h[k].sample ?? []), [h, k]);
  const growing = step === 1 ? Math.ceil(progress * sample.length) : sample.length;
  const lines = useMemo(() => sample.slice(0, growing).map((p) => [p.p, p.q] as [Vec3, Vec3]), [sample, growing]);
  const { c0, moved, len, ex, aa, exR } = useMemo(() => estimatedMove(h, k, extent), [h, k, extent]);
  const pair = hi >= 0 ? sample[hi] : null, showEst = step === 2;
  return (
    <>
      <CloudLayer cloud={A} mode="rgb" size={Math.max(1.5, ps - 1)} budget={120000} pickable={false} />
      <RigidGroup T={T}><CloudLayer cloud={B} mode="rgb" size={Math.max(1.5, ps - 1)} budget={120000} pickable={false} /></RigidGroup>
      {showLines && step >= 1 && lines.map((l, i) => <PolyLine key={i} pts={l} color="#3a3a3c" width={1.6} />)}
      {showLines && step >= 1 && pair && (
        <>
          <PolyLine pts={[pair.p, pair.q]} color={AMBER} width={5} />
          <Marker p={pair.p} color={ORANGE} r={extent * 0.008} /><Marker p={pair.q} color={BLUE} r={extent * 0.008} />
          {pair.n && <Arrow from={pair.q} to={add(pair.q, scale(pair.n, extent * 0.06))} color={GREEN} width={3} />}
        </>
      )}
      {showEst && len > 1e-9 && <Arrow from={c0} to={add(c0, scale(moved, ex * Math.min(1, progress * 1.5)))} color={GREEN} width={4} />}
      {showEst && aa.angle > 1e-9 && <Arc centre={c0} axis={norm(aa.axis)} angle={aa.angle * exR * Math.min(1, progress * 1.5)} radius={extent * 0.12} color={AMBER} />}
    </>
  );
}

/** The transform box in the corner of the view, with the shift and the turn picked out while the guide is open. */
export function IcpMatrixBox({ auto, T, result }: { auto: boolean; T: Rigid | null; result: IcpResult | null }) {
  const on = useIcpGuide((s) => s.on), step = useIcpGuide((s) => s.step), progress = useIcpGuide((s) => s.progress), iter = useIcpGuide((s) => s.iter);
  let shown = T, title = auto ? 'Transform found by ICP' : 'Transform you applied to B';
  if (on && result) {
    const k = Math.min(iter, result.history.length - 1);
    if (step === 2) { shown = deltaOf(result.history, k); title = `This round's move (iteration ${k + 1})`; }
    else { shown = transformAt(result.history, k, moveFraction(step, progress)); title = `B's transform after iteration ${k + (moveFraction(step, progress) >= 1 ? 2 : 1) - 1}`; }
  }
  const m = shown ? [[shown.R[0], shown.R[1], shown.R[2], shown.t[0]], [shown.R[3], shown.R[4], shown.R[5], shown.t[1]], [shown.R[6], shown.R[7], shown.R[8], shown.t[2]], [0, 0, 0, 1]] : null;
  const tint = (i: number) => (!on ? undefined : i % 4 === 3 && i < 12 ? 'rgba(255,159,10,.28)' : i < 12 && i % 4 < 3 ? 'rgba(10,132,255,.16)' : undefined);
  return (
    <div data-testid="transform-matrix" style={{ position: 'absolute', right: 14, bottom: 14, background: 'rgba(255,255,255,.92)', border: '1px solid var(--line, #d2d2d7)', borderRadius: 12, padding: '8px 12px', pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,.08)' }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {m ? (
        <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 3.6rem)', gap: '2px 6px', fontSize: '0.8125rem', textAlign: 'right' }}>
          {m.flat().map((v, i) => <span key={i} style={{ opacity: i >= 12 ? 0.5 : 1, background: tint(i), borderRadius: 4, padding: '0 2px' }}>{(Math.abs(v) < 5e-4 ? 0 : v).toFixed(3)}</span>)}
        </div>
      ) : <span className="hint">Run ICP to see it.</span>}
      {on && step === 2 && <div className="caption" style={{ marginTop: 4 }}><b style={{ color: '#b36b00' }}>Shift</b> = right column · <b style={{ color: BLUE }}>Turn</b> = 3×3 block</div>}
    </div>
  );
}

const cm = (m: number) => `${(m * 100).toFixed(m < 0.1 ? 2 : 1)} cm`;

export function IcpGuidePanel({ extent, result, method, busy, onRun, onPreset, verdict, openSlam }: {
  extent: number; result: IcpResult | null; method: 'point' | 'plane'; busy: boolean; onRun: () => void;
  onPreset: (k: 'bad' | 'overlap' | 'wide') => void; verdict: { errT: number; errDeg: number } | null; openSlam: () => void;
}) {
  const s = useIcpGuide();
  const h = result?.history ?? [], last = Math.max(0, h.length - 1), k = Math.min(s.iter, last);
  const plane = method === 'plane';
  const steps: GuideStep[] = [
    { title: 'Why registration?', text: <>Two scans of the same room, taken from <b>different positions</b>. They do not line up. <b style={{ color: BLUE }}>A</b> is the reference. <b style={{ color: ORANGE }}>B</b> has to move onto it.</>, tech: 'Registration finds the rigid transform (a rotation R and a shift t) that maps B into the frame of A.' },
    { title: 'Find matching points', text: <>For some B points, ICP looks for the <b>closest A point</b>. Each grey line is one guess. The <b style={{ color: AMBER }}>red</b> line is one example. The closest point is a guess, not always the same physical spot.</>, tech: <>Nearest neighbour by k-d tree, closer than the match distance. Showing {h[k]?.sample?.length ?? 0} of {h[k]?.pairs ?? 0} pairs the solver used.</> },
    { title: 'Estimate the move', text: <>From all pairs together ICP finds the one <b>shift and turn</b> that shrinks the gaps most. {plane ? 'Point-to-plane counts only the gap across the surface.' : 'Point-to-point counts the full distance of each pair.'}</>, tech: plane ? <>Minimises Σ((R p + t − q)·n)² for small rotations (a linear 6×6 solve), n = surface normal of A at q. The <span style={{ color: GREEN }}>green</span> tick is n.</> : <>Minimises Σ‖R p + t − q‖² in closed form (centroids + SVD, Kabsch).</> },
    { title: 'Move B', text: <>B is moved by that estimate. The matrix and the gap (RMSE) update to the new values.</>, tech: 'The new transform is the estimated move composed with the old one: T′ = Δ · T.' },
    { title: 'Repeat', text: <>With B in its new place the matches change. ICP repeats: match, estimate, move. The curve shows the gap shrinking. It stops when the gap stops improving. That does <b>not</b> prove the answer is right.</>, tech: 'Stops when the RMSE improves by less than the tolerance (after tightening the match distance) or at the iteration limit.' },
  ];
  const mv = result ? estimatedMove(h, k, extent) : null, d = mv?.d ?? null, aa = mv?.aa ?? null, sample = result ? h[k].sample ?? [] : [], hi = highlightPair(sample), pair = hi >= 0 ? sample[hi] : null;
  const moveLen = d ? Math.hypot(...d.t) : 0;
  const next = () => { if (s.step === 3) { useIcpGuide.setState({ step: 4, iter: Math.min(1, last), progress: 0 }); } else if (s.step === 4) { if (s.iter < last) s.setIter(s.iter + 1); } else s.goto(s.step + 1); };
  const prev = () => { if (s.step === 4 && s.iter > 1) s.setIter(s.iter - 1, 1); else if (s.step === 4) useIcpGuide.setState({ step: 3, iter: 0, progress: 1 }); else s.goto(s.step - 1); };
  const v = verdict && result ? icpVerdict(result.converged, verdict.errT, verdict.errDeg) : null;
  return (
    <>
      {!result ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <GuideNote title="Run ICP once first">The lesson replays the real iterations of the solver. Press the button to compute them.</GuideNote>
          <Btn variant="primary" onClick={onRun} busy={busy} testId="guide-run-icp">Run ICP for the lesson</Btn>
          <Btn sm onClick={s.close}>Close the lesson</Btn>
        </div>
      ) : (
        <>
          <GuidePanel store={useIcpGuide} testId="icp-guide" title="How ICP works" steps={steps} onNext={next} onPrev={prev} canNext={!(s.step === 4 && s.iter >= last)}
            toggles={[{ label: 'Show correspondences', key: 'showLines' }]}>
            <div className="mono caption" data-testid="icp-guide-iter">Iteration {k + 1} / {h.length} · {h[k].pairs.toLocaleString()} pairs · gap {cm(h[k].rmse)}</div>
            {s.step === 1 && pair && <div className="caption" data-testid="icp-guide-pair">Red pair: {cm(pair.d)} apart{pair.n ? ` · across the surface: ${cm(pairResidual(pair))}` : ''}. {plane ? 'Point-to-plane keeps only the across-the-surface part.' : ''}</div>}
            {s.step === 2 && d && aa && (
              <div className="caption" data-testid="icp-guide-delta">
                Move found: shift <b style={{ color: '#b36b00' }}>({d.t.map((x) => (x * 100).toFixed(1)).join(', ')}) cm</b> ({cm(moveLen)}) · turn <b style={{ color: BLUE }}>{(aa.angle * R2D).toFixed(2)}°</b>.
                {mv && (mv.ex > 1.05 || mv.exR > 1.05) ? <> The <span style={{ color: GREEN }}>arrow</span> is drawn ×{mv.ex.toFixed(0)} and the <span style={{ color: AMBER }}>arc</span> ×{mv.exR.toFixed(0)} larger than real, so you can see them.</> : null}
              </div>
            )}
            {s.step === 3 && result && <div className="caption" data-testid="icp-guide-rmse">Gap (RMSE): {cm(h[k].rmse)} → <b>{cm(h[Math.min(k + 1, last)].rmse)}</b></div>}
            {s.step === 4 && <ConvergenceChart testId="icp-guide-chart" values={h.map((x) => x.rmse * 100)} current={k} label="iteration" unit="cm gap (RMSE)" />}
            {s.step === 4 && s.iter >= last && v && (
              <GuideNote kind={v === 'wrong' ? 'warn' : 'good'} title={v === 'wrong' ? 'Settled, but in the wrong place' : v === 'good' ? 'Converged' : 'Stopped at the limit'}>
                {v === 'wrong' && verdict ? <>ICP stopped because the gap stopped shrinking, yet B is still off by {cm(verdict.errT)} and {verdict.errDeg.toFixed(1)}°. This is a <b>local solution</b>: a good fit to the wrong matches.</> : v === 'good' ? 'The gap stopped improving and B is close to its true place. A small gap alone would not tell you this on real data.' : 'Raise the iteration limit to let it finish.'}
              </GuideNote>
            )}
          </GuidePanel>
          {s.step === 4 && s.iter >= last && (
            <GuideNote kind="edu" title="Next: a moving LiDAR">
              We now know how to align two scans. But what if a LiDAR keeps moving and collects hundreds of scans? Can we simply register each scan to the previous one?
              <div style={{ marginTop: 8 }}><Btn sm variant="primary" onClick={openSlam} testId="guide-open-slam">Open SLAM &amp; Mobile Scanning</Btn></div>
            </GuideNote>
          )}
        </>
      )}
      <Section title="Break it, then run again" hint="These only set the normal controls below. Press Run ICP (or the button here) to see what happens.">
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm onClick={() => onPreset('bad')} testId="guide-bad-start">Poor start</Btn>
              <Btn sm onClick={() => onPreset('overlap')} testId="guide-low-overlap">Little overlap</Btn>
              <Btn sm onClick={() => onPreset('wide')} testId="guide-wide">Wrong matches</Btn>
              <Btn sm variant="primary" onClick={onRun} busy={busy} testId="guide-rerun">Run again</Btn>
            </div>
            <p className="hint">Poor start: B begins far away and turned. Little overlap: A and B share only a small part. Wrong matches: any pair up to 5 m counts.</p>
      </Section>
      <GuideClock store={useIcpGuide} dur={(g) => DUR[g.step] * (g.step === 4 && h.length > 25 ? 0.6 : 1)} onDone={(g) => {
        if (g.step < 3) g.goto(g.step + 1);
        else if (g.step === 3) useIcpGuide.setState({ step: 4, iter: Math.min(1, last), progress: 0 });
        else if (g.iter < last) g.setIter(g.iter + 1);
        else g.pause();
      }} />
    </>
  );
}

/** Jump to the SLAM lab inside the mapping tab. */
export function goToSlam() { nav.mappingLab = 'slam'; const i = tabIndex('SLAM & Mobile Scanning'); if (i >= 0) useLab.getState().setTab(i); }
