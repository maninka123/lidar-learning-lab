import { ReactNode, useEffect, useRef } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { Btn, Callout, Seg, Toggle } from './controls';
import { Play, Pause, RotateCcw, ChevronRight, X } from './icons';
import { GuideState, prefersReducedMotion } from '../guide/store';

export type GuideStore = UseBoundStore<StoreApi<GuideState>>;
export interface GuideStep { title: string; text: ReactNode; tech?: ReactNode }

/** Runs the animation of the current step (progress 0→1). While playing, it also moves on when a step is finished. */
export function GuideClock({ store, dur, onDone }: { store: GuideStore; dur: (s: GuideState) => number; onDone: (s: GuideState) => void }) {
  const raf = useRef(0);
  const on = store((s) => s.on);
  useEffect(() => {
    if (!on) return;
    const reduced = prefersReducedMotion();
    let last = performance.now(), held = 0;
    const loop = (now: number) => {
      const dt = Math.min(64, now - last); last = now;
      const s = store.getState(), d = reduced ? 0 : dur(s);
      if (s.hold) { held = 0; }
      else if (s.progress < 1) { held = 0; store.getState().setProgress(d <= 0 ? 1 : Math.min(1, s.progress + (dt * s.speed) / d)); }
      else if (s.playing) { held += dt * s.speed; if (held > (reduced ? 1600 : 900)) { held = 0; onDone(store.getState()); } }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [on, store]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Same teaching controls in every guided lesson: steps, previous / next, play / pause, restart, speed. */
export function GuidePanel({ store, title, steps, onNext, onPrev, canNext = true, canPrev = true, toggles, children, testId }: {
  store: GuideStore; title: string; steps: GuideStep[]; onNext?: () => void; onPrev?: () => void; canNext?: boolean; canPrev?: boolean;
  toggles?: { label: string; key: 'showLines' | 'showGt' | 'showCorrected' }[]; children?: ReactNode; testId: string;
}) {
  const s = store();
  const st = steps[s.step];
  const next = onNext ?? (() => s.goto(s.step + 1)), prev = onPrev ?? (() => s.goto(s.step - 1));
  return (
    <div data-testid={testId} className="guide" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="seg block" role="group" aria-label={`${title} steps`} style={{ flex: 1 }}>
          {steps.map((x, i) => <button key={i} aria-pressed={i === s.step} title={x.title} onClick={() => s.goto(i)} data-testid={`${testId}-step-${i + 1}`}>{i + 1}</button>)}
        </div>
        <button className="btn sm" onClick={s.close} title="Close the guide" aria-label="Close the guide" data-testid={`${testId}-close`}><X size={14} /></button>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontWeight: 650, fontSize: '1rem' }} data-testid={`${testId}-title`}>Step {s.step + 1} of {steps.length} · {st.title}</div>
        <div style={{ fontSize: '0.9375rem', lineHeight: 1.45 }}>{st.text}</div>
        {st.tech && <details><summary className="hint" style={{ cursor: 'pointer' }}>Technical detail</summary><div className="hint" style={{ marginTop: 4 }}>{st.tech}</div></details>}
      </div>
      {children}
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <Btn sm onClick={prev} disabled={!canPrev} testId={`${testId}-prev`}>Previous</Btn>
        <Btn sm variant="primary" icon={s.playing ? <Pause size={14} /> : <Play size={14} />} onClick={s.playing ? s.pause : s.play} testId={`${testId}-play`}>{s.playing ? 'Pause' : 'Play'}</Btn>
        <Btn sm icon={<ChevronRight size={14} />} onClick={next} disabled={!canNext} testId={`${testId}-next`}>Next</Btn>
        <Btn sm icon={<RotateCcw size={14} />} onClick={s.restart} testId={`${testId}-restart`}>Restart</Btn>
      </div>
      <Seg value={s.speed} onChange={s.setSpeed} label="Animation speed" options={[{ value: 0.5, label: '0.5×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }]} />
      {toggles?.map((t) => <Toggle key={t.key} label={t.label} checked={s[t.key]} onChange={(v) => s.set({ [t.key]: v })} />)}
    </div>
  );
}

/** Small line chart with the current point highlighted. */
export function ConvergenceChart({ values, current, label, unit, testId, reveal, color = '#ff9f0a', extra }: { values: number[]; current: number; label: string; unit: string; testId?: string; reveal?: boolean; color?: string; extra?: { values: number[]; color: string } }) {
  const W = 340, H = 110, pad = { l: 40, r: 10, t: 10, b: 22 };
  if (!values.length) return null;
  const c = Math.min(Math.max(current, 0), values.length - 1);
  const hi = Math.max(...values, ...(extra?.values ?? [])) * 1.08 || 1, n = Math.max(values.length, 2);
  const X = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r), Y = (v: number) => H - pad.b - (v / hi) * (H - pad.t - pad.b);
  return (
    <div data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ background: 'var(--fill)', borderRadius: 12 }}>
        <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--sep)" />
        <text x={pad.l - 6} y={Y(hi / 1.08) + 4} textAnchor="end" fontSize="11" fill="var(--text2)">{(hi / 1.08).toFixed(hi > 10 ? 0 : 1)}</text>
        <text x={pad.l - 6} y={Y(0) + 4} textAnchor="end" fontSize="11" fill="var(--text2)">0</text>
        <polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" points={values.slice(0, reveal ? c + 1 : undefined).map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
        {extra && <polyline fill="none" stroke={extra.color} strokeWidth="2.2" strokeLinejoin="round" points={extra.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />}
        <line x1={X(c)} x2={X(c)} y1={pad.t} y2={Y(0)} stroke="#0a84ff" strokeDasharray="3 3" />
        <circle cx={X(c)} cy={Y(values[c])} r="5" fill="#0a84ff" stroke="#fff" strokeWidth="2" />
        <text x={W / 2} y={H - 5} textAnchor="middle" fontSize="11" fill="var(--text2)">{label}</text>
      </svg>
      <div className="caption mono" data-testid={testId ? `${testId}-now` : undefined}>now: {values[c].toFixed(2)} {unit}</div>
    </div>
  );
}

export const GuideNote = ({ kind = 'edu', title, children }: { kind?: 'edu' | 'warn' | 'good' | 'bad'; title?: string; children: ReactNode }) => <Callout kind={kind} title={title}>{children}</Callout>;
