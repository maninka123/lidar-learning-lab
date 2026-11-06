import { BudgetSummary } from '../twin/ui/BudgetSummary';
import { MissionCheck } from '../twin/ui/MissionCheck';
import { CompletionReport } from '../twin/ui/CompletionReport';
import { engineeringReport } from '../twin/report';
import { PairBoard, FovOverlapChart, CalPanel } from '../twin/ui/CalibrationWorkspace';
import { MISSIONS, MISSION_TARGETS, TOOL_NAMES, fmtMetric, currentMissionMetrics, currentPass, evaluateMission, recordMission, readyForFinal, missionFingerprint, pipelineForMission } from '../twin/missions';
import { MissionMap, MissionBrief } from '../twin/ui/MissionPanel';
import { EquipmentCatalogue } from '../twin/ui/EquipmentCatalogue';
import { pairedLidarOf, inspectionCamera, INSPECTION_CAMERA_ID } from '../twin/catalogue';
import { inspectionCoverage } from '../twin/inspection';
import { InspectionMission } from '../twin/ui/InspectionMission';
import { usd } from '../twin/pricing';
import '../twin/ui/missions.css';
import { Fragment, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, CloudLayer, PolyLine, Marker, BoxOutline } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Crosshair, Play, Plus, Trash2, Download, Upload } from '../ui/icons';
import { runTask } from '../engine/client';
import { downloadBlob } from '../io/load';
import { buildFactory, zoneAt, ZONES, SAFETY_ZONES, TWIN_CLASSES, CRITICAL_CAMERA_ZONE } from '../twin/factory';
import { LIDARS, CAMERAS, LIGHT_UNIT, LOWLIGHT_KIT, MOBILE_PLATFORM, RES_TIERS, INSTALL, TASK_KEYS, TASK_NAMES, LIMITS, costOf, lidarItem, cameraItem, newId, isMobile, HW_SEED, ResTier, TwinDesign, LidarUnit, CameraUnit, TaskKey } from '../twin/catalogue';
import { raysFor, acquireSurvey, Survey } from '../twin/acquire';
import { camPose, nominalOf, makeSampler, colourPoints } from '../twin/camera';
import { BLOCKS, BLOCK_TAB, PickList, PHASES, phaseIndex, insertBlock, regParamsOf, newBlock, checkPipeline, canRunParallel, parallelGroups, BlockKind, Block } from '../twin/pipeline';
import { registerScans, RegReport } from '../twin/register';
import { AlignPanel, type AlignRow } from '../twin/ui/AlignPanel';
import { poseError } from '../twin/grade';
import type { Rigid } from '../core/math';
import { PRACTICE_SEED, RunResult } from '../twin/runner';
import { createPortal } from 'react-dom';
import { useTwin, snapshot, parseSave } from '../twin/store';
import { evaluate } from '../occlusion/coverage';
import { FovVolume, ScannerMarkers, SamplePoints, paint, STATUS_COLOURS } from '../occlusion/OccView';
import { cameraView, lidarAsScanner } from '../twin/coverage';
import { insideSolid } from '../occlusion/coverage';
import { feedbackFor } from '../twin/feedback';
import { sensorOf } from '../occlusion/coverage';
import { PointCloud, concatClouds } from '../core/pointcloud';
import { D2R, Vec3 } from '../core/math';
import { tabIndex } from './nav';
import { workshopConfigured, submitChallengeScore, challengeAccepting } from '../apps/workshop';
import { buildSubmission, validIndex } from '../twin/submit';

const UNIT_COLOURS = ['#e63946', '#1d78dc', '#28aa5a', '#f4a21e', '#8c50c8', '#00b4be'];
const HEAT = ['#ff453a', '#e8b42a', '#30a14e'];
/** Where a new item goes: the open floor spot that is farthest from everything already placed, so equipment starts scattered around the factory. */
function scatterSpot(scene: ReturnType<typeof buildFactory>['scene'], taken: [number, number][], z = 1.6): [number, number] {
  const b = scene.bounds; let best: [number, number] = [-8, -4], bestD = -1;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
    const x = b.min[0] + 1.5 + (i / 12) * (b.max[0] - b.min[0] - 3), y = b.min[1] + 1.2 + (j / 8) * (b.max[1] - b.min[1] - 2.4);
    if (insideSolid(scene, x, y, z) || insideSolid(scene, x, y, 0.4)) continue;
    const d = taken.length ? Math.min(...taken.map(([a, c]) => Math.hypot(a - x, c - y))) : Math.hypot(x + 8, y + 4) * -1 + 100; // the first item starts at the left of the floor
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)} %`;
const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const hexRgb = (h: string): [number, number, number] => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const cloudOf = (pos: Float32Array): PointCloud => ({ id: 'x', name: 'x', count: pos.length / 3, positions: pos, meta: { kind: 'processed', source: 'overlay', units: 'm' } });

const blockSig = (b: Block) => JSON.stringify([b.kind, b.params, b.bypass]);
if (typeof window !== 'undefined') (window as unknown as { __twin: typeof useTwin }).__twin = useTwin; // for the browser tests


export default function TabTwin() {
  const T = useTwin(), lab = useLab();
  const stage = T.stage, d = T.design, mission = T.progress.current;
  const missionDef = MISSIONS[mission];
  const goMission = (i: number) => { if (i <= useTwin.getState().progress.unlocked) T.set({ progress: { ...useTwin.getState().progress, current: i }, stage: MISSIONS[i].tools[0] }); };
  const [coverageMode, setCoverageMode] = useState<'all' | 'critical'>('critical');
  const [finalVariant, setFinalVariant] = useState(0);
  const [timeView, setTimeView] = useState<'A' | 'B' | 'changes' | 'safety'>('changes');
  const visualSeed = mission === 6 && T.final ? (T.final.runs[finalVariant] ?? T.final.runs[0]).seed : PRACTICE_SEED;
  const visualEpoch = mission === 5 && timeView !== 'A' ? 'B' : 'A';
  const factory = useMemo(() => buildFactory(visualSeed, visualEpoch), [visualSeed, visualEpoch]);
  const scene = factory.scene;
  const cost = useMemo(() => costOf(d, T.settings), [d, T.settings]);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [routeMode, setRouteMode] = useState(false), [placeMode, setPlaceMode] = useState(false);
  const [taskTab, setTaskTab] = useState<'detect' | 'colour' | 'change' | 'quality' | 'safety'>('detect');
  const [fovDist, setFovDist] = useState(5); // metres in front of the camera at which the two fields of view are compared
  const [calCloud, setCalCloud] = useState<{ cloud: PointCloud; coloured: number; total: number } | null>(null), [calBusy, setCalBusy] = useState(false);
  const calCache = useRef<{ key: string; cloud: PointCloud } | null>(null);
  const [ownFrames, setOwnFrames] = useState(true); // acquired scans are shown as delivered: each in its own scanner's coordinate system
  const [camColour, setCamColour] = useState(true); // in the survey view: points a camera sees take its colours
  const [surveyView, setSurveyView] = useState<{ cloud: PointCloud; base: Uint8Array; cam: Uint8Array | null; coloured: number }[] | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null); // which block's settings are open
  const [regTest, setRegTest] = useState<{ id: string; report: RegReport; clouds: PointCloud[] } | null>(null), [regBusy, setRegBusy] = useState(false);
  const [alignRows, setAlignRows] = useState<AlignRow[]>([]); // mission 2: the scans aligned so far, one at a time
  const [alignActive, setAlignActive] = useState(1);
  const [alignPreview, setAlignPreview] = useState<'before' | 'after'>('after');
  const [pipeExpanded, setPipeExpanded] = useState(false); // the builder can fill the whole window
  const [lastRun, setLastRun] = useState<Record<string, { before: number; after: number; sig: string }>>({}); // what each block did to the point count in the latest test, kept until that block is changed
  const [lastPick, setLastPick] = useState<Record<string, PickList>>({}); // the planes and clusters each block found in the latest test, kept while the team ticks and unticks them
  const [rerunAt, setRerunAt] = useState(0); // set when a tick changes: the test runs again a moment later so the 3D view follows
  const [autoTest, setAutoTest] = useState(false); // in the pipeline stage: run the practice again a moment after every change to the blocks
  const [planOpen, setPlanOpen] = useState(true); // the plan in the corner of the view can be folded away and brought back
  const [viewMode, setViewMode] = useState<'both' | 'scene' | 'points'>('both'); // what the 3D view shows: the factory, the points, or both at once
  const [pname, setPname] = useState('Pipeline 1');
  const [consent, setConsent] = useState(false), [sendKind, setSendKind] = useState<'final' | 'practice'>('final'), [sending, setSending] = useState(false), [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showObjectLabels, setShowObjectLabels] = useState(false);
  const [showMissing, setShowMissing] = useState(true), [showZones, setShowZones] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTaskTab(mission === 4 ? 'colour' : mission === 5 ? 'change' : 'detect'); }, [mission]);

  useEffect(() => { const st = useLab.getState(); return () => { st.patch({ interaction: 'select' }); }; }, []);
  useEffect(() => { lab.patch({ interaction: (placeMode || routeMode) && stage === 2 ? 'add-station' : 'select' }); }, [placeMode, routeMode, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stage !== 5) setPipeExpanded(false); }, [stage]);
  useEffect(() => { setRegTest(null); }, [d.lidars, d.cameras, d.route, d.routeSteps, d.platform]);
  useEffect(() => { setSurvey(null); setSurveyView(null); }, [d.lidars, d.cameras, d.lights, d.routeSteps, d.route, d.platform]);

  /** Every change to the equipment goes through here. A change that raises the cost is refused when it would go over the budget: the budget can never be exceeded. */
  const setDesign = (f: (x: TwinDesign) => TwinDesign): boolean => {
    if (useTwin.getState().busy) return false;
    const s = useTwin.getState(), cur = s.design, next = f(cur), c0 = costOf(cur, s.settings), c1 = costOf(next, s.settings);
    if (c1.total > s.settings.budget && c1.total > c0.total) { lab.notify(`Not enough budget: that costs ${usd(c1.total - c0.total)} more and you have ${usd(Math.max(0, s.settings.budget - c0.total))} left.`, 'warn'); return false; }
    s.set({ design: next, practice: null }); return true;
  };
  /** What adding something would cost, so the shop can grey out what you cannot afford. */
  const extra = (f: (x: TwinDesign) => TwinDesign) => costOf(f(d), T.settings).total - cost.total;
  const affordable = (f: (x: TwinDesign) => TwinDesign) => extra(f) <= cost.remaining;
  const sel = T.selectedUnit;
  const selL = d.lidars.find((u) => u.id === sel), selC = d.cameras.find((u) => u.id === sel), selLight = d.lights.find((u) => u.id === sel);
  const bounds = scene.bounds;
  const clampXY = (x: number, y: number): [number, number] => [Math.min(bounds.max[0] - 0.3, Math.max(bounds.min[0] + 0.3, x)), Math.min(bounds.max[1] - 0.3, Math.max(bounds.min[1] + 0.3, y))];
  const place = (x0: number, y0: number) => {
    if (stage !== 2) return; const [x, y] = clampXY(x0, y0);
    if (routeMode) { setDesign((q) => ({ ...q, route: [...q.route, [x, y]] })); return; }
    if (!placeMode || !sel) return;
    if (selL) patchLidar(selL.id, { x, y });
    else if (selC) patchCam(sel, { x, y }); else if (selLight) setDesign((q) => ({ ...q, lights: q.lights.map((u) => (u.id === sel ? { ...u, x, y } : u)) }));
  };
  useEffect(() => { if (lab.pendingStation) { place(lab.pendingStation[0], lab.pendingStation[1]); lab.patch({ pendingStation: null }); } }, [lab.pendingStation]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Moving or re-aiming a camera, or changing its optics, makes the old calibration wrong: it goes back to the intended pose. */
  function patchCam(id: string, p: Partial<CameraUnit>) {
    setDesign((q) => ({ ...q, cameras: q.cameras.map((c) => { if (c.id !== id) return c; const n = { ...c, ...p }, it = cameraItem(n.item); return { ...n, cal: { est: nominalOf(n), fov: it.fov, done: false } }; }) }));
  }
  /** every place already used by a scanner, camera or lamp */
  const taken = useMemo<[number, number][]>(() => [...d.lidars.map((u) => [u.x, u.y] as [number, number]), ...d.cameras.map((u) => [u.x, u.y] as [number, number]), ...d.lights.map((u) => [u.x, u.y] as [number, number])], [d]);
  const nextSpot = useMemo(() => scatterSpot(scene, taken), [scene, taken]);
  /** the spot from the latest design, so quick repeated clicks cannot put two items in the same place */
  const freshSpot = (): [number, number] => { const q = useTwin.getState().design; return scatterSpot(scene, [...q.lidars.map((u) => [u.x, u.y] as [number, number]), ...q.cameras.map((u) => [u.x, u.y] as [number, number]), ...q.lights.map((u) => [u.x, u.y] as [number, number])]); };
  const patchLidar = (id: string, p: Partial<LidarUnit>) => setDesign((q) => ({ ...q, lidars: q.lidars.map((u) => (u.id === id ? { ...u, ...p } : u)) }));

  // ---- buying
  const lidarPlan = (item: string, fresh = false): { u: LidarUnit; f: (q: TwinDesign) => TwinDesign } => {
    const [x, y] = fresh ? freshSpot() : nextSpot, u: LidarUnit = { id: newId('lidar'), item, res: 'standard', x, y, z: lidarItem(item).mobile ? 1.5 : 1.8, yaw: 0, pitch: 0 };
    return { u, f: (q) => ({ ...q, lidars: [...q.lidars, u], platform: q.platform || !!lidarItem(item).mobile }) }; // a mobile LiDAR comes with the platform it rides on
  };
  const buyLidar = (item: string) => { const { u, f } = lidarPlan(item, true); if (setDesign(f)) T.set({ selectedUnit: u.id }); };
  const buyCamera = (item: string) => {
    const [x, y] = freshSpot(), base: CameraUnit = { id: newId('cam'), item, x, y, z: 1.8, yaw: Math.atan2(-y, -x), // looks towards the middle of the factory
      pitch: 0, kit: false, pairedLidarId: null, cal: { est: { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 }, fov: 0, done: false } };
    const c = { ...base, cal: { est: nominalOf(base), fov: cameraItem(item).fov, done: false } };
    if (setDesign((q) => ({ ...q, cameras: [...q.cameras, c] }))) T.set({ selectedUnit: c.id });
  };
  // Older projects may not contain a camera yet. Keep their choices; add the specified one when the camera mission begins, if affordable.
  useEffect(() => {
    if (mission === 4) {
      const state = useTwin.getState(), camera = state.design.cameras[0];
      if (camera) state.set({ selectedUnit: camera.id });
    }
  }, [mission]);
  useEffect(() => {
    if (mission !== 4) return;
    const state = useTwin.getState();
    if (state.design.cameras.length || state.busy) return;
    const camera = inspectionCamera(), next = { ...state.design, cameras: [camera] };
    if (costOf(next, state.settings).total <= state.settings.budget) state.set({ design: next, selectedUnit: camera.id });
  }, [mission, d.cameras.length, cost.remaining, T.settings.budget, T.settings.priceScale]);
  const cameraPlan = (item: string) => (q: TwinDesign): TwinDesign => ({ ...q, cameras: [...q.cameras, { id: 'x', item, x: 0, y: 0, z: 1.8, yaw: 0, pitch: 0, kit: false, cal: { est: { tx: 0, ty: 0, tz: 1.8, yawDeg: 0, pitchDeg: 0 }, fov: 0, done: false } }] });
  const remove = (id: string) => { if (id === INSPECTION_CAMERA_ID) return; setDesign((q) => ({ ...q, lidars: q.lidars.filter((u) => u.id !== id), cameras: q.cameras.filter((u) => u.id !== id), lights: q.lights.filter((u) => u.id !== id) })); if (sel === id) T.set({ selectedUnit: null }); };

  // ---- running
  const cfg = { design: d, pipeline: T.pipeline, settings: T.settings };
  const chk = useMemo(() => {
    const blocks = pipelineForMission(T.pipeline, mission), checked = checkPipeline(blocks, { cameras: d.cameras.length, hasB: true });
    return { ...checked, perBlock: T.pipeline.map((b) => { const at = blocks.indexOf(b); return at < 0 ? null : checked.perBlock[at]; }) };
  }, [T.pipeline, mission, d.cameras.length]);
  const alignmentPending = !survey || survey.visible.scans.length === 0 || alignRows.length < survey.visible.scans.length - 1;
  async function runPractice() {
    if (mission === 1 && alignmentPending) { lab.notify('Acquire the scans, then align each one before evaluating the map.', 'warn'); return; }
    if (!cost.ok || useTwin.getState().busy) { if (!cost.ok) lab.notify(cost.errors.join(' '), 'warn'); return; }
    const fingerprint = missionFingerprint(cfg, 6);
    const runCfg = mission === 0 ? { ...cfg, pipeline: [newBlock('merge')] } : { ...cfg, pipeline: pipelineForMission(cfg.pipeline, mission) };
    setViewMode((m) => (m === 'scene' ? 'both' : m)); // the result is points: make sure the view shows them
    T.set({ busy: 'Running the practice survey and your pipeline…' });
    try {
      const r = await runTask('twinRun', { config: runCfg, seed: PRACTICE_SEED });
      const live = useTwin.getState();
      if (fingerprint !== missionFingerprint({ design: live.design, pipeline: live.pipeline, settings: live.settings }, 6)) return;
      if (mission < 6) live.set({ progress: recordMission(live.progress, mission, evaluateMission(mission, r, cfg)) });
      setLastPick(Object.fromEntries(r.steps.filter((x) => x.pick).map((x) => [x.id, x.pick as PickList])));
      setLastRun(Object.fromEntries(r.steps.filter((x) => !x.bypassed && !x.error).map((x) => { const b = T.pipeline.find((q) => q.id === x.id); return [x.id, { before: x.before, after: x.after, sig: b ? blockSig(b) : '' }]; })));
      useTwin.getState().set({ practice: r, selectedStep: r.steps.reduce((last, x, i) => (x.preview && !x.error && !x.bypassed ? i : last), -1), attempts: [...useTwin.getState().attempts, { at: Date.now(), mission: mission + 1, status: evaluateMission(mission, r, cfg).level, kind: 'practice', seed: PRACTICE_SEED, total: r.grade.total, tasks: Object.fromEntries(r.grade.perTask.map((x) => [x.key, x.score])), cost: r.cost.total }] });
    } catch (e) { lab.notify((e as Error).message, 'error'); } finally { useTwin.getState().set({ busy: null }); }
  }
  const pipeSig = JSON.stringify(T.pipeline.map((b) => [b.kind, b.bypass, b.params, b.parallel]));
  useEffect(() => { // "test as I add": a short wait after the last change, then the practice run shows the result in the 3D view
    if (stage !== 5 || !autoTest || !chk.ok || !cost.ok || useTwin.getState().busy) return;
    const id = setTimeout(() => { if (!useTwin.getState().busy) void runPractice(); }, 1200); return () => clearTimeout(id);
  }, [pipeSig, autoTest, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rerunAt || stage !== 5 || !chk.ok || !cost.ok) return;
    const id = setTimeout(() => { if (!useTwin.getState().busy) void runPractice(); }, 700); return () => clearTimeout(id);
  }, [rerunAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalsUsed = T.attempts.filter((a) => a.kind === 'final').length;
  async function submitFinal() {
    if (!readyForFinal(useTwin.getState().progress) || useTwin.getState().busy) { lab.notify('Revalidate all six missions before the final evaluation.', 'warn'); return; }
    const fingerprint = missionFingerprint(cfg, 6);
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    if (T.settings.maxSubmissions > 0 && finalsUsed >= T.settings.maxSubmissions) { lab.notify('No final evaluations left.', 'warn'); return; }
    T.set({ busy: 'Final evaluation on separate scenario variants…' });
    try {
      const r = await runTask('twinFinal', { config: cfg });
      const s = useTwin.getState();
      if (fingerprint !== missionFingerprint({ design: s.design, pipeline: s.pipeline, settings: s.settings }, 6)) return;
      s.set({ progress: recordMission(s.progress, 6, evaluateMission(6, r.runs[0], cfg, r)), final: r, finalSubmitted: { at: Date.now(), design: d, pipeline: T.pipeline, total: r.grade.total }, attempts: [...s.attempts, { at: Date.now(), mission: 7, status: evaluateMission(6, r.runs[0], cfg, r).level, kind: 'final', seed: r.runs.map((x) => x.seed), total: r.grade.total, tasks: Object.fromEntries(r.grade.perTask.map((x) => [x.key, x.score])), cost: r.cost.total }] });
    } catch (e) { lab.notify((e as Error).message, 'error'); } finally { useTwin.getState().set({ busy: null }); }
  }
  async function acquire() {
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    T.set({ busy: 'Acquiring the survey…' }); await new Promise((r) => setTimeout(r, 30));
    try {
      const sv = acquireSurvey(factory, d, PRACTICE_SEED); setSurvey(sv);
      // where a camera sees a point, the point takes the camera's colour (with the calibration as set); all other points keep their scanner colour
      const cams = d.cameras.map((c, i) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, i, d.lights), e: c.cal.est, fov: c.cal.fov, scanIds: sv.visible.scans.filter((q) => q.unit === pairedLidarOf(c, d)?.id).map((q) => q.index) }));
      setSurveyView(sv.visible.scans.map((s2, i) => {
        const n = s2.cloud.count, [r, g, b] = hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]), base = new Uint8Array(n * 3);
        for (let k = 0; k < n; k++) { base[k * 3] = r; base[k * 3 + 1] = g; base[k * 3 + 2] = b; }
        if (!cams.length) return { cloud: s2.cloud, base, cam: null, coloured: 0 };
        const col = colourPoints(s2.cloud.positions, n, cams, s2.cloud.scanIds), cam = base.slice();
        for (let k = 0; k < n; k++) if (col.valid[k]) cam.set(col.colors.subarray(k * 3, k * 3 + 3), k * 3);
        return { cloud: s2.cloud, base, cam, coloured: col.count };
      }));
    } finally { T.set({ busy: null }); }
  }
  /** Try one registration block on the acquired survey and show its RMSE straight away, so the settings can be tuned without running everything */
  async function testRegistration(b: Block) {
    setViewMode((m) => (m === 'scene' ? 'both' : m));
    setRegBusy(true); await new Promise((r) => setTimeout(r, 30));
    try {
      const sv = survey ?? acquireSurvey(factory, d, PRACTICE_SEED); if (!survey) setSurvey(sv);
      const r = registerScans(sv.visible.scans, regParamsOf(b.kind, { ...Object.fromEntries(BLOCKS[b.kind].params.map((p2) => [p2.key, p2.def])), ...b.params }));
      setRegTest({ id: b.id, report: r.report, clouds: r.clouds }); useTwin.getState().set({ selectedStep: -1 }); // show this test in the 3D view, not an older run
    } finally { setRegBusy(false); }
  }
  const icpBlock = T.pipeline.find((b) => b.kind === 'icp');
  const icpSig = JSON.stringify(icpBlock?.params ?? {});
  useEffect(() => { if (mission === 1 && stage === 5 && !T.pipeline.some((b) => b.kind === 'icp')) T.set({ pipeline: insertBlock(T.pipeline.filter((b) => b.kind !== 'merge' && b.kind !== 'mobileicp'), newBlock('icp')), practice: null }); }, [mission, stage, T.pipeline]); // eslint-disable-line react-hooks/exhaustive-deps
  const resetAlignment = () => { setAlignRows([]); setAlignActive(1); setAlignPreview('after'); setRegTest(null); };
  const selectAlignment = (k: number) => {
    if (regBusy || k < 1 || !survey || k >= survey.visible.scans.length || k > alignRows.length + 1) return;
    setAlignActive(k); setAlignPreview('after'); setViewMode((m) => m === 'scene' ? 'both' : m);
  };
  useEffect(() => { resetAlignment(); }, [survey, icpSig]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Align one more scan: the first k + 1 scans are registered with the team's settings, and scan k is compared with its surveyed position (known to the simulation). */
  async function alignScan(k: number) {
    if (!survey || !icpBlock || regBusy || useTwin.getState().busy || k < 1 || k >= survey.visible.scans.length || k > alignRows.length + 1) return;
    setViewMode((m) => (m === 'scene' ? 'both' : m)); setRegBusy(true); await new Promise((r) => setTimeout(r, 30));
    try {
      const scans = survey.visible.scans, truth = survey.hidden.truePoses;
      const r = registerScans(scans.slice(0, k + 1), regParamsOf('icp', { ...Object.fromEntries(BLOCKS.icp.params.map((p2) => [p2.key, p2.def])), ...icpBlock.params }));
      const pair = (poses: Rigid[]) => poseError([poses[0], poses[k]], [truth[0], truth[k]]), rep = r.report.scans[k - 1];
      setAlignRows((rows) => [...rows.slice(0, k - 1), { k, name: scans[k].name, before: poseError([scans[0].pose, scans[k].pose], [truth[0], truth[k]]), after: pair(r.poses), overlap: rep.overlapAfter, accepted: rep.accepted }]);
      setAlignPreview('after');
      setRegTest({ id: icpBlock.id, report: r.report, clouds: [...r.clouds, ...scans.slice(k + 1).map((q) => q.cloud)] }); T.set({ selectedStep: -1 });
    } catch (e) { lab.notify(`The alignment failed: ${(e as Error).message}`, 'error'); } finally { setRegBusy(false); }
  }
  const exportConfig = () => downloadBlob(new Blob([JSON.stringify(snapshot(useTwin.getState()), null, 1)], { type: 'application/json' }), `${(T.team || 'team').replace(/\W+/g, '_')}_twin_challenge.json`);
  const exportReport = () => downloadBlob(new Blob([engineeringReport(snapshot(useTwin.getState()), T.practice, T.final)], { type: 'text/markdown' }), `${(T.team || 'team').replace(/\W+/g, '_')}_twin_report.md`);
  const [accept, setAccept] = useState<{ known: boolean; accepting: boolean; until: number | null }>({ known: false, accepting: false, until: null });
  useEffect(() => {
    if (!workshopConfigured()) return;
    let on = true;
    const ask = () => challengeAccepting().then((a) => {
      if (!on) return; setAccept({ known: a.known, accepting: a.accepting, until: a.until });
      // the instructor's grading settings win over anything saved here; a change makes old results stale
      const cur = useTwin.getState().settings;
      if (a.settings && JSON.stringify(a.settings) !== JSON.stringify(cur)) useTwin.getState().set({ settings: a.settings, practice: null, final: null });
    });
    ask(); const id = setInterval(ask, 30000);
    return () => { on = false; clearInterval(id); };
  }, []);
  const canSendFinal = !!T.final, canSendPractice = !!T.practice;
  const kindToSend: 'final' | 'practice' = sendKind === 'final' && canSendFinal ? 'final' : canSendPractice ? 'practice' : 'final';
  async function sendScore() {
    const kind = kindToSend, st = T.student;
    if (st.name.trim().length < 2) { setSendMsg({ ok: false, text: 'Enter your name.' }); return; }
    if (!validIndex(st.index)) { setSendMsg({ ok: false, text: 'Enter your index number (3 to 24 letters or digits).' }); return; }
    if (!consent) { setSendMsg({ ok: false, text: 'Tick the box to agree to send this.' }); return; }
    if (accept.known && !accept.accepting) { setSendMsg({ ok: false, text: 'Scores are not being accepted right now. Keep grading, and send when it opens.' }); return; }
    const body = buildSubmission({ name: st.name.trim(), index: st.index.trim(), consent, team: T.team }, { practice: T.practice, final: T.final, design: d, pipeline: T.pipeline, settings: T.settings, attempts: T.attempts, startedAt: T.startedAt, progress: T.progress }, kind);
    if (!body) { setSendMsg({ ok: false, text: kind === 'final' ? 'Submit for the final evaluation first.' : 'Run the practice first.' }); return; }
    setSending(true); setSendMsg(null);
    const r = await submitChallengeScore(body); setSending(false); setSendMsg({ ok: r.ok, text: r.message }); if (!r.ok && /not being accepted/.test(r.message)) setAccept({ known: true, accepting: false, until: null });
    if (r.ok) T.set({ sent: [...useTwin.getState().sent, { at: Date.now(), kind, total: body.total }] });
  }
  const importConfig = (f: File | undefined) => { if (!f) return; f.text().then((t) => { const s = parseSave(t); if (s) { T.importSave(s); lab.notify('Challenge configuration loaded.', 'ok'); } else lab.notify('That file is not a challenge configuration.', 'error'); }); };

  // ---- calibration check: the points of one LiDAR, coloured by the selected camera with the calibration as it is now
  const nearestLidar = (c: CameraUnit) => d.lidars.reduce<LidarUnit | null>((b, u) => (!b || Math.hypot(u.x - c.x, u.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? u : b), null);
  const pairedLidar = (c: CameraUnit) => pairedLidarOf(c, d);
  const calLid = selC ? pairedLidar(selC) : null;
  /** every camera wired to that LiDAR: they all colour its points, each with its own calibration */
  const connected = calLid ? d.cameras.filter((c) => pairedLidar(c)?.id === calLid.id) : [];
  const connSig = JSON.stringify(connected.map((c) => [c.id, c.cal.est, c.cal.fov, c.x, c.y, c.z, c.yaw, c.pitch, c.kit, c.item]));
  useEffect(() => {
    if (stage !== 3 || !selC || !calLid) { setCalCloud(null); return; }
    setCalBusy(true);
    const id = setTimeout(() => {
      try {
        const key = JSON.stringify([calLid, d.platform, d.route, d.routeSteps, d.distortion]);
        if (calCache.current?.key !== key) { const sv = acquireSurvey(factory, { ...d, lidars: [calLid] }, PRACTICE_SEED); calCache.current = { key, cloud: concatClouds(sv.visible.scans.map((s2) => s2.cloud), 'Calibration check') }; }
        const cloud = calCache.current.cloud, col = colourPoints(cloud.positions, cloud.count, connected.map((c) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, d.cameras.findIndex((x) => x.id === c.id), d.lights), e: c.cal.est, fov: c.cal.fov })));
        const colors = new Uint8Array(cloud.count * 3); for (let i = 0; i < cloud.count; i++) { if (col.valid[i]) colors.set(col.colors.subarray(i * 3, i * 3 + 3), i * 3); else colors.fill(110, i * 3, i * 3 + 3); } // grey: no connected camera sees the point
        setCalCloud({ cloud: { ...cloud, colors, instances: undefined }, coloured: col.count, total: cloud.count });
      } finally { setCalBusy(false); }
    }, 250); // wait for the slider to settle
    return () => clearTimeout(id);
  }, [stage, selC?.id, connSig, calLid?.id, d.lidars, d.lights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- planning aids
  const scanners = useMemo(() => d.lidars.map(lidarAsScanner), [d.lidars]);
  const cov = useMemo(() => (stage === 2 && scanners.length ? evaluate(scene, scanners) : null), [stage, scanners, scene]);
  const covColours = useMemo(() => (cov ? paint(cov.samples.count, (i) => HEAT[Math.min(2, cov.stats.times[i])]) : null), [cov]);
  const camStats = useMemo(() => (stage === 2 && selC ? cameraView(scene, selC, factory.targets) : null), [stage, selC, scene, factory.targets]);
  const rayCount = (u: LidarUnit) => raysFor(u);
  const inspectionPreview = useMemo(() => mission === 4 ? inspectionCoverage(factory, d) : { total: 6, coverage: 0, sharedCoverage: 0, calibratedCoverage: 0, cameras: [] }, [mission, factory, d]);
  const inspectionCam = selC ?? d.cameras[0];
  const inspectionLidar = inspectionCam ? pairedLidarOf(inspectionCam, d) : undefined;

  // ---- 3D
  const practice = T.practice, step = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
  const frustum = (c: CameraUnit, color: string) => {
    const it = cameraItem(c.item), p = camPose(nominalOf(c)), t = Math.tan((it.fov * D2R) / 2), a = it.w / it.h, L = 4, o = p.pos;
    const corner = (sx: number, sy: number): Vec3 => [o[0] + L * (p.f[0] + sx * t * a * p.r[0] + sy * t * p.u[0]), o[1] + L * (p.f[1] + sx * t * a * p.r[1] + sy * t * p.u[1]), o[2] + L * (p.f[2] + sx * t * a * p.r[2] + sy * t * p.u[2])];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    return <>{cs.map((q, i) => <PolyLine key={i} pts={[o as Vec3, q]} color={color} width={1.5} />)}<PolyLine pts={[...cs, cs[0]]} color={color} width={1.5} /></>;
  };
  const refs = practice?.refs ?? [];
  const matchRef = useMemo(() => { if (!practice) return null; const m = practice.tasks.detect.match; const ok = new Map(m.pairs.map((p) => [p.ref, practice.objects[p.pred]?.cls === refs[p.ref].cls])); return ok; }, [practice, refs]);
  const coverageCloud = useMemo(() => {
    const c = practice?.coverage; if (!c) return null;
    const pos: number[] = [], rgb: number[] = [];
    for (let i = 0; i < c.positions.length / 3; i++) {
      if (coverageMode === 'critical' && !['production', 'inspection', 'loading'].includes(zoneAt(c.positions[i * 3], c.positions[i * 3 + 1]))) continue;
      pos.push(...c.positions.subarray(i * 3, i * 3 + 3)); rgb.push(...c.colours.subarray(i * 3, i * 3 + 3));
    }
    return { ...cloudOf(Float32Array.from(pos)), colors: Uint8Array.from(rgb) };
  }, [practice?.coverage, coverageMode]);
  const displayedRun = mission === 6 && T.final ? T.final.runs[finalVariant] ?? T.final.runs[0] : practice;
  const showScene = viewMode !== 'points', showPts = viewMode !== 'scene';
  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} bgOverride={!showScene ? '#ffffff' : undefined} hideGrid={!showScene} hideAxes>
      {showScene && <SceneLayer scene={scene} opacity={viewMode === 'both' && stage >= 3 && stage <= 6 ? 0.18 : 0.4} showCeiling={false} interactive={stage === 2} />}
      {showPts && stage === 2 && !practice?.coverage && cov && covColours && <SamplePoints samples={cov.samples} colours={covColours} size={3} />}
      {showPts && mission === 0 && coverageCloud && <CloudLayer cloud={coverageCloud} mode="rgb" size={3} budget={15000} pickable={false} />}
      {(stage <= 3 || mission === 6) && <ScannerMarkers scanners={scanners} selected={scanners.findIndex((s2) => d.lidars[s2.id].id === sel) >= 0 ? scanners.findIndex((s2) => d.lidars[s2.id].id === sel) : null} sensorOf={(s2) => sensorOf(s2.preset)} onSelect={(i) => T.set({ selectedUnit: d.lidars[i]?.id ?? null })} />}
      {mission >= 4 && stage <= 3 && d.cameras.map((c, i) => <group key={c.id} onClick={(e) => { e.stopPropagation(); T.set({ selectedUnit: c.id }); }}><mesh position={[c.x,c.y,c.z]}><sphereGeometry args={[0.3,10,8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh><Marker p={[c.x, c.y, c.z]} color="#0a84ff" r={0.18} label={`Cam ${i + 1}`} />{c.id === sel && frustum(c, '#0a84ff')}</group>)}
      {stage <= 3 && d.lights.map((l, i) => <Marker key={l.id} p={[l.x, l.y, l.z]} color="#ffcc00" r={0.18} label={`Lamp ${i + 1}`} />)}
      {stage === 2 && selL && <FovVolume sc={lidarAsScanner(selL, 0)} sensor={sensorOf(lidarItem(selL.item).preset)} color={UNIT_COLOURS[d.lidars.indexOf(selL) % 6]} reach={14} opacity={0.08} />}
      {stage === 2 && d.lidars.some(isMobile) && d.route.length > 1 && <PolyLine pts={d.route.map(([x, y]) => [x, y, 0.2] as Vec3)} color="#ff9f0a" width={3} dashed />}
      {stage === 2 && d.route.map(([x, y], i) => (d.lidars.some(isMobile) || routeMode) ? <Marker key={i} p={[x, y, 0.2]} color="#ff9f0a" r={0.2} label={`${i + 1}`} /> : null)}
      {showPts && stage === 4 && survey && ownFrames && survey.visible.scans.map((s2, i) => { const v = surveyView?.[i]; return v && s2.local.count === v.base.length / 3 ? <CloudLayer key={`o${i}`} cloud={{ ...s2.local, instances: undefined, colors: camColour && v.cam ? v.cam : v.base }} mode="rgb" size={2.5} budget={120000} pickable={false} /> : <CloudLayer key={`o${i}`} cloud={{ ...s2.local, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) }} size={2.5} budget={120000} pickable={false} />; })}
      {showPts && stage === 4 && surveyView && !ownFrames && surveyView.map((v, i) => <CloudLayer key={i} cloud={{ ...v.cloud, instances: undefined, colors: camColour && v.cam ? v.cam : v.base }} mode="rgb" size={2.5} budget={120000} pickable={false} />)}
      {showPts && stage === 3 && calCloud && <CloudLayer cloud={calCloud.cloud} mode="rgb" size={3} budget={150000} pickable={false} />}
      {stage === 3 && selC && calLid && <PolyLine pts={[[selC.x, selC.y, selC.z], [calLid.x, calLid.y, calLid.z]]} color="#ff9f0a" width={3} dashed />}
      {showPts && stage === 5 && mission === 1 && survey && survey.visible.scans.slice(0, alignActive + 1).map((s2, i) => {
        const aligned = i < alignActive || alignPreview === 'after', cloud = aligned && regTest?.clouds[i] ? regTest.clouds[i] : s2.cloud;
        return <CloudLayer key={`align-${i}`} cloud={{ ...cloud, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(i === alignActive ? '#f4a21e' : '#1d78dc') }} size={2.5} budget={120000} pickable={false} />;
      })}
      {showPts && stage === 5 && mission !== 1 && !step && regTest && regTest.clouds.map((c2, i) => <CloudLayer key={i} cloud={{ ...c2, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[i % 6]) }} size={2.5} budget={120000} pickable={false} />)}
      {showPts && stage === 5 && mission !== 1 && !step && !regTest && survey && survey.visible.scans.map((s2, i) => <CloudLayer key={`in${i}`} cloud={{ ...s2.cloud, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) }} size={2.5} budget={60000} pickable={false} />)}
      {showPts && stage === 5 && mission !== 1 && step?.preview && <CloudLayer cloud={step.preview} mode={step.preview.colors ? "rgb" : "height"} size={2.5} budget={40000} pickable={false} />}
      {showPts && (stage === 6 || stage === 8) && displayedRun?.twinPreview && <CloudLayer cloud={displayedRun!.twinPreview!} mode={displayedRun!.twinPreview!.colors ? "rgb" : "height"} size={2.5} budget={40000} pickable={false} />}
      {showPts && stage === 6 && showMissing && practice?.tasks.twin.missing && practice.tasks.twin.missing.length > 0 && <CloudLayer cloud={cloudOf(practice.tasks.twin.missing)} mode="flat" colorOpts={{ flat: [255, 69, 58] }} size={3} budget={20000} pickable={false} />}
      {showPts && mission === 5 && timeView === 'A' && practice?.twinPreview && <CloudLayer cloud={practice.twinPreview} mode="height" size={2.5} budget={40000} pickable={false} />}
      {showPts && mission === 5 && timeView === 'B' && practice?.updatedPreview && <CloudLayer cloud={practice.updatedPreview} mode="height" size={2.5} budget={40000} pickable={false} />}
      {mission === 6 && T.final && displayedRun?.objects.map((o) => <BoxOutline key={`final-${o.id}`} bbox={o} color="#30a14e" />)}
      {stage === 7 && showObjectLabels && practice?.objects.map((o) => <Marker key={`label-${o.id}`} p={[o.centre[0], o.centre[1], o.max[2] + 0.15]} color="#30a14e" r={0.04} label={`${o.cls}${o.colour && o.colour !== 'unknown' ? ` · ${o.colour}` : ''}`} />)}
      {stage === 7 && taskTab === 'detect' && practice && refs.map((t, i) => { const found = matchRef?.get(i); return <BoxOutline key={t.id} bbox={t} color={found === undefined ? '#ff453a' : found ? '#30d158' : '#ff9f0a'} />; })}
      {stage === 7 && taskTab === 'detect' && practice && practice.objects.map((o, i) => practice.tasks.detect.match.spurious.includes(i) ? <BoxOutline key={`p${i}`} bbox={o} color="#8e8e93" dashed /> : null)}
      {stage === 7 && taskTab === 'change' && (mission !== 5 || timeView === 'changes') && practice && <>{practice.truth.changes.map((c, i) => <Marker key={`t${i}`} p={[c.centre[0], c.centre[1], 2.5]} color="#30d158" r={0.25} label={`${c.kind}`} />)}{practice.found.changes.map((c, i) => <Marker key={`f${i}`} p={[c.centre[0], c.centre[1], 1.5]} color="#ff9f0a" r={0.18} />)}</>}
      {(mission === 0 && stage === 2 || mission === 4 || mission === 6) && <><BoxOutline bbox={CRITICAL_CAMERA_ZONE} color="#af52de" dashed /><Marker p={[-.15, -6.8, 1.6]} color="#af52de" r={.08} label="Critical camera bay" /></>}
      {(stage === 7 && (taskTab === 'safety' || mission === 5 && timeView === 'safety') || stage === 2 && showZones) && SAFETY_ZONES.map((z) => <BoxOutline key={z.id} bbox={{ min: [z.min[0], z.min[1], z.zMin], max: [z.max[0], z.max[1], 0.8] }} color="#ff453a" dashed />)}
    </Viewport>
  );

  // ---- panels
  const selectedUnitEditor = () => {
    if (selL) {
      const i = d.lidars.indexOf(selL), it = lidarItem(selL.item);
      return (
        <>
          <div className="caption"><b style={{ color: UNIT_COLOURS[i % 6] }}>LiDAR {i + 1}</b> · {it.name} · {rayCount(selL).toLocaleString()} rays per scan</div>
          <Select label="Measurement resolution" value={selL.res} options={Object.entries(RES_TIERS).map(([value, tier]) => ({ value: value as ResTier, label: `${tier.label} · effort ×${tier.cost}` }))} onChange={(res) => patchLidar(selL.id, { res })} />
          <Slider label="Height" value={selL.z} min={0.3} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => patchLidar(selL.id, { z })} />
          <Slider label="Turn" value={Math.round(selL.yaw / D2R)} min={-180} max={180} step={5} unit="°" onChange={(v) => patchLidar(selL.id, { yaw: v * D2R })} />
          <Slider label="Tilt up (+) / down (−)" value={Math.round(-selL.pitch / D2R)} min={-90} max={90} step={5} unit="°" onChange={(v) => patchLidar(selL.id, { pitch: -v * D2R })} />
          {isMobile(selL) && <p className="hint">This unit rides the platform along the route below. Its position above is not used.</p>}
        </>
      );
    }
    if (selC) {
      const i = d.cameras.indexOf(selC), it = cameraItem(selC.item);
      return (
        <>
          <div className="caption"><b style={{ color: '#0a84ff' }}>Camera {i + 1}</b> · {it.name} · {it.w}×{it.h} px · {it.fov}° view{selC.cal.done ? ' · calibrated' : ' · not calibrated'}</div>
          <Slider label="Height" value={selC.z} min={0.5} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => patchCam(selC.id, { z })} />
          <Slider label="Turn" value={Math.round(selC.yaw / D2R)} min={-180} max={180} step={5} unit="°" onChange={(v) => patchCam(selC.id, { yaw: v * D2R })} />
          <Slider label="Tilt up (+) / down (−)" value={Math.round(-selC.pitch / D2R)} min={-90} max={90} step={5} unit="°" onChange={(v) => patchCam(selC.id, { pitch: -v * D2R })} />
          <Toggle label={`Low-light kit (+${usd(LOWLIGHT_KIT.cost)})`} checked={selC.kit} onChange={(kit) => patchCam(selC.id, { kit })} />
          <p className="hint">Moving or re-aiming a camera undoes its calibration.</p>
          {camStats && <div className="caption" data-testid="twin-cam-stats">In view: {pct(camStats.coverage)} of the surface, {pct(camStats.sharp)} sharply · containers readable: {camStats.containers.filter((c2) => c2.px !== null && c2.px >= 8).length} of {camStats.containers.length} (label ≥ 8 px) · small objects in view {camStats.smalls} of {camStats.smallTotal}</div>}
        </>
      );
    }
    if (selLight) return <p className="hint">Lighting unit: adds light around it. Place it in or near the dark zone (top right).</p>;
    return <p className="hint">Pick a unit in the list to edit it.</p>;
  };

  const unitList = (
    <div className="btn-row" style={{ flexWrap: 'wrap' }}>
      {d.lidars.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} data-testid={`twin-unit-l${i + 1}`} style={{ borderColor: UNIT_COLOURS[i % 6], borderWidth: 2, borderStyle: 'solid' }}>LiDAR {i + 1}</button>)}
      {mission >= 4 && d.cameras.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} data-testid={`twin-unit-c${i + 1}`} style={{ borderColor: '#0a84ff', borderWidth: 2, borderStyle: 'solid' }}>Camera {i + 1}</button>)}
      {d.lights.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} style={{ borderColor: '#ffcc00', borderWidth: 2, borderStyle: 'solid' }}>Lamp {i + 1}</button>)}
    </div>
  );

  const fb = practice ? feedbackFor(practice) : null;
  const gradeRows = (g: { total: number; perTask: { key: TaskKey; points: number; weight: number; score: number; enabled: boolean }[] }) => (
    <table className="table" data-testid="twin-grade-table"><thead><tr><td>Task</td><td>Score</td><td>Points</td></tr></thead><tbody>
      {g.perTask.map((t) => <tr key={t.key} style={{ opacity: t.enabled ? 1 : 0.4 }}><td>{TASK_NAMES[t.key]}</td><td className="mono">{pct(t.score)}</td><td className="mono">{t.points.toFixed(1)} / {t.enabled ? t.weight : 0}</td></tr>)}
      <tr><td><b>Total</b></td><td /><td className="mono" data-testid="twin-total"><b>{g.total.toFixed(1)} / 100</b></td></tr>
    </tbody></table>
  );

  const panel = (() => {
    switch (stage) {
      case 1: return (
        <>
          {mission === 0 && <Section title="Compare LiDAR scanners"><EquipmentCatalogue cameras={false} scale={T.settings.priceScale} buy={buyLidar} canBuy={(id) => d.lidars.length < LIMITS.lidars && (id !== 'tls-hire' || d.lidars.filter((u) => u.item === id).length < 2) && (!lidarItem(id).mobile || !d.lidars.some(isMobile)) && affordable(lidarPlan(id).f)} /></Section>}
          {mission >= 4 && <Section title="Additional cameras (optional)" open={false}><EquipmentCatalogue cameras scale={T.settings.priceScale} buy={buyCamera} canBuy={(id) => d.cameras.length < LIMITS.cameras && affordable(cameraPlan(id))} /></Section>}
          <Section title="Extras" open={mission >= 4}>
            <Btn sm icon={<Plus size={14} />} onClick={() => setDesign((q) => ({ ...q, lights: [...q.lights, { id: newId('lamp'), x: q.lights.length ? freshSpot()[0] : 8, y: q.lights.length ? freshSpot()[1] : 5, z: 3 }] }))} disabled={d.lights.length >= LIMITS.lights || !affordable((q) => ({ ...q, lights: [...q.lights, { id: 'x', x: 0, y: 0, z: 3 }] }))} testId="twin-buy-light">Lighting unit ({Math.round(LIGHT_UNIT.cost * T.settings.priceScale)})</Btn>
            {d.platform && <Toggle label={`Mobile scanning platform (${Math.round(MOBILE_PLATFORM.cost * T.settings.priceScale)})`} checked={d.platform} onChange={(v) => { if (!v && d.lidars.some(isMobile)) { lab.notify('Remove the mobile LiDAR first: it needs the platform.', 'warn'); return; } setDesign((q) => ({ ...q, platform: v })); }} hint="Needed for the mobile LiDAR (it is added for you)." />}
            <p className="hint">Installing each device has a small cost too. Credits use a USD reference divided by 5; generic accessories are educational estimates.</p>
          </Section>
          <Section title="Your bill" hint="Your choices are kept. Come back any time to remove something or add more: the other items keep their place and calibration.">
            {(() => {
              const k = T.settings.priceScale, c = (v: number) => Math.round(v * k);
              type Row = { label: string; amount: number; sub?: boolean; remove?: { id: string; test: string; what: string; onClick?: () => void } };
              const rows: Row[] = [];
              d.lidars.forEach((u, i) => {
                const it = lidarItem(u.item);
                rows.push({ label: `LiDAR ${i + 1}: ${it.name}${u.res !== 'standard' ? ` · ${u.res}` : ''}`, amount: c(it.cost * RES_TIERS[u.res].cost), remove: { id: u.id, test: `l${i + 1}`, what: `LiDAR ${i + 1}` } });
                rows.push({ label: 'Installation', amount: c(INSTALL.lidar), sub: true });
              });
              d.cameras.forEach((u, i) => {
                const it = cameraItem(u.item);
                rows.push({ label: `Camera ${i + 1}: ${it.name}${u.id === INSPECTION_CAMERA_ID ? ' · specified for Mission 5' : ''}`, amount: c(it.cost), remove: u.id === INSPECTION_CAMERA_ID ? undefined : { id: u.id, test: `c${i + 1}`, what: `Camera ${i + 1}` } });
                if (u.kit) rows.push({ label: 'Low-light kit', amount: c(LOWLIGHT_KIT.cost), sub: true });
                rows.push({ label: 'Installation', amount: c(INSTALL.camera), sub: true });
              });
              d.lights.forEach((u, i) => { rows.push({ label: `Lighting unit ${i + 1}`, amount: c(LIGHT_UNIT.cost), remove: { id: u.id, test: `lamp${i + 1}`, what: `Lighting unit ${i + 1}` } }); rows.push({ label: 'Installation', amount: c(INSTALL.light), sub: true }); });
              if (d.platform) rows.push({ label: 'Mobile scanning platform', amount: c(MOBILE_PLATFORM.cost), remove: d.lidars.some(isMobile) ? undefined : { id: 'platform', test: 'platform', what: 'the platform', onClick: () => setDesign((q) => ({ ...q, platform: false })) } });
              return (
                <div className="bill" data-testid="twin-owned" role="table" aria-label="Your bill">
                  <div className="bill-head"><span>Item</span><span>US$</span></div>
                  {rows.length === 0 && <div className="bill-empty">Nothing yet. Add equipment above.</div>}
                  {rows.map((r, i) => (
                    <div key={i} className={`bill-row ${r.sub ? 'sub' : ''}`} role="row">
                      <span className="bill-label">{r.label}</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{usd(r.amount)}</span>
                      <span className="bill-x-slot">{r.remove && <button className="bill-x" aria-label={`Remove ${r.remove.what}`} title={`Remove ${r.remove.what}`} onClick={r.remove.onClick ?? (() => remove(r.remove!.id))} data-testid={`twin-remove-${r.remove.test}`}>✕</button>}</span>
                    </div>
                  ))}
                  <div className="bill-total"><span>Total</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt" data-testid="twin-bill-total">{usd(cost.total)}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row sub"><span className="bill-label">Budget</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{usd(T.settings.budget)}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row"><span className="bill-label"><b>Remaining</b></span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt"><b>{usd(cost.remaining)}</b></span><span className="bill-x-slot" /></div>
                </div>
              );
            })()}
          </Section>
        </>
      );
      case 2: return (
        <>
          <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })} testId="twin-back-equipment">← Change equipment</Btn></div>
          <Section title="Place your equipment">
            {unitList}
            <Btn sm variant={placeMode ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => { setPlaceMode((v) => !v); setRouteMode(false); }} disabled={!sel} testId="twin-place">{placeMode ? 'Click the scene or plan…' : 'Move selected by clicking'}</Btn>
            {selectedUnitEditor()}
          </Section>
          {d.lidars.some(isMobile) && (
            <Section title="Mobile route">
              <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                <Btn sm variant={routeMode ? 'primary' : ''} onClick={() => { setRouteMode((v) => !v); setPlaceMode(false); }} testId="twin-route-tool">{routeMode ? 'Click to add route points…' : 'Edit route'}</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [] }))} disabled={!d.route.length}>Clear</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [[-9, -0.3], [9, -0.3]] }))}>Straight</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [[-9, -0.3], [9, -0.3], [9, -5], [-9, -5]] }))}>Loop</Btn>
              </div>
              <Slider label="Scans along the route" value={d.routeSteps} min={4} max={16} step={1} onChange={(v) => setDesign((q) => ({ ...q, routeSteps: v }))} hint="More scans overlap more but take longer. The platform only knows its position by dead reckoning, so it drifts." />
              <Toggle label="Motion distortion (the platform moves during a sweep)" checked={d.distortion} onChange={(v) => setDesign((q) => ({ ...q, distortion: v }))} />
            </Section>
          )}
          <p className="hint">The plan (top left of the view) shows where everything stands: click it to move the selected unit, or to add route points. Coverage and equipment numbers are in the Live statistics card below the view.</p>
          {cov && <p className="hint" data-testid="twin-coverage-note">Coverage is geometry, not points: the share of the surface with a clear straight line from at least one scanner, inside its range and field of view. Red preview dots are not seen by any LiDAR. Test measured coverage to include sampling density, range noise and dropout. A coarse sensor can see a surface and still measure it poorly.</p>}
          <Toggle label="Show the safety zones" checked={showZones} onChange={setShowZones} />
        </>
      );
      case 3: return (
        <>
          <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })}>← Change equipment</Btn></div>
          <Callout kind="edu" title="How calibration works">
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 3 }}>
              <li><b>Connect</b> each camera to a LiDAR: drag a wire from its dot (several cameras can share one).</li>
              <li><b>Match</b> the red crosses to the green squares, inspect the marker error and try a manual correction; assistance is available afterwards.</li>
              <li><b>Watch</b> the view: that LiDAR's points take the camera's colours. When it is right, the labels land on the right objects.</li>
            </ol>
          </Callout>
          {d.cameras.length === 0 ? <p className="hint">You have no cameras. Colour-coded labels require a camera with a view of the measured labels.</p> : (
            <>
              <PairBoard cams={d.cameras.map((u) => ({ id: u.id, label: `Camera ${d.cameras.indexOf(u) + 1}`, sub: cameraItem(u.item).name, done: u.cal.done, to: pairedLidar(u)?.id ?? null }))} lids={d.lidars.map((u, i) => ({ id: u.id, label: `LiDAR ${i + 1}`, sub: lidarItem(u.item).name, nearestOf: d.cameras.filter((c) => nearestLidar(c)?.id === u.id).map((c) => c.id) }))} selected={sel} onSelect={(id) => T.set({ selectedUnit: id })} onPair={(cid, lid) => setDesign((q) => ({ ...q, cameras: q.cameras.map((c) => c.id === cid ? { ...c, pairedLidarId: lid, cal: c.pairedLidarId === lid ? c.cal : { est: nominalOf(c), fov: cameraItem(c.item).fov, done: false } } : c) }))} />
              {selC && d.lidars.length > 0 && (
                <>

                  {calLid && <FovOverlapChart cam={selC} lid={calLid} camNo={d.cameras.indexOf(selC) + 1} lidNo={d.lidars.indexOf(calLid) + 1} dist={fovDist} onDist={setFovDist} />}
                  <div className="caption" data-testid="twin-cal-colour">{calBusy ? 'Preparing the LiDAR scan and the colours…' : calCloud ? `${connected.length > 1 ? `Cameras ${connected.map((c) => d.cameras.indexOf(c) + 1).join(' + ')} together colour` : `Camera ${d.cameras.indexOf(selC) + 1} colours`} ${calCloud.coloured.toLocaleString()} of ${calCloud.total.toLocaleString()} points of LiDAR ${calLid ? d.lidars.indexOf(calLid) + 1 : ''} (${calCloud.total ? Math.round((100 * calCloud.coloured) / calCloud.total) : 0} %). Grey points are not in ${connected.length > 1 ? 'any of their' : "this camera's"} view.` : ''}</div>
                </>
              )}
              {selC ? <CalPanel key={selC.id + JSON.stringify([selC.x, selC.y, selC.z, selC.yaw, selC.pitch, selC.kit])} unit={selC} index={d.cameras.indexOf(selC)} lights={d.lights} onChange={(c) => setDesign((q) => ({ ...q, cameras: q.cameras.map((x) => (x.id === c.id ? c : x)) }))} /> : <p className="hint">Pick a camera above. A ✓ means it is calibrated.</p>}
            </>
          )}
        </>
      );
      case 4: return (
        <>
          <Callout kind="edu" title="What you get">Scans include range noise, lost returns and a few floating points. Your fixed scanners also carry a small installation error. Continue to <b>Align scans</b> to match them one at a time.</Callout>
          {survey && (
            <table className="table" data-testid="twin-survey"><thead><tr><td>Scan</td><td>Points</td><td>Coloured by a camera</td></tr></thead><tbody>
              {survey.visible.scans.map((s2, i) => <tr key={s2.index}><td>{s2.name}</td><td className="mono">{s2.cloud.count.toLocaleString()}</td><td className="mono">{surveyView?.[i]?.cam ? `${surveyView[i].coloured.toLocaleString()} (${Math.round((100 * surveyView[i].coloured) / Math.max(1, s2.cloud.count))} %)` : d.cameras.length ? '…' : 'no camera'}</td></tr>)}
              <tr><td><b>All</b></td><td className="mono"><b>{survey.visible.stats.points.toLocaleString()}</b></td><td className="mono"><b>{surveyView ? surveyView.reduce((a, v) => a + v.coloured, 0).toLocaleString() : ''}</b></td></tr>
            </tbody></table>
          )}
          {survey && <Toggle label="As delivered: each scan in its own coordinate system" checked={ownFrames} onChange={setOwnFrames} hint="A scanner knows nothing about the building: every scan is centred on its own scanner, so they pile up around one point. Turn this off to place them where you put the scanners (roughly). Registration, in the pipeline, joins them properly." />}
          {survey && d.cameras.length > 0 && <Toggle label="Colour the points that a camera sees" checked={camColour} onChange={setCamColour} hint="Only those points take the camera's colours (with your calibration). The rest stay in their scanner's colour. A camera that is badly calibrated puts the colours in the wrong places." />}
          <p className="hint">Practice survey = Time A. A second survey (Time B, after changes) is taken automatically when your pipeline compares surveys.</p>
        </>
      );
      case 5: {
        const names = (ks: BlockKind[]) => ks.map((k) => BLOCKS[k].name.replace(/ \(.*\)$/, ''));
        const has = (kinds: BlockKind[]) => T.pipeline.some((x) => kinds.includes(x.kind) && !x.bypass);
        const checklist: { ok: boolean; text: string }[] = [
          { ok: has(['icp', 'mobileicp', 'merge']), text: 'The scans are joined (registration)' },
          { ok: has(['euclid', 'dbscan']), text: 'Points are grouped into objects' },
          { ok: has(['classify']), text: 'Objects are named' },
          { ok: has(['diff', 'objmatch']), text: 'Changes are compared (optional)' },
          { ok: has(['safety']), text: 'Safety zones are checked (optional)' },
        ];
        const setParam = (id: string, k: string, v: number) => T.set({ pipeline: T.pipeline.map((x) => (x.id === id ? { ...x, params: { ...x.params, [k]: v } } : x)), practice: null });
        const blockCard = (b: (typeof T.pipeline)[number]) => {
          const i = T.pipeline.indexOf(b), info = BLOCKS[b.kind], err = chk.perBlock[i], st = practice?.steps.find((x) => x.id === b.id), isReg = phaseIndex(b.kind) === 0, open = openBlock === b.id;
          const phase = phaseIndex(b.kind), samePhase = T.pipeline.filter((x) => phaseIndex(x.kind) === phase), pos = samePhase.indexOf(b);
          const swap = (d2: number) => { const o = samePhase[pos + d2]; if (!o) return; const p = [...T.pipeline], a2 = p.indexOf(b), b2 = p.indexOf(o); [p[a2], p[b2]] = [p[b2], p[a2]]; T.set({ pipeline: p, practice: null }); };
          const reg = isReg ? (regTest?.id === b.id ? regTest.report : st?.reg) : undefined;
          return (
            <div key={b.id} data-testid={`twin-block-${i + 1}`} style={{ border: `1px solid ${err ? '#ff453a' : 'var(--sep)'}`, borderRadius: 12, padding: 8, display: 'grid', gap: 4, opacity: b.bypass ? 0.55 : 1, background: 'var(--bg-elev, #fff)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: '0.875rem' }} title={`From the ${BLOCK_TAB[b.kind]} tab`}>{info.name}</b></div>
                <button className="btn sm" aria-label="Move up" disabled={pos === 0} onClick={() => swap(-1)} title="Earlier in this phase">↑</button>
                <button className="btn sm" aria-label="Move down" disabled={pos === samePhase.length - 1} onClick={() => swap(1)} title="Later in this phase">↓</button>
                <button className="btn sm" aria-pressed={!!b.bypass} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, bypass: !x.bypass } : x)), practice: null })} data-testid={`twin-bypass-${i + 1}`} title="Keep it in the list but skip it">{b.bypass ? 'Off' : 'On'}</button>
                <button className="bill-x" aria-label={`Remove ${info.name}`} title="Remove this block" onClick={() => T.set({ pipeline: T.pipeline.filter((x) => x.id !== b.id), practice: null })} data-testid={`twin-remove-${i + 1}`}>✕</button>
              </div>
              <div className="caption">{info.help}</div>
              {(() => { const cur = st && !st.bypassed && !st.error ? { before: st.before, after: st.after, stale: false } : lastRun[b.id] && !b.bypass ? { ...lastRun[b.id], stale: lastRun[b.id].sig !== blockSig(b) } : null; if (!cur || cur.before === cur.after) return null; const drop = cur.after < cur.before, share = cur.after / Math.max(1, cur.before), pc = Math.round(Math.abs(cur.after - cur.before) / Math.max(1, cur.before) * 100); return (
                <div className={`pointchange ${drop ? 'down' : 'up'} ${cur.stale ? 'stale' : ''}`} data-testid={`twin-points-${i + 1}`} title={`${cur.before.toLocaleString()} points before this block, ${cur.after.toLocaleString()} after`}>
                  <span className="pc-line"><span className="pc-badge">{drop ? '▼' : '▲'} {drop ? '−' : '+'}{pc} %</span><span className="pc-nums">{cur.before.toLocaleString()} → {cur.after.toLocaleString()} points{cur.stale ? ' · test again' : ''}</span></span>
                  <span className="pc-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} /></span>
                </div>); })()}
              {(() => {
                const pk = st && !st.bypassed ? st.pick : lastPick[b.id]; if (!pk || b.bypass || !pk.items.length) return null;
                const off = b.off ?? [], setOff = (n: string[]) => { T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, off: n } : x)), practice: null }); setRerunAt(Date.now()); };
                return (
                  <div className="picklist" data-testid={`twin-pick-${i + 1}`}>
                    <div className="picklist-head"><b>{pk.mode === 'remove' ? `${pk.items.length} planes found` : `${pk.items.length + pk.hidden} clusters found`}</b><span>tick the ones to {pk.mode === 'remove' ? 'remove' : 'keep'}</span>
                      <button type="button" className="picklist-all" onClick={() => setOff([])}>All</button><button type="button" className="picklist-all" onClick={() => setOff(pk.items.map((x) => x.key))} data-testid={`twin-pick-none-${i + 1}`}>None</button></div>
                    <ul>{pk.items.map((it, k) => <li key={it.key}><label><input type="checkbox" checked={!off.includes(it.key)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== it.key) : [...off, it.key])} data-testid={`twin-pick-${i + 1}-${k + 1}`} /><span className="pk-name">{it.label}</span><small>{it.pts.toLocaleString()} pts</small></label></li>)}</ul>
                    {pk.hidden > 0 && <div className="caption">{pk.hidden} smaller clusters are not listed.</div>}
                  </div>
                );
              })()}
              {canRunParallel(b.kind) && (
                <div className="seg" role="group" aria-label="How this block runs" style={{ justifySelf: 'start' }}>
                  <button aria-pressed={!b.parallel} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, parallel: false } : x)), practice: null })} data-testid={`twin-seq-${i + 1}`} title="Runs after the block before it">In sequence</button>
                  <button aria-pressed={!!b.parallel} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, parallel: true } : x)), practice: null })} data-testid={`twin-par-${i + 1}`} title="Runs at the same time as the parallel blocks next to it; their results are joined">In parallel</button>
                </div>
              )}
              {err && <div className="caption" style={{ color: '#ff453a' }} data-testid={`twin-block-error-${i + 1}`}>⚠ {err}</div>}
              {st && !st.bypassed && st.note && <div className="caption" style={{ color: '#30a14e' }}>Last run: {st.before === st.after ? `${st.after.toLocaleString()} points (unchanged) · ` : ''}{st.note}</div>}
              {info.params.length > 0 && <button className="btn sm" onClick={() => setOpenBlock(open ? null : b.id)} aria-expanded={open} data-testid={`twin-settings-${i + 1}`} style={{ justifySelf: 'start' }}>{open ? '▾ Hide settings' : '▸ Settings'}</button>}
              {open && info.params.map((p) => p.options
                ? <Select<string> key={p.key} label={p.label} value={String(b.params[p.key] ?? p.def)} options={p.options.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(v) => setParam(b.id, p.key, Number(v))} hint={p.hint} />
                : <Slider key={p.key} label={p.label} value={b.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} unit={p.unit} format={(v) => (p.step < 1 ? v.toFixed(p.step < 0.05 ? 2 : 1) : String(v))} onChange={(v) => setParam(b.id, p.key, v)} hint={p.hint} />)}
              {isReg && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <Btn sm variant="primary" onClick={() => testRegistration(b)} busy={regBusy} disabled={b.bypass || !!err} testId={`twin-test-reg-${i + 1}`}>Test this registration</Btn>
                  {reg && Number.isFinite(reg.rmse) && (
                    <div data-testid="twin-reg-result" style={{ display: 'grid', gap: 3 }}>
                      <div style={{ fontWeight: 650 }}>RMSE <span className="mono">{(reg.rmse * 100).toFixed(1)} cm</span> · overlap <span className="mono">{Math.round(reg.overlap * 100)} %</span> · <span style={{ color: reg.rmse < 0.03 && reg.overlap > 0.3 ? '#30a14e' : reg.rmse < 0.06 ? '#b36b00' : '#ff453a' }}>{reg.rmse < 0.03 && reg.overlap > 0.3 ? 'Excellent' : reg.rmse < 0.06 ? 'Fair: keep tuning' : 'Poor: scans do not fit'}</span></div>
                      <table className="table"><thead><tr><td>Scan</td><td>RMSE before → after</td><td>Overlap</td></tr></thead><tbody>{reg.scans.map((s2) => <tr key={s2.name}><td>{s2.name}{!s2.accepted && reg.mode !== 'merge' ? ' ⚠' : ''}</td><td className="mono">{(s2.rmseBefore * 100).toFixed(1)} → {(s2.rmseAfter * 100).toFixed(1)} cm</td><td className="mono">{Math.round(s2.overlapAfter * 100)} %</td></tr>)}</tbody></table>
                      <div className="caption">RMSE = how far apart matching points of two scans still are. Lower is better. Judged the same way whatever match distance you choose. These settings are used in your evaluation.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        };
        if (mission === 1) return (
          <AlignPanel names={survey?.visible.scans.map((q) => q.name) ?? []} rows={alignRows} active={alignActive} preview={alignPreview} busy={regBusy || !!T.busy} hasSurvey={!!survey} onSelect={selectAlignment} onPreview={setAlignPreview} onAlign={alignScan} onReset={resetAlignment} onAcquire={() => T.set({ stage: 4 })}
            settings={icpBlock ? <>{BLOCKS.icp.params.map((p) => p.options
              ? <Select<string> key={p.key} label={p.label} value={String(icpBlock.params[p.key] ?? p.def)} options={p.options.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(v) => setParam(icpBlock.id, p.key, Number(v))} hint={p.hint} />
              : <Slider key={p.key} label={p.label} value={icpBlock.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} unit={p.unit} format={(v) => (p.step < 1 ? v.toFixed(p.step < 0.05 ? 2 : 1) : String(v))} onChange={(v) => setParam(icpBlock.id, p.key, v)} hint={p.hint} />)}</> : null} />
        );
        const groups = parallelGroups(T.pipeline);
        /** one phase: its blocks one after the other (↓), with runs of parallel blocks side by side between a fork and a join */
        const laneBody = (ph: (typeof PHASES)[number], pi: number) => {
          const inPhase = T.pipeline.filter((x) => phaseIndex(x.kind) === pi && missionDef.blocks.includes(x.kind)), items: ReactNode[] = [];
          for (let k = 0; k < inPhase.length;) {
            const g = groups[T.pipeline.indexOf(inPhase[k])];
            if (g >= 0) {
              let j = k; while (j < inPhase.length && groups[T.pipeline.indexOf(inPhase[j])] === g) j++;
              items.push(<div key={`g${k}`} className="pipe-par" data-testid="twin-parallel-group"><div className="pipe-par-label">⑂ at the same time · results joined</div><div className="pipe-par-row" style={{ gridTemplateColumns: `repeat(${j - k}, minmax(0, 1fr))` }}>{inPhase.slice(k, j).map(blockCard)}</div><div className="pipe-par-label">⑃ joined: {ph.id === 'compare' ? 'findings combined' : 'points kept by every block'}</div></div>);
              k = j;
            } else { items.push(blockCard(inPhase[k])); k++; }
            if (k < inPhase.length) items.push(<div key={`a${k}`} className="pipe-arrow" aria-hidden="true">↓</div>);
          }
          return (
            <>
              {items}
              <select aria-label={`Add to phase ${pi + 1}`} value="" onChange={(e) => { if (e.target.value) T.set({ pipeline: insertBlock(T.pipeline, newBlock(e.target.value as BlockKind)), practice: null }); }} data-testid={`twin-add-phase-${pi + 1}`}>
                <option value="">+ Add a block…</option>
                {[...new Set(ph.kinds.filter((k) => missionDef.blocks.includes(k)).map((k) => BLOCK_TAB[k]))].map((tab) => <optgroup key={tab} label={`From ${tab}`}>{ph.kinds.filter((k) => missionDef.blocks.includes(k) && BLOCK_TAB[k] === tab).map((k) => <option key={k} value={k}>{BLOCKS[k].name}</option>)}</optgroup>)}
              </select>
            </>
          );
        };
        const lanesView = (wide: boolean) => (
          <div className={wide ? 'pipe-cols' : 'pipe-stack'} data-testid={wide ? 'twin-lanes-wide' : 'twin-lanes'}>
            {PHASES.map((ph, pi) => ph.kinds.some((k) => missionDef.blocks.includes(k)) ? (
              <Fragment key={ph.id}>
                <div className={`pipe-lane ${T.pipeline.some((x) => phaseIndex(x.kind) === pi) ? 'has' : ''}`} data-testid={`twin-phase-${pi + 1}`}>
                  <div className="pipe-lane-head"><b>{ph.title}</b>{ph.required && <span className="pipe-req">required</span>}<div className="caption">{ph.why}</div></div>
                  {laneBody(ph, pi)}
                </div>
                {pi < PHASES.length - 1 && <div className="pipe-link" aria-hidden="true"><span>{wide ? '→' : '↓'}</span></div>}
              </Fragment>
            ) : null)}
          </div>
        );
        const expandedView = pipeExpanded && createPortal(
          <div className="pipe-overlay" role="dialog" aria-label="Pipeline builder (expanded)" data-testid="twin-pipe-overlay">
            <div className="pipe-overlay-head">
              <div style={{ flex: 1, minWidth: 260 }}><b style={{ fontSize: '1.15rem' }}>Your pipeline</b>
                <div className="caption">Each phase feeds the next (→). Inside a phase, blocks run one after another (↓), or side by side when you set them to parallel.</div></div>
              <Btn sm variant="primary" icon={<Play size={14} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-wide">Run practice</Btn>
              <Btn sm onClick={() => setPipeExpanded(false)} testId="twin-collapse-builder">Collapse ⤡</Btn>
            </div>
            <div data-testid="twin-checklist-wide" className="pipe-chips">{checklist.filter((c, i) => mission === 1 ? i === 0 : mission === 3 ? i === 1 || i === 2 : mission === 5 ? i >= 3 : false).map((c) => <span key={c.text} className={`pipe-chip ${c.ok ? 'ok' : ''}`}>{c.ok ? '✓' : '○'} {c.text}</span>)}</div>
            {lanesView(true)}
          </div>, document.body);
        return (
          <>
            {expandedView}
            <Callout kind="edu" title="This mission’s processing tools">Earlier mission blocks remain in your system. Add and tune the tools for this mission, then test the measured result. Return to earlier missions to adjust their settings.</Callout>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn variant="primary" icon={<Play size={16} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run">Run practice</Btn>
              <Btn sm onClick={() => setPipeExpanded(true)} testId="twin-expand-builder" title="Open the builder full size">Expand ⤢</Btn>
              <Btn sm onClick={() => T.set({ pipeline: T.pipeline.filter((b) => !missionDef.blocks.includes(b.kind)), practice: null })}>Clear mission tools</Btn>
            </div>
            <div data-testid="twin-checklist" style={{ display: 'grid', gap: 2 }}>{checklist.filter((c, i) => mission === 1 ? i === 0 : mission === 3 ? i === 1 || i === 2 : mission === 5 ? i >= 3 : false).map((c) => <div key={c.text} className="caption" style={{ color: c.ok ? '#30a14e' : undefined }}>{c.ok ? '✓' : '○'} {c.text}</div>)}</div>
            {chk.global.map((g) => <div key={g} className="caption" style={{ color: '#ff453a' }}>⚠ {g}</div>)}
            {!chk.ok && !chk.global.length && <p className="hint">Fix the ⚠ messages in the blocks below to run.</p>}
            {pipeExpanded ? <p className="hint" data-testid="twin-expanded-note">The builder is open full size. Press Collapse to bring it back here.</p> : lanesView(false)}
            {practice && (
              <Section title="What each block did">
                <table className="table" data-testid="twin-steps"><thead><tr><td>Block</td><td>Points</td></tr></thead><tbody>
                  {practice.steps.map((s2, i) => missionDef.blocks.includes(s2.kind) ? <tr key={i} style={{ cursor: s2.preview ? 'pointer' : 'default', background: T.selectedStep === i ? 'rgba(10,132,255,.12)' : undefined }} onClick={() => s2.preview && T.set({ selectedStep: i })}><td>{BLOCKS[s2.kind].name.replace(/ \(.*\)$/, '')}{s2.error ? ' ⚠' : ''}</td><td className="mono">{s2.bypassed ? 'off' : `${s2.before.toLocaleString()} → ${s2.after.toLocaleString()}`}</td></tr> : null)}
                </tbody></table>
                <p className="hint">Click a row to see the points after that block, in the 3D view.</p>
              </Section>
            )}
            <Section title="Saved pipelines" open={false}>
              <div className="btn-row"><input aria-label="Pipeline name" value={pname} onChange={(e) => setPname(e.target.value)} style={{ flex: 1 }} /><Btn sm onClick={() => T.set({ saved: [...T.saved.filter((x) => x.name !== pname), { name: pname, blocks: T.pipeline }] })} testId="twin-save-pipe">Save</Btn></div>
              {T.saved.map((sv) => <div key={sv.name} className="btn-row"><Btn sm onClick={() => T.set({ pipeline: sv.blocks, practice: null })}>{sv.name}</Btn><Btn sm onClick={() => T.set({ saved: T.saved.filter((x) => x.name !== sv.name) })}>✕</Btn></div>)}
            </Section>
          </>
        );
      }
      case 6: return !practice ? <><p className="hint">Run the practice pipeline first (stage 6).</p><Btn onClick={() => T.set({ stage: 5 })}>Go to the pipeline</Btn></> : (
        <>
          <Callout kind="edu" title="Your digital twin">The cloud before any wall or object removal, compared with the true surfaces below 3 m. <b style={{ color: '#ff453a' }}>Red dots</b> are true surfaces your cloud does not cover.</Callout>
          <div className="stats-grid" data-testid="twin-twin">
            <div className="stat"><div className="k">Covered</div><div className="v">{pct(practice.tasks.twin.coverage)}</div></div>
            <div className="stat"><div className="k">Median error</div><div className="v">{num(practice.tasks.twin.medianErr * 100)} cm</div></div>
            <div className="stat"><div className="k">Scans agree to</div><div className="v">{num(practice.tasks.twin.poseErrCm)} cm</div></div>
            <div className="stat"><div className="k">Points</div><div className="v">{practice.tasks.twin.points.toLocaleString()}</div></div>
          </div>
          <Toggle label="Show the missing surfaces" checked={showMissing} onChange={setShowMissing} />
          {fb?.twin.map((x, i) => <p key={i} className="hint">{x}</p>)}
        </>
      );
      case 7: return !practice ? <><p className="hint">Run the practice pipeline first.</p><Btn onClick={() => T.set({ stage: 5 })}>Go to the pipeline</Btn></> : (
        <>
          <Seg value={taskTab} onChange={setTaskTab} label="Task" options={(mission === 3 ? [{ value: 'detect', label: 'Objects' }] : mission === 4 ? [{ value: 'colour', label: 'Colour' }] : mission === 5 ? [{ value: 'change', label: 'Change' }, { value: 'safety', label: 'Safety' }] : [{ value: 'detect', label: 'Objects' }, { value: 'colour', label: 'Colour' }, { value: 'change', label: 'Change' }, { value: 'quality', label: 'Noise' }, { value: 'safety', label: 'Safety' }]) as { value: typeof taskTab; label: string }[]} />
          {taskTab === 'detect' && (
            <>
              <Toggle label="Show detected object labels" checked={showObjectLabels} onChange={setShowObjectLabels} />
              <div className="stats-grid" data-testid="twin-detect"><div className="stat"><div className="k">Found</div><div className="v">{practice.tasks.detect.tp}/{practice.tasks.detect.refs}</div></div><div className="stat"><div className="k">Precision</div><div className="v">{pct(practice.tasks.detect.precision)}</div></div><div className="stat"><div className="k">Recall</div><div className="v">{pct(practice.tasks.detect.recall)}</div></div><div className="stat"><div className="k">Small found</div><div className="v">{pct(practice.tasks.detect.smallRecall)}</div></div></div>
              <table className="table"><thead><tr><td>Class</td><td>Right / real</td></tr></thead><tbody>{TWIN_CLASSES.filter((c) => practice.tasks.detect.byClass[c].ref > 0).map((c) => <tr key={c}><td>{c}</td><td className="mono">{practice.tasks.detect.byClass[c].found} / {practice.tasks.detect.byClass[c].ref}</td></tr>)}</tbody></table>
              <p className="hint">3D: green = found with the right class, amber = found but misnamed, red = missed, grey dashed = reported but not real.</p>
            </>
          )}
          {taskTab === 'colour' && (
            <>
              <div className="stats-grid" data-testid="twin-colour"><div className="stat"><div className="k">Correct</div><div className="v">{practice.tasks.colour.correct}/{practice.tasks.colour.total}</div></div><div className="stat"><div className="k">No reading</div><div className="v">{practice.tasks.colour.unknown}</div></div><div className="stat"><div className="k">Macro F1</div><div className="v">{pct(practice.tasks.colour.macroF1)}</div></div></div>
              <table className="table"><thead><tr><td>Container</td><td>True</td><td>Read</td></tr></thead><tbody>{practice.tasks.colour.rows.map((r) => <tr key={r.id}><td>{r.id.replace('container-', '')}</td><td>{r.truth}</td><td style={{ color: r.got === r.truth ? '#30d158' : '#ff453a' }}>{r.got}</td></tr>)}</tbody></table>
            </>
          )}
          {taskTab === 'change' && (
            <>
              <div className="stats-grid" data-testid="twin-change"><div className="stat"><div className="k">Reported</div><div className="v">{practice.tasks.change.found}</div></div><div className="stat"><div className="k">Real</div><div className="v">{practice.tasks.change.truth}</div></div><div className="stat"><div className="k">Right kind & place</div><div className="v">{practice.tasks.change.kindOk}</div></div></div>
              <table className="table"><thead><tr><td>Real change</td><td>Your answer</td></tr></thead><tbody>{practice.tasks.change.rows.map((r, i) => <tr key={i}><td>{r.truth}</td><td style={{ color: r.got === 'missed' ? '#ff453a' : undefined }}>{r.got}</td></tr>)}</tbody></table>
              <p className="hint">3D: green markers are the real changes, orange the ones you found.</p>
            </>
          )}
          {taskTab === 'quality' && <div className="stats-grid" data-testid="twin-quality"><div className="stat"><div className="k">Floating points removed</div><div className="v">{pct(practice.tasks.quality.outlierRemoval)}</div></div><div className="stat"><div className="k">Real points kept</div><div className="v">{pct(practice.tasks.quality.retention)}</div></div><div className="stat"><div className="k">Small-object points kept</div><div className="v">{pct(practice.tasks.quality.smallRetention)}</div></div></div>}
          {taskTab === 'safety' && (
            <>
              <Callout kind="warn" title="Educational only">This is a teaching simulation, not a certified safety system.</Callout>
              <table className="table" data-testid="twin-safety"><thead><tr><td>Zone</td><td>Truth</td><td>Yours</td></tr></thead><tbody>{practice.tasks.safety.rows.map((r) => <tr key={r.zone}><td>{r.zone}</td><td>{r.truth}</td><td style={{ color: r.got.startsWith('violated') === r.truth.startsWith('violated') ? '#30d158' : '#ff453a' }}>{r.got}</td></tr>)}</tbody></table>
            </>
          )}
          {fb && <div className="hint">{fb[taskTab === 'detect' ? 'detect' : taskTab].map((x, i) => <div key={i}>• {x}</div>)}</div>}
        </>
      );
      default: return (
        <>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn variant="primary" icon={<Play size={16} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-2">Run practice</Btn>
            <Btn variant="good" onClick={submitFinal} busy={!!T.busy} disabled={!readyForFinal(T.progress) || !cost.ok || !chk.ok || (T.settings.maxSubmissions > 0 && finalsUsed >= T.settings.maxSubmissions)} testId="twin-final">Final evaluation{T.settings.maxSubmissions > 0 ? ` (${Math.max(0, T.settings.maxSubmissions - finalsUsed)} left)` : ''}</Btn>
          </div>
          <p className="hint">Grade as often as you like. Practice shows every detail. The final evaluation runs your current system, unchanged, on 2 other scenario variants and averages the scores. When you are happy, send the result below.</p>
          {T.busy && <p className="hint" data-testid="twin-busy">{T.busy}</p>}
          {T.final && <CompletionReport result={T.final} design={d} progress={T.progress} />}
          {T.final && <Section title="Final evaluation"><div data-testid="twin-final-result">{gradeRows(T.final.grade)}</div><p className="hint">Averaged over scenario variants {T.final.runs.map((r) => r.seed).join(' and ')}.</p></Section>}
          {practice && (
            <>
              <Section title="Practice grade">{gradeRows(practice.grade)}</Section>
              {fb && TASK_KEYS.map((k) => <Section key={k} title={TASK_NAMES[k]} open={false}>{fb[k].map((x, i) => <p key={i} className="hint">{x}</p>)}</Section>)}
            </>
          )}
          <Section title="Attempts">
            <table className="table" data-testid="twin-attempts"><thead><tr><td>When</td><td>Kind</td><td>Score</td><td>Cost</td></tr></thead><tbody>{[...T.attempts].reverse().slice(0, 12).map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleTimeString()}</td><td>{a.kind}</td><td className="mono">{a.total.toFixed(1)}</td><td className="mono">{a.cost}</td></tr>)}</tbody></table>
          </Section>
          <Section title="Send my score">
            <p className="hint">Grade as many times as you like. When you are happy, send the result with your name and index number. What is sent: your name, index number, the score, the time, the network address (IP) of this computer and the approximate place it connects from, and a short summary of the equipment and blocks you used. No point clouds are sent.</p>
            {!workshopConfigured() ? <p className="hint" data-testid="twin-send-off">Sending is not set up in this copy of the lab. Use “Results report” below to save your result.</p> : (
              <>
                <div className="field"><label htmlFor="twin-sname">Name</label><input id="twin-sname" data-testid="twin-sname" value={T.student.name} maxLength={60} autoComplete="name" onChange={(e) => T.set({ student: { ...T.student, name: e.target.value } })} /></div>
                <div className="field"><label htmlFor="twin-sindex">Index number</label><input id="twin-sindex" data-testid="twin-sindex" value={T.student.index} maxLength={24} onChange={(e) => T.set({ student: { ...T.student, index: e.target.value } })} placeholder="e.g. z1234567" /></div>
                <Seg value={kindToSend} onChange={setSendKind} label="Which result" options={[{ value: 'final', label: 'Final evaluation', disabled: !canSendFinal }, { value: 'practice', label: 'Latest practice', disabled: !canSendPractice }]} />
                <p className="hint" data-testid="twin-accepting" style={{ color: accept.known ? (accept.accepting ? '#30a14e' : '#b36b00') : undefined }}>{!accept.known ? 'Checking whether scores are being accepted…' : accept.accepting ? `Scores are being accepted${accept.until ? ' until ' + new Date(accept.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}.` : 'Scores are not being accepted right now. You can keep grading and see every result. Sending opens when collection is started.'}</p>
                <Toggle label="I agree to send my name, index number and this score. The network address of this computer is recorded with it." checked={consent} onChange={setConsent} />
                <Btn variant="primary" onClick={sendScore} busy={sending} disabled={(!canSendFinal && !canSendPractice) || (accept.known && !accept.accepting)} testId="twin-send">Send my score</Btn>
                {sendMsg && <p className="hint" data-testid="twin-send-msg" style={{ color: sendMsg.ok ? '#30a14e' : '#ff453a' }}>{sendMsg.text}</p>}
                {T.sent.length > 0 && <p className="hint" data-testid="twin-sent">Sent {T.sent.length} time{T.sent.length > 1 ? 's' : ''}; the last was {T.sent[T.sent.length - 1].kind} {T.sent[T.sent.length - 1].total.toFixed(1)} at {new Date(T.sent[T.sent.length - 1].at).toLocaleTimeString()}.</p>}
              </>
            )}
          </Section>
          <Section title="Save, share and report">
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm icon={<Download size={14} />} onClick={exportConfig} testId="twin-export">Export configuration</Btn>
              <Btn sm icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Import</Btn>
              <Btn sm icon={<Download size={14} />} onClick={exportReport} disabled={!practice && !T.final} testId="twin-report">Results report</Btn>
              <Btn sm onClick={() => { if (confirm('Clear the whole workspace (equipment, pipeline, attempts)?')) T.reset(); }}>Start over</Btn>
            </div>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importConfig(e.target.files?.[0])} data-testid="twin-import" />
          </Section>
          <Section title="Next" open={false}><Btn sm onClick={() => { const i = tabIndex('TLS Scanning'); if (i >= 0) lab.setTab(i); }}>Review TLS scanning</Btn></Section>
          <p className="hint">Educational simulation: sensor, camera, light and SLAM models are simplified. The safety check is not a certified system.</p>
        </>
      );
    }
  })();

  const missionCheck = mission < 6 && <MissionCheck
    target={MISSION_TARGETS[mission]}
    coverage={mission === 0 ? { value: coverageMode, onChange: setCoverageMode } : undefined}
    busy={!!T.busy || regBusy}
    disabled={!cost.ok || (mission > 0 && !chk.ok) || (mission === 1 && alignmentPending)}
    disabledReason={!d.lidars.length ? 'Add a LiDAR from the catalogue to begin.' : !cost.ok ? 'Review your equipment and budget before testing.' : mission === 1 && alignmentPending ? !survey ? 'Acquire your scans first, then open Align scans.' : 'Align each scan above, then evaluate the complete map.' : 'Complete the processing steps before testing.'}
    onEvaluate={runPractice}
  />;
  const controls = (
    <>
      <MissionBrief key={mission} mission={mission} progress={T.progress} cost={cost.total} budget={T.settings.budget} onContinue={() => goMission(mission + 1)} onReference={() => { const i = tabIndex(missionDef.reference); if (i >= 0) lab.setTab(i); }} />
      {[1, 2, 8].includes(stage) && <BudgetSummary cost={cost} budget={T.settings.budget} hasLidar={!!d.lidars.length} />}
      <div className="mission-tools"><Seg label="Mission tools" value={stage} onChange={(stage) => { if (!regBusy && !T.busy) T.set({ stage }); }} options={missionDef.tools.map((value) => ({ value, label: mission === 1 ? value === 4 ? '1 · Acquire scans' : '2 · Align scans' : TOOL_NAMES[value] }))} /></div>
      {stage === 4 && <div className="align-acquire"><Btn variant="primary" block icon={<Play size={16} />} onClick={acquire} busy={T.busy === 'Acquiring the survey…'} disabled={!cost.ok || !!T.busy || regBusy} testId="twin-acquire">{survey ? 'Acquire the survey again' : 'Acquire the practice survey'}</Btn>{mission === 1 && survey && <Btn block onClick={() => T.set({ stage: 5 })} disabled={!!T.busy || regBusy} testId="align-open">Continue to alignment →</Btn>}</div>}
      {mission === 6 && <p className="mission-check-target mission-final-target" data-testid="mission-targets">{MISSION_TARGETS[mission]}</p>}
      {mission === 4 && <InspectionMission camera={inspectionCam} lidar={inspectionLidar} lidarNumber={inspectionLidar ? d.lidars.indexOf(inspectionLidar) + 1 : undefined} preview={inspectionPreview} busy={!!T.busy} onPlace={() => { T.set({ stage: 2, selectedUnit: inspectionCam?.id ?? null }); setPlaceMode(true); }} onCalibrate={() => T.set({ stage: 3, selectedUnit: inspectionCam?.id ?? null })} />}
      {mission !== 1 && mission !== 4 && missionCheck}
      <div key={stage} className="mission-workspace">{panel}</div>
      {(mission === 1 || mission === 4) && missionCheck}
      <div className="mission-project-details">{mission === 0 && <Section title="Project identity" open={false}><div className="field"><label htmlFor="twin-team">Team name (optional)</label><input id="twin-team" value={T.team} onChange={(e) => T.set({ team: e.target.value })} /></div><Btn sm onClick={exportConfig}>Export configuration</Btn><Btn sm onClick={() => { if (confirm("Start a new project? Export first if you want to keep this configuration.")) T.reset(); }}>Start a new project</Btn><Btn sm onClick={() => fileRef.current?.click()}>Import configuration</Btn><input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importConfig(e.target.files?.[0])} /></Section>}</div>
    </>
  );
  const basePlan = { markers: [...d.lidars.map((u, i) => ({ x: u.x, y: u.y, color: UNIT_COLOURS[i % 6], label: `L${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.cameras.map((u, i) => ({ x: u.x, y: u.y, color: '#0a84ff', label: `C${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.lights.map((u, i) => ({ x: u.x, y: u.y, color: '#ffcc00', label: `Lamp ${i + 1}`, r: 5 })), ...(d.lidars.some(isMobile) ? d.route.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: `${i + 1}`, r: 4 })) : [])], paths: [...(d.lidars.some(isMobile) && d.route.length > 1 ? [{ pts: d.route, color: '#ff9f0a', dashed: true }] : []), ...((mission === 0 || mission === 4 || mission === 6) ? [{ pts: [[-3.7,-7.5],[3.4,-7.5],[3.4,-6.1],[-3.7,-6.1],[-3.7,-7.5]] as [number, number][], color: '#af52de', dashed: true, width: 2 }] : [])] };
  /** later stages keep the plan and add what that stage is about: where the real objects were found or missed, and where changes happened */
  const taskMarks = stage === 7 && practice ? (taskTab === 'detect'
    ? refs.map((r, i) => ({ x: r.centre[0], y: r.centre[1], color: matchRef?.get(i) === undefined ? '#ff453a' : matchRef.get(i) ? '#30d158' : '#ff9f0a', r: 3 }))
    : taskTab === 'change' ? [...practice.truth.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#30d158', r: 5 })), ...practice.found.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#ff9f0a', r: 3 }))] : []) : [];
  const planLayers = { ...basePlan, markers: [...basePlan.markers, ...taskMarks] };
  const result = T.progress.results[mission];
  const stats = result ? currentMissionMetrics(result, cost.total, T.settings.budget).map((m) => ({ k: m.label, v: fmtMetric(m.value, m.unit), s: result.stale ? 'Revalidation required' : `Target ${m.lower ? '≤' : '≥'} ${fmtMetric(m.target, m.unit)}` })) : [{ k: 'Project budget', v: `${usd(cost.remaining)} left`, s: `${usd(cost.total)} spent of ${usd(T.settings.budget)}` }];
  const legend = stage === 5 && mission === 1 ? [{ color: '#1d78dc', label: 'Reference + earlier scans' }, { color: '#f4a21e', label: 'Current scan' }] : stage === 2 ? [{ color: HEAT[0], label: 'No LiDAR sees it' }, { color: HEAT[1], label: 'One LiDAR' }, { color: HEAT[2], label: 'Two views (green); 3+ blue in measured test' }] : stage === 6 ? [{ color: '#ff453a', label: 'True surface not covered' }] : stage === 7 ? [{ color: '#30d158', label: 'Found' }, { color: '#ff9f0a', label: 'Misnamed' }, { color: '#ff453a', label: 'Missed' }] : ZONES.map((z, i) => ({ color: ['#c7a28a', '#9ab', '#8ac', '#bb9', '#667'][i], label: z.name }));
  void STATUS_COLOURS;
  return <TabFrame title="Industrial Digital Twin Challenge" topExtras={<MissionMap progress={T.progress} busy={!!T.busy || regBusy} onSelect={goMission} />} tab={17} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv stats={stats} overlays={<>{stage === 5 && mission !== 1 && (() => {
    const why = !cost.ok ? cost.errors[0] : chk.global[0] ?? (chk.perBlock.find(Boolean) as string | undefined) ?? (T.pipeline.length ? '' : 'Add a registration block to begin.'), withView = practice ? practice.steps.map((x, i) => (x.preview ? i : -1)).filter((i) => i >= 0) : [], at = withView.indexOf(T.selectedStep), go = (d2: number) => { if (!withView.length) return; const n = at < 0 ? (d2 > 0 ? 0 : withView.length - 1) : at + d2; if (n >= 0 && n < withView.length) T.set({ selectedStep: withView[n] }); };
    const cur = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
    return (
      <div className="overlay glass card canvas-run" data-testid="twin-canvas-run">
        <Btn variant="primary" sm icon={<Play size={14} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-canvas" title={why || 'Run the practice survey through your blocks and see the result here'}>Test pipeline</Btn>
        <label className="canvas-run-auto" title="Run the test again a moment after every change to your blocks"><input type="checkbox" checked={autoTest} onChange={(e) => setAutoTest(e.target.checked)} data-testid="twin-auto-test" /> Auto</label>
        {why ? <span className="canvas-run-note warn" data-testid="twin-canvas-why">{why}</span>
          : practice && withView.length ? (
            <span className="canvas-run-steps" data-testid="twin-canvas-steps">
              <button className="canvas-run-nav" aria-label="Previous block" disabled={at <= 0 && T.selectedStep >= 0} onClick={() => go(-1)}>‹</button>
              <span className="canvas-run-note">{cur ? <>After <b>{BLOCKS[cur.kind].name.replace(/ \(.*\)$/, '')}</b>: {cur.after.toLocaleString()} points</> : 'Step through the blocks'}</span>
              <button className="canvas-run-nav" aria-label="Next block" disabled={at >= withView.length - 1} onClick={() => go(1)}>›</button>
            </span>
          ) : <span className="canvas-run-note">Add blocks, then test them here.</span>}
      </div>
    );
  })()}{stage >= 2 && <div className="overlay glass card" style={{ left: 12, top: mission >= 5 ? 110 : 10, width: planOpen ? 268 : 'auto', padding: 6 }} data-testid="twin-plan"><div className="plan-head"><b>Plan</b><button className="stats-toggle" onClick={() => setPlanOpen((o) => !o)} aria-expanded={planOpen} title={planOpen ? 'Fold the plan away' : 'Show the plan'} data-testid="twin-plan-toggle">{planOpen ? 'Hide' : 'Show'}</button></div>{planOpen && <Plan2D scene={scene} height={176} onClick={stage === 2 ? place : undefined} layers={planLayers} />}</div>}<KindLegend items={legend} top={66} side={stage >= 2 ? 'right' : 'left'} /></>}
    viewExtras={<>{mission === 6 && T.final && <Seg label="Final scenario" value={finalVariant} onChange={setFinalVariant} options={T.final.runs.map((r, value) => ({ value, label: `Scenario ${r.seed}` }))} />}{mission === 5 && <Seg label="Survey comparison" value={timeView} onChange={setTimeView} options={[{ value: 'A', label: 'Time A' }, { value: 'B', label: 'Time B' }, { value: 'changes', label: 'Changes' }, { value: 'safety', label: 'Safety zones' }]} />}<Seg<'scene' | 'points' | 'both'> value={viewMode} onChange={setViewMode} block={false} label="What the 3D view shows" options={[{ value: 'scene', label: 'Scene' }, { value: 'points', label: 'Points' }, { value: 'both', label: 'Both' }]} /></>} />;
}
