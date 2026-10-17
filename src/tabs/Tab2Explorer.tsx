import { useMemo, useState } from 'react';
import { useLab, pushUndo } from '../state/store';
import { getScene } from '../scenes';
import { className, classColor } from '../scenes/classes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Badge, Btn, Callout, Eq, Section, Select, Slider, Stat, cloudBadge, fmtN } from '../ui/controls';
import { DatasetInfo, DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, CloudFromStore, PickLayer } from './common';
import { Crosshair, Download, Play, Scissors, Trash2, Undo2, Upload } from '../ui/icons';
import { activeCloud, clearPicks, exportCloudFile, runScan, uploadCloud } from '../state/actions';
import { cloudBounds, PointCloud, attributesOf } from '../core/pointcloud';
import { cropBox } from '../processing/ops';
import { turbo, viridis, COLOR_MODE_LABEL } from '../core/colorize';
import { Vec3 } from '../core/math';

function ColorBar({ cloud, mode }: { cloud: PointCloud; mode: string }) {
  const info = useMemo(() => {
    if (mode === 'height' || mode === 'range') {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < cloud.count; i++) { const v = mode === 'height' ? cloud.positions[i * 3 + 2] : cloud.ranges?.[i] ?? 0; if (v < lo) lo = v; if (v > hi) hi = v; }
      return { fn: turbo, lo, hi, unit: 'm' };
    }
    if (mode === 'intensity') return { fn: viridis, lo: 0, hi: 1, unit: '(relative)' };
    return null;
  }, [cloud, mode]);
  if (!info) return null;
  const stops = Array.from({ length: 12 }, (_, i) => { const c = info.fn(i / 11); return `rgb(${c[0]},${c[1]},${c[2]}) ${(i / 11) * 100}%`; }).join(',');
  return (
    <div className="overlay glass card" style={{ right: 12, bottom: 12, width: 220 }}>
      <div className="caption" style={{ marginBottom: 4 }}>{COLOR_MODE_LABEL[mode as keyof typeof COLOR_MODE_LABEL]}</div>
      <div style={{ height: 10, borderRadius: 6, background: `linear-gradient(90deg,${stops})` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginTop: 4 }} className="mono"><span>{info.lo.toFixed(2)}</span><span>{info.unit}</span><span>{info.hi.toFixed(2)}</span></div>
    </div>
  );
}

export default function Tab2() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const cloud = activeCloud();
  const ids = Object.keys(s.clouds);
  const last = s.picks[s.picks.length - 1];
  const b = useMemo(() => (cloud ? cloudBounds(cloud) : null), [cloud]);
  const [crop, setCrop] = useState<{ min: Vec3; max: Vec3 } | null>(null);
  const c = crop ?? (b ? { min: b.min as Vec3, max: b.max as Vec3 } : null);

  const dists = s.picks.slice(1).map((p, i) => Math.hypot(p.pos[0] - s.picks[i].pos[0], p.pos[1] - s.picks[i].pos[1], p.pos[2] - s.picks[i].pos[2]));
  const total = dists.reduce((a, d) => a + d, 0);

  const info = (() => {
    if (!cloud || !last || last.cloudId !== cloud.id) return null;
    const i = last.index;
    return {
      pos: last.pos,
      range: cloud.ranges?.[i],
      intensity: cloud.intensity?.[i],
      rgb: cloud.colors ? [cloud.colors[i * 3], cloud.colors[i * 3 + 1], cloud.colors[i * 3 + 2]] : null,
      cls: cloud.labels ? cloud.labels[i] : null,
      normal: cloud.normals ? [cloud.normals[i * 3], cloud.normals[i * 3 + 1], cloud.normals[i * 3 + 2]] : null,
    };
  })();

  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} threshold={0.06}>
      <SceneFromStore interactive={s.interaction === 'select'} />
      {cloud && <CloudFromStore cloud={cloud} />}
      <PickLayer radius={0.045} />
    </Viewport>
  );

  const stats = [
    { k: 'Points', v: cloud ? fmtN(cloud.count) : '—', s: cloud ? attributesOf(cloud).join(' · ') : undefined },
    { k: 'Picked', v: s.picks.length, s: dists.length ? `path ${total.toFixed(3)} m` : 'click points to measure' },
    { k: 'Last distance', v: dists.length ? `${dists[dists.length - 1].toFixed(3)} m` : '—' },
    { k: 'Colour mode', v: COLOR_MODE_LABEL[s.view.colorMode] },
  ];

  const controls = (
    <>
      <Section title="Point cloud">
        {ids.length > 0 ? (
          <Select value={cloud?.id ? (ids.find((k) => s.clouds[k].id === cloud.id) ?? ids[0]) : ids[0]} options={ids.map((k) => ({ value: k, label: `${s.clouds[k].name} (${fmtN(s.clouds[k].count)})` }))} onChange={(k) => s.patch({ activeCloudId: k, picks: [] })} />
        ) : <p className="hint">No cloud yet. Generate a scan, load an example or upload a file.</p>}
        <div className="btn-row">
          <Btn variant="primary" icon={<Play size={16} />} onClick={() => runScan()} busy={!!s.busy}>Scan this scene</Btn>
          <label className="btn" style={{ cursor: 'pointer' }}><Upload size={16} />Upload
            <input type="file" accept=".ply,.pcd,.las,.laz" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadCloud(f); e.target.value = ''; }} />
          </label>
        </div>
        {cloud && <div className="btn-row">
          <Btn icon={<Download size={16} />} onClick={() => exportCloudFile(cloud, 'ply')}>PLY</Btn>
          <Btn icon={<Download size={16} />} onClick={() => exportCloudFile(cloud, 'pcd')}>PCD</Btn>
        </div>}
        {cloud && <DatasetInfo cloud={cloud} />}
      </Section>

      <DisplaySection cloud={cloud} />

      <Section title="Inspect & measure">
        <Btn icon={<Crosshair size={16} />} variant={s.interaction === 'pick-points' ? 'primary' : ''} onClick={() => s.patch({ interaction: s.interaction === 'pick-points' ? 'select' : 'pick-points' })} testId="pick-mode" block>
          {s.interaction === 'pick-points' ? 'Picking… click points in the view' : 'Pick points'}
        </Btn>
        <div className="btn-row">
          <Btn sm icon={<Undo2 size={15} />} onClick={() => { const p = s.picks.slice(0, -1); s.patch({ picks: p }); }} disabled={!s.picks.length}>Remove last</Btn>
          <Btn sm icon={<Trash2 size={15} />} onClick={clearPicks} disabled={!s.picks.length}>Clear</Btn>
        </div>
        {info ? (
          <div className="callout" data-testid="point-info">
            <b>Selected point P{s.picks.length}</b>
            <table className="table"><tbody>
              <tr><td>X, Y, Z</td><td className="mono">{info.pos.map((v) => v.toFixed(3)).join(', ')} m</td></tr>
              {info.range !== undefined && <tr><td>Range</td><td className="mono">{info.range.toFixed(3)} m</td></tr>}
              {info.intensity !== undefined && <tr><td>Intensity</td><td className="mono">{info.intensity.toFixed(3)} <span className="caption">(relative)</span></td></tr>}
              {info.rgb && <tr><td>RGB</td><td className="mono"><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: `rgb(${info.rgb.join(',')})`, verticalAlign: -1, marginRight: 6 }} />{info.rgb.join(', ')}</td></tr>}
              {info.cls !== null && <tr><td>Class</td><td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: `rgb(${classColor(info.cls).join(',')})`, marginRight: 6 }} />{className(info.cls)} <span className="caption">(ground truth)</span></td></tr>}
              {info.normal && <tr><td>Normal</td><td className="mono">{info.normal.map((v) => v.toFixed(2)).join(', ')}</td></tr>}
            </tbody></table>
          </div>
        ) : <p className="hint">Attributes of the last picked point appear here — only those the cloud actually has.</p>}
        {dists.length > 0 && (
          <table className="table" data-testid="distance-table">
            <thead><tr><th>Segment</th><th>Distance</th></tr></thead>
            <tbody>
              {dists.map((d, i) => <tr key={i}><td>P{i + 1} → P{i + 2}</td><td className="mono">{d.toFixed(3)} m</td></tr>)}
              {s.picks.length > 2 && <tr><td>P1 ↔ P{s.picks.length}</td><td className="mono">{Math.hypot(s.picks[0].pos[0] - last.pos[0], s.picks[0].pos[1] - last.pos[1], s.picks[0].pos[2] - last.pos[2]).toFixed(3)} m</td></tr>}
              <tr><td><b>Path length</b></td><td className="mono"><b>{total.toFixed(3)} m</b></td></tr>
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Clipping & cropping" open={false}>
        <div className="field"><label>View clip (does not change data)</label></div>
        <label className="toggle"><span className="lbl">Clip height slab</span><input type="checkbox" checked={s.view.clipOn} onChange={(e) => s.setView({ clipOn: e.target.checked })} /><span className="sw" /></label>
        {s.view.clipOn && b && (
          <>
            <Slider label="Keep above Z" value={Math.max(s.view.clipMin, b.min[2])} min={b.min[2]} max={b.max[2]} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => s.setView({ clipMin: v })} />
            <Slider label="Keep below Z" value={Math.min(s.view.clipMax, b.max[2])} min={b.min[2]} max={b.max[2]} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => s.setView({ clipMax: v })} />
          </>
        )}
        {c && b && (
          <>
            <div className="field" style={{ marginTop: 6 }}><label>Crop box (creates a new cloud)</label></div>
            {(['X', 'Y', 'Z'] as const).map((ax, a) => (
              <div key={ax} style={{ display: 'grid', gap: 6 }}>
                <Slider label={`${ax} min`} value={c.min[a]} min={b.min[a]} max={b.max[a]} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => setCrop({ min: c.min.map((m, k) => (k === a ? v : m)) as Vec3, max: c.max })} />
                <Slider label={`${ax} max`} value={c.max[a]} min={b.min[a]} max={b.max[a]} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => setCrop({ min: c.min, max: c.max.map((m, k) => (k === a ? v : m)) as Vec3 })} />
              </div>
            ))}
            <Btn icon={<Scissors size={16} />} onClick={() => {
              if (!cloud) return;
              const out = cropBox(cloud, c.min, c.max);
              const prevActive = s.activeCloudId;
              s.setCloud('cropped', out);
              pushUndo('crop', () => { useLab.getState().setCloud('cropped', null); useLab.setState({ activeCloudId: prevActive }); });
              s.notify(`Cropped to ${fmtN(out.count)} points (original kept).`, 'ok');
            }} block>Crop to new cloud</Btn>
          </>
        )}
      </Section>
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="Intensity is not colour">
        Intensity is the strength of the returned laser pulse (near-infrared). RGB comes from a camera or from material colour. A white wall can return weak intensity at a grazing angle; a dark but retro-reflective surface can return strong intensity.
      </Callout>
      <Eq note="simplified educational model used by this simulator — not a calibrated return">I ≈ ρ · cos θ ÷ (1 + (r / r₀)²)</Eq>
      <Callout kind="warn" title="What the model leaves out">Real intensity also depends on laser power, receiver gain, atmospheric loss, beam divergence and sensor-specific calibration.</Callout>
      <Callout title="Colour modes"><b>Height</b> and <b>range</b> are computed from geometry. <b>Semantic class</b> shows the ground-truth label stored with simulated data (or the label uploaded in your file) — it is not a prediction. <b>Normals</b> are ground-truth for simulated scans until you estimate them in Tab 5.</Callout>
      <Callout title="File formats">PLY (ascii/binary), PCD (ascii/binary/compressed) and uncompressed LAS are read. Exports keep every attribute the cloud has. LAZ must be converted to LAS first.</Callout>
    </>
  );

  return (
    <TabFrame
      title="Point Cloud Explorer"
      tab={1}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={
        <>
          {cloud && <ColorBar cloud={cloud} mode={s.view.colorMode} />}
          <KindLegend items={[{ color: '#8e8e93', label: 'Original mesh geometry', style: 'wire' }, { color: '#64d2ff', label: cloud ? (cloud.meta.kind === 'measured' ? 'Measured point cloud' : 'Simulated LiDAR points') : 'Point cloud' }, { color: '#ffd60a', label: 'Picked points' }]} />
        </>
      }
    />
  );
  void Badge; void cloudBadge; void Stat;
}
