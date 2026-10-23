import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Play, Plus, Trash2 } from '../ui/icons';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Select, Seg, Slider, MiniSlider, Toggle, Badge, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, CloudFromStore, PickLayer, targetOf, countInstance, useSpacing } from './common';
import { SensorMarker, RayLines } from '../ui/three';
import { SensorPicker } from '../ui/SensorPicker';
import { getPreset, raysPerSweep, pointsPerSecond, isSteered } from '../sensor/presets';
import { sweepDirections } from '../sensor/simulate';
import { runScan, stopLive } from '../state/actions';
import { RawViewer } from '../ui/RawViewer';
import { writePCD } from '../io/pcd';
import { Dots, FileText, Pause } from '../ui/icons';
import { Plan2D } from '../ui/Plan2D';
import { D2R } from '../core/math';

function PatternPreview({ sensor }: { sensor: import("../sensor/presets").SensorConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const steered = sensor.pattern === 'risley' || sensor.pattern === 'solidstate'; // only these change from sweep to sweep
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = 340, H = 190, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr);
    const hh = Math.min(180, sensor.hFov / 2), v0 = Math.min(sensor.vMin, sensor.vMax - 1), v1 = Math.max(sensor.vMax, sensor.vMin + 1);
    const X = (a: number) => 10 + ((a * 180 / Math.PI + hh) / (2 * hh)) * (W - 20), Y = (e: number) => H - 14 - ((e * 180 / Math.PI - v0) / (v1 - v0)) * (H - 28);
    const stride = Math.max(1, Math.ceil(raysPerSweep(sensor) / 4000));
    const maxSweeps = steered ? 6 : 1;
    const sweepsDirs = Array.from({ length: maxSweeps }, (_, sw) => sweepDirections(sensor, sw, stride));
    const cols = ['#64d2ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#ffd60a'];
    const SW_MS = steered ? 1400 : 3200; // time to draw one sweep
    let raf = 0; const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / SW_MS, cycle = t % maxSweeps, cur = Math.floor(cycle), frac = cycle - cur;
      g.fillStyle = '#11131a'; g.fillRect(0, 0, W, H);
      for (let sw = 0; sw <= cur; sw++) {
        const d = sweepsDirs[sw], upto = sw < cur ? d.n : Math.floor(d.n * frac);
        g.fillStyle = sw < cur ? cols[sw % cols.length] + '99' : cols[sw % cols.length];
        for (let k = 0; k < upto; k++) g.fillRect(X(d.az[k]) - 0.8, Y(d.el[k]) - 0.8, 1.7, 1.7);
        if (sw === cur && upto > 0) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(d.az[upto - 1]), Y(d.el[upto - 1]), 3.5, 0, 7); g.fill(); }
      }
      g.fillStyle = '#9aa'; g.font = '12px -apple-system, sans-serif';
      g.fillText(`azimuth ±${hh.toFixed(0)}°`, 10, H - 2); g.fillText(`elevation ${v0.toFixed(0)}…${v1.toFixed(0)}°`, W - 130, 12);
      if (steered) g.fillText(`sweep ${cur + 1} of ${maxSweeps} · fills in each sweep`, 10, 14);
      if (steered) raf = requestAnimationFrame(frame);
    };
    if (steered) raf = requestAnimationFrame(frame); else frame(t0 + SW_MS * 0.999);
    return () => cancelAnimationFrame(raf);
  }, [sensor, steered]);
  return (
    <div className="field">
      <label>{steered ? 'Scan pattern (changes every sweep)' : 'Scan pattern (same every sweep)'}</label>
      <canvas ref={ref} style={{ width: '100%', height: 190, borderRadius: 12 }} aria-label="Scan pattern" />
    </div>
  );
}



export default function Tab1() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const preset = getPreset(s.sensorPresetId);
  const [pane, setPane] = useState<'sensor' | 'position' | 'view'>('sensor');
  const [pointsOnly, setPointsOnly] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const cloud = s.clouds['scan'];
  const rawText = useMemo(() => {
    if (!rawOpen || !cloud) return '';
    // a real LiDAR file keeps just what the sensor measured: x y z + intensity (TLS: x y z + colour)
    const colour = s.sensor.pattern === 'panoramic' && !!cloud.colors;
    const slim = { id: 'raw', name: 'scan', count: cloud.count, positions: cloud.positions, meta: cloud.meta, ...(colour ? { colors: cloud.colors } : { intensity: cloud.intensity }) };
    return new TextDecoder().decode(writePCD(slim as typeof cloud, false));
  }, [rawOpen, cloud, s.sensor.pattern]);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  useEffect(() => () => stopLive(), []);
  useEffect(() => { stopLive(); }, [s.sensorPresetId]);
  const spacing = useSpacing(cloud);
  // keep the scan in step with the scanner: re-scan shortly after the pose changes (only if a scan already exists)
  const poseKey = `${s.pose.x}|${s.pose.y}|${s.pose.z}|${s.pose.yaw}|${s.pose.pitch}`;
  const firstPose = useRef(poseKey);
  useEffect(() => {
    if (firstPose.current === poseKey) return;
    firstPose.current = poseKey;
    if (!useLab.getState().clouds['scan']) return;
    const t = setTimeout(() => { if (!useLab.getState().busy) void runScan({ withCoverage: false }); }, 350);
    return () => clearTimeout(t);
  }, [poseKey]);
  const target = targetOf(s.sceneId);
  const hits = countInstance(cloud, target?.instanceId);
  const info = s.scanInfo;
  const cov = info?.coverage;
  const sensor = s.sensor;
  const b = scene.bounds;
  const rps = raysPerSweep(sensor);
  const solid = isSteered(sensor.pattern);

  const stats = [
    { k: 'Points', v: cloud ? fmtN(cloud.count) : '—', s: info ? `${fmtN(info.stats.rays)} rays · ${fmtN(info.stats.misses)} no-return` : `${fmtN(rps * s.scanOpts.sweeps)} rays planned` },
    { k: 'Surface coverage', v: cov ? `${cov.coveredPct.toFixed(1)} %` : '—', s: cov?.vis ? `${((100 * cov.vis.occluded) / cov.total).toFixed(0)} % occluded` : undefined },
  ];

  const logRow = () => {
    if (!cloud) return;
    useLab.setState({ scanLog: [...s.scanLog, { label: `${sensor.hRes.toFixed(2)}° · ${sensor.channels}ch · ${sensor.maxRange} m`, hRes: sensor.hRes, channels: sensor.channels, maxRange: sensor.maxRange, points: cloud.count, spacing: spacing ?? 0, coveragePct: cov?.coveredPct ?? null, occludedPct: cov?.vis ? (100 * cov.vis.occluded) / cov.total : null }].slice(-8) });
  };

  const viewport = mode === '3d' ? (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget}>
      {!pointsOnly && <SceneFromStore annotate={false} />}
      {cloud && <CloudFromStore cloud={cloud} mode={sensor.pattern === 'panoramic' && cloud.colors ? 'rgb' : 'flat'} colorOpts={{ flat: [230, 30, 40] }} />}
      {!pointsOnly && <SensorMarker x={s.pose.x} y={s.pose.y} z={s.pose.z} yaw={s.pose.yaw} pitch={s.pose.pitch} scale={s.sceneId === 'C' ? 3 : s.sceneId === 'B' ? 1.8 : 1} sensor={sensor} label="Scanner" />}
      {!pointsOnly && s.view.showRays && info?.viz && <RayLines origin={info.viz.origin} ends={info.viz.ends} hit={info.viz.hit} />}
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
      <Seg value={pane} onChange={setPane} options={[{ value: 'sensor', label: 'Sensor' }, { value: 'position', label: 'Position' }, { value: 'view', label: 'View' }]} label="Controls section" />
      {pane === 'sensor' && (<>
      <Section title="Sensor preset">
        <SensorPicker value={s.sensorPresetId} onPick={(id) => { stopLive(); s.setPreset(id); void runScan(); }} />
        <p className="hint">{preset.blurb}</p>
        {solid && <Callout kind="warn">Steered-beam patterns (prism rosette, MEMS) are illustrative and do not reproduce any commercial scan pattern.</Callout>}
        <PatternPreview sensor={sensor} />
      </Section>

      <Section title="Sensor characteristics">
        {sensor.pattern === 'planar' && <p className="hint">2D scanner: a single beam sweeps one plane, so there is no vertical FOV or vertical resolution.</p>}
        <Slider label="Horizontal FOV" value={sensor.hFov} min={10} max={360} step={5} unit="°" onChange={(hFov) => s.setSensor({ hFov })} disabled={sensor.pattern === 'planar' && false} />
        {sensor.pattern !== 'planar' && <Slider label="Vertical FOV" value={Math.round((sensor.vMax - sensor.vMin) * 2) / 2} min={0} max={150} step={0.5} unit="°" onChange={(f) => { const mid = (sensor.vMin + sensor.vMax) / 2; s.setSensor({ vMin: mid - f / 2, vMax: mid + f / 2 }); }} />}
        {sensor.pattern !== 'rotating' && sensor.pattern !== 'panoramic' && <Slider label="Horizontal resolution (angular step)" value={sensor.hRes} min={0.05} max={3} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(hRes) => s.setSensor({ hRes })} hint={solid ? 'For solid-state: sets the number of steered beams per sweep.' : undefined} />}
        {sensor.pattern !== 'planar' && <Slider label={solid ? 'Beam density (lines)' : 'Vertical resolution (channels)'} value={sensor.channels} min={1} max={256} step={1} onChange={(channels) => s.setSensor({ channels })} />}
        <Slider label="Maximum range" value={sensor.maxRange} min={1} max={150} step={1} unit=" m" onChange={(maxRange) => s.setSensor({ maxRange })} />
      </Section>

      <Section title="Advanced" open={false}>
        <Slider label="Minimum range" value={sensor.minRange} min={0} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(minRange) => s.setSensor({ minRange })} />
        <Slider label="Scan frequency" value={sensor.frequency} min={0.01} max={50} step={0.01} unit=" Hz" format={(v) => v.toFixed(2)} onChange={(frequency) => s.setSensor({ frequency })} />
        <div className="field"><label>Returns per beam</label><Seg value={sensor.returns} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]} onChange={(v) => s.setSensor({ returns: v as 1 | 2 | 3 })} /><span className="caption">Extra returns only appear where a beam partly passes through something (e.g. tree foliage in Scene C).</span></div>
        <Slider label="Range noise (1σ)" value={sensor.noise} min={0} max={0.1} step={0.001} unit=" m" format={(v) => v.toFixed(3)} onChange={(noise) => s.setSensor({ noise })} />
        <Toggle label="Override surface reflectivity" checked={sensor.reflectivityOverride !== null} onChange={(on) => s.setSensor({ reflectivityOverride: on ? 0.5 : null })} hint="Off: each material uses its own reflectivity." />
        {sensor.reflectivityOverride !== null && <Slider label="Reflectivity (all surfaces)" value={sensor.reflectivityOverride} min={0.02} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.setSensor({ reflectivityOverride: v })} />}
        <Slider label="Accumulated sweeps" value={s.scanOpts.sweeps} min={1} max={10} step={1} onChange={(sweeps) => s.patch({ scanOpts: { ...s.scanOpts, sweeps } })} hint="Accumulate several sweeps from the same pose." />
        <NumberField label="Random seed" value={s.scanOpts.seed} step={1} onChange={(seed) => s.patch({ scanOpts: { ...s.scanOpts, seed: Math.round(seed) || 0 } })} />
      </Section>

      </>)}
      {pane === 'position' && (<>
      <Section title="Sensor pose">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
          <MiniSlider label="X" value={s.pose.x} min={b.min[0] + 0.3} max={b.max[0] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(x) => s.setPose({ x })} />
          <MiniSlider label="Y" value={s.pose.y} min={b.min[1] + 0.3} max={b.max[1] - 0.3} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(y) => s.setPose({ y })} />
          <MiniSlider label="Height" value={s.pose.z} min={0.1} max={Math.max(2.8, b.max[2] - 0.2)} step={0.05} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => s.setPose({ z })} />
          <MiniSlider label="Heading" value={Math.round(s.pose.yaw / D2R)} min={-180} max={180} step={1} unit="°" onChange={(d) => s.setPose({ yaw: d * D2R })} />
          <MiniSlider label="Pitch (+ = up)" value={Math.round(s.pose.pitch / D2R)} min={-60} max={60} step={1} unit="°" onChange={(d) => s.setPose({ pitch: d * D2R })} />
        </div>
        <Btn sm icon={<Crosshair size={15} />} variant={s.interaction === 'place-sensor' ? 'primary' : ''} onClick={() => s.patch({ interaction: s.interaction === 'place-sensor' ? 'select' : 'place-sensor' })} block>
          {s.interaction === 'place-sensor' ? 'Click a surface in the view…' : 'Place by clicking in the scene'}
        </Btn>
      </Section>

      </>)}
      {pane === 'view' && (<>
      <Section title="Scan">
        <div className="btn-row">
          <Btn icon={<Plus size={16} />} onClick={logRow} disabled={!cloud} testId="log-scan">Add to comparison</Btn>
          <Btn icon={<Trash2 size={16} />} onClick={() => { s.setCloud('scan', null); s.patch({ scanInfo: null }); }} disabled={!cloud}>Clear</Btn>
        </div>
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
      <DisplaySection cloud={cloud} hideColour />
      </>)}
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
      <Callout kind="edu" title="Scan architectures you can simulate here">
        <b>Rotating multi-channel</b> (VLP-16, OS1): fixed elevation rings, azimuth sweeps 360°. <b>Prism / Risley</b> (Avia-type): two counter-rotating wedges draw a rosette that fills in over time. <b>MEMS micro-mirror</b> (Cube-1-type): sinusoidal sweep, eye-shaped coverage. <b>Solid-state array</b> (FT120-type): fixed grid, identical every frame. <b>2D planar</b>: one fan. Use the scan-pattern preview to see each pattern.
        <div className="caption" style={{ marginTop: 6 }}>Kinematic descriptions follow the open-source <a href="https://github.com/maninka123/rotating-target-calibration-studio" target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent)' }}>Rotating Target Calibration Studio</a>, which compares LiDAR and camera architectures in more depth (<a href="https://maninka123.github.io/rotating-target-calibration-studio/" target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent)' }}>live demo</a>).</div>
      </Callout>
      <Callout title="Terminology">Mechanical, MEMS, flash, rotating-mirror and optical-phased-array LiDAR describe the <i>sensing architecture</i>. TLS (tripod) and MLS (moving) describe the <i>deployment</i> — see Tab 3.</Callout>
    </>
  );

  return (
    <TabFrame
      title="Scanner Simulator"
      tab={1}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      statsRow
      noPanelTabs
      topExtras={<Seg block={false} value={mode} onChange={setMode} options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} label="View" />}
      viewExtras={<><Btn sm variant="primary" icon={s.live ? <Pause size={15} /> : <Play size={15} />} onClick={() => (s.live ? stopLive() : runScan())} busy={!!s.busy} testId="run-scan">{s.live ? 'Stop' : 'Run scan'}</Btn><Btn sm icon={<Dots size={15} />} variant={pointsOnly ? 'primary' : ''} onClick={() => setPointsOnly(!pointsOnly)} testId="points-only">{pointsOnly ? 'Show scene' : 'Point cloud'}</Btn><Btn sm icon={<FileText size={15} />} variant={rawOpen ? 'primary' : ''} onClick={() => setRawOpen(!rawOpen)} disabled={!cloud} testId="raw-toggle">Raw</Btn></>}
      overlays={<>{(s.sensor.pattern === 'risley' || s.sensor.pattern === 'solidstate') && (
        <div className="overlay glass card" style={{ right: 12, top: 70, padding: '0.35rem' }} data-testid="accumulate-toggle">
          <Seg block={false} value={s.accumulate ? 'acc' : 'one'} onChange={(v) => { stopLive(); s.patch({ accumulate: v === 'acc' }); setTimeout(() => void runScan(), 0); }} label="Point cloud mode" options={[{ value: 'one', label: 'Single sweep' }, { value: 'acc', label: 'Building up' }]} />
        </div>
      )}{rawOpen && cloud && <RawViewer text={rawText} filename="scan.pcd" onClose={() => setRawOpen(false)} />}<KindLegend items={[{ color: '#8e8e93', label: 'Scene mesh (original geometry)', style: 'wire' }, { color: '#64d2ff', label: 'Simulated LiDAR points' }, { color: '#ff9f0a', label: 'Ray end-points' }]} /></>}
    />
  );
  void Badge; void useMemo;
}
