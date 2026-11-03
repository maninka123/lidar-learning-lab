import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { submitFeedback } from '../apps/workshop';
import { FormState, MAX_TEXT, MODULES, Rating, SCALE, TOPICS, changeText, missing, shortLabel, newSid, toPayload } from './model';

type Status = 'idle' | 'sending' | 'done' | 'error';
const ONE_TO_FIVE: Rating[] = [1, 2, 3, 4, 5];

/** A row of five numbered choices. It behaves as one radio group: Tab enters it, the arrow keys move and choose, nothing is chosen until the visitor chooses. */
function RatingRow({ name, label, value, onChange, hints, invalid, testId }: { name: string; label: string; value: Rating | null; onChange: (v: Rating) => void; hints: readonly string[]; invalid?: boolean; testId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => { const v = ONE_TO_FIVE[(to + 5) % 5]; onChange(v); refs.current[(to + 5) % 5]?.focus(); };
  return (
    <div role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} className={`fb-rating ${invalid ? 'bad' : ''}`} data-testid={testId}>
      {ONE_TO_FIVE.map((v, i) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} aria-label={`${v}: ${hints[i]}`} title={hints[i]} tabIndex={value === v || (value === null && i === 0) ? 0 : -1} ref={(el) => { refs.current[i] = el; }}
          className={value === v ? 'on' : ''} data-testid={`${testId}-${v}`} onClick={() => onChange(v)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); } else if (e.key === 'Home') { e.preventDefault(); move(0); } else if (e.key === 'End') { e.preventDefault(); move(4); } }}>
          {v}
        </button>
      ))}
      <span className="fb-rating-name" aria-hidden="true">{name}</span>
    </div>
  );
}

export function FeedbackDialog({ form, setForm, onClose, onSent }: { form: FormState; setForm: (f: FormState) => void; onClose: () => void; onSent: () => void }) {
  const [status, setStatus] = useState<Status>('idle'), [message, setMessage] = useState(''), [tried, setTried] = useState(false);
  const sid = useRef(newSid()), inflight = useRef(false), box = useRef<HTMLDivElement>(null), opener = useRef<Element | null>(document.activeElement), uid = useId();
  const gaps = missing(form), bad = (k: string) => tried && gaps.includes(k);
  const sending = status === 'sending', answered = 8 - gaps.length;

  useEffect(() => { // the dialog takes focus when it opens and hands it back when it closes
    const o = opener.current as HTMLElement | null; (box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current)?.focus();
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; o?.focus?.(); };
  }, []);

  const set = (patch: Partial<FormState>) => { setForm({ ...form, ...patch }); if (status === 'error') setStatus('idle'); };
  const rate = (field: 'before' | 'after', i: number, v: Rating) => set({ [field]: form[field].map((x, k) => (k === i ? v : x)) } as Partial<FormState>);

  async function send() {
    if (inflight.current) return; // a second click while the first is on its way does nothing
    setTried(true); const payload = toPayload(form, sid.current);
    if (!payload) { setStatus('idle'); setMessage(''); focusQuestion(missing(form)[0]); return; }
    inflight.current = true; setStatus('sending'); setMessage('');
    const r = await submitFeedback(payload); inflight.current = false;
    if (r.ok) { setStatus('done'); onSent(); } else { setStatus('error'); setMessage(r.message); }
  }

  const focusQuestion = (k: string) => box.current?.querySelector<HTMLElement>(`[data-q="${k}"] [role=radio], [data-q="${k}"] select`)?.focus();
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !sending) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, [tabindex="0"]')].filter((el) => el.offsetParent !== null && el.tabIndex >= 0);
    if (!f.length) return; const first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); } else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="fb-backdrop" data-testid="feedback-backdrop">
      <div ref={box} tabIndex={-1} className="fb-dialog" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} onKeyDown={trap} data-testid="feedback-dialog">
        {status === 'done' ? (
          <div className="fb-done" data-testid="feedback-success" role="status">
            <svg viewBox="0 0 52 52" width="72" height="72" aria-hidden="true"><circle cx="26" cy="26" r="23" className="fb-ring" /><path d="M15 27l8 8 14-16" className="fb-tick" /></svg>
            <h2 id={`${uid}-t`}>Thank you for your feedback!</h2>
            <p>Your response has been recorded and will help us improve LiDAR Learning Lab.</p>
            <button type="button" className="thanks-btn primary" onClick={onClose} data-autofocus data-testid="feedback-back">Back to the Thank You page</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
            <header className="fb-head">
              <div><h2 id={`${uid}-t`}>Share your feedback</h2><p>Six short questions. It takes about a minute.</p></div>
              <button type="button" className="fb-x" onClick={onClose} disabled={sending} aria-label="Close the feedback form" data-testid="feedback-close">✕</button>
            </header>
            <div className="fb-progress" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={8} aria-valuenow={answered} aria-valuetext={`${answered} of 8 answered`} data-testid="fb-progress"><i style={{ width: `${(answered / 8) * 100}%` }} /><span>{answered === 8 ? 'All answered' : `${answered} of 8 answered`}</span></div>

            <section aria-labelledby={`${uid}-a`} className="fb-card">
              <h3 id={`${uid}-a`}>How has your understanding changed?</h3>
              <p className="fb-help">Thinking back to before you used the lab, rate your understanding before and after the experience.</p>
              <div className="fb-scale" aria-hidden="true">{SCALE.map((s, i) => <span key={s}><b>{i + 1}</b> {s}</span>)}</div>
              <div className="fb-cols" aria-hidden="true"><span /><span>Before using the lab</span><span>After using the lab</span></div>
              {TOPICS.map((t, i) => (
                <div key={t.key} className="fb-topic" data-testid={`fb-topic-${i + 1}`}>
                  <div className="fb-q"><b>{i + 1}.</b> {t.label}</div>
                  <div className="fb-pair">
                    <div data-q={`before-${i}`}><span className="fb-mobile-label">Before</span><RatingRow testId={`fb-before-${i + 1}`} name="Before" label={`Before using the lab: ${t.label}`} value={form.before[i]} onChange={(v) => rate('before', i, v)} hints={SCALE} invalid={bad(`before-${i}`)} />
                      <small className="fb-picked">{form.before[i] ? `${form.before[i]} · ${SCALE[form.before[i]! - 1]}` : bad(`before-${i}`) ? 'Choose a rating' : ''}</small></div>
                    <div data-q={`after-${i}`}><span className="fb-mobile-label">After</span><RatingRow testId={`fb-after-${i + 1}`} name="After" label={`After using the lab: ${t.label}`} value={form.after[i]} onChange={(v) => rate('after', i, v)} hints={SCALE} invalid={bad(`after-${i}`)} />
                      <small className="fb-picked">{form.after[i] ? `${form.after[i]} · ${SCALE[form.after[i]! - 1]}` : bad(`after-${i}`) ? 'Choose a rating' : ''}</small></div>
                  </div>
                  {form.before[i] && form.after[i] ? <div className={`fb-delta ${form.after[i]! > form.before[i]! ? 'up' : form.after[i]! < form.before[i]! ? 'down' : 'same'}`} data-testid={`fb-delta-${i + 1}`}>Change: {changeText(form.before[i], form.after[i])}</div> : null}
                </div>
              ))}
            </section>

            <section data-q="helpful" aria-labelledby={`${uid}-h`} className="fb-card">
              <h3 id={`${uid}-h`}>4. How helpful were the interactive simulations in understanding LiDAR concepts?</h3>
              <RatingRow testId="fb-helpful" name="" label="How helpful the simulations were" value={form.helpful} onChange={(v) => set({ helpful: v })} hints={['Not helpful', '2', '3', '4', 'Extremely helpful']} invalid={bad('helpful')} />
              <div className="fb-ends"><span>1 = Not helpful</span><span>5 = Extremely helpful</span></div>
              {bad('helpful') && <small className="fb-err">Choose a rating</small>}
            </section>

            <section data-q="module" className="fb-card">
              <h3><label htmlFor={`${uid}-m`}>5. Which part of LiDAR Learning Lab did you find most useful?</label></h3>
              <select id={`${uid}-m`} value={form.module} onChange={(e) => set({ module: e.target.value })} aria-invalid={bad('module') || undefined} className={bad('module') ? 'bad' : ''} data-testid="fb-module">
                <option value="">Choose one…</option>
                {MODULES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              {bad('module') && <small className="fb-err">Choose one</small>}
            </section>

            <section className="fb-card">
              <h3><label htmlFor={`${uid}-s`}>6. What could we improve or add? <span className="fb-opt">optional</span></label></h3>
              <textarea id={`${uid}-s`} rows={4} maxLength={MAX_TEXT} value={form.text} onChange={(e) => set({ text: e.target.value })} placeholder="Share any suggestions, difficulties, missing topics or features you would like to see." data-testid="fb-text" />
              <div className="fb-count" aria-live="off">{form.text.length} / {MAX_TEXT}</div>
            </section>

            {tried && gaps.length > 0 && (
              <div className="fb-alert" role="alert" data-testid="feedback-missing">
                <b>{gaps.length === 1 ? 'One answer is missing' : `${gaps.length} answers are missing`}</b>
                <div className="fb-chips">{gaps.map((k) => <button type="button" key={k} className="fb-chip" onClick={() => focusQuestion(k)}>{shortLabel(k)}</button>)}</div>
              </div>
            )}
            {status === 'error' && <div className="fb-alert" role="alert" data-testid="feedback-error">{message} Your answers are kept: press Send feedback to try again.</div>}

            <footer className="fb-foot">
              <p className="fb-privacy">Your feedback is anonymous. Please avoid including personal information in your comments.</p>
              <div className="fb-actions">
                <button type="button" className="thanks-btn" onClick={onClose} disabled={sending} data-testid="feedback-cancel">Cancel</button>
                <button type="submit" className="thanks-btn primary" disabled={sending} aria-busy={sending} data-testid="feedback-submit">{sending ? 'Sending…' : status === 'error' ? 'Try again' : 'Submit feedback'}</button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>, document.body);
}
