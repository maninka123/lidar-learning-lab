import { useMemo, useState } from 'react';
import { Crosshair, Play, Plus, Trash2 } from '../ui/icons';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Select, Seg, Slider, Toggle, Badge, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, CloudFromStore, PickLayer, targetOf, countInstance, useSpacing } from './common';
import { SensorMarker, RayLines } from '../ui/three';
import { PRESETS, getPreset, raysPerSweep, pointsPerSecond } from '../sensor/presets';
import { runScan } from '../state/actions';
import { Plan2D } from '../ui/Plan2D';
import { D2R } from '../core/math';

export default function Tab1() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const preset = getPreset(s.sensorPresetId);
  const cloud = s.clouds['scan'];
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const spacing = useSpacing(cloud);
  const target = targetOf(s.sceneId);
  const hits = countInstance(cloud, target?.instanceId);
  const info = s.scanInfo;
  const cov = info?.coverage;
  const sensor = s.sensor;
  const b = scene.bounds;
  const rps = raysPerSweep(sensor);
  const solid = sensor.pattern === 'solidstate';

  const stats = [
    { k: 'Points', v: cloud ? fmtN(cloud.count) : '—', s: info ? `${fmtN(info.stats.rays)} rays · ${fmtN(info.stats.misses)} no-return` : `${fmtN(rps * s.scanOpts.sweeps)} rays planned` },
    { k: 'Point spacing', v: spacing ? `${(spacing * 100).toFixed(1)} cm` : '—', s: `${(10 * Math.tan(sensor.hRes * D2R) * 100).toFixed(1)} cm at 10 m (horizontal)` },
    { k: 'Target hits', v: target ? fmtN(hits) : '—', s: target ? `${target.name}` : '' },
    { k: 'Surface coverage', v: cov ? `${cov.coveredPct.toFixed(1)} %` : '—', s: cov?.vis ? `${((100 * cov.vis.occluded) / cov.total).toFixed(0)} % occluded` : undefined },
    { k: 'Scan time', v: info ? `${info.stats.ms.toFixed(0)} ms` : '—', s: `${(pointsPerSecond(sensor) / 1000).toFixed(0)}k pts/s nominal` },
    { k: 'Data rate', v: `${(rps * sensor.frequency / 1000).toFixed(0)}k/s`, s: `${sensor.frequency} Hz × ${fmtN(rps)} rays` },
  ];

  const logRow = () => {
    if (!cloud) return;
    useLab.setState({ scanLog: [...s.scanLog, { label: `${sensor.hRes.toFixed(2)}° · ${sensor.channels}ch · ${sensor.maxRange} m`, hRes: sensor.hRes, channels: sensor.channels, maxRange: sensor.maxRange, points: cloud.count, spacing: spacing ?? 0, coveragePct: cov?.coveredPct ?? null, occludedPct: cov?.vis ? (100 * cov.vis.occluded) / cov.total : null }].slice(-8) });
  };

  const viewport = mode === '3d' ? (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget}>
      <SceneFromStore annotate={false} />
      {cloud && <CloudFromStore cloud={cloud} />}
      <SensorMarker x={s.pose.x} y={s.pose.y} z={s.pose.z} yaw={s.pose.yaw} sensor={sensor} label="Scanner" />
      {s.view.showRays && info?.viz && <RayLines origin={info.viz.origin} ends={info.viz.ends} hit={info.viz.hit} />}
      <PickLayer />
    </Viewport>
  ) : (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Plan2D scene={scene} height="fill" zRange={sensor.channels === 1 ? undefined : [s.pose.z - 0.3, s.pose.z + 0.3]}
        layers={{
          points: cloud ? [{ pos: cloud.positions, count: cloud.count, color: '#64d2ff' }] : [],
          markers: [{ x: s.pose.x, y: s.pose.y, color: '#0a84ff', yaw: s.pose.yaw, label: 'Scanner', r: 6 }],
          fov: { x: s.pose.x, y: s.pose.y, yaw: s.pose.yaw, hFov: sensor.hFov, range: Math.min(sensor.maxRange, 12), color: '#0a84ff' },
        }}
        onClick={(x, y) => useLab.getState().interaction === 'place-sensor' && useLab.getState().setPose({ x, y })} />
      <div className="overlay glass card caption" style={{ right: 12, bottom: 12 }}>2D slice: points within ±30 cm of the scanner height.</div>
    </div>
  );

  const controls = (
    <>
      <Section title="Sensor preset">
        <Select value={s.sensorPresetId} options={PRESETS.map((p) => ({ value: p.id, label: p.name }))} onChange={s.setPreset} />
        <p className="hint">{preset.blurb}</p>
        {preset.profile && (
          <Callout kind="warn" title={`${preset.profile.vendor} profile — what is verified vs simplified`}>
            <table className="table"><tbody>{preset.profile.verified.map((v) => <tr key={v.label}><td>{v.label}</td><td>{v.value}</td></tr>)}</tbody></table>
            <b style={{ display: 'block', marginTop: 8 }}>Simplified in this simulator</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>{preset.profile.simplifications.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Callout>
        )}
        {solid && <Callout kind="warn">The rosette pattern is illustrative. It does not reproduce any commercial non-repetitive scan pattern.</Callout>}
      </Section>

      <Section title="Sensor pose">
        <Slider label="X" value={s.pose.x} min={b.min[0] + 0.3} max={b.max[0] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(x) => s.setPose({ x })} />
        <Slider label="Y" value={s.pose.y} min={b.min[1] + 0.3} max={b.max[1] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(y) => s.setPose({ y })} />
        <Slider label="Height Z" value={s.pose.z} min={0.1} max={Math.max(2.8, b.max[2] - 0.2)} step={0.05} unit=" m" format={(v) => v.toFixed(2)} onChange={(z) => s.setPose({ z })} />
        <Slider label="Heading (yaw)" value={Math.round(s.pose.yaw / D2R)} min={-180} max={180} step={1} unit="°" onChange={(d) => s.setPose({ yaw: d * D2R })} />
        <Slider label="Pitch" value={Math.round(s.pose.pitch / D2R)} min={-60} max={60} step={1} unit="°" onChange={(d) => s.setPose({ pitch: d * D2R })} />
        <Btn icon={<Crosshair size={16} />} variant={s.interaction === 'place-sensor' ? 'primary' : ''} onClick={() => s.patch({ interaction: s.interaction === 'place-sensor' ? 'select' : 'place-sensor' })} block>
          {s.interaction === 'place-sensor' ? 'Click a surface in the view…' : 'Click in the scene to place scanner'}
        </Btn>
      </Section>

      <Section title="Scan geometry">
        <Slider label="Horizontal FOV" value={sensor.hFov} min={10} max={360} step={5} unit="°" onChange={(hFov) => s.setSensor({ hFov })} disabled={sensor.pattern === 'planar' && false} />
        <Slider label="Lowest beam elevation" value={sensor.vMin} min={-90} max={sensor.vMax} step={0.5} unit="°" onChange={(vMin) => s.setSensor({ vMin })} />
        <Slider label="Highest beam elevation" value={sensor.vMax} min={sensor.vMin} max={90} step={0.5} unit="°" onChange={(vMax) => s.setSensor({ vMax })} hint={`Vertical FOV ${(sensor.vMax - sensor.vMin).toFixed(1)}°`} />
        <Slider label="Angular resolution" value={sensor.hRes} min={0.05} max={3} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(hRes) => s.setSensor({ hRes })} hint={solid ? 'For solid-state: sets the number of steered beams per sweep.' : undefined} />
        <Slider label={solid ? 'Beam density (lines)' : 'Vertical channels'} value={sensor.channels} min={1} max={256} step={1} onChange={(channels) => s.setSensor({ channels })} />
        <Slider label="Minimum range" value={sensor.minRange} min={0} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(minRange) => s.setSensor({ minRange })} />
        <Slider label="Maximum range" value={sensor.maxRange} min={1} max={150} step={1} unit=" m" onChange={(maxRange) => s.setSensor({ maxRange })} hint="Range for a bright (80 %) target; darker surfaces are detected at shorter range." />
        <Slider label="Scan frequency" value={sensor.frequency} min={0.01} max={50} step={0.01} unit=" Hz" format={(v) => v.toFixed(2)} onChange={(frequency) => s.setSensor({ frequency })} />
        <div className="field"><label>Returns per beam</label><Seg value={sensor.returns} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]} onChange={(v) => s.setSensor({ returns: v as 1 | 2 | 3 })} /><span className="caption">Extra returns only appear where a beam partly passes through something (e.g. tree foliage in Scene C).</span></div>
      </Section>

      <Section title="Noise & surface">
        <Slider label="Range noise (1σ)" value={sensor.noise} min={0} max={0.1} step={0.001} unit=" m" format={(v) => v.toFixed(3)} onChange={(noise) => s.setSensor({ noise })} />
        <Toggle label="Override surface reflectivity" checked={sensor.reflectivityOverride !== null} onChange={(on) => s.setSensor({ reflectivityOverride: on ? 0.5 : null })} hint="Off: each material uses its own reflectivity." />
        {sensor.reflectivityOverride !== null && <Slider label="Reflectivity (all surfaces)" value={sensor.reflectivityOverride} min={0.02} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.setSensor({ reflectivityOverride: v })} />}
        <Slider label="Accumulated sweeps" value={s.scanOpts.sweeps} min={1} max={10} step={1} onChange={(sweeps) => s.patch({ scanOpts: { ...s.scanOpts, sweeps } })} hint="Accumulate several sweeps from the same pose." />
        <Slider label="Point budget" value={s.scanOpts.maxRays} min={5000} max={400000} step={5000} format={fmtN} onChange={(maxRays) => s.patch({ scanOpts: { ...s.scanOpts, maxRays } })} hint="Upper limit on rays per scan; the simulator coarsens the angular step to stay within it." />
        <NumberField label="Random seed" value={s.scanOpts.seed} step={1} onChange={(seed) => s.patch({ scanOpts: { ...s.scanOpts, seed: Math.round(seed) || 0 } })} />
      </Section>

      <Section title="Run">
        <div className="btn-row">
          <Btn variant="primary" icon={<Play size={16} />} onClick={() => runScan()} busy={!!s.busy} testId="run-scan">Run scan</Btn>
          <Btn icon={<Plus size={16} />} onClick={logRow} disabled={!cloud} testId="log-scan">Add to comparison</Btn>
          <Btn icon={<Trash2 size={16} />} onClick={() => { s.setCloud('scan', null); s.patch({ scanInfo: null }); }} disabled={!cloud}>Clear</Btn>
        </div>
        <Seg value={mode} onChange={setMode} options={[{ value: '3d', label: '3D view' }, { value: '2d', label: '2D plan' }]} />
        <Toggle label="Show scanning rays" checked={s.view.showRays} onChange={(v) => s.setView({ showRays: v })} />
      </Section>

      {s.scanLog.length > 0 && (
        <Section title="Comparison">
          <table className="table" data-testid="scan-log">
            <thead><tr><th>Setting</th><th>Points</th><th>Spacing</th><th>Cover</th><th>Occl.</th></tr></thead>
            <tbody>{s.scanLog.map((r, i) => <tr key={i}><td>{r.label}</td><td>{fmtN(r.points)}</td><td>{(r.spacing * 100).toFixed(1)} cm</td><td>{r.coveragePct?.toFixed(0) ?? '—'}%</td><td>{r.occludedPct?.toFixed(0) ?? '—'}%</td></tr>)}</tbody>
          </table>
          <Btn sm onClick={() => useLab.setState({ scanLog: [] })}>Clear table</Btn>
        </Section>
      )}
      <DisplaySection cloud={cloud} />
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="How a simulated LiDAR measures">
        For every beam the simulator casts a ray from the sensor origin against the scene geometry, finds the nearest surface hit, adds Gaussian range noise, and converts the sensor-frame measurement into world coordinates.
      </Callout>
      <Eq note="range from time of flight (c = speed of light)">R = c · Δt / 2</Eq>
      <Eq note="sensor-frame direction from azimuth α and elevation ε">d = (cos ε cos α, cos ε sin α, sin ε)</Eq>
      <Eq note="sensor → world: R is the sensor orientation, t its position">p<sub>world</sub> = t + R · (r · d)</Eq>
      <Eq note="point spacing grows with range">spacing ≈ r · Δθ</Eq>
      <Callout kind="warn" title="Simplified models">
        Detection range scales with √reflectivity and intensity uses ρ·cosθ ÷ (1 + (r/r₀)²). These are teaching approximations, not a calibrated link budget.
      </Callout>
      <Callout title="Terminology">Mechanical, MEMS, flash, rotating-mirror and optical-phased-array LiDAR describe the <i>sensing architecture</i>. TLS (tripod) and MLS (moving) describe the <i>deployment</i> — see Tab 3.</Callout>
    </>
  );

  return (
    <TabFrame
      title="LiDAR Fundamentals"
      tab={0}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={<KindLegend items={[{ color: '#8e8e93', label: 'Scene mesh (original geometry)', style: 'wire' }, { color: '#64d2ff', label: 'Simulated LiDAR points' }, { color: '#ff9f0a', label: 'Ray end-points' }]} />}
    />
  );
  void Badge; void useMemo;
}
