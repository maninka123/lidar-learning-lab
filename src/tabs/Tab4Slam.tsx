import { useEffect, useMemo, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Eq, NumberField, Section, Seg, Slider, Toggle, fmtN } from '../ui/controls';
import { DisplaySection, KindLegend } from '../ui/shared';
import { SceneFromStore, MiniChart } from './common';
import { PolyLine, CloudLayer, Marker } from '../ui/three';
import { Play, Wand, RotateCcw } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { transformCloud, PointCloud } from '../core/pointcloud';
import { D2R, R2D, rigidFromEuler, mulR, rotationAngle, rigidApply, Rigid, rigidCompose, Vec3 } from '../core/math';
import { evaluateAlignment } from '../registration/icp';
import { makeRng } from '../core/rng';
import { Plan2D } from '../ui/Plan2D';

const SLAM_SENSOR: SensorConfig = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), hRes: 2, channels: 5, vMin: -20, vMax: 20, maxRange: 30, noise: 0.005, minRange: 0.3 };
const REG_SENSOR: SensorConfig = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 1, noise: 0.003 };

const errTransform = (r: ReturnType<typeof useLab.getState>['reg']): Rigid => rigidFromEuler(r.errT[0], r.errT[1], r.errT[2], r.errYawDeg * D2R, r.errPitchDeg * D2R, r.errRollDeg * D2R);

export default function Tab4() {
  const s = useLab();
  const scene = getScene(s.sceneId);
  const [mode, setMode] = useState<'slam' | 'reg'>('slam');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'before' | 'after' | 'both'>('both');
  const p = s.slamParams;
  const slam = s.slam;
  const reg = s.reg;
  const setP = (patch: Partial<typeof p>) => s.patch({ slamParams: { ...p, ...patch } });
  const setReg = (patch: Partial<typeof reg>) => s.patch({ reg: { ...useLab.getState().reg, ...patch } });

  async function runSlam() {
    setBusy(true);
    try {
      const r = await runTask('slam', { scene, sensor: SLAM_SENSOR, params: p });
      s.patch({ slam: r });
      s.setCloud('slam-map', r.maps.corrected ?? r.maps.est, true);
    } catch (e) { s.notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ------------------------------------------------ registration lab
  async function makeScans() {
    setBusy(true);
    try {
      const base = useLab.getState().pose;
      const [A, B] = await Promise.all([
        runTask('scan', { scene, sensor: REG_SENSOR, trajectory: staticPose(base.x, base.y, base.z, base.yaw), sweeps: 1, seed: 11, maxRays: 60000, distortion: false, scanId: 1, name: 'Scan A (reference)' }),
        runTask('scan', { scene, sensor: REG_SENSOR, trajectory: staticPose(base.x + reg.offset, base.y + reg.offset * 0.5, base.z, base.yaw + 0.1), sweeps: 1, seed: 12, maxRays: 60000, distortion: false, scanId: 2, name: 'Scan B (true pose)' }),
      ]);
      setReg({ A: A.cloud, B: B.cloud, result: null, before: null, after: null, recoveredErr: null, iter: 0, applied: null });
    } finally { setBusy(false); }
  }

  const Bmis = useMemo(() => (reg.B ? transformCloud(reg.B, errTransform(reg), 'Scan B (misaligned)') : null), [reg.B, reg.errT, reg.errYawDeg, reg.errPitchDeg, reg.errRollDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => {
    if (!reg.A || !Bmis) return null;
    return evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, rigidFromEuler(0, 0, 0, 0, 0, 0), 1.5, 3000);
  }, [reg.A, Bmis]);

  async function runIcp() {
    if (!reg.A || !Bmis) return;
    setBusy(true);
    try {
      const before = evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, rigidFromEuler(0, 0, 0, 0, 0, 0), 1.5, 3000);
      const r = await runTask('icp', { src: Bmis.positions, nSrc: Bmis.count, dst: reg.A.positions, nDst: reg.A.count, opts: { maxIterations: reg.icp.maxIterations, tolerance: 1e-6, maxCorrDist: reg.icp.maxCorrDist, sampleMax: reg.icp.sample } });
      const after = evaluateAlignment(Bmis.positions, Bmis.count, reg.A.positions, reg.A.count, r.T, 1.5, 3000);
      // truth: T ∘ E should be identity
      const total = rigidCompose(r.T, errTransform(reg));
      const c: Vec3 = [reg.B!.positions[0], reg.B!.positions[1], reg.B!.positions[2]];
      const pc = rigidApply(total, c);
      setReg({ result: r, before, after, iter: r.history.length - 1, recoveredErr: { t: Math.hypot(pc[0] - c[0], pc[1] - c[1], pc[2] - c[2]), deg: rotationAngle(total.R) * R2D } });
    } finally { setBusy(false); }
  }

  const iterIdx = reg.result ? Math.min(reg.iter, reg.result.history.length - 1) : 0;
  const Bafter = useMemo(() => (reg.result && Bmis ? transformCloud(Bmis, iterIdx >= reg.result.history.length - 1 ? reg.result.T : reg.result.history[iterIdx].T, 'Scan B (ICP aligned)') : null), [reg.result, Bmis, iterIdx]);

  useEffect(() => { if (mode === 'reg' && !reg.A && !busy) void makeScans(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------ viewport
  const z = p.z;
  const path = (poses: { x: number; y: number }[] | null | undefined, h = z): Vec3[] => (poses ?? []).map((q) => [q.x, q.y, h]);
  const flat = (c: [number, number, number]) => ({ flat: c });
  const showMap = (c: PointCloud | null | undefined, rgb: [number, number, number], on: boolean) => (c && on ? <CloudLayer cloud={c} mode="flat" colorOpts={flat(rgb)} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} /> : null);

  const slamView = (
    <>
      <SceneFromStore interactive={false} />
      {slam && (
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
  const regView = (
    <>
      <SceneFromStore interactive={false} />
      {reg.A && <CloudLayer cloud={reg.A} mode="flat" colorOpts={flat([10, 132, 255])} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />}
      {Bmis && (view !== 'after' || !Bafter) && <CloudLayer cloud={Bmis} mode="flat" colorOpts={flat([255, 159, 10])} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />}
      {Bafter && view !== 'before' && <CloudLayer cloud={Bafter} mode="flat" colorOpts={flat([48, 209, 88])} size={s.view.pointSize} budget={s.view.renderBudget} pickable={false} />}
    </>
  );

  const viewport = <Viewport home={scene.cameraHome} target={scene.cameraTarget}>{mode === 'slam' ? slamView : regView}</Viewport>;

  const stats = mode === 'slam'
    ? [
      { k: 'ATE (before)', v: slam ? `${(slam.ateBefore * 100).toFixed(1)} cm` : '—', s: 'RMS position error of estimate' },
      { k: 'ATE (after)', v: slam?.ateAfter != null ? `${(slam.ateAfter * 100).toFixed(1)} cm` : '—', s: slam?.closure ? (slam.closure.detected ? 'loop closure applied' : 'closure not detected') : 'closure off' },
      { k: 'Final drift', v: slam ? `${(slam.finalDriftBefore * 100).toFixed(1)} cm` : '—', s: slam?.finalDriftAfter != null ? `→ ${(slam.finalDriftAfter * 100).toFixed(1)} cm` : undefined },
      { k: 'Mean scan overlap', v: slam ? `${((100 * slam.overlap.reduce((a, v) => a + v, 0)) / slam.overlap.length).toFixed(0)} %` : '—', s: 'ICP inlier fraction' },
    ]
    : [
      { k: 'RMSE before', v: reg.before ? `${(reg.before.rmse * 100).toFixed(2)} cm` : live ? `${(live.rmse * 100).toFixed(2)} cm` : '—', s: reg.before ? 'at ICP start' : 'live (sliders)' },
      { k: 'RMSE after', v: reg.after ? `${(reg.after.rmse * 100).toFixed(2)} cm` : '—' },
      { k: 'Fitness', v: reg.after ? `${(reg.after.fitness * 100).toFixed(0)} %` : live ? `${(live.fitness * 100).toFixed(0)} %` : '—', s: 'inliers within 1.5 m' },
      { k: 'Pose error vs truth', v: reg.recoveredErr ? `${(reg.recoveredErr.t * 100).toFixed(1)} cm · ${reg.recoveredErr.deg.toFixed(2)}°` : '—' },
    ];

  const sliderTrans = (k: 0 | 1 | 2, label: string) => <Slider key={label} label={label} value={reg.errT[k]} min={-1} max={1} step={0.01} unit=" m" format={(v) => v.toFixed(2)} onChange={(v) => { const e = [...reg.errT] as [number, number, number]; e[k] = v; setReg({ errT: e, result: null, after: null, recoveredErr: null }); }} />;

  const controls = (
    <>
      <Seg value={mode} onChange={setMode} options={[{ value: 'slam', label: 'SLAM drift & loop closure' }, { value: 'reg', label: 'Registration (ICP)' }]} label="Lab" />
      {mode === 'slam' ? (
        <>
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
              <Btn variant="primary" icon={<Play size={16} />} onClick={runSlam} busy={busy} testId="run-slam">Run SLAM simulation</Btn>
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
      ) : (
        <>
          <Section title="1 · Scans">
            <Slider label="Sensor offset between scans" value={reg.offset} min={0} max={2} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(offset) => setReg({ offset })} hint="Scan B is taken from a displaced pose, so the overlap is partial." />
            <Btn onClick={makeScans} busy={busy} testId="make-scans">Generate scans A and B</Btn>
            <p className="hint">A (blue) is the reference. B (orange) starts perfectly aligned, then gets the rigid error below.</p>
          </Section>
          <Section title="2 · Rigid error on scan B (manual controls)">
            {sliderTrans(0, 'Translate X')}
            {sliderTrans(1, 'Translate Y')}
            {sliderTrans(2, 'Translate Z')}
            <Slider label="Yaw" value={reg.errYawDeg} min={-20} max={20} step={0.25} unit="°" onChange={(v) => setReg({ errYawDeg: v, result: null, after: null, recoveredErr: null })} />
            <Slider label="Pitch" value={reg.errPitchDeg} min={-10} max={10} step={0.25} unit="°" onChange={(v) => setReg({ errPitchDeg: v, result: null, after: null, recoveredErr: null })} />
            <Slider label="Roll" value={reg.errRollDeg} min={-10} max={10} step={0.25} unit="°" onChange={(v) => setReg({ errRollDeg: v, result: null, after: null, recoveredErr: null })} />
            <div className="btn-row">
              <Btn sm icon={<Wand size={15} />} onClick={() => { const r = makeRng(Date.now() & 0xffff); setReg({ errT: [r.range(-0.5, 0.5), r.range(-0.5, 0.5), r.range(-0.1, 0.1)], errYawDeg: r.range(-8, 8), errPitchDeg: r.range(-2, 2), errRollDeg: r.range(-2, 2), result: null, after: null }); }}>Random error</Btn>
              <Btn sm onClick={() => setReg({ errT: [0, 0, 0], errYawDeg: 0, errPitchDeg: 0, errRollDeg: 0, result: null, after: null })}>Zero (perfect)</Btn>
            </div>
            <p className="hint">Try aligning by eye first: drive the sliders back to zero and watch the live RMSE.</p>
          </Section>
          <Section title="3 · Point-to-point ICP">
            <Slider label="Max iterations" value={reg.icp.maxIterations} min={5} max={150} step={5} onChange={(maxIterations) => setReg({ icp: { ...reg.icp, maxIterations } })} />
            <Slider label="Max correspondence distance" value={reg.icp.maxCorrDist} min={0.1} max={3} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(maxCorrDist) => setReg({ icp: { ...reg.icp, maxCorrDist } })} hint="Too small: ICP cannot see the error. Too large: wrong matches pull the result off." />
            <Slider label="Points used" value={reg.icp.sample} min={500} max={8000} step={500} format={fmtN} onChange={(sample) => setReg({ icp: { ...reg.icp, sample } })} />
            <Btn variant="primary" icon={<Play size={16} />} onClick={runIcp} busy={busy} disabled={!reg.A} testId="run-icp">Run ICP</Btn>
          </Section>
          {reg.result && (
            <Section title="Result">
              <Seg value={view} onChange={setView} options={[{ value: 'before', label: 'Before' }, { value: 'both', label: 'Overlay' }, { value: 'after', label: 'After' }]} />
              <Slider label="Iteration" value={iterIdx} min={0} max={reg.result.history.length - 1} step={1} onChange={(iter) => setReg({ iter })} format={(v) => `${v + 1} / ${reg.result!.history.length}`} />
              <MiniChart series={[{ name: 'RMSE (cm)', color: '#ff9f0a', values: reg.result.history.map((h) => h.rmse * 100) }]} yLabel="convergence error" xLabel="iteration" />
              <table className="table"><tbody>
                <tr><td>RMSE</td><td className="mono">{(reg.before!.rmse * 100).toFixed(2)} → {(reg.after!.rmse * 100).toFixed(2)} cm</td></tr>
                <tr><td>Fitness</td><td className="mono">{(reg.before!.fitness * 100).toFixed(0)} → {(reg.after!.fitness * 100).toFixed(0)} %</td></tr>
                <tr><td>Pose error vs truth</td><td className="mono">{(reg.recoveredErr!.t * 100).toFixed(1)} cm · {reg.recoveredErr!.deg.toFixed(2)}°</td></tr>
                <tr><td>Converged</td><td>{reg.result.converged ? 'yes' : 'iteration limit'}</td></tr>
              </tbody></table>
            </Section>
          )}
        </>
      )}
      <DisplaySection />
    </>
  );

  const learn = (
    <>
      <Callout kind="edu" title="Why drift happens">Each step adds a small error. Because the next pose is built on the previous one, errors accumulate — a tiny heading bias bends the whole trajectory.</Callout>
      <Callout kind="edu" title="ICP in four lines">Match every source point to its nearest target point, solve the best rigid transform for those pairs, apply it, repeat until the error stops falling.</Callout>
      <Eq note="minimise the sum of squared point-pair distances">min<sub>R,t</sub> Σ ‖ R pᵢ + t − qᵢ ‖²</Eq>
      <Eq note="RMSE over the n matched pairs">RMSE = √( (1/n) Σ ‖ R pᵢ + t − qᵢ ‖² )</Eq>
      <Callout title="Fitness">Fraction of source points with a neighbour inside the correspondence distance — a proxy for overlap.</Callout>
      <Callout kind="warn" title="Limits">ICP needs a decent starting pose and overlap. In long flat corridors or featureless walls it can slide along the surface.</Callout>
    </>
  );

  return (
    <TabFrame
      title="SLAM & Registration"
      tab={5}
      viewport={viewport}
      controls={controls}
      learn={learn}
      stats={stats}
      overlays={<KindLegend items={mode === 'slam' ? [{ color: '#30d158', label: 'Ground-truth trajectory' }, { color: '#ff453a', label: 'Estimated (drifting)', style: 'dash' }, { color: '#0a84ff', label: 'After loop closure' }] : [{ color: '#0a84ff', label: 'Scan A (reference)' }, { color: '#ff9f0a', label: 'Scan B (misaligned)' }, { color: '#30d158', label: 'Scan B after ICP' }]} />}
    />
  );
  void mulR; void SLAM_SENSOR;
}
