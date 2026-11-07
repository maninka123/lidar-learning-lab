import type { ReactNode } from 'react';
import { Btn } from '../../ui/controls';
import { SAFETY_ZONES, zoneAt } from '../factory';
import type { ChangeFound, SafetyFound } from '../pipeline';

export interface ChangeRow { kind: ChangeFound['kind']; label: string; where: string; size: string }
export type Focus = { type: 'change'; i: number } | { type: 'zone'; i: number } | null;

const KIND: Record<ChangeFound['kind'], { colour: string; word: string }> = {
  added: { colour: '#30d158', word: 'Appeared' }, removed: { colour: '#ff453a', word: 'Gone' }, moved: { colour: '#ff9f0a', word: 'Moved' },
};
export const changeColour = (k: ChangeFound['kind']) => KIND[k].colour;

const metres = (v: number) => `${v.toFixed(1)} m`;
export const describeChange = (c: ChangeFound): ChangeRow => {
  const at = c.centre, zone = zoneAt(at[0], at[1]);
  const moved = c.kind === 'moved' && c.from ? Math.hypot(c.centre[0] - c.from[0], c.centre[1] - c.from[1]) : 0;
  return { kind: c.kind, label: `${KIND[c.kind].word}${c.cls ? `: ${c.cls}` : ''}`, where: `${zone} zone, near (${at[0].toFixed(1)}, ${at[1].toFixed(1)})`, size: c.kind === 'moved' ? `by ${metres(moved)}` : `${metres(Math.max(c.size[0], c.size[1]))} wide` };
};

interface Props {
  shown: boolean; busy: boolean; changes: ChangeFound[]; safety: SafetyFound[]; focus: Focus; onFocus: (f: Focus) => void; onShow: () => void;
  best: { thr: number; min: number; tried: number } | null;
  reality?: { real: number; matched: number };
  /** a place to put the zoomed look at the colour labels, which belongs right under the lists */
  colourView?: ReactNode;
}

/** Task 6 is for looking, not for tuning: one button, then what changed and which safety zones are affected. */
export function ChangesExplorer({ shown, busy, changes, safety, focus, onFocus, onShow, best, reality, colourView }: Props) {
  const count = (k: ChangeFound['kind']) => changes.filter((c) => c.kind === k).length, affected = safety.filter((z) => z.violated).length;
  return <section className="changes-explorer" data-testid="changes-explorer" aria-label="Changes and safety">
    <p className="changes-intro">Compare Time A (commissioning) with Time B (today). Press the button: your data is compared with the best settings chosen for it. Click anything in the lists to see it in 3D.</p>
    <Btn variant="primary" block onClick={onShow} busy={busy} testId="twin-show-changes">{shown ? 'Show again' : 'Show changes and safety'}</Btn>
    {shown && <>
      <div className="changes-chips" data-testid="changes-summary">
        <span className="chip"><i style={{ background: KIND.added.colour }} />{count('added')} appeared</span>
        <span className="chip"><i style={{ background: KIND.removed.colour }} />{count('removed')} gone</span>
        <span className="chip"><i style={{ background: KIND.moved.colour }} />{count('moved')} moved</span>
        <span className={`chip ${affected ? 'warn' : ''}`}>{affected} of {safety.length} safety zones affected</span>
      </div>
      {reality && <p className="changes-note">In reality {reality.real} things changed; {reality.matched} of them were found.</p>}
      {best && <details className="changes-best" data-testid="changes-best"><summary>Best settings for your data</summary>
        <p>Change threshold <b>{best.thr.toFixed(2)} m</b> · smallest change <b>{best.min} points</b>. I tried {best.tried} combinations on your data and kept the one that matched what really changed best. A smaller threshold or smaller changes would pick up noise; larger ones would miss small moves.</p></details>}
      <h4>What changed</h4>
      {changes.length ? <ul className="changes-list" data-testid="changes-list">{changes.map((c, i) => { const r = describeChange(c), on = focus?.type === 'change' && focus.i === i;
        return <li key={i}><button type="button" className={on ? 'on' : ''} onClick={() => onFocus(on ? null : { type: 'change', i })} data-testid={`change-${i}`}><i style={{ background: KIND[c.kind].colour }} /><span><b>{r.label}</b><small>{r.where} · {r.size}</small></span></button></li>; })}</ul> : <p className="hint">No change found between Time A and Time B.</p>}
      <h4>Safety zones</h4>
      <ul className="changes-list" data-testid="zones-list">{safety.map((z, i) => { const zone = SAFETY_ZONES.find((q) => q.id === z.zone), on = focus?.type === 'zone' && focus.i === i;
        return <li key={z.zone}><button type="button" className={on ? 'on' : ''} onClick={() => onFocus(on ? null : { type: 'zone', i })} data-testid={`zone-${i}`}><i style={{ background: z.violated ? '#ff453a' : '#30d158' }} /><span><b>{zone?.name ?? z.zone}</b><small>{z.violated ? `Affected: ${z.objects.length} object${z.objects.length === 1 ? '' : 's'} inside or too close` : `Clear: nearest object ${Number.isFinite(z.clearance) && z.clearance < 90 ? metres(z.clearance) : 'far away'}`}</small></span></button></li>; })}</ul>
      <p className="hint">An educational view, not a certified safety system.</p>
      {colourView}
    </>}
  </section>;
}
