import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, MiniChart } from './common';
import { PolyLine, CloudLayer, Marker } from '../ui/three';
import { Crosshair, Trash2, X } from '../ui/icons';
import { Play, Wand, RotateCcw } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { transformCloud, PointCloud } from '../core/pointcloud';
import { D2R, R2D, rigidFromEuler, mulR, rotationAngle, rigidApply, Rigid, rigidCompose, Vec3 } from '../core/math';
import { evaluateAlignment } from '../registration/icp';
import { makeRng } from '../core/rng';
import { Plan2D } from '../ui/Plan2D';
import { SlamGuidePanel, SlamGuideScene } from '../guide/SlamGuide';
import { useSlamGuide } from '../guide/store';
import { tabIndex } from './nav';

const SLAM_SENSOR: SensorConfig = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), hRes: 2, channels: 5, vMin: -20, vMax: 20, maxRange: 60, noise: 0.005, minRange: 0.3 };
const REG_SENSOR: SensorConfig = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 1, noise: 0.003 };

const errTransform = (r: ReturnType<typeof useLab.getState>['reg']): Rigid => rigidFromEuler(r.errT[0], r.errT[1], r.errT[2], r.errYawDeg * D2R, r.errPitchDeg * D2R, r.errRollDeg * D2R);

/** The lesson lives in the Learn tab of the side panel: opening the tab starts it, leaving it closes it. */
function SlamLearn({ slam, busy, onRun, onTls }: { slam: ReturnType<typeof useLab.getState>['slam']; busy: boolean; onRun: (o?: Record<string, number | boolean>) => void; onTls: () => void }) {
  useEffect(() => { useSlamGuide.getState().start(); if (!useLab.getState().slam) onRun({ loopClosure: true }); return () => useSlamGuide.getState().close(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const on = useSlamGuide((g) => g.on);
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
  useEffect(() => { s.patch({ interaction: tool && !guideOn ? 'add-waypoint' : 'select' }); return () => { useLab.getState().patch({ interaction: 'select' }); }; }, [tool, guideOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const wps = s.waypoints;
  const addWp = (x: number, y: number) => s.patch({ waypoints: [...useLab.getState().waypoints, [x, y]] });
  async function runSlam(over: Partial<typeof p> = {}) {
    setBusy(true);
    try {
      const params = { ...p, ...over, waypoints: s.waypoints.length >= 3 ? s.waypoints : undefined };
      if (Object.keys(over).length) s.patch({ slamParams: { ...p, ...over } });
      const r = await runTask('slam', { scene, sensor: SLAM_SENSOR, params });
      s.patch({ slam: r });
      s.setCloud('slam-map', r.maps.corrected ?? r.maps.est, true);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ------------------------------------------------ viewport
  const z = p.z;
  const path = (poses: { x: number; y: number }[] | null | undefined, h = z): Vec3[] => (poses ?? []).map((q) => [q.x, q.y, h]);
  const flat = (c: [number, number, number]) => ({ flat: c });
  const showMap = (c: PointCloud | null | undefined, rgb: [number, number, number], on: boolean) => (c && on ? <CloudLayer cloud={c} mode="flat" colorOpts={flat(rgb)} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} /> : null);

  const slamView = (
    <>
      <SceneFromStore interactive={false} />
      {guideOn && slam && <SlamGuideScene slam={slam} z={z} sensor={SLAM_SENSOR} pointSize={s.view.pointSize} />}
      {!guideOn && wps.length > 0 && <>
        {wps.length > 1 && <PolyLine pts={[...wps, ...(wps.length > 2 ? [wps[0]] : [])].map(([x, y]) => [x, y, 0.3] as Vec3)} color="#ff9f0a" width={3} dashed />}
        {wps.map(([x, y], i) => <Marker key={i} p={[x, y, 0.3]} color="#ff9f0a" r={0.5} label={`${i + 1}`} />)}
      </>}
      {slam && !guideOn && (
        <>
          {showMap(slam.maps.gt, [140, 150, 170], s.slamShow.mapGt)}
          {showMap(slam.maps.est, [255, 159, 10], s.slamShow.mapEst)}
          {showMap(slam.maps.corrected, [48, 209, 88], s.slamShow.mapCorr)}
          {s.slamShow.gt && <PolyLine pts={path(slam.gt)} color="#30d158" width={3} />}
          {s.slamShow.est && <PolyLine pts={path(slam.est)} color="#ff453a" width={3} dashed />}
          {s.slamShow.corrected && slam.corrected && <PolyLine pts={path(slam.corrected)} color="#0a84ff" width={3} />}
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
          <Section title="Route">
            <p className="hint">Click corners of a route in the scene or on the plan. The robot drives round them and back to the start. With fewer than 3 corners it drives a ready-made loop.</p>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm variant={tool ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => setTool((v) => !v)} testId="add-waypoints-tool">{tool ? 'Click to add waypoints…' : 'Add waypoints'}</Btn>
              <Btn sm onClick={() => s.patch({ waypoints: [[-14, 0], [14, 0], [14, 24], [-14, 24]] })}>Loop preset</Btn>
              <Btn sm icon={<Trash2 size={15} />} onClick={() => s.patch({ waypoints: [] })} disabled={!wps.length} testId="clear-waypoints">Clear ({wps.length})</Btn>
            </div>
            {wps.length > 0 && <ol style={{ margin: 0, paddingLeft: '1.3rem', display: 'grid', gap: 2 }}>{wps.map(([x, y], i) => (
              <li key={i} className="mono" style={{ fontSize: '0.875rem' }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span>{x.toFixed(1)}, {y.toFixed(1)}</span>
                <button className="btn sm" style={{ padding: '2px 6px', minHeight: 0 }} title={`Remove waypoint ${i + 1}`} aria-label={`Remove waypoint ${i + 1}`} data-testid={`wp-remove-${i}`} onClick={() => s.patch({ waypoints: useLab.getState().waypoints.filter((_, j) => j !== i) })}><X size={13} /></button></span></li>
            ))}</ol>}
            <Plan2D scene={scene} height={200} onClick={(x, y) => tool && addWp(x, y)} layers={{ paths: wps.length > 1 ? [{ pts: [...wps, ...(wps.length > 2 ? [wps[0]] : [])], color: '#ff9f0a', dashed: true }] : [], markers: wps.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: `${i + 1}` })) }} />
          </Section>
          <Callout kind="warn" title="Teaching approximation">
            The robot follows a known loop. Motion error is <b>injected</b> into the odometry (or ICP scan matching is used). Loop closure here = ICP between the last and first scan + the residual spread along the path. It is <b>not</b> a full pose-graph SLAM back-end, and nothing is prerecorded.
          </Callout>
          <Section title="Odometry">
            <Seg value={p.odom} onChange={(odom) => setP({ odom })} options={[{ value: 'noisy', label: 'Noisy odometry' }, { value: 'icp', label: 'ICP scan matching' }]} label="Odometry source" />
            <p className="hint">{p.odom === 'noisy' ? 'Dead reckoning with the error you set below.' : 'Each step is refined by registering the new scan to the previous one (initialised from the noisy odometry).'}</p>
            <Slider label="Translation noise / step" value={p.transNoise} min={0} max={0.08} step={0.002} unit=" m" format={(v) => v.toFixed(3)} onChange={(transNoise) => setP({ transNoise })} />
            <Slider label="Rotation noise / step" value={p.rotNoiseDeg} min={0} max={2} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(rotNoiseDeg) => setP({ rotNoiseDeg })} />
            <Slider label="Rotation bias / step" value={p.rotBiasDeg} min={-1} max={1} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(rotBiasDeg) => setP({ rotBiasDeg })} hint="A systematic heading error is what makes the path drift away." />
            <Slider label="Distance scale error" value={p.scaleErr * 100} min={-5} max={5} step={0.1} unit=" %" format={(v) => v.toFixed(1)} onChange={(v) => setP({ scaleErr: v / 100 })} />
            <Slider label="Steps in the loop" value={p.steps} min={20} max={80} step={2} onChange={(steps) => setP({ steps })} />
            <NumberField label="Random seed" value={p.seed} step={1} onChange={(seed) => setP({ seed: Math.round(seed) || 0 })} />
            <Toggle label="Loop closure (teaching approximation)" checked={p.loopClosure} onChange={(loopClosure) => setP({ loopClosure })} />
          </Section>
          <Section title="Run">
            <div className="btn-row">
              <Btn variant="primary" icon={<Play size={16} />} onClick={() => runSlam()} busy={busy} testId="run-slam">Run SLAM simulation</Btn>
              <Btn icon={<RotateCcw size={16} />} onClick={() => { s.patch({ slam: null }); s.setCloud('slam-map', null); }} disabled={!slam}>Clear</Btn>
            </div>
          </Section>
          <Section title="Layers">
            <Toggle label="Ground-truth trajectory (green)" checked={s.slamShow.gt} onChange={(gt) => s.patch({ slamShow: { ...s.slamShow, gt } })} />
            <Toggle label="Estimated trajectory (red)" checked={s.slamShow.est} onChange={(est) => s.patch({ slamShow: { ...s.slamShow, est } })} />
            <Toggle label="Corrected trajectory (blue)" checked={s.slamShow.corrected} onChange={(corrected) => s.patch({ slamShow: { ...s.slamShow, corrected } })} />
            <Toggle label="Map from estimated poses (orange)" checked={s.slamShow.mapEst} onChange={(mapEst) => s.patch({ slamShow: { ...s.slamShow, mapEst } })} />
            <Toggle label="Map after loop closure (green)" checked={s.slamShow.mapCorr} onChange={(mapCorr) => s.patch({ slamShow: { ...s.slamShow, mapCorr } })} />
            <Toggle label="Map from true poses (grey)" checked={s.slamShow.mapGt} onChange={(mapGt) => s.patch({ slamShow: { ...s.slamShow, mapGt } })} />
          </Section>
          {slam && (
            <Section title="Results">
              <MiniChart series={[{ name: 'before closure', color: '#ff453a', values: slam.errBefore.map((v) => v * 100) }, ...(slam.errAfter ? [{ name: 'after closure', color: '#0a84ff', values: slam.errAfter.map((v) => v * 100) }] : [])]} yLabel="position error (cm) per step" xLabel="step" />
              <MiniChart series={[{ name: 'scan overlap', color: '#30d158', values: slam.overlap.map((v) => v * 100) }]} yLabel="overlap with previous scan (%)" xLabel="step" />
              {slam.closure && <Callout kind={slam.closure.detected ? 'good' : 'warn'} title="Loop closure"> {slam.closure.detected ? `Detected (fitness ${(slam.closure.fitness * 100).toFixed(0)} %, RMSE ${(slam.closure.rmse * 100).toFixed(1)} cm). Correction applied: ${(slam.closure.correctionTrans * 100).toFixed(1)} cm, ${slam.closure.correctionDeg.toFixed(2)}° spread along the loop.` : 'Last and first scans did not overlap enough to close the loop.'}</Callout>}
              <Plan2D scene={scene} height={220} layers={{ paths: [{ pts: slam.gt.map((q) => [q.x, q.y] as [number, number]), color: '#30d158' }, { pts: slam.est.map((q) => [q.x, q.y] as [number, number]), color: '#ff453a', dashed: true }, ...(slam.corrected ? [{ pts: slam.corrected.map((q) => [q.x, q.y] as [number, number]), color: '#0a84ff' }] : [])] }} />
            </Section>
          )}
        </>
      <DisplaySection />
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
      overlays={<KindLegend items={[{ color: '#30d158', label: 'Ground-truth trajectory' }, { color: '#ff453a', label: 'Estimated (drifting)', style: 'dash' }, { color: '#0a84ff', label: 'After loop closure' }]} />}
    />
  );
  void mulR; void SLAM_SENSOR;
}
