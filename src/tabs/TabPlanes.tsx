import { useEffect, useMemo, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { CloudLayer } from '../ui/three';
import { Play } from '../ui/icons';
import { useLab } from '../state/store';
import { detectPlanes, trialsNeeded, PlaneRun } from '../apps/planes';
import { PLANE_COLOURS, useClassroom } from '../apps/useClassroom';
import { CLASSROOM_CLASSES } from '../apps/classroom';
import { PointCloud } from '../core/pointcloud';
import { Credit } from '../ui/VideoCard';

const tilt = (n: number[]) => (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;

export default function TabPlanes() {
  const s = useLab();
  const { cloud, error } = useClassroom(0.03);
  const [mode, setMode] = useState<'fixed' | 'adaptive'>('adaptive');
  const [threshold, setThreshold] = useState(0.02), [iterations, setIterations] = useState(100);
  const [confidence, setConfidence] = useState(0.99), [minPct, setMinPct] = useState(2), [maxPlanes, setMaxPlanes] = useState(12);
  const [hideCeiling, setHideCeiling] = useState(true), [realColours, setRealColours] = useState(false);
  const [run, setRun] = useState<PlaneRun | null>(null);
  const [last, setLast] = useState<{ fixed?: PlaneRun; adaptive?: PlaneRun }>({});
  const [busy, setBusy] = useState(false);

  function detect() {
    if (!cloud) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const r = detectPlanes(cloud.positions, cloud.count, cloud.labels ?? null, { mode, threshold, iterations, confidence, minFraction: minPct / 100, maxPlanes, seed: 3 });
        setRun(r); setLast((l) => ({ ...l, [mode]: r }));
      } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
    }, 30);
  }
  useEffect(() => { if (cloud && !run && !busy) detect(); }, [cloud]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo<PointCloud | null>(() => {
    if (!cloud) return null;
    if (!run || realColours) return cloud;
    const col = new Uint8Array(cloud.count * 3).fill(205);
    for (let i = 0; i < cloud.count; i++) { const a = run.assigned[i]; if (a >= 0) col.set(PLANE_COLOURS[a % PLANE_COLOURS.length], i * 3); }
    return { ...cloud, colors: col };
  }, [cloud, run, realColours]);

  const purity = (r?: PlaneRun) => (r && r.planes.length ? r.planes.reduce((a, p) => a + (p.purity ?? 0) * p.inliers.length, 0) / Math.max(1, r.planes.reduce((a, p) => a + p.inliers.length, 0)) : null);
  const viewport = (
    <Viewport home={[8, -10, 6.5]} target={[0, 0, 1.2]} gridSize={1} hideAxes bgOverride="#ffffff">
      {shown && <CloudLayer cloud={shown} mode="rgb" size={Math.max(2, s.view.pointSize - 1)} budget={Math.max(s.view.renderBudget, 300000)} pickable={false} clip={{ on: hideCeiling, min: -1, max: 2.55 }} />}
    </Viewport>
  );
  const stats = [
    { k: 'Planes found', v: run ? String(run.planes.length) : '—', s: run ? `${(run.coverage * 100).toFixed(0)} % of points on a plane` : undefined },
    { k: 'Time', v: run ? `${run.ms.toFixed(0)} ms` : '—', s: run ? `${fmtN(run.totalIterations)} trials in total` : undefined },
  ];
  const first = run?.planes[0];
  const controls = (
    <>
      <Callout kind="edu" title="Find the flat surfaces automatically">
        RANSAC picks 3 random points, makes a plane through them and counts the points close to it. It repeats, keeps the best plane, removes its points and looks for the next one. The settings (how close is close? how many tries?) normally need hand tuning. <b>Adaptive</b> RANSAC measures them from the data.
      </Callout>
      <Section title="1 · Method">
        <Seg value={mode} onChange={setMode} options={[{ value: 'fixed', label: 'Fixed settings' }, { value: 'adaptive', label: 'Adaptive' }]} label="RANSAC" />
        {mode === 'fixed' ? (
          <>
            <Slider label="Inlier distance" value={threshold * 1000} min={2} max={100} step={1} unit=" mm" onChange={(v) => setThreshold(v / 1000)} hint="Points closer than this count as on the plane. Too small: planes break up. Too large: different surfaces merge." />
            <Slider label="Trials per plane" value={iterations} min={10} max={1000} step={10} onChange={setIterations} hint="More trials find better planes but take longer." />
          </>
        ) : (
          <>
            <Slider label="Confidence" value={confidence * 100} min={90} max={99.9} step={0.1} unit=" %" format={(v) => v.toFixed(1)} onChange={(v) => setConfidence(v / 100)} hint="How sure you want to be of finding the best plane. The number of trials is worked out from it." />
            <p className="hint">Inlier distance and trial count are measured from the data for every plane.</p>
          </>
        )}
        <Slider label="Smallest plane" value={minPct} min={0.5} max={10} step={0.5} unit=" % of points" onChange={setMinPct} hint="Stop when the best plane is smaller than this." />
        <Slider label="Most planes" value={maxPlanes} min={3} max={20} step={1} onChange={setMaxPlanes} />
        <Btn variant="primary" icon={<Play size={16} />} onClick={detect} busy={busy} disabled={!cloud} testId="detect-planes">Detect planes</Btn>
        {error && <p className="hint">{error}</p>}
      </Section>
      {run && (
        <Section title="2 · What it found">
          {run.mode === 'adaptive' && first && (
            <div className="callout" style={{ gap: 6 }}>
              <b>What adaptive RANSAC worked out</b>
              <span>Point spacing: <b>{(run.spacing * 1000).toFixed(1)} mm</b> (median distance to the nearest neighbour)</span>
              <span>Noise on plane 1: <b>{(first.sigma * 1000).toFixed(1)} mm</b> → inlier distance <b>{(first.threshold * 1000).toFixed(1)} mm</b></span>
              <span>Trials for plane 1: <b>{first.iterations}</b>. Rule: N = log(1 − p) / log(1 − w³), with p = {(confidence * 100).toFixed(1)} % and w = share of points on the plane. If w = 30 %, N = {trialsNeeded(confidence, 0.3)}; if w = 10 %, N = {trialsNeeded(confidence, 0.1)}.</span>
            </div>
          )}
          <table className="table"><thead><tr><td />
            <td>Plane</td><td>Points</td><td>Tilt</td><td>Trials</td></tr></thead><tbody>
            {run.planes.map((p) => (
              <tr key={p.id}><td><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: `rgb(${PLANE_COLOURS[p.id % PLANE_COLOURS.length].join(',')})` }} /></td>
                <td>{p.kind}{p.majorLabel !== null && p.purity !== null ? <span className="caption"> · {(p.purity * 100).toFixed(0)} % {CLASSROOM_CLASSES[p.majorLabel]?.name.toLowerCase()}</span> : null}</td>
                <td className="mono">{fmtN(p.inliers.length)}</td><td className="mono">{tilt(p.normal).toFixed(0)}°</td><td className="mono">{p.iterations}</td></tr>
            ))}
          </tbody></table>
          <p className="hint">Planes are named from their direction and height. The percentage is how many of the plane's points the scan file labels as that class.</p>
        </Section>
      )}
      {last.fixed && last.adaptive && (
        <Section title="3 · Fixed vs adaptive">
          <table className="table"><thead><tr><td /><td>Fixed</td><td>Adaptive</td></tr></thead><tbody>
            <tr><td>Planes</td><td className="mono">{last.fixed.planes.length}</td><td className="mono">{last.adaptive.planes.length}</td></tr>
            <tr><td>Points on a plane</td><td className="mono">{(last.fixed.coverage * 100).toFixed(0)} %</td><td className="mono">{(last.adaptive.coverage * 100).toFixed(0)} %</td></tr>
            <tr><td>Label agreement</td><td className="mono">{((purity(last.fixed) ?? 0) * 100).toFixed(0)} %</td><td className="mono">{((purity(last.adaptive) ?? 0) * 100).toFixed(0)} %</td></tr>
            <tr><td>Trials</td><td className="mono">{fmtN(last.fixed.totalIterations)}</td><td className="mono">{fmtN(last.adaptive.totalIterations)}</td></tr>
            <tr><td>Time</td><td className="mono">{last.fixed.ms.toFixed(0)} ms</td><td className="mono">{last.adaptive.ms.toFixed(0)} ms</td></tr>
          </tbody></table>
          <p className="hint">Try the fixed method with a very small or very large distance, then compare.</p>
        </Section>
      )}
      <Section title="Tutorial"><Credit keys={['ransac']} title="" /></Section>
      <Section title="View">
        <Toggle label="Hide the ceiling" checked={hideCeiling} onChange={setHideCeiling} />
        <Toggle label="Show the scan's own colours" checked={realColours} onChange={setRealColours} />
      </Section>
    </>
  );
  return <TabFrame title="Plane Detection" tab={10} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv statsRow stats={stats} />;
}
