import { useLab } from '../state/store';
import { PolyLine, Marker, SensorMarker, CloudLayer } from '../ui/three';
import { Btn, Section } from '../ui/controls';
import { ConvergenceChart, GuideClock, GuideNote, GuidePanel, GuideStep } from '../ui/Guide';
import { Segments } from './three';
import { useSlamGuide } from './store';
import { correctionAt, driftAt, poseAtFrame, relativeMotion, trailTo } from './replay';
import type { SlamResult, Pose2 } from '../registration/slam';
import type { SensorConfig } from '../sensor/presets';
import type { Vec3 } from '../core/math';

const GREEN = '#30d158', RED = '#ff453a', BLUE = '#0a84ff', ORANGE = '#ff9f0a';
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const DUR = [3000, 6000, 2500, 2200, 3200, 6000];
const SHOWN_FIRST = 6; // step 1 shows the first few consecutive scans

/** Frame position (0..n-1, fractional) the playhead is at for the current step. */
export function frameFor(step: number, progress: number, n: number, hold = false): number {
  if (step === 0) return progress * Math.min(SHOWN_FIRST, n - 1);
  if (step === 1 || (step === 2 && hold)) return progress * (n - 1);
  return n - 1;
}
const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

const pth = (q: { x: number; y: number }[], z: number): Vec3[] => q.map((p) => [p.x, p.y, z]);
const head = (q: Pose2, z: number, L = 1.4): Vec3[] => [[q.x, q.y, z], [q.x + Math.cos(q.yaw) * L, q.y + Math.sin(q.yaw) * L, z]];

export function SlamGuideScene({ slam, z, sensor, pointSize }: { slam: SlamResult; z: number; sensor: SensorConfig; pointSize: number }) {
  const g = useSlamGuide(), n = slam.gt.length, f = frameFor(g.step, g.progress, n, g.hold), a = g.step === 4 ? ease(g.progress) : 0;
  const gtNow = poseAtFrame(slam.gt, f), estNow = poseAtFrame(slam.est, f);
  const showGt = g.showGt, showCorr = g.showCorrected && !!slam.corrected;
  const corr = g.step >= 4 && slam.corrected ? correctionAt(slam, g.step === 4 ? a : 1) : null;
  const idx = Array.from({ length: 7 }, (_, i) => Math.round((i * (n - 1)) / 6));
  const first = Math.min(SHOWN_FIRST, n - 1);
  return (
    <>
      {g.step === 5 && <CloudLayer cloud={slam.maps.corrected ?? slam.maps.est} mode="flat" colorOpts={{ flat: slam.maps.corrected ? [48, 209, 88] : [255, 159, 10] }} size={pointSize} budget={120000} pickable={false} />}
      {showGt && <PolyLine pts={pth(g.step <= 1 || (g.step === 2 && g.hold) ? trailTo(slam.gt, f) : slam.gt, z)} color={GREEN} width={3} />}
      {g.step === 0 && Array.from({ length: first + 1 }, (_, i) => i).filter((i) => i <= f + 0.01).map((i) => <Marker key={i} p={[slam.est[i].x, slam.est[i].y, z]} color={RED} r={0.22} label={`pose ${i}`} />)}
      {g.step === 0 && <PolyLine pts={pth(trailTo(slam.est, f), z)} color={RED} width={3} dashed />}
      {g.step >= 1 && g.step <= 3 && <PolyLine pts={pth(g.step === 1 ? trailTo(slam.est, f) : slam.est, z)} color={RED} width={3} dashed />}
      {g.step >= 4 && <PolyLine pts={pth(slam.est, z)} color={RED} width={2} dashed />}
      {corr && showCorr && <PolyLine pts={pth(corr, z)} color={BLUE} width={4} />}
      {g.step <= 2 && <SensorMarker x={gtNow.x} y={gtNow.y} z={z} yaw={gtNow.yaw} sensor={sensor} color={GREEN} showFov={g.step === 0} label={g.step === 0 ? 'LiDAR' : undefined} />}
      {g.step >= 1 && g.step <= 2 && g.showLines && <Segments pts={[[[gtNow.x, gtNow.y, z], [estNow.x, estNow.y, z]]]} color={ORANGE} opacity={1} />}
      {g.step >= 1 && g.step <= 2 && <Marker p={[estNow.x, estNow.y, z]} color={RED} r={0.25} />}
      {g.step === 2 && idx.map((i, j) => <group key={j}><PolyLine pts={head(slam.gt[i], z)} color={GREEN} width={2} /><PolyLine pts={head(slam.est[i], z)} color={RED} width={2} /></group>)}
      {g.step === 3 && (
        <>
          <SensorMarker x={slam.est[n - 1].x} y={slam.est[n - 1].y} z={z} yaw={slam.est[n - 1].yaw} sensor={sensor} color={RED} label="now" showFov={false} />
          <SensorMarker x={slam.est[0].x} y={slam.est[0].y} z={z} yaw={slam.est[0].yaw} sensor={sensor} color={BLUE} label="seen before" showFov={false} />
          <PolyLine pts={[[slam.est[n - 1].x, slam.est[n - 1].y, z], [slam.est[0].x, slam.est[0].y, z]]} color={ORANGE} width={Math.max(1, 5 * g.progress)} dashed />
        </>
      )}
      {g.step >= 4 && showGt && <Marker p={[slam.gt[n - 1].x, slam.gt[n - 1].y, z]} color={GREEN} r={0.2} />}
      {g.step === 4 && <Marker p={[slam.est[n - 1].x, slam.est[n - 1].y, z]} color={RED} r={0.2} />}
    </>
  );
}

const PIPE = ['Sensor measurements', 'Relative motion (scan matching)', 'Pose estimate', 'Map building', 'Loop-closure detection', 'Global correction'];

export function SlamGuidePanel({ slam, busy, onRun, onRunWith, openTls }: {
  slam: SlamResult | null; busy: boolean; onRun: () => void; onRunWith: (o: Record<string, number | boolean>) => void; openTls?: () => void;
}) {
  const g = useSlamGuide(), n = slam?.gt.length ?? 0, f = slam ? frameFor(g.step, g.progress, n, g.hold) : 0;
  const steps: GuideStep[] = [
    { title: 'From registration to movement', text: <>Last lesson we aligned two scans. Now the LiDAR <b>moves</b> and takes a scan at every pose. Registering each scan to the one before gives a small <b>relative move</b>. Chain these moves and you get a <b>trajectory</b>.</>, tech: 'pose k = pose k−1 ∘ (relative move k). Errors in each relative move are carried into every later pose.' },
    { title: 'Why this is not enough', text: <><span style={{ color: GREEN }}>Green</span> is where the sensor really was. <span style={{ color: RED }}>Red</span> is what chaining the moves says. Each step is almost right, but the small errors <b>add up</b>.</>, tech: 'Local registration only checks neighbouring scans. Nothing ties the far end of the path back to the start.' },
    { title: 'Understanding drift', text: <>The orange line is the gap between truth and estimate. A tiny <b>turning</b> error at the start swings every later position sideways, so the gap grows. Drag the timeline, or change the error below.</>, tech: 'Position error ≈ distance travelled × heading error (small angles). Your noise and bias settings change it; it is not the same for every path or place.' },
    { title: 'Seeing a place again', text: <>Back at the start, the scan looks like the very first one. This is a <b>loop-closure candidate</b>: two poses far apart in time that saw the same place. It must be <b>checked</b> by registering the two scans, or a look-alike place could ruin the map.</>, tech: 'Real systems use place recognition, then geometric verification (registration fitness) before accepting the constraint.' },
    { title: 'Closing the loop', text: <>The check says: “this pose should be right next to the start”. The estimate is pulled into line. <span style={{ color: BLUE }}>Blue</span> is the corrected path.</>, tech: <>Here: the gap is spread <b>linearly</b> along the path (a teaching shortcut). Real SLAM uses <b>pose-graph optimisation</b>: every pose is a node, every measurement a constraint, and a solver finds the poses that best fit all constraints at once.</> },
    { title: 'The whole picture', text: <>SLAM is more than registration. It chains <b>measurement → motion → pose → map</b>, and it adds <b>loop closure</b> to keep the whole map consistent. Methods mix these parts differently.</>, tech: 'This simulator has all six parts, but the last one is simplified: no pose-graph optimiser, no place-recognition search.' },
  ];
  const drift = slam ? driftAt(slam, f) : null;
  const hasClosure = !!slam?.corrected;
  const pipeAt = g.step === 5 ? Math.min(PIPE.length - 1, Math.floor(g.progress * PIPE.length)) : -1;
  const frameSlider = slam && (g.step === 1 || g.step === 2) && (
    <label style={{ display: 'grid', gap: 2 }}><span className="caption">Timeline · pose {Math.round(f)} of {n - 1}</span>
      <input type="range" min={0} max={n - 1} step={1} value={Math.round(f)} onChange={(e) => useSlamGuide.getState().scrub(Number(e.target.value) / (n - 1))} data-testid="slam-guide-timeline" aria-label="Timeline" /></label>
  );
  if (!slam) return (
    <div style={{ display: 'grid', gap: 8 }}>
      <GuideNote title="Run the simulation first">The lesson replays the real simulation result. Press the button to run it.</GuideNote>
      <Btn variant="primary" onClick={onRun} busy={busy} testId="guide-run-slam">Run the simulation</Btn><Btn sm onClick={g.close}>Close</Btn>
      <GuideClock store={useSlamGuide} dur={() => 1} onDone={() => undefined} />
    </div>
  );
  return (
    <>
      <GuidePanel store={useSlamGuide} testId="slam-guide" title="How SLAM works" steps={steps} toggles={[{ label: 'Show ground truth (green)', key: 'showGt' }, { label: 'Show drift (orange gap)', key: 'showLines' }, { label: 'Show corrected path (blue)', key: 'showCorrected' }]}>
        {frameSlider}
        {g.step === 0 && f >= 1 && (() => { const k = Math.min(n - 1, Math.max(1, Math.round(f))), m = relativeMotion(slam.est[k - 1], slam.est[k]); return <div className="caption mono" data-testid="slam-guide-rel">Move {k - 1}→{k}: forward {m.x.toFixed(2)} m, side {m.y.toFixed(2)} m, turn {((m.yaw * 180) / Math.PI).toFixed(1)}°</div>; })()}
        {(g.step === 1 || g.step === 2) && <ConvergenceChart testId="slam-guide-chart" values={slam.errBefore.map((v) => v * 100)} current={Math.floor(f)} reveal label="pose number" unit="cm position error" color={RED} />}
        {g.step === 2 && drift && <div className="caption" data-testid="slam-guide-drift">At pose {Math.round(f)}: position off by <b>{cm(drift.pos)}</b>, heading off by <b>{drift.headingDeg.toFixed(1)}°</b>.</div>}
        {g.step === 3 && (hasClosure || slam.closure ? <div className="caption" data-testid="slam-guide-verify">Check: registering the last scan to the first gives an overlap of <b>{((slam.closure?.fitness ?? 0) * 100).toFixed(0)} %</b> → {slam.closure?.detected ? 'accepted as a loop closure.' : 'rejected (too little overlap).'}</div> : <GuideNote kind="warn" title="Loop closure is off">Turn it on to see the check.</GuideNote>)}
        {g.step === 4 && hasClosure && <div className="caption" data-testid="slam-guide-ate">Final drift {cm(slam.finalDriftBefore)} → <b>{cm(slam.finalDriftAfter ?? 0)}</b> · average error (ATE) {cm(slam.ateBefore)} → <b>{cm(slam.ateAfter ?? 0)}</b></div>}
        {g.step >= 3 && g.step <= 4 && !hasClosure && <Btn sm variant="primary" onClick={() => onRunWith({ loopClosure: true })} busy={busy} testId="slam-guide-enable-closure">Turn on loop closure and run</Btn>}
        {g.step === 4 && <GuideNote kind="warn" title="A teaching shortcut">The correction here is spread evenly along the path. It is <b>not</b> full pose-graph optimisation, which real SLAM systems use.</GuideNote>}
        {g.step === 5 && (
          <div data-testid="slam-guide-pipeline" style={{ display: 'grid', gap: 4 }}>
            {PIPE.map((p, i) => <div key={p} style={{ padding: '5px 10px', borderRadius: 10, fontSize: '0.875rem', background: i <= pipeAt ? (i === 5 ? 'rgba(255,159,10,.22)' : 'rgba(10,132,255,.16)') : 'var(--fill)', opacity: i <= pipeAt ? 1 : 0.55 }}>{i + 1}. {p}{i === 5 ? ' (simplified here)' : ''}</div>)}
          </div>
        )}
        {g.step === 5 && openTls && <Btn sm onClick={openTls} testId="slam-guide-tls">Next: how stations are scanned (TLS)</Btn>}
      </GuidePanel>
      {g.step === 2 && (
        <Section title="Try different errors" hint="These change the normal controls, then run again.">
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn sm onClick={() => onRunWith({ transNoise: 0, rotNoiseDeg: 0, rotBiasDeg: 0, scaleErr: 0 })} busy={busy} testId="slam-guide-perfect">No error</Btn>
            <Btn sm onClick={() => onRunWith({ rotBiasDeg: 0.4 })} busy={busy} testId="slam-guide-bias">Add turn bias</Btn>
          </div>
        </Section>
      )}
      <GuideClock store={useSlamGuide} dur={(s) => DUR[s.step]} onDone={(s) => { if (s.step < 5) s.goto(s.step + 1); else s.pause(); }} />
    </>
  );
}
void useLab;
