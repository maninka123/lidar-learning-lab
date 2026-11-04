import { useEffect, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Seg, Slider, ToolbarSlider, Toggle, fmtN } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneFromStore, MiniChart } from './common';
import { PolyLine, CloudLayer, Marker } from '../ui/three';
import { Crosshair, Trash2, X, Play, RotateCcw, Dots } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { PointCloud } from '../core/pointcloud';
import { Vec3 } from '../core/math';
import { Plan2D } from '../ui/Plan2D';
import { SlamGuidePanel, SlamGuideScene } from '../guide/SlamGuide';
import { useSlamGuide } from '../guide/store';
import { tabIndex } from './nav';
import { closeRoute, routeIsClosed } from '../registration/slam';

const SLAM_SENSOR: SensorConfig = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), hRes: 2, channels: 5, vMin: -20, vMax: 20, maxRange: 60, noise: 0.005, minRange: 0.3 };

/** The lesson lives in the Learn tab of the side panel: opening the tab starts it, leaving it closes it. */
function SlamLearn({ slam, busy, onRun, onTls }: { slam: ReturnType<typeof useLab.getState>['slam']; busy: boolean; onRun: (o?: Record<string, number | boolean>) => void; onTls: () => void }) {
  useEffect(() => { useSlamGuide.getState().start(); if (!useLab.getState().slam && useLab.getState().waypoints.length >= 2) onRun({ loopClosure: true }); return () => useSlamGuide.getState().close(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const on = useSlamGuide((g) => g.on);
  const routeReady = useLab((s) => s.waypoints.length >= 2);
  if (!routeReady) return <p className="hint" data-testid="slam-route-needed">Open Controls and add at least two waypoints to draw your route, then return here to explore the SLAM lesson.</p>;
  return <div style={{ padding: '0 1rem' }}>{on ? <SlamGuidePanel slam={slam} busy={busy} onRun={() => onRun({ loopClosure: true })} onRunWith={onRun} openTls={onTls} /> : <Btn variant="primary" icon={<Play size={16} />} onClick={() => useSlamGuide.getState().start()} testId="slam-guide-start">Start the lesson again</Btn>}</div>;
}

export default function Tab4() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const [busy, setBusy] = useState(false);
  const p = s.slamParams;
  const slam = s.slam;
  const setP = (patch: Partial<typeof p>) => s.patch({ slamParams: { ...p, ...patch } });

  const guideOn = useSlamGuide((g) => g.on);
  const [tool, setTool] = useState(false);
  const [output, setOutput] = useState<'before' | 'after'>('before');
  const [resultZ, setResultZ] = useState(p.z);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setTool(false);
    s.patch({ slam: null });
    s.setCloud('slam-map', null);
    return () => { generation.current++; };
  }, [s.sceneId]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalidate = () => { generation.current++; s.patch({ slam: null }); s.setCloud('slam-map', null); };
  const setRoute = (waypoints: [number, number][]) => { invalidate(); s.patch({ waypoints }); };
  const setPlatform = (z: number) => { invalidate(); setP({ z }); };
  const platform = p.z >= 3 ? 'uav' : p.z === 1.8 ? 'vehicle' : 'handheld';

  useEffect(() => { s.patch({ interaction: tool && !guideOn ? 'add-waypoint' : 'select' }); return () => { useLab.getState().patch({ interaction: 'select' }); }; }, [tool, guideOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const wps = s.waypoints;
  useEffect(() => { generation.current++; s.patch({ slam: null }); s.setCloud('slam-map', null); }, [wps]); // eslint-disable-line react-hooks/exhaustive-deps
  const addWp = (x: number, y: number) => setRoute([...useLab.getState().waypoints, [x, y]]);
  async function runSlam(over: Partial<typeof p> = {}) {
    if (wps.length < 2 || busy) return;
    const gen = generation.current;
    setTool(false);
    setBusy(true);
    try {
      const params = { ...p, ...over, odom: 'icp' as const, waypoints: s.waypoints };
      if (Object.keys(over).length) s.patch({ slamParams: { ...p, ...over } });
      const r = await runTask('slam', { scene, sensor: SLAM_SENSOR, params });
      if (gen !== generation.current) return;
      s.patch({ slam: r });
      setResultZ(params.z);
      setOutput(r.corrected ? 'after' : 'before');
      s.setCloud('slam-map', r.maps.corrected ?? r.maps.est, true);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ------------------------------------------------ viewport
  const z = slam ? resultZ : p.z;
  const path = (poses: { x: number; y: number }[] | null | undefined, h = z): Vec3[] => (poses ?? []).map((q) => [q.x, q.y, h]);
  const flat = (c: [number, number, number]) => ({ flat: c });
  const showMap = (c: PointCloud | null | undefined, rgb: [number, number, number], on: boolean) => (c && on ? <CloudLayer cloud={c} mode="flat" colorOpts={flat(rgb)} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} /> : null);

  const slamView = (
    <>
      <SceneFromStore interactive={tool && s.interaction === 'add-waypoint' && !guideOn} />
      {guideOn && slam && <SlamGuideScene slam={slam} z={z} sensor={SLAM_SENSOR} pointSize={s.view.pointSize} />}
      {!guideOn && wps.length > 0 && <>
        {wps.length > 1 && <PolyLine pts={wps.map(([x, y]) => [x, y, 0.3] as Vec3)} color="#ff9f0a" width={3} dashed />}
        {wps.map(([x, y], i) => <Marker key={i} p={[x, y, 0.3]} color="#ff9f0a" r={0.5} label={`${i + 1}`} />)}
      </>}
      {slam && !guideOn && (
        <>
          {showMap(slam.maps.gt, [140, 150, 170], s.slamShow.mapGt)}
          {showMap(slam.maps.est, [255, 159, 10], output === 'before')}
          {showMap(slam.maps.corrected, [48, 209, 88], output === 'after')}
          {s.slamShow.gt && <PolyLine pts={path(slam.gt)} color="#30d158" width={3} />}
          {output === 'before' && <PolyLine pts={path(slam.est)} color="#ff453a" width={3} dashed />}
          {output === 'after' && slam.corrected && <PolyLine pts={path(slam.corrected)} color="#0a84ff" width={3} />}
          <Marker p={[slam.gt[0].x, slam.gt[0].y, z]} color="#ffffff" r={0.1} label="start / end" />
        </>
      )}
    </>
  );
  const viewport = <Viewport home={scene.cameraHome} target={scene.cameraTarget}>{slamView}</Viewport>;

  const stats = [
      { k: 'ATE (before)', v: slam ? `${(slam.ateBefore * 100).toFixed(1)} cm` : '—', s: 'RMS position error of estimate' },
      { k: 'ATE (after)', v: slam?.ateAfter != null ? `${(slam.ateAfter * 100).toFixed(1)} cm` : '—', s: slam?.closure ? (slam.closure.detected ? 'loop closure applied' : 'closure not detected') : 'closure off' },
      { k: 'Final drift', v: slam ? `${(slam.finalDriftBefore * 100).toFixed(1)} cm` : '—', s: slam?.finalDriftAfter != null ? `→ ${(slam.finalDriftAfter * 100).toFixed(1)} cm` : undefined },
      { k: 'Mean scan overlap', v: slam ? `${((100 * slam.overlap.reduce((a, v) => a + v, 0)) / slam.overlap.length).toFixed(0)} %` : '—', s: 'ICP inlier fraction' },
    ];

  const controls = (
    <>
        <>
          <Section title="Mobile platform">
            <Seg label="Mobile platform" value={platform} onChange={(v) => setPlatform(v === 'uav' ? 6 : v === 'vehicle' ? 1.8 : 1.5)} options={[{ value: 'handheld', label: 'Handheld' }, { value: 'vehicle', label: 'Vehicle' }, { value: 'uav', label: 'UAV' }]} />
            <p className="hint">Scanner height changes the surfaces measured along your route.</p>
            {platform === 'uav' && <Slider label="Flight height" value={p.z} min={3} max={40} step={1} unit=" m" onChange={setPlatform} />}
          </Section>
          <Section title="Route">
            <p className="hint">Add at least two waypoints in the scene or plan. The scanner follows your route. For loop closure, place at least three corners and use Close route to add a return waypoint at the start.</p>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm variant={tool ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => setTool((v) => !v)} testId="add-waypoints-tool">{tool ? 'Click to add waypoints…' : 'Add waypoints'}</Btn>
              <Btn sm onClick={() => { setRoute(closeRoute(wps)); setP({ loopClosure: true }); }} disabled={wps.length < 3 || routeIsClosed(wps)} testId="close-route">Close route</Btn>
              <Btn sm icon={<Trash2 size={15} />} onClick={() => setRoute([])} disabled={!wps.length} testId="clear-waypoints">Clear ({wps.length})</Btn>
            </div>
            {wps.length > 0 && <ol style={{ margin: 0, paddingLeft: '1.3rem', display: 'grid', gap: 2 }}>{wps.map(([x, y], i) => (
              <li key={i} className="mono" style={{ fontSize: '0.875rem' }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>{x.toFixed(1)}, {y.toFixed(1)}</span>
                <button className="btn sm" style={{ padding: '2px 6px', minHeight: 0 }} title={`Remove waypoint ${i + 1}`} aria-label={`Remove waypoint ${i + 1}`} data-testid={`wp-remove-${i}`} onClick={() => setRoute(useLab.getState().waypoints.filter((_, j) => j !== i))}><X size={13} /></button></span></li>
            ))}</ol>}
            <Plan2D scene={scene} height={200} onClick={(x, y) => tool && s.interaction === 'add-waypoint' && addWp(x, y)} layers={{ paths: wps.length > 1 ? [{ pts: wps, color: '#ff9f0a', dashed: true }] : [], markers: wps.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: `${i + 1}` })) }} />
          </Section>
          <Callout kind="warn" title="Teaching approximation">
            Scans are aligned with ICP along your route. Loop closure matches the final and first scans and distributes the correction along the trajectory. This is a teaching approximation of a SLAM back-end.
          </Callout>
          <Section title="Mapping">
            <Slider label="Scans along the route" value={p.steps} min={20} max={80} step={2} onChange={(steps) => { invalidate(); setP({ steps }); }} />
            <Toggle label="Apply loop closure" checked={p.loopClosure} onChange={(loopClosure) => { invalidate(); setP({ loopClosure }); }} hint="Revisit the start using Close route, then run the simulation to compare both outputs." />
          </Section>
          <Section title="Run">
            <div className="btn-row">
              <Btn variant="primary" icon={<Play size={16} />} onClick={() => runSlam()} busy={busy} disabled={wps.length < 2} testId="run-slam">Run SLAM simulation</Btn>
              <Btn icon={<RotateCcw size={16} />} onClick={() => { s.patch({ slam: null }); s.setCloud('slam-map', null); }} disabled={!slam}>Clear</Btn>
            </div>
          </Section>
          {slam && <Section title="Final output">
            <Seg label="Loop closure output" value={output} onChange={(v) => { setOutput(v); s.setCloud('slam-map', v === 'after' ? slam.maps.corrected : slam.maps.est, true); }} options={[{ value: 'before', label: 'Without loop closure' }, { value: 'after', label: 'With loop closure', disabled: !slam.corrected }]} />
            {!slam.corrected && <p className="hint">{slam.closure ? 'The first and last scans did not match well enough. Return closer to the start and try again.' : 'Enable Apply loop closure and run again to produce the corrected output.'}</p>}
            <Toggle label="Ground-truth trajectory (green)" checked={s.slamShow.gt} onChange={(gt) => s.patch({ slamShow: { ...s.slamShow, gt } })} />
          </Section>}
          {slam && (
            <Section title="Results">
              <MiniChart series={[{ name: 'before closure', color: '#ff453a', values: slam.errBefore.map((v) => v * 100) }, ...(slam.errAfter ? [{ name: 'after closure', color: '#0a84ff', values: slam.errAfter.map((v) => v * 100) }] : [])]} yLabel="position error (cm) per step" xLabel="step" />
              <MiniChart series={[{ name: 'scan overlap', color: '#30d158', values: slam.overlap.map((v) => v * 100) }]} yLabel="overlap with previous scan (%)" xLabel="step" />
              {slam.closure && <Callout kind={slam.closure.detected ? 'good' : 'warn'} title="Loop closure"> {slam.closure.detected ? `Detected (fitness ${(slam.closure.fitness * 100).toFixed(0)} %, RMSE ${(slam.closure.rmse * 100).toFixed(1)} cm). Correction applied: ${(slam.closure.correctionTrans * 100).toFixed(1)} cm, ${slam.closure.correctionDeg.toFixed(2)}° spread along the loop.` : 'Last and first scans did not overlap enough to close the loop.'}</Callout>}
              <Plan2D scene={scene} height={220} layers={{ paths: [{ pts: slam.gt.map((q) => [q.x, q.y] as [number, number]), color: '#30d158' }, { pts: slam.est.map((q) => [q.x, q.y] as [number, number]), color: '#ff453a', dashed: true }, ...(slam.corrected ? [{ pts: slam.corrected.map((q) => [q.x, q.y] as [number, number]), color: '#0a84ff' }] : [])] }} />
            </Section>
          )}
        </>
      <Section title="Display">
        <Slider label="Point size" value={s.view.pointSize} min={1} max={10} step={0.5} unit=" px" onChange={(pointSize) => s.setView({ pointSize })} />
        <Slider label="Render budget" value={s.view.renderBudget} min={10000} max={2000000} step={10000} format={fmtN} onChange={(renderBudget) => s.setView({ renderBudget })} />
      </Section>
    </>
  );

  return (
    <TabFrame
      title="SLAM & Mobile Scanning"
      tab={7}
      envIds={['A', 'B', 'D']}
      viewport={viewport}
      controls={controls}
      learn={<SlamLearn slam={slam} busy={busy} onRun={runSlam} onTls={() => { const i = tabIndex('TLS Scanning'); if (i >= 0) s.setTab(i); }} />}
      stats={stats}
      viewExtras={<>
        <Btn sm icon={<Dots size={15} />} variant={!s.view.showScene ? 'primary' : ''} onClick={() => s.setView({ showScene: !s.view.showScene })} testId="points-only">{s.view.showScene ? 'Point cloud' : 'Show scene'}</Btn>
        <ToolbarSlider label="Scene opacity" value={s.view.sceneOpacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(sceneOpacity) => s.setView({ sceneOpacity })} />
      </>}
      overlays={<KindLegend items={[{ color: '#30d158', label: 'Ground-truth trajectory' }, { color: '#ff453a', label: 'Estimated (drifting)', style: 'dash' }, { color: '#0a84ff', label: 'After loop closure' }]} />}
    />
  );

}
