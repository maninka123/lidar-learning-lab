import { ReactNode, useEffect, useRef, useState } from 'react';
import { Home, ArrowDownToLine, ScanLine, PanelLeft, Eye, EyeOff, Undo2, RotateCcw, Camera, Download, Settings2, FolderOpen, PanelRightClose, PanelRightOpen, Database, Upload, ChevronDown, Check, Circle } from './icons';
import { useLab, doUndo, exportSettings, importSettings, Background } from '../state/store';
import { viewBus } from './viewBus';
import { Btn, Seg, Select, Slider, Toggle, Section, Stat, Badge, cloudBadge, fmtN } from './controls';
import { COLOR_MODE_LABEL, availableModes, ColorMode } from '../core/colorize';
import { SCENE_IDS, getScene, SceneId } from '../scenes';
import { activeCloud, exampleCloud, exportCloudFile, takeScreenshot, uploadCloud } from '../state/actions';
import { downloadBlob } from '../io/load';
import { attributesOf, PointCloud } from '../core/pointcloud';
import { CHALLENGES } from '../exercises/defs';

// ------------------------------------------------------------------ top bar
function Popover({ label, icon, children, align = 'left', testId }: { label: ReactNode; icon?: ReactNode; children: ReactNode; align?: 'left' | 'right'; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open} data-testid={testId}>{icon}{label}<ChevronDown size={14} /></button>
      {open && (
        <div className="glass-strong fade-in" style={{ position: 'absolute', top: 'calc(100% + 8px)', [align]: 0, minWidth: 300, padding: '0.9rem', borderRadius: 16, zIndex: 40, display: 'grid', gap: '0.7rem' }} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

function EnvironmentMenu() {
  const s = useLab();
  const sc = getScene(s.sceneId);
  const SHORT: Record<string, string> = { A: 'Room', B: 'Workshop', C: 'Street' };
  return (
    <Popover label={`Environment · ${SHORT[s.sceneId]}`} icon={<Database size={16} />} testId="environment-menu">
      <div style={{ minWidth: 260, display: 'grid', gap: 8 }}>
        <div className="seg block" role="group" aria-label="Environment">
          {SCENE_IDS.map((id) => <button key={id} aria-pressed={s.sceneId === id} onClick={() => s.setScene(id as SceneId)} data-testid={`env-${id}`}>{SHORT[id]}</button>)}
        </div>
        <p className="hint">{sc.name.split('·')[1]?.trim()} — {sc.description}</p>
      </div>
    </Popover>
  );
}

export function DatasetInfo({ cloud }: { cloud: PointCloud }) {
  const m = cloud.meta;
  return (
    <div className="callout" data-testid="dataset-info">
      <b>{cloud.name}</b>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Badge kind={cloudBadge(m.kind)} /> <span className="caption">{fmtN(cloud.count)} points</span></div>
      <table className="table"><tbody>
        <tr><td>Source</td><td>{m.source}</td></tr>
        <tr><td>Licence</td><td>{m.license ?? (m.kind === 'measured' ? 'User-supplied — check terms' : 'Generated here (MIT)')}</td></tr>
        <tr><td>Units / frame</td><td>{m.units}; {m.coordinateFrame ?? 'as in file (assumed Z-up)'}</td></tr>
        <tr><td>Attributes</td><td>{attributesOf(cloud).join(', ')}</td></tr>
        <tr><td>Origin</td><td>{m.kind === 'measured' ? 'Measured (real)' : m.kind === 'simulated' ? 'Synthetic (simulated)' : m.kind === 'reconstructed' ? 'Image-derived reconstruction' : 'Derived'}</td></tr>
        {m.labelSource && <tr><td>Labels</td><td>{m.labelSource === 'ground-truth' ? 'Ground-truth annotation' : 'Estimated'}</td></tr>}
      </tbody></table>
      {m.notes?.map((n, i) => <span key={i} className="caption">• {n}</span>)}
    </div>
  );
}

function ExportMenu() {
  const cloud = activeCloud();
  return (
    <Popover label="Export" icon={<Download size={16} />} align="right" testId="export-menu">
      {cloud ? (
        <>
          <p className="hint"><b>{cloud.name}</b> · {fmtN(cloud.count)} points · attributes kept: {attributesOf(cloud).join(', ')}</p>
          <div className="btn-row">
            <Btn onClick={() => exportCloudFile(cloud, 'ply')} testId="export-ply">PLY (binary)</Btn>
            <Btn onClick={() => exportCloudFile(cloud, 'pcd')} testId="export-pcd">PCD (binary)</Btn>
            <Btn sm onClick={() => exportCloudFile(cloud, 'ply-ascii')}>PLY ascii</Btn>
            <Btn sm onClick={() => exportCloudFile(cloud, 'pcd-ascii')}>PCD ascii</Btn>
          </div>
        </>
      ) : <p className="hint">No point cloud yet — run a scan first.</p>}
    </Popover>
  );
}

export function TopBar({ title, minimal }: { title: string; minimal?: boolean }) {
  const s = useLab();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (confirm) { const t = setTimeout(() => setConfirm(false), 3000); return () => clearTimeout(t); } }, [confirm]);
  return (
    <header className="topbar glass">
      <h1>{title}</h1>
      {!minimal && <EnvironmentMenu />}
      <div className="spacer" />
      {!minimal && <Btn icon={<Undo2 size={16} />} onClick={doUndo} disabled={s.undoCount === 0} title="Undo last action" testId="undo">Undo</Btn>}
      {!minimal && <Btn icon={<RotateCcw size={16} />} variant={confirm ? 'danger' : ''} onClick={() => { if (confirm) { s.resetAll(); setConfirm(false); s.notify('Everything reset.', 'info'); } else setConfirm(true); }} title="Reset the whole lab" testId="reset">{confirm ? 'Confirm reset' : 'Reset'}</Btn>}
      <Btn icon={<Camera size={16} />} onClick={takeScreenshot} title="Save a screenshot of the 3D view" testId="screenshot">Screenshot</Btn>
      {!minimal && <ExportMenu />}
      <Btn icon={s.rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />} onClick={() => s.patch({ rightOpen: !s.rightOpen })} title="Toggle the controls panel" testId="toggle-panel" />
    </header>
  );
}

// ------------------------------------------------------------------ overlays
export function ViewControls({ simple, extra }: { simple?: boolean; extra?: ReactNode }) {
  const v = useLab((s) => s.view);
  const setView = useLab((s) => s.setView);
  const interaction = useLab((s) => s.interaction);
  return (
    <div className="overlay glass card" style={{ top: 12, right: 12, display: 'flex', gap: 6, padding: '0.35rem', alignItems: 'center' }} role="toolbar" aria-label="View controls">
      {extra}
      <Btn sm icon={<Home size={15} />} onClick={() => viewBus.emit('home')} testId="view-home">Home</Btn>
      {!simple && <Btn sm icon={v.showGrid ? <Eye size={15} /> : <EyeOff size={15} />} onClick={() => setView({ showGrid: !v.showGrid })} title="Toggle grid">Grid</Btn>}
      <Btn sm icon={v.showAxes ? <Eye size={15} /> : <EyeOff size={15} />} onClick={() => setView({ showAxes: !v.showAxes })} title="Toggle axes">Axes</Btn>
      {interaction !== 'select' && <Btn sm variant="primary" onClick={() => useLab.getState().patch({ interaction: 'select' })}>Done · {interaction.replace('-', ' ')}</Btn>}
    </div>
  );
}

export function StatsCard({ items, title = 'Live statistics' }: { items: { k: string; v: ReactNode; s?: string }[]; title?: string }) {
  const fps = useLab((s) => s.fps);
  const [open, setOpen] = useState(true);
  return (
    <div className="overlay glass card" style={{ left: 12, bottom: 12, width: open ? 'min(24rem, calc(100% - 24px))' : 'auto' }} data-testid="stats-card">
      <button className="section-head" onClick={() => setOpen(!open)} style={{ marginBottom: open ? 8 : 0, width: '100%' }}>
        <h3>{title}</h3><span className="spacer" /><span className="caption mono">{fps} fps</span>
      </button>
      {open && <div className="stats-grid">{items.map((it) => <Stat key={it.k} k={it.k} v={it.v} s={it.s} />)}</div>}
    </div>
  );
}

export function KindLegend({ items }: { items: { color: string; label: string; style?: 'dot' | 'wire' | 'dash' }[] }) {
  return (
    <div className="overlay glass card legend" style={{ left: 12, top: 12, padding: '0.55rem 0.8rem' }} aria-label="Legend">
      {items.map((it) => (
        <span key={it.label}><i style={{ background: it.style === 'wire' ? 'transparent' : it.color, border: it.style ? `2px ${it.style === 'dash' ? 'dashed' : 'solid'} ${it.color}` : undefined, borderRadius: it.style ? 4 : 99 }} />{it.label}</span>
      ))}
    </div>
  );
}

export function Toast() {
  const t = useLab((s) => s.toast);
  const [vis, setVis] = useState<typeof t>(null);
  useEffect(() => { if (t) { setVis(t); const id = setTimeout(() => setVis(null), 4800); return () => clearTimeout(id); } }, [t]);
  const busy = useLab((s) => s.busy);
  return (
    <>
      {vis && <div key={vis.n} className="toast glass-strong" role="status" style={{ color: vis.kind === 'error' ? 'var(--red)' : vis.kind === 'warn' ? 'var(--orange)' : vis.kind === 'ok' ? 'var(--green)' : 'var(--text)' }}>{vis.msg}</div>}
      {busy && <div className="toast glass-strong" style={{ bottom: vis ? '4.8rem' : '1.4rem', display: 'flex', gap: 10, alignItems: 'center' }} role="status"><span className="spin" />{busy}</div>}
    </>
  );
}

// ------------------------------------------------------------------ shared control sections
export function DisplaySection({ cloud, extra, open = true }: { cloud?: PointCloud | null; extra?: ReactNode; open?: boolean }) {
  const v = useLab((s) => s.view);
  const setView = useLab((s) => s.setView);
  const modes = cloud ? availableModes(cloud) : (['height', 'flat'] as ColorMode[]);
  return (
    <Section title="Display" open={open}>
      <Select label="Colour by" value={v.colorMode} options={modes.map((m) => ({ value: m, label: COLOR_MODE_LABEL[m] }))} onChange={(m) => { setView({ colorMode: m }); const u = useLab.getState().usedColorModes; if (!u.includes(m)) useLab.setState({ usedColorModes: [...u, m] }); }} />
      <Slider label="Point size" value={v.pointSize} min={1} max={10} step={0.5} unit=" px" onChange={(x) => setView({ pointSize: x })} />
      <Slider label="Render budget" value={v.renderBudget} min={10000} max={400000} step={5000} format={(x) => fmtN(x)} onChange={(x) => setView({ renderBudget: x })} hint="Upper limit of points drawn. Lower it on slow machines — the app also lowers it automatically when the frame rate drops." />
      <Seg value={v.background} onChange={(b) => setView({ background: b as Background })} options={[{ value: 'dark', label: 'Dark' }, { value: 'graphite', label: 'Graphite' }, { value: 'gray', label: 'Gray' }, { value: 'light', label: 'Light' }]} label="Background" />
      <Toggle label="Show scene geometry" checked={v.showScene} onChange={(x) => setView({ showScene: x })} />
      <Slider label="Scene opacity" value={v.sceneOpacity} min={0.05} max={1} step={0.05} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => setView({ sceneOpacity: x })} />
      <Toggle label="Show ceiling" checked={v.showCeiling} onChange={(x) => setView({ showCeiling: x })} />
      {extra}
    </Section>
  );
}

export function ExercisePanel({ tab }: { tab: number }) {
  const s = useLab();
  const list = CHALLENGES.filter((c) => c.tab === tab);
  if (!list.length) return <p className="hint" style={{ paddingTop: 12 }}>No exercise on this tab.</p>;
  return (
    <div style={{ display: 'grid', gap: 14, paddingTop: 12 }}>
      {list.map((c) => {
        const r = c.check(s);
        return (
          <div key={c.id} className="callout" style={{ gap: 8 }} data-testid={`exercise-${c.id}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {r.done ? <Check size={18} color="var(--green)" /> : <Circle size={18} color="var(--text3)" />}
              <b>Challenge {c.id}</b>
              <span className="spacer" />
              <span className="caption" style={{ color: r.done ? 'var(--green)' : undefined }}>{r.done ? 'Complete' : 'In progress'}</span>
            </div>
            <h3>{c.title}</h3>
            <p>{c.goal}</p>
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 3 }}>{c.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
            <div className="callout good"><b>Automatic check</b>{r.detail}</div>
            <div className="callout edu"><b>What you should learn</b>{c.outcome}</div>
          </div>
        );
      })}
    </div>
  );
}

export function sidebarIcon(): ReactNode { return <PanelLeft size={18} />; }
export { ArrowDownToLine, ScanLine };
