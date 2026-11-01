import { useEffect, useMemo, useRef, useState } from 'react';
import { INTRO } from './config';
import { LivingCloud } from './LivingCloud';
import { canLeave, KV, rememberIntro, shouldShowIntro } from './logic';
import { useAppReady } from './ready';
import './intro.css';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export interface IntroProps { /** Called once, when the intro has finished leaving. */ onDone?: () => void }

/** The welcome screen. It sits on top of the app, which is already loading underneath: it never waits for the app and never delays it. */
export function IntroScreen({ onDone }: IntroProps) {
  const [skipped, setSkipped] = useState(false), [leaving, setLeaving] = useState(false), [gone, setGone] = useState(false);
  const ready = useAppReady(), par = useRef({ x: 0, y: 0 }), calm = useMemo(reduced, []), minMs = calm ? INTRO.reducedMinMs : INTRO.minMs;
  const t0 = useRef(performance.now()), root = useRef<HTMLDivElement>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => { document.documentElement.classList.remove('intro-pending'); document.getElementById('intro-boot')?.remove(); }, []); // the plain splash from index.html hands over to this one
  useEffect(() => {
    const tick = () => {
      const elapsed = performance.now() - t0.current;
      setWaiting(elapsed >= minMs && !ready);
      if (canLeave({ elapsedMs: elapsed, minMs, ready, skipped, maxWaitMs: INTRO.maxWaitMs })) setLeaving(true);
    };
    tick(); const id = setInterval(tick, 100); return () => clearInterval(id);
  }, [ready, skipped, minMs]);
  useEffect(() => { // finish: remove it from the page once the fade has run
    if (!leaving) return;
    const id = setTimeout(() => { setGone(true); onDone?.(); }, calm ? 250 : INTRO.leaveMs + 60); return () => clearTimeout(id);
  }, [leaving, calm, onDone]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setSkipped(true); }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, []);
  useEffect(() => { // a little parallax: the camera drifts with the pointer
    if (calm) return;
    const m = (e: PointerEvent) => { par.current.x = e.clientX / innerWidth - 0.5; par.current.y = e.clientY / innerHeight - 0.5; };
    addEventListener('pointermove', m, { passive: true }); return () => removeEventListener('pointermove', m);
  }, [calm]);
  if (gone) return null;

  return (
    <div ref={root} className={`intro ${leaving ? 'leaving' : ''} ${calm ? 'calm' : ''}`} role="dialog" aria-label={`${INTRO.title}: welcome`} data-testid="intro">
      <div className="intro-bg" />
      <div className="intro-layer"><LivingCloud calm={calm} par={par} paused={leaving} /></div>
      <div className="intro-frame" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="intro-vignette" />
      <div className="intro-copy">
        <h1 className="intro-title">{INTRO.title}</h1>
        <p className="intro-tag">{INTRO.tagline}</p>
        <p className="intro-detail">{INTRO.detail}</p>
      </div>
      <div className="intro-foot">
        <span className={`intro-wait ${waiting ? 'on' : ''}`} role="status" aria-live="polite">{waiting ? 'Getting the lab ready…' : ''}</span>
      </div>
      <button className="intro-skip" onClick={() => setSkipped(true)} data-testid="intro-skip">Skip</button>
    </div>
  );
}

/** Decides whether to show the intro at all (by default: on the first visit and then at most once every two hours). Render it before the app: the app mounts at the same moment either way. */
const store = (): KV | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
export function IntroGate() {
  const [show] = useState(() => { const yes = shouldShowIntro(INTRO.show, store(), Date.now()); if (yes && INTRO.show === 'cooldown') rememberIntro(store(), Date.now()); return yes; }); // the time is written the moment the intro is shown
  const [done, setDone] = useState(false);
  useEffect(() => { if (!show) { document.documentElement.classList.remove('intro-pending'); document.getElementById('intro-boot')?.remove(); } }, [show]);
  return show && !done ? <IntroScreen onDone={() => setDone(true)} /> : null;
}
