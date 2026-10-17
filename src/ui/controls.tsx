import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight } from './icons';

export function Section({ title, children, open = true, hint }: { title: string; children: ReactNode; open?: boolean; hint?: string }) {
  const [o, setO] = useState(open);
  return (
    <div className="section">
      <button className="section-head" onClick={() => setO(!o)} aria-expanded={o}>
        {o ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <h3>{title}</h3>
      </button>
      {o && (
        <div className="section-body fade-in">
          {hint && <p className="hint">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, format, hint, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; format?: (v: number) => string; hint?: string; disabled?: boolean;
}) {
  const p = ((value - min) / (max - min || 1)) * 100;
  const id = `s-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <div className="field-top">
        <label htmlFor={id}>{label}</label>
        <span className="val">{format ? format(value) : value}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={{ ['--p' as string]: `${p}%` }} onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint && <span className="caption">{hint}</span>}
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange, hint }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  const id = `sel-${(label ?? 'x').replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="caption">{hint}</span>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <label className="toggle">
        <span className="lbl">{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="sw" />
      </label>
      {hint && <span className="caption">{hint}</span>}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, block = true, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; block?: boolean; label?: string }) {
  return (
    <div className={`seg ${block ? 'block' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Btn({ children, onClick, variant = '', busy, disabled, icon, sm, block, title, testId }: {
  children?: ReactNode; onClick?: () => void; variant?: 'primary' | 'good' | 'danger' | ''; busy?: boolean; disabled?: boolean; icon?: ReactNode; sm?: boolean; block?: boolean; title?: string; testId?: string;
}) {
  return (
    <button className={`btn ${variant} ${sm ? 'sm' : ''} ${block ? 'block' : ''}`} onClick={onClick} disabled={disabled || busy} title={title} data-testid={testId} aria-label={title}>
      {busy ? <span className="spin" /> : icon}
      {children}
    </button>
  );
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}
export const StatGrid = ({ children }: { children: ReactNode }) => <div className="stats-grid">{children}</div>;

export function Callout({ kind = '', title, children }: { kind?: 'edu' | 'warn' | 'good' | 'bad' | ''; title?: string; children: ReactNode }) {
  return (
    <div className={`callout ${kind}`}>
      {title && <b>{title}</b>}
      <div>{children}</div>
    </div>
  );
}

export function Eq({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="eq">
      {children}
      {note && <small>{note}</small>}
    </div>
  );
}

export type BadgeKind = 'sim' | 'measured' | 'recon' | 'gt' | 'est' | 'mesh' | 'proc';
const BADGE_TEXT: Record<BadgeKind, string> = { sim: 'Simulated LiDAR', measured: 'Measured', recon: 'Reconstructed', gt: 'Ground truth', est: 'Estimated', mesh: 'Mesh geometry', proc: 'Processed' };
export const Badge = ({ kind, children }: { kind: BadgeKind; children?: ReactNode }) => <span className={`badge ${kind}`}>{children ?? BADGE_TEXT[kind]}</span>;

export const cloudBadge = (kind: string): BadgeKind => (kind === 'simulated' ? 'sim' : kind === 'measured' ? 'measured' : kind === 'reconstructed' ? 'recon' : kind === 'estimated' ? 'est' : 'proc');

export function NumberField({ label, value, onChange, step = 0.1, min, max, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <div className="field">
      <label>{label}{unit ? ` (${unit})` : ''}</label>
      <input type="number" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export const fmtN = (n: number) => n.toLocaleString('en-US');
export const fmtM = (n: number, d = 2) => `${n.toFixed(d)} m`;
