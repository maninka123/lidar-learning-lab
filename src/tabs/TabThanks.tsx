import { useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { ThanksCloud, Pointer } from '../feedback/ThanksCloud';
import { FeedbackDialog } from '../feedback/FeedbackDialog';
import { emptyForm, FormState } from '../feedback/model';
import '../feedback/thanks.css';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The last tab: a quiet goodbye, and an optional, anonymous feedback form. Nothing here opens by itself and nothing is required. */
export default function TabThanks() {
  const setTab = useLab((s) => s.setTab), still = useMemo(reduced, []), par = useRef<Pointer>({ x: 0, y: 0, on: false, down: false, pulse: 0 });
  const [open, setOpen] = useState(false), [sent, setSent] = useState(false), [form, setForm] = useState<FormState>(emptyForm); // the answers survive closing and reopening the form
  return (
    <div className={`thanks ${still ? 'still' : ''}`} data-testid="thanks-page" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); par.current.x = (e.clientX - r.left) / r.width - 0.5; par.current.y = (e.clientY - r.top) / r.height - 0.5; par.current.on = true; }} onPointerLeave={() => { if (!par.current.down) par.current.on = false; }} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return; par.current.down = true; par.current.pulse = (par.current.pulse ?? 0) + 1; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not every browser lets a pointer be captured */ } }} onPointerUp={() => { par.current.down = false; }} onPointerCancel={() => { par.current.down = false; }}>
      <ThanksCloud still={still} par={par} />
      <div className="thanks-hero" data-testid="thanks-hero" data-cloud-hero>
        <div className="thanks-glow" aria-hidden="true" />
        <span className="thanks-tag tl" aria-hidden="true"><i />Learning, together</span>
        <span className="thanks-tag tr" aria-hidden="true">Move · drag to turn · click to ripple</span>
      </div>
      <div className="thanks-copy" data-cloud-copy aria-hidden={open || undefined}>
        <p className="thanks-kicker">The end of the journey</p>
        <h1>Thank You for Exploring <em>LiDAR Learning Lab</em></h1>
        <p className="thanks-lead">You've explored how LiDAR captures the world, how point clouds become meaningful information, and how sensing, mapping and AI work together.</p>
        <p className="thanks-ask">We'd love to hear about your experience. Your feedback will help us improve the lab for future learners.</p>
        <div className="thanks-actions">
          {sent
            ? <div className="thanks-sent" role="status" data-testid="thanks-sent">✓ Feedback sent. Thank you!</div>
            : <button type="button" className="thanks-btn primary big" onClick={() => setOpen(true)} data-testid="thanks-feedback">Share Your Feedback</button>}
          <button type="button" className="thanks-btn big" onClick={() => setTab(0)} data-testid="thanks-again">Explore the Lab Again</button>
        </div>
      </div>
      {open && <FeedbackDialog form={form} setForm={setForm} onClose={() => setOpen(false)} onSent={() => { setSent(true); setForm(emptyForm()); }} />}
    </div>
  );
}
