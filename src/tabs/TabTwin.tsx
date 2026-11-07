import { BudgetSummary } from '../twin/ui/BudgetSummary';
import { MissionCheck, type CoverageReadout, type LidarBreakdown } from '../twin/ui/MissionCheck';
import { CompletionReport } from '../twin/ui/CompletionReport';
import { engineeringReport } from '../twin/report';
import { PairBoard, FovOverlapChart, CalPanel } from '../twin/ui/CalibrationWorkspace';
import { MISSIONS, MISSION_TARGETS, ZONE_DENSITY_MIN, TOOL_NAMES, fmtMetric, currentMissionMetrics, currentPass, evaluateMission, recordMission, readyForFinal, missionFingerprint, pipelineForMission } from '../twin/missions';
import { MissionMap, MissionBrief } from '../twin/ui/MissionPanel';
import { EquipmentCatalogue } from '../twin/ui/EquipmentCatalogue';
import { pairedLidarOf, pairedLidarsOf, ALL_LIDARS, inspectionCamera, INSPECTION_CAMERA_ID } from '../twin/catalogue';
import { inspectionCoverage } from '../twin/inspection';
import { InspectionMission } from '../twin/ui/InspectionMission';
import { CompletionExperience } from '../twin/ui/Completion';
import { ChangesExplorer, changeColour, type Focus } from '../twin/ui/ChangesExplorer';
import { usd } from '../twin/pricing';
import '../twin/ui/missions.css';
import { Fragment, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle, ToolbarSwitch } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, CloudLayer, PolyLine, Marker, BoxOutline, TextSprite } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Crosshair, Play, Plus, Trash2, Download, Upload, Circle } from '../ui/icons';
import { runTask } from '../engine/client';
import { downloadBlob } from '../io/load';
import { buildFactory, zoneAt, ZONES, SAFETY_ZONES, TWIN_CLASSES, CRITICAL_CAMERA_ZONE } from '../twin/factory';
import { LIDARS, CAMERAS, LIGHT_UNIT, LOWLIGHT_KIT, MOBILE_PLATFORM, RES_TIERS, INSTALL, TASK_KEYS, TASK_NAMES, LIMITS, costOf, lidarItem, cameraItem, newId, isMobile, HW_SEED, TwinDesign, LidarUnit, CameraUnit, TaskKey } from '../twin/catalogue';
import { raysFor, acquireSurvey, Survey } from '../twin/acquire';
import { camPose, nominalOf, makeSampler, colourPoints, renderPreview, trueExtrinsic } from '../twin/camera';
import { BayInset, type BayView, type LabelEvent } from '../twin/ui/BayInset';
import { project } from '../apps/fusion';
import { runPipeline, BLOCKS, BLOCK_TAB, PickList, PHASES, phaseIndex, insertBlock, regParamsOf, newBlock, checkPipeline, canRunParallel, parallelGroups, BlockKind, Block } from '../twin/pipeline';
import { registerScans, RegReport } from '../twin/register';
import { AlignPanel, type AlignRow } from '../twin/ui/AlignPanel';
import { PairErrors, type PairRow } from '../twin/ui/PairErrors';
import { poseError } from '../twin/grade';
import { identity, type Rigid } from '../core/math';
import { PRACTICE_SEED, RunResult } from '../twin/runner';
import { createPortal } from 'react-dom';
import { useTwin, snapshot, parseSave } from '../twin/store';
import { evaluate } from '../occlusion/coverage';
import { FovVolume, ScannerMarkers, SamplePoints, paint, STATUS_COLOURS } from '../occlusion/OccView';
import { cameraView, lidarAsScanner } from '../twin/coverage';
import { insideSolid } from '../occlusion/coverage';
import { feedbackFor } from '../twin/feedback';
import { sensorOf } from '../occlusion/coverage';
import { PointCloud, concatClouds, selectPoints } from '../core/pointcloud';
import { D2R, Vec3 } from '../core/math';
import { tabIndex } from './nav';
import { workshopConfigured, submitChallengeScore, challengeAccepting } from '../apps/workshop';
import { buildSubmission, validIndex } from '../twin/submit';

const UNIT_COLOURS = ['#e63946', '#1d78dc', '#28aa5a', '#f4a21e', '#8c50c8', '#00b4be'];
const HEAT = ['#ff453a', '#e8b42a', '#30a14e']; // how many LiDARs reach a spot: none, one, two or more
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


/** The three critical areas of the first mission, drawn as boxes up to 3 m (the height the point density is judged over). */
const CRITICAL_AREAS = (['production', 'inspection', 'loading'] as const).map((id) => {
  const z = ZONES.find((q) => q.id === id)!;
  return { id, name: z.name, min: z.min, max: z.max, need: ZONE_DENSITY_MIN[id], color: { production: '#e8890c', inspection: '#12a89d', loading: '#0a6fe0' }[id] };
});

export default function TabTwin() {
  const T = useTwin(), lab = useLab();
  const stage = T.stage, d = T.design, mission = T.progress.current;
  const missionDef = MISSIONS[mission];
  const goMission = (i: number) => { if (i <= useTwin.getState().progress.unlocked) T.set({ progress: { ...useTwin.getState().progress, current: i }, stage: MISSIONS[i].tools[0] }); };
  const [finalVariant, setFinalVariant] = useState(0);
  const [timeView, setTimeView] = useState<'A' | 'B' | 'changes' | 'safety'>('changes');
  const [changeFocus, setChangeFocus] = useState<Focus>(null), [bestChange, setBestChange] = useState<{ thr: number; min: number; tried: number } | null>(null);
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
  const [camColour, setCamColour] = useState(true); // in the survey view: points a camera sees take its colours
  const [surveyView, setSurveyView] = useState<{ cloud: PointCloud; base: Uint8Array; cam: Uint8Array | null; coloured: number }[] | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null); // which block's settings are open
  const [calc, setCalc] = useState(false), calcRef = useRef(false); // the first mission recalculates by itself; this is true while it is working
  const [regTest, setRegTest] = useState<{ id: string; report: RegReport; clouds: PointCloud[] } | null>(null), [regBusy, setRegBusy] = useState(false);
  const [alignRows, setAlignRows] = useState<AlignRow[]>([]); // mission 2: the scans aligned so far, one at a time
  const [alignActive, setAlignActive] = useState(1);
  const [alignPreview, setAlignPreview] = useState<'before' | 'after'>('after');
  const [pipeExpanded, setPipeExpanded] = useState(false); // the builder can fill the whole window
  const [lastRun, setLastRun] = useState<Record<string, { before: number; after: number; sig: string }>>({}); // what each block did to the point count in the latest test, kept until that block is changed
  const [lastPick, setLastPick] = useState<Record<string, PickList>>({}); // the planes and clusters each block found in the latest test, kept while the team ticks and unticks them
  const [rerunAt, setRerunAt] = useState(0); // set when a tick changes: the test runs again a moment later so the 3D view follows
  const [autoTest, setAutoTest] = useState(false); // in the pipeline stage: run the practice again a moment after every change to the blocks
  const [planOpen, setPlanOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1100); // starts folded on a narrow window, where it would cover the view controls; // the plan in the corner of the view can be folded away and brought back
  const [viewMode, setViewMode] = useState<'both' | 'scene' | 'points'>('both'); // what the 3D view shows: the factory, the points, or both at once
  const [roof, setRoof] = useState(true); // roof on = the complete view; roof off = the roof is gone, the deck and its scanned points, to look inside
  const [zoneNames, setZoneNames] = useState(true); // the names on the three critical-area boxes (the boxes themselves always stay)
  const [solo, setSolo] = useState(false); // show only the selected LiDAR's view (its coverage points)
  const [legendTop, setLegendTop] = useState(66); // the legend sits just below the view toolbar, which can wrap onto a second row on a narrow window
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.overlay[role="toolbar"]'); if (!bar) return;
    const measure = () => setLegendTop(Math.round(bar.offsetTop + bar.offsetHeight + 8));
    measure(); const ro = new ResizeObserver(measure); ro.observe(bar); return () => ro.disconnect();
  }, [stage, mission, planOpen, T.final]);
  const [cloudColour, setCloudColour] = useState<'solid' | 'intensity' | 'height' | 'objects'>('solid'); // missions 3 and 4: how the points are coloured; each click on the toolbar button goes to the next
  const [statsLift, setStatsLift] = useState(12); // the "Test pipeline" bar rides above the statistics card, which is wide here and changes height
  useEffect(() => {
    const card = document.querySelector<HTMLElement>('[data-testid="stats-card"]'); if (!card) return;
    const measure = () => setStatsLift(Math.round(12 + card.offsetHeight + 10));
    measure(); const ro = new ResizeObserver(measure); ro.observe(card); return () => ro.disconnect();
  }, [stage, mission, T.practice]);
  const [legendOnly, setLegendOnly] = useState<number | null>(null); // clicking a legend item shows only that kind of point: 0 unseen, 1 seen by one LiDAR, 2 by two or more
  const roofClip = roof ? undefined : { on: true, min: -1, max: 5.9 }; // roof off: the scanned points of the roof deck (6 m) are cut away too
  const [pname, setPname] = useState('Pipeline 1');
  const [consent, setConsent] = useState(false), [sendKind, setSendKind] = useState<'final' | 'practice'>('final'), [sending, setSending] = useState(false), [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showObjectLabels, setShowObjectLabels] = useState(false);
  const [showMissing, setShowMissing] = useState(true), [showZones, setShowZones] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTaskTab(mission === 4 ? 'colour' : mission === 5 ? 'change' : 'detect'); }, [mission]);

  useEffect(() => { const st = useLab.getState(); return () => { st.patch({ interaction: 'select' }); }; }, []);
  useEffect(() => { lab.patch({ interaction: 'select' }); return () => { useLab.getState().patch({ interaction: 'select' }); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps -- placing is handled by the floor below, not by a global mode
  useEffect(() => { // Escape ends placing
    const stop = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPlaceMode(false); setRouteMode(false); } };
    window.addEventListener('keydown', stop); return () => window.removeEventListener('keydown', stop);
  }, []);
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
  const unitName = selL ? `LiDAR ${d.lidars.indexOf(selL) + 1}` : selC ? `Camera ${d.cameras.indexOf(selC) + 1}` : selLight ? `Lamp ${d.lights.indexOf(selLight) + 1}` : 'it';
  const bounds = scene.bounds;
  const clampXY = (x: number, y: number): [number, number] => [Math.min(bounds.max[0] - 0.3, Math.max(bounds.min[0] + 0.3, x)), Math.min(bounds.max[1] - 0.3, Math.max(bounds.min[1] + 0.3, y))];
  /** Move the selected unit. A click on the plan always moves it. A click in the 3D scene moves it while "Place … by clicking" is on: it stays on, so the unit can be moved again and again, until the button is pressed again, another unit or tool is chosen, or the step changes. */
  const place = (x0: number, y0: number, fromPlan = false) => {
    if (stage !== 2) return; const [x, y] = clampXY(x0, y0);
    if (routeMode) { setDesign((q) => ({ ...q, route: [...q.route, [x, y]] })); return; }
    if ((!placeMode && !fromPlan) || !sel || (mission === 4 && selL)) return; // in task 5 the LiDARs stay where task 1 put them
    if (selL) patchLidar(selL.id, { x, y });
    else if (selC) patchCam(sel, { x, y }); else if (selLight) setDesign((q) => ({ ...q, lights: q.lights.map((u) => (u.id === sel ? { ...u, x, y } : u)) }));
  };
  useEffect(() => { setPlaceMode(false); }, [sel, stage]); // choosing another unit, or another step, ends the placing
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
      pitch: 0, kit: false, pairedLidarId: ALL_LIDARS, cal: { est: { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 }, fov: 0, done: false } };
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
  /** `auto` is the quiet recalculation of the first mission: no warnings, no attempt counted, and the rest of the screen stays usable while it works. */
  /** Task 6: one click. A few ways of comparing Time A with Time B are tried on this data, the best is kept, and the result is shown. Nothing is graded. */
  async function showChanges() {
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    if (useTwin.getState().busy) return;
    T.set({ busy: 'Comparing Time A with Time B and finding the best settings for your data…' });
    try {
      const earlier = T.pipeline.filter((b) => !['diff', 'objmatch', 'safety'].includes(b.kind)), diffOld = T.pipeline.find((b) => b.kind === 'diff'), safeOld = T.pipeline.find((b) => b.kind === 'safety');
      const blocksFor = (thr: number, min: number): Block[] => [...earlier, { ...(diffOld ?? newBlock('diff')), params: { ...(diffOld ?? newBlock('diff')).params, thr, min }, bypass: false }, { ...(safeOld ?? newBlock('safety')), bypass: false }];
      const options: [number, number][] = [[0.3, 70], [0.35, 70], [0.45, 70], [0.3, 50]];
      let best: { r: RunResult; thr: number; min: number } | null = null;
      for (const [thr, min] of options) {
        const r = await runTask('twinRun', { config: { design: d, pipeline: pipelineForMission(blocksFor(thr, min), 5), settings: T.settings }, seed: PRACTICE_SEED });
        if (!best || r.tasks.change.f1 > best.r.tasks.change.f1 + 1e-9) best = { r, thr, min };
      }
      if (!best) return;
      const final = blocksFor(best.thr, best.min);
      T.set({ pipeline: final }); // the best settings stay in the pipeline, so the final evaluation uses them too
      const live = useTwin.getState(), cfg2 = { design: live.design, pipeline: live.pipeline, settings: live.settings };
      live.set({ practice: best.r, selectedStep: -1, progress: recordMission(live.progress, 5, evaluateMission(5, best.r, cfg2), true) });
      setBestChange({ thr: best.thr, min: best.min, tried: options.length }); setChangeFocus(null); setTimeView('changes'); setTick(0); setPlaying(true);
    } catch (e) { lab.notify((e as Error).message, 'error'); } finally { useTwin.getState().set({ busy: null }); }
  }
  async function runPractice(autoArg?: unknown) {
    const auto = autoArg === true; // buttons pass their click event here, which must not count as the quiet recalculation
    if (auto) { if (calcRef.current || useTwin.getState().busy || !cost.ok || mission !== 0) return; }
    else {
      if (mission === 1 && alignmentPending) { lab.notify('Acquire the scans, then align each one before evaluating the map.', 'warn'); return; }
      if (!cost.ok || useTwin.getState().busy) { if (!cost.ok) lab.notify(cost.errors.join(' '), 'warn'); return; }
    }
    const fingerprint = missionFingerprint(cfg, 6);
    const runCfg = mission === 0 ? { ...cfg, pipeline: [newBlock('merge')] } : { ...cfg, pipeline: pipelineForMission(cfg.pipeline, mission) };
    if (!auto) setViewMode((m) => (m === 'scene' ? 'both' : m)); // the result is points: make sure the view shows them
    if (auto) { calcRef.current = true; setCalc(true); } else T.set({ busy: 'Running the practice survey and your pipeline…' });
    try {
      const r = await runTask('twinRun', { config: runCfg, seed: PRACTICE_SEED });
      const live = useTwin.getState();
      if (fingerprint !== missionFingerprint({ design: live.design, pipeline: live.pipeline, settings: live.settings }, 6)) return;
      if (mission < 6) live.set({ progress: recordMission(live.progress, mission, evaluateMission(mission, r, cfg), !auto) });
      setLastPick(Object.fromEntries(r.steps.filter((x) => x.pick).map((x) => [x.id, x.pick as PickList])));
      setLastRun(Object.fromEntries(r.steps.filter((x) => !x.bypassed && !x.error).map((x) => { const b = T.pipeline.find((q) => q.id === x.id); return [x.id, { before: x.before, after: x.after, sig: b ? blockSig(b) : '' }]; })));
      useTwin.getState().set({ practice: r, selectedStep: r.steps.reduce((last, x, i) => (x.preview && !x.error && !x.bypassed ? i : last), -1), attempts: auto ? useTwin.getState().attempts : [...useTwin.getState().attempts, { at: Date.now(), mission: mission + 1, status: evaluateMission(mission, r, cfg).level, kind: 'practice', seed: PRACTICE_SEED, total: r.grade.total, tasks: Object.fromEntries(r.grade.perTask.map((x) => [x.key, x.score])), cost: r.cost.total }] });
    } catch (e) { if (!auto) lab.notify((e as Error).message, 'error'); } finally { if (auto) { calcRef.current = false; setCalc(false); } else useTwin.getState().set({ busy: null }); }
  }
  // mission 1: recalculate coverage and density a moment after any change, until the saved result is up to date
  const covSig = JSON.stringify(d.lidars.map((u) => [u.item, u.x, u.y, u.z, u.yaw, u.pitch]));
  const covStale = !T.progress.results[0] || T.progress.results[0].stale;
  useEffect(() => {
    if (mission !== 0 || !d.lidars.length || !cost.ok || T.busy || calc || !covStale) return;
    const id = setTimeout(() => { void runPractice(true); }, 700); return () => clearTimeout(id);
  }, [mission, covSig, cost.ok, T.busy, calc, covStale]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const cams = d.cameras.map((c, i) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, i, d.lights), e: c.cal.est, fov: c.cal.fov, scanIds: sv.visible.scans.filter((q) => pairedLidarsOf(c, d).some((u) => u.id === q.unit)).map((q) => q.index) }));
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
  useEffect(() => { if ((stage === 2 && !d.lidars.length) || (stage === 3 && !d.cameras.length)) T.set({ stage: 1 }); }, [stage, d.lidars.length, d.cameras.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // in the cleaning mission the blocks always run in sequence: an older save that set some to run in parallel is put right
  useEffect(() => { if ((mission >= 2 && mission <= 5) && T.pipeline.some((b) => b.parallel && missionDef.blocks.includes(b.kind))) T.set({ pipeline: T.pipeline.map((b) => (missionDef.blocks.includes(b.kind) ? { ...b, parallel: false } : b)), practice: null }); }, [mission, T.pipeline]); // eslint-disable-line react-hooks/exhaustive-deps
  const icpBlock = T.pipeline.find((b) => b.kind === 'icp');
  const icpSig = JSON.stringify(icpBlock?.params ?? {});
  useEffect(() => { if (mission === 1 && stage === 5 && !T.pipeline.some((b) => b.kind === 'icp')) T.set({ pipeline: insertBlock(T.pipeline.filter((b) => b.kind !== 'merge' && b.kind !== 'mobileicp'), newBlock('icp')), practice: null }); }, [mission, stage, T.pipeline]); // eslint-disable-line react-hooks/exhaustive-deps
  // each scan is aligned with its own settings: they are kept with the scan, and the next scan starts from them but can be changed without touching the ones already done
  const regDefaults = Object.fromEntries(BLOCKS.icp.params.map((p2) => [p2.key, p2.def]));
  const scanSettings = (k: number, block = icpBlock): Record<string, number> => {
    for (let i = k; i >= 1; i--) { const own = block?.perScan?.[String(i)]; if (own) return { ...regDefaults, ...block!.params, ...own }; }
    return { ...regDefaults, ...(block?.params ?? {}) };
  };
  const setScanParam = (k: number, key: string, v: number) => {
    if (!icpBlock) return;
    const next = { ...scanSettings(k), [key]: v };
    T.set({ pipeline: T.pipeline.map((b) => (b.id === icpBlock.id ? { ...b, perScan: { ...(b.perScan ?? {}), [String(k)]: next } } : b)), practice: null });
    setAlignRows((rows) => rows.slice(0, k - 1)); setAlignActive(k); setAlignPreview('after'); // this scan and the ones after it are done again; the scans before it keep their result
  };
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
      const per = { ...(icpBlock.perScan ?? {}), [String(k)]: scanSettings(k) }; // this scan's settings are kept with it from now on
      const r = registerScans(scans.slice(0, k + 1), regParamsOf('icp', { ...regDefaults, ...icpBlock.params }, per));
      T.set({ pipeline: T.pipeline.map((b) => (b.id === icpBlock.id ? { ...b, perScan: per } : b)), practice: null });
      const pair = (poses: Rigid[]) => poseError([poses[0], poses[k]], [truth[0], truth[k]]), rep = r.report.scans[k - 1];
      setAlignRows((rows) => [...rows.slice(0, k - 1), { k, name: scans[k].name, before: poseError([identity(), identity()], [truth[0], truth[k]]), after: pair(r.poses), overlap: rep.overlapAfter, accepted: rep.accepted }]);
      setAlignPreview('after');
      setRegTest({ id: icpBlock.id, report: r.report, clouds: [...r.clouds, ...scans.slice(k + 1).map((q) => q.local)] }); T.set({ selectedStep: -1 });
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
  const calLids = selC ? pairedLidarsOf(selC, d) : [];
  const calLid = selC && selC.pairedLidarId !== ALL_LIDARS ? pairedLidar(selC) ?? null : null; // one LiDAR only for a camera paired in an older save
  /** every camera wired to that LiDAR: they all colour its points, each with its own calibration */
  const connected = calLids.length ? d.cameras.filter((c) => pairedLidarsOf(c, d).some((u) => calLids.some((x) => x.id === u.id))) : [];
  const connSig = JSON.stringify(connected.map((c) => [c.id, c.cal.est, c.cal.fov, c.x, c.y, c.z, c.yaw, c.pitch, c.kit, c.item]));
  useEffect(() => {
    if (stage !== 3 || !selC || !calLids.length) { setCalCloud(null); return; }
    setCalBusy(true);
    const id = setTimeout(() => {
      try {
        const key = JSON.stringify([calLids, d.platform, d.route, d.routeSteps, d.distortion, mission === 4]);
        if (calCache.current?.key !== key) { const sv = acquireSurvey(factory, { ...d, lidars: calLids }, PRACTICE_SEED); let all = concatClouds(sv.visible.scans.map((s2) => s2.cloud), 'Calibration check');
          if (mission === 4) { // the LiDARs are registered into one cloud: only the inspection bay of it is registered with the camera
            const z = CRITICAL_CAMERA_ZONE, keep: number[] = [], p = all.positions;
            for (let i = 0; i < all.count; i++) if (p[i * 3] >= z.min[0] - 0.6 && p[i * 3] <= z.max[0] + 0.6 && p[i * 3 + 1] >= z.min[1] - 0.6 && p[i * 3 + 1] <= z.max[1] + 0.6 && p[i * 3 + 2] <= 2) keep.push(i);
            all = selectPoints(all, keep, 'Inspection bay');
          }
          calCache.current = { key, cloud: all }; }
        const cloud = calCache.current.cloud, col = colourPoints(cloud.positions, cloud.count, connected.map((c) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, d.cameras.findIndex((x) => x.id === c.id), d.lights), e: c.cal.est, fov: c.cal.fov })));
        const colors = new Uint8Array(cloud.count * 3); for (let i = 0; i < cloud.count; i++) { if (col.valid[i]) colors.set(col.colors.subarray(i * 3, i * 3 + 3), i * 3); else colors.fill(110, i * 3, i * 3 + 3); } // grey: no connected camera sees the point
        setCalCloud({ cloud: { ...cloud, colors, instances: undefined }, coloured: col.count, total: cloud.count });
      } finally { setCalBusy(false); }
    }, 250); // wait for the slider to settle
    return () => clearTimeout(id);
  }, [stage, selC?.id, connSig, calLids.map((u) => u.id).join(), d.lidars, d.lights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- task 5: the registered, cleaned LiDAR cloud (one colour), with the inspection bay picked out in another
  const [m4Cloud, setM4Cloud] = useState<{ rest: PointCloud; bay: PointCloud } | null>(null);
  const m4Key = mission === 4 ? JSON.stringify([d.lidars, d.platform, d.route, d.routeSteps, d.distortion, pipelineForMission(T.pipeline, 2).map(({ id, ...b }) => b)]) : '';
  useEffect(() => {
    if (mission !== 4 || !d.lidars.length) { setM4Cloud(null); return; }
    const id = setTimeout(() => {
      try {
        const sv = acquireSurvey(factory, d, PRACTICE_SEED), blocks = pipelineForMission(T.pipeline, 2).filter((b) => !b.bypass);
        const ready = blocks.length > 0 && checkPipeline(blocks, { cameras: 0, hasB: false }).ok;
        const cloud = (ready ? runPipeline(blocks, { A: sv.visible, camerasA: [] }).A.cloud : undefined) ?? concatClouds(sv.visible.scans.map((s2) => s2.cloud), 'Combined cloud');
        const z = CRITICAL_CAMERA_ZONE, p = cloud.positions, inBay: number[] = [], rest: number[] = [];
        for (let i = 0; i < cloud.count; i++) { const inside = p[i * 3] >= z.min[0] - 0.1 && p[i * 3] <= z.max[0] + 0.1 && p[i * 3 + 1] >= z.min[1] - 0.1 && p[i * 3 + 1] <= z.max[1] + 0.1 && p[i * 3 + 2] <= z.max[2] + 0.1; (inside ? inBay : rest).push(i); }
        const every = (ids: number[], max: number) => (ids.length > max ? ids.filter((_, k) => k % Math.ceil(ids.length / max) === 0) : ids);
        setM4Cloud({ rest: selectPoints(cloud, every(rest, 90000), 'Point cloud'), bay: selectPoints(cloud, every(inBay, 40000), 'Inspection bay') });
      } catch { setM4Cloud(null); }
    }, 250);
    return () => clearTimeout(id);
  }, [m4Key]); // eslint-disable-line react-hooks/exhaustive-deps
  // the bay points take the colours the camera really records there (as seen with the calibration as it is now)
  const [bayColour, setBayColour] = useState<{ bay: PointCloud; rest: PointCloud | null } | null>(null);
  const hasColourBlock = T.pipeline.some((b) => b.kind === 'colour' && !b.bypass);
  const bayCamSig = mission === 4 ? JSON.stringify([hasColourBlock, d.cameras.map((c) => [c.id, c.cal.est, c.cal.fov, c.x, c.y, c.z, c.yaw, c.pitch, c.kit, c.item]), d.lights]) : '';
  useEffect(() => {
    if (mission !== 4 || !m4Cloud || !d.cameras.length) { setBayColour(null); return; }
    const id = setTimeout(() => {
      try {
        const cams = d.cameras.map((c, i) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, i, d.lights), e: c.cal.est, fov: c.cal.fov }));
        // each point the camera sees takes the colour the camera records there; a point no camera sees stays the cloud's own blue
        const paint = (cloud: PointCloud, max: number, name: string): PointCloud => {
          const ids = Array.from({ length: cloud.count }, (_, i) => i), keep = ids.length > max ? ids.filter((_, k) => k % Math.ceil(ids.length / max) === 0) : ids, sub = selectPoints(cloud, keep, name);
          const col = colourPoints(sub.positions, sub.count, cams), colors = new Uint8Array(sub.count * 3);
          for (let i = 0; i < sub.count; i++) { if (col.valid[i]) colors.set(col.colors.subarray(i * 3, i * 3 + 3), i * 3); else colors.set([59, 130, 246], i * 3); }
          return { ...sub, colors, instances: undefined };
        };
        setBayColour({ bay: paint(m4Cloud.bay, 20000, 'Inspection bay'), rest: hasColourBlock ? paint(m4Cloud.rest, 60000, 'Point cloud') : null });
      } catch { setBayColour(null); }
    }, 300);
    return () => clearTimeout(id);
  }, [m4Cloud, bayCamSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // in task 5 the camera is what is placed and calibrated: it is the selected unit unless something else was chosen
  useEffect(() => { if (mission === 4 && (stage === 2 || stage === 3) && !d.cameras.some((c) => c.id === T.selectedUnit) && !d.lights.some((l) => l.id === T.selectedUnit) && d.cameras[0]) T.set({ selectedUnit: d.cameras[0].id }); }, [mission, stage, T.selectedUnit, d.cameras.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- planning aids
  const scanners = useMemo(() => d.lidars.map(lidarAsScanner), [d.lidars]);
  const cov = useMemo(() => (stage === 2 && scanners.length && mission !== 4 ? evaluate(scene, scanners) : null), [stage, scanners, scene, mission]); // task 5 shows the one combined cloud, not per-LiDAR coverage
  const covColours = useMemo(() => (cov ? paint(cov.samples.count, (i) => HEAT[Math.min(2, cov.stats.times[i])]) : null), [cov]);
  useEffect(() => { setLegendOnly(null); }, [stage, mission]); // the legend choice belongs to the Deploy step
  const legendKeep = useMemo(() => (legendOnly === null || !cov ? undefined : Uint8Array.from(cov.stats.times, (t) => (Math.min(2, t) === legendOnly ? 1 : 0))), [cov, legendOnly]);
  const soloIndex = solo && stage === 2 ? d.lidars.findIndex((u) => u.id === sel) : -1; // which LiDAR is shown alone (-1 = all of them)
  const soloCov = useMemo(() => (soloIndex >= 0 ? evaluate(scene, [scanners[soloIndex]]) : null), [soloIndex, scanners, scene]);
  const soloColours = useMemo(() => (soloCov ? paint(soloCov.samples.count, () => UNIT_COLOURS[soloIndex % 6]) : null), [soloCov, soloIndex]);
  const soloKeep = useMemo(() => (soloCov ? Uint8Array.from(soloCov.stats.times, (t) => (t > 0 ? 1 : 0)) : undefined), [soloCov]); // only what this LiDAR sees
  const camStats = useMemo(() => (stage === 2 && selC ? cameraView(scene, selC, factory.targets) : null), [stage, selC, scene, factory.targets]);
  const rayCount = (u: LidarUnit) => raysFor(u);
  const inspectionPreview = useMemo(() => mission === 4 ? inspectionCoverage(factory, d) : { total: 6, coverage: 0, sharedCoverage: 0, calibratedCoverage: 0, cameras: [] }, [mission, factory, d]);
  const inspectionCam = selC ?? d.cameras[0];

  // ---- 3D
  const practice = T.practice, step = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
  /** task 6: four moments from Time A to Time B. At the second the things that moved have moved, at the third things have appeared and gone, at the fourth two labels have changed colour. The cloud of each moment is built from the two real surveys: what has not happened yet is still as it was at Time A. */
  const timeline = useMemo(() => {
    if (mission !== 5 || !practice?.twinPreview || !practice.updatedPreview) return null;
    const A = practice.twinPreview, B = practice.updatedPreview, pick = (cloud: PointCloud, c: { centre: number[]; size: number[] }) => {
      const p = cloud.positions, hx = Math.max(c.size[0], 0.4) / 2 + 0.2, hy = Math.max(c.size[1], 0.4) / 2 + 0.2, ids: number[] = [];
      for (let i = 0; i < cloud.count; i++) if (Math.abs(p[i * 3] - c.centre[0]) <= hx && Math.abs(p[i * 3 + 1] - c.centre[1]) <= hy && p[i * 3 + 2] > 0.08) ids.push(i);
      return ids;
    };
    const ev = practice.found.changes.map((c, idx) => {
      const step = c.kind === 'moved' ? 1 : 2;
      const hx = Math.max(c.size[0], 0.4) / 2, hy = Math.max(c.size[1], 0.4) / 2;
      const zone = c.kind === 'removed' ? undefined : SAFETY_ZONES.find((z) => { const dx = Math.max(z.min[0] - (c.centre[0] + hx), c.centre[0] - hx - z.max[0], 0), dy = Math.max(z.min[1] - (c.centre[1] + hy), c.centre[1] - hy - z.max[1], 0); return Math.hypot(dx, dy) <= 0.15 && c.centre[2] + c.size[2] / 2 >= z.zMin; });
      return { c, idx, step, zone, aOld: c.kind === 'removed' ? pick(A, c) : c.kind === 'moved' && c.from ? pick(A, { centre: c.from as number[], size: c.size }) : [], bNew: c.kind !== 'removed' ? pick(B, c) : [] };
    });
    const frames = [0, 1, 2, 3].map((k) => {
      const drop = new Set<number>(), addA: number[] = [], red: number[] = [], green: number[] = [], orange: number[] = [], alert: number[] = [];
      for (const e of ev) {
        if (e.step > k) { e.bNew.forEach((i) => drop.add(i)); addA.push(...e.aOld); continue; } // not yet: still as it was
        if (e.c.kind === 'removed') red.push(...e.aOld);
        else if (e.zone) { alert.push(...e.bNew); red.push(...e.aOld); }
        else if (e.c.kind === 'added') green.push(...e.bNew);
        else { orange.push(...e.bNew); red.push(...e.aOld); }
      }
      const keep: number[] = []; for (let i = 0; i < B.count; i++) if (!drop.has(i)) keep.push(i);
      return { base: concatClouds([selectPoints(B, keep, 'now'), selectPoints(A, addA, 'before')], 'moment'), red: selectPoints(A, red, 'gone'), green: selectPoints(B, green, 'appeared'), orange: selectPoints(B, orange, 'moved'), alert: selectPoints(B, alert, 'in a safety zone') };
    });
    const alerts = ev.filter((e) => e.zone).map((e) => ({ step: e.step, zone: e.zone!, text: `${e.c.cls ?? 'An object'} ${e.c.kind === 'moved' ? 'moved into' : 'appeared in'} ${e.zone!.name}` }));
    return { frames, alerts };
  }, [mission, practice]);
  const [tick, setTick] = useState(3), [playing, setPlaying] = useState(false), [celebrate, setCelebrate] = useState(false);
  useEffect(() => { if (!playing) return; const id = setInterval(() => setTick((t) => { if (t >= 3) { setPlaying(false); return 3; } return t + 1; }), 2200); return () => clearInterval(id); }, [playing]);
  const activeAlerts = timeline ? timeline.alerts.filter((a) => a.step <= tick) : [];
  /** task 6: the colour labels of the inspection bay as a camera in front of it sees them at Time A and at Time B, zoomed, and which labels changed colour */
  const bayLook = useMemo((): { view: BayView; events: LabelEvent[] } | null => {
    if (mission !== 5 || !practice) return null;
    const fA = buildFactory(PRACTICE_SEED, 'A'), fB = buildFactory(PRACTICE_SEED, 'B');
    const cam: CameraUnit = { id: 'bay-view', item: 'cam-mid', x: 0, y: -0.6, z: 1.5, yaw: -Math.PI / 2, pitch: 0, kit: false, pairedLidarId: null, cal: { est: { tx: 0, ty: -0.6, tz: 1.5, yawDeg: -90, pitchDeg: 0 }, fov: 70, done: true } };
    const a = renderPreview(fA, cam, HW_SEED, 0, d.lights, 960), b = renderPreview(fB, cam, HW_SEED, 0, d.lights, 960);
    const labelled = fA.targets.filter((t) => t.id.startsWith('container-i')).sort((p, q) => p.centre[0] - q.centre[0]);
    const it = cameraItem(cam.item), tr = trueExtrinsic(cam, HW_SEED, 0), pose = camPose(tr.e), sc = a.w / it.w;
    const marks = labelled.map((t, n) => { const q = project(pose, [t.centre[0], t.max[1] + 0.002, t.min[2] + 0.75], it.w, it.h, tr.fov); return q ? { id: t.id, u: q.u * sc, v: q.v * sc, n: n + 1 } : null; }).filter((m): m is { id: string; u: number; v: number; n: number } => !!m);
    if (!marks.length) return null;
    const us = marks.map((m) => m.u), vs = marks.map((m) => m.v), aspect = a.w / a.h;
    let w = Math.max((Math.max(...us) - Math.min(...us)) * 1.2, (Math.max(...vs) - Math.min(...vs)) * 1.2 * aspect, a.w * 0.22); w = Math.min(w, a.w); const h = w / aspect;
    const sx = Math.max(0, Math.min(a.w - w, (Math.max(...us) + Math.min(...us)) / 2 - w / 2)), sy = Math.max(0, Math.min(a.h - h, (Math.max(...vs) + Math.min(...vs)) / 2 - h / 2));
    const events: LabelEvent[] = labelled.flatMap((t, n) => { const after = fB.targets.find((q) => q.id === t.id); return after && after.label !== t.label ? [{ id: t.id, name: `Label ${n + 1}`, from: t.label, to: after.label }] : []; });
    return { view: { a, b, crop: { sx, sy, sw: w, sh: h }, marks }, events };
  }, [mission, practice, d.lights]);
  /** how the cloud is drawn in the cleaning and detection missions: one solid colour to begin with, or by intensity or by height */
  const showObjects = mission === 3 && cloudColour === 'objects' && !!step?.segPreview, hasObjectView = mission === 3 && !!step?.segPreview;
  const cloudLook = cloudColour === 'solid' || cloudColour === 'objects' ? { mode: 'flat' as const, colorOpts: { flat: hexRgb('#3b82f6') } } : { mode: cloudColour as 'intensity' | 'height' };
  useEffect(() => { if (mission === 3 && step?.segPreview) setCloudColour('objects'); else setCloudColour((c) => (c === 'objects' ? 'solid' : c)); }, [mission, step?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const frustum = (c: CameraUnit, color: string) => {
    const it = cameraItem(c.item), p = camPose(nominalOf(c)), t = Math.tan((it.fov * D2R) / 2), a = it.w / it.h, L = 4, o = p.pos;
    const corner = (sx: number, sy: number): Vec3 => [o[0] + L * (p.f[0] + sx * t * a * p.r[0] + sy * t * p.u[0]), o[1] + L * (p.f[1] + sx * t * a * p.r[1] + sy * t * p.u[1]), o[2] + L * (p.f[2] + sx * t * a * p.r[2] + sy * t * p.u[2])];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    return <>{cs.map((q, i) => <PolyLine key={i} pts={[o as Vec3, q]} color={color} width={1.5} />)}<PolyLine pts={[...cs, cs[0]]} color={color} width={1.5} /></>;
  };
  const refs = practice?.refs ?? [];
  const matchRef = useMemo(() => { if (!practice) return null; const m = practice.tasks.detect.match; const ok = new Map(m.pairs.map((p) => [p.ref, practice.objects[p.pred]?.cls === refs[p.ref].cls])); return ok; }, [practice, refs]);
  // the measured coverage shows the whole factory; the critical areas are the coloured boxes
  const coverageCloud = useMemo(() => {
    const c = practice?.coverage; if (!c) return null;
    // the colour of each measured sample says how many scanners reached it: red 0, yellow 1, green 2, blue 3 or more; two or more share one green
    const colours = Uint8Array.from(c.colours); for (let i = 0; i < colours.length; i += 3) if (colours[i] === 29) { colours[i] = 40; colours[i + 1] = 170; colours[i + 2] = 90; }
    if (legendOnly === null) return { ...cloudOf(Float32Array.from(c.positions)), colors: colours };
    const kind = (i: number) => { const r = colours[i * 3]; return r === 230 ? 0 : r === 235 ? 1 : 2; };
    const idx: number[] = []; for (let i = 0; i < c.positions.length / 3; i++) if (kind(i) === legendOnly) idx.push(i);
    const pos = new Float32Array(idx.length * 3), col = new Uint8Array(idx.length * 3);
    idx.forEach((i, k) => { for (let q = 0; q < 3; q++) { pos[k * 3 + q] = c.positions[i * 3 + q]; col[k * 3 + q] = colours[i * 3 + q]; } });
    return { ...cloudOf(pos), colors: col };
  }, [practice?.coverage, legendOnly]);
  const displayedRun = mission === 6 && T.final ? T.final.runs[finalVariant] ?? T.final.runs[0] : practice;
  const showScene = viewMode !== 'points', showPts = viewMode !== 'scene';
  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} bgOverride={!showScene ? '#ffffff' : undefined} alwaysShowGuides>
      {showScene && <SceneLayer scene={scene} opacity={viewMode === 'both' && stage >= 3 && stage <= 6 ? 0.18 : 0.4} showCeiling={roof} interactive={false} />}
      {stage === 2 && (placeMode || routeMode) && <mesh position={[(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, 0.01]} onClick={(e) => { e.stopPropagation(); place(e.point.x, e.point.y); }} onPointerOver={() => { document.body.style.cursor = 'crosshair'; }} onPointerOut={() => { document.body.style.cursor = ''; }}><planeGeometry args={[bounds.max[0] - bounds.min[0] + 16, bounds.max[1] - bounds.min[1] + 16]} /><meshBasicMaterial visible={false} /></mesh>}
      {showPts && soloCov && soloColours && <SamplePoints samples={soloCov.samples} colours={soloColours} keep={soloKeep} size={3} maxZ={roof ? undefined : 5.9} />}
      {showPts && mission === 4 && [2, 3, 5, 7].includes(stage) && m4Cloud && !(stage === 5 && step?.preview) && <>
        {bayColour?.rest ? <CloudLayer clip={roofClip} cloud={bayColour.rest} mode="rgb" size={2.6} budget={90000} pickable={false} /> : <CloudLayer clip={roofClip} cloud={m4Cloud.rest} mode="flat" colorOpts={{ flat: hexRgb('#3b82f6') }} size={2.4} budget={90000} pickable={false} />}
        {stage !== 3 && (bayColour ? <CloudLayer clip={roofClip} cloud={bayColour.bay} mode="rgb" size={4.5} budget={40000} pickable={false} /> : <CloudLayer clip={roofClip} cloud={m4Cloud.bay} mode="flat" colorOpts={{ flat: [217, 70, 239] }} size={5} budget={40000} pickable={false} />)}
      </>}
      {showPts && stage === 2 && !soloCov && !practice?.coverage && cov && covColours && <SamplePoints samples={cov.samples} colours={covColours} keep={legendKeep} size={3} maxZ={roof ? undefined : 5.9} />}
      {showPts && mission === 0 && !soloCov && coverageCloud && <CloudLayer clip={roofClip} cloud={coverageCloud} mode="rgb" size={3} budget={15000} pickable={false} />}
      {(stage <= 3 || mission === 6) && <ScannerMarkers scanners={scanners} labelPrefix="LiDAR" labels={mission !== 4 && mission !== 6} colours={UNIT_COLOURS} colourLabels selected={scanners.findIndex((s2) => d.lidars[s2.id].id === sel) >= 0 ? scanners.findIndex((s2) => d.lidars[s2.id].id === sel) : null} sensorOf={(s2) => sensorOf(s2.preset)} onSelect={(i) => T.set({ selectedUnit: d.lidars[i]?.id ?? null })} />}
      {mission >= 4 && stage <= 3 && d.cameras.map((c, i) => <group key={c.id} onClick={(e) => { e.stopPropagation(); T.set({ selectedUnit: c.id }); }}><mesh position={[c.x,c.y,c.z]}><sphereGeometry args={[0.3,10,8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh><Marker p={[c.x, c.y, c.z]} color="#0a84ff" r={0.18} label={`Cam ${i + 1}`} />{c.id === sel && frustum(c, '#0a84ff')}</group>)}
      {stage <= 3 && d.lights.map((l, i) => <Marker key={l.id} p={[l.x, l.y, l.z]} color="#ffcc00" r={0.18} label={`Lamp ${i + 1}`} />)}
      {stage === 2 && selL && <FovVolume sc={lidarAsScanner(selL, 0)} sensor={sensorOf(lidarItem(selL.item).preset)} color={UNIT_COLOURS[d.lidars.indexOf(selL) % 6]} reach={14} opacity={0.08} />}
      {stage === 2 && d.lidars.some(isMobile) && d.route.length > 1 && <PolyLine pts={d.route.map(([x, y]) => [x, y, 0.2] as Vec3)} color="#ff9f0a" width={3} dashed />}
      {stage === 2 && d.route.map(([x, y], i) => (d.lidars.some(isMobile) || routeMode) ? <Marker key={i} p={[x, y, 0.2]} color="#ff9f0a" r={0.2} label={`${i + 1}`} /> : null)}
      {showPts && stage === 4 && survey && survey.visible.scans.map((s2, i) => { const v = surveyView?.[i]; return v && s2.local.count === v.base.length / 3 ? <CloudLayer clip={roofClip} key={`o${i}`} cloud={{ ...s2.local, instances: undefined, colors: camColour && v.cam ? v.cam : v.base }} mode="rgb" size={2.5} budget={120000} pickable={false} /> : <CloudLayer clip={roofClip} key={`o${i}`} cloud={{ ...s2.local, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) }} size={2.5} budget={120000} pickable={false} />; })}
      {showPts && stage === 3 && calCloud && <CloudLayer clip={roofClip} cloud={calCloud.cloud} mode="rgb" size={3} budget={150000} pickable={false} />}
      {stage === 3 && selC && calLid && mission !== 4 && <PolyLine pts={[[selC.x, selC.y, selC.z], [calLid.x, calLid.y, calLid.z]]} color="#ff9f0a" width={3} dashed />}
      {showPts && stage === 5 && mission === 1 && survey && survey.visible.scans.slice(0, alignActive + 1).map((s2, i) => {
        // the reference is the map; a scan that is not aligned yet is drawn as delivered, in its own scanner's frame, so it does NOT line up with the map until it has been aligned
        const done = i <= alignRows.length, aligned = done && (i < alignActive || alignPreview === 'after'), cloud = i === 0 ? (regTest?.clouds[0] ?? s2.cloud) : aligned && regTest?.clouds[i] ? regTest.clouds[i] : s2.local; // only a scan that has really been aligned uses the aligned picture
        const cur = i === alignActive; // the scan being aligned stands out; the map behind it is a lighter blue
        return <CloudLayer clip={roofClip} key={`align-${i}`} cloud={{ ...cloud, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(cur ? '#f4a21e' : '#5d9be6') }} size={cur ? 3.4 : 2.4} budget={120000} pickable={false} />;
      })}
      {showPts && stage === 5 && mission === 1 && survey && alignActive < survey.visible.scans.length && !(alignActive <= alignRows.length && alignPreview === 'after') && (() => { // not aligned yet: show where the scan sits as delivered, and where it belongs
        const q = survey.visible.scans[alignActive], [px, py, pz] = q.pose.t;
        return <><PolyLine pts={[[0, 0, 0], [px, py, pz]]} color="#f4a21e" width={2.5} dashed /><Marker p={[0, 0, 0]} color="#f4a21e" r={0.2} label={`${q.name} as delivered`} /><Marker p={[px, py, pz]} color="#1d78dc" r={0.2} label="where it belongs" /></>;
      })()}
      {showPts && stage === 5 && mission !== 1 && !step && regTest && regTest.clouds.map((c2, i) => <CloudLayer clip={roofClip} key={i} cloud={{ ...c2, instances: undefined }} {...(mission >= 2 && mission <= 4 ? cloudLook : { mode: 'flat' as const, colorOpts: { flat: hexRgb(UNIT_COLOURS[i % 6]) } })} size={2.5} budget={120000} pickable={false} />)}
      {showPts && stage === 5 && mission !== 1 && !step && !regTest && survey && survey.visible.scans.map((s2, i) => <CloudLayer clip={roofClip} key={`in${i}`} cloud={{ ...s2.cloud, instances: undefined }} {...(mission >= 2 && mission <= 4 ? cloudLook : { mode: 'flat' as const, colorOpts: { flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) } })} size={2.5} budget={60000} pickable={false} />)}
      {stage === 5 && mission === 3 && step?.objects && step.objects.map((o, i) => <BoxOutline key={`det${i}`} bbox={o} color={o.cls === 'small' ? '#ff9f0a' : '#30d158'} />)}
      {stage === 5 && mission === 3 && step?.objects && [...step.objects].sort((a, b) => b.n - a.n).slice(0, 24).map((o, i) => <TextSprite key={`dett${i}`} text={o.cls} height={0.016} position={[o.centre[0], o.centre[1], o.max[2] + 0.2]} bg={o.cls === 'small' ? '#b86e00' : '#1f7a3a'} />)}
      {showPts && stage === 5 && mission >= 2 && mission <= 3 && step?.removed && <CloudLayer clip={roofClip} cloud={step.removed} mode="flat" colorOpts={{ flat: [255, 69, 58] }} size={3.2} budget={40000} pickable={false} />}
      {showPts && stage === 5 && mission !== 1 && step?.preview && <CloudLayer clip={roofClip} cloud={showObjects ? step.segPreview! : step.preview} {...(showObjects ? { mode: 'rgb' as const } : mission >= 2 && mission <= 4 ? cloudLook : { mode: step.preview.colors ? 'rgb' as const : 'height' as const })} size={2.5} budget={40000} pickable={false} />}
      {showPts && (stage === 6 || stage === 8) && displayedRun?.twinPreview && <CloudLayer clip={roofClip} cloud={displayedRun!.twinPreview!} {...(mission >= 2 && mission <= 4 ? cloudLook : { mode: displayedRun!.twinPreview!.colors ? 'rgb' as const : 'height' as const })} size={2.5} budget={40000} pickable={false} />}
      {showPts && stage === 6 && showMissing && practice?.tasks.twin.missing && practice.tasks.twin.missing.length > 0 && <CloudLayer clip={roofClip} cloud={cloudOf(practice.tasks.twin.missing)} mode="flat" colorOpts={{ flat: [255, 69, 58] }} size={3} budget={20000} pickable={false} />}
      {showPts && mission === 5 && timeline && (() => { const f = timeline.frames[tick]; return <>
        <CloudLayer clip={roofClip} cloud={f.base} mode="flat" colorOpts={{ flat: hexRgb('#3b82f6') }} size={2.5} budget={60000} pickable={false} />
        <CloudLayer clip={roofClip} cloud={f.red} mode="flat" colorOpts={{ flat: hexRgb(changeColour('removed')) }} size={5} budget={20000} pickable={false} />
        <CloudLayer clip={roofClip} cloud={f.green} mode="flat" colorOpts={{ flat: hexRgb(changeColour('added')) }} size={5} budget={20000} pickable={false} />
        <CloudLayer clip={roofClip} cloud={f.orange} mode="flat" colorOpts={{ flat: hexRgb(changeColour('moved')) }} size={5} budget={20000} pickable={false} />
        <CloudLayer clip={roofClip} cloud={f.alert} mode="flat" colorOpts={{ flat: [255, 45, 85] }} size={6} budget={20000} pickable={false} />
      </>; })()}
      {mission === 5 && practice && changeFocus?.type === 'change' && practice.found.changes[changeFocus.i] && (() => { const c = practice.found.changes[changeFocus.i], h = [Math.max(c.size[0], 0.5) / 2 + 0.25, Math.max(c.size[1], 0.5) / 2 + 0.25, Math.max(c.size[2], 0.5) / 2 + 0.25]; return <BoxOutline bbox={{ min: [c.centre[0] - h[0], c.centre[1] - h[1], Math.max(0, c.centre[2] - h[2])], max: [c.centre[0] + h[0], c.centre[1] + h[1], c.centre[2] + h[2]] }} color="#0a84ff" />; })()}
      {mission === 6 && T.final && displayedRun?.objects.map((o) => <BoxOutline key={`final-${o.id}`} bbox={o} color="#30a14e" />)}
      {stage === 7 && showObjectLabels && practice?.objects.map((o) => <Marker key={`label-${o.id}`} p={[o.centre[0], o.centre[1], o.max[2] + 0.15]} color="#30a14e" r={0.04} label={`${o.cls}${o.colour && o.colour !== 'unknown' ? ` · ${o.colour}` : ''}`} />)}
      {stage === 7 && taskTab === 'detect' && practice && refs.map((t, i) => { const found = matchRef?.get(i); return <BoxOutline key={t.id} bbox={t} color={found === undefined ? '#ff453a' : found ? '#30d158' : '#ff9f0a'} />; })}
      {stage === 7 && taskTab === 'detect' && practice && practice.objects.map((o, i) => practice.tasks.detect.match.spurious.includes(i) ? <BoxOutline key={`p${i}`} bbox={o} color="#8e8e93" dashed /> : null)}
      {stage === 7 && taskTab === 'change' && (mission !== 5 || timeView === 'changes') && practice && <>{practice.truth.changes.map((c, i) => <Marker key={`t${i}`} p={[c.centre[0], c.centre[1], 2.5]} color="#30d158" r={0.25} label={`${c.kind}`} />)}{practice.found.changes.map((c, i) => <Marker key={`f${i}`} p={[c.centre[0], c.centre[1], 1.5]} color="#ff9f0a" r={0.18} />)}</>}
      {(mission === 0 && stage === 2 || mission === 4 || mission === 6) && <><BoxOutline bbox={CRITICAL_CAMERA_ZONE} color="#af52de" dashed /><Marker p={[-.15, -6.8, 1.6]} color="#af52de" r={.08} label={zoneNames && mission !== 4 && mission !== 6 ? 'Critical camera bay' : undefined} /></>}
      {mission === 0 && stage <= 2 && CRITICAL_AREAS.map((z) => {
        const cx = (z.min[0] + z.max[0]) / 2, cy = (z.min[1] + z.max[1]) / 2;
        return <group key={z.id}>
          <mesh position={[cx, cy, 0.03]} raycast={() => null}><planeGeometry args={[z.max[0] - z.min[0], z.max[1] - z.min[1]]} /><meshBasicMaterial color={z.color} transparent opacity={0.28} depthWrite={false} /></mesh>
          <BoxOutline bbox={{ min: [z.min[0], z.min[1], 0], max: [z.max[0], z.max[1], 3] }} color={z.color} />
          {zoneNames && <TextSprite text={`${z.name} · ≥ ${z.need} pts/m²`} position={[cx, cy, 3.2]} bg={z.color} />}
        </group>;
      })}
      {(stage === 7 && taskTab === 'safety' || stage === 2 && showZones) && SAFETY_ZONES.map((z) => <BoxOutline key={z.id} bbox={{ min: [z.min[0], z.min[1], z.zMin], max: [z.max[0], z.max[1], 0.8] }} color="#ff453a" dashed />)}
      {mission === 5 && practice && SAFETY_ZONES.map((z) => { const f = practice.found.safety?.find((q) => q.zone === z.id), on = changeFocus?.type === 'zone' && practice.found.safety?.[changeFocus.i]?.zone === z.id, warned = activeAlerts.some((a) => a.zone.id === z.id); if (!on && !warned) return null; return <BoxOutline key={z.id} bbox={{ min: [z.min[0], z.min[1], z.zMin], max: [z.max[0], z.max[1], on || warned ? 2.4 : 0.8] }} color={on ? '#0a84ff' : f?.violated || warned ? '#ff2d55' : '#30d158'} dashed={!on} />; })}
    </Viewport>
  );

  // ---- panels
  const selectedUnitEditor = () => {
    if (selL && mission === 4) return <p className="hint">The LiDARs stay where you put them in task 1.</p>;
    if (selL) {
      const i = d.lidars.indexOf(selL), it = lidarItem(selL.item);
      return (
        <>
          <div className="caption"><b style={{ color: UNIT_COLOURS[i % 6] }}>LiDAR {i + 1}</b> · {it.name} · {rayCount(selL).toLocaleString()} rays per scan</div>
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
      {mission !== 4 && d.lidars.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} data-testid={`twin-unit-l${i + 1}`} style={{ borderColor: UNIT_COLOURS[i % 6], borderWidth: 2, borderStyle: 'solid' }}>LiDAR {i + 1}</button>)}
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
          {mission === 0 && <Section title="Compare LiDAR scanners"><EquipmentCatalogue cameras={false} scale={T.settings.priceScale} buy={buyLidar} owned={(id) => d.lidars.filter((u) => u.item === id).length} removeOne={(id) => { const u = [...d.lidars].reverse().find((x) => x.item === id); if (u) remove(u.id); }} canBuy={(id) => d.lidars.length < LIMITS.lidars && (id !== 'tls-hire' || d.lidars.filter((u) => u.item === id).length < 2) && (!lidarItem(id).mobile || !d.lidars.some(isMobile)) && affordable(lidarPlan(id).f)} /></Section>}
          {mission >= 4 && <Section title="Additional cameras (optional)" open={false}><EquipmentCatalogue cameras scale={T.settings.priceScale} buy={buyCamera} owned={(id) => d.cameras.filter((u) => u.item === id && u.id !== INSPECTION_CAMERA_ID).length} removeOne={(id) => { const u = [...d.cameras].reverse().find((x) => x.item === id && x.id !== INSPECTION_CAMERA_ID); if (u) remove(u.id); }} canBuy={(id) => d.cameras.length < LIMITS.cameras && affordable(cameraPlan(id))} /></Section>}
          <Section title="Extras" open={mission >= 4}>
            <Btn sm icon={<Plus size={14} />} onClick={() => setDesign((q) => ({ ...q, lights: [...q.lights, { id: newId('lamp'), x: q.lights.length ? freshSpot()[0] : 8, y: q.lights.length ? freshSpot()[1] : 5, z: 3 }] }))} disabled={d.lights.length >= LIMITS.lights || !affordable((q) => ({ ...q, lights: [...q.lights, { id: 'x', x: 0, y: 0, z: 3 }] }))} testId="twin-buy-light">Lighting unit ({Math.round(LIGHT_UNIT.cost * T.settings.priceScale)})</Btn>
            {d.platform && <Toggle label={`Mobile scanning platform (${Math.round(MOBILE_PLATFORM.cost * T.settings.priceScale)})`} checked={d.platform} onChange={(v) => { if (!v && d.lidars.some(isMobile)) { lab.notify('Remove the mobile LiDAR first: it needs the platform.', 'warn'); return; } setDesign((q) => ({ ...q, platform: v })); }} hint="Needed for the mobile LiDAR (it is added for you)." />}
            <p className="hint">Installing each device has a small cost too. Credits use a USD reference divided by 5; generic accessories are educational estimates.</p>
          </Section>
          {mission !== 4 && <Section title="Your bill" hint="Your choices are kept. Come back any time to remove something or add more: the other items keep their place and calibration.">
            {(() => {
              const k = T.settings.priceScale, c = (v: number) => Math.round(v * k);
              type Row = { label: string; amount: number; sub?: boolean; mandatory?: boolean; remove?: { id: string; test: string; what: string; onClick?: () => void } };
              const rows: Row[] = [];
              d.lidars.forEach((u, i) => {
                const it = lidarItem(u.item);
                rows.push({ label: `LiDAR ${i + 1}: ${it.name}${u.res !== 'standard' ? ` · ${u.res}` : ''}`, amount: c(it.cost * RES_TIERS[u.res].cost), remove: { id: u.id, test: `l${i + 1}`, what: `LiDAR ${i + 1}` } });
                rows.push({ label: 'Installation', amount: c(INSTALL.lidar), sub: true });
              });
              d.cameras.forEach((u, i) => {
                const it = cameraItem(u.item);
                rows.push({ label: `Camera ${i + 1}: ${it.name}`, mandatory: u.id === INSPECTION_CAMERA_ID, amount: c(it.cost), remove: u.id === INSPECTION_CAMERA_ID ? undefined : { id: u.id, test: `c${i + 1}`, what: `Camera ${i + 1}` } });
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
                      <span className="bill-label">{r.label}{r.mandatory && <span className="bill-tag" title="Part of the project: it cannot be removed">Mandatory</span>}</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{usd(r.amount)}</span>
                      <span className="bill-x-slot">{r.mandatory && <span title="Mandatory: it cannot be removed" aria-label="Mandatory, cannot be removed">🔒</span>}{r.remove && <button className="bill-x" aria-label={`Remove ${r.remove.what}`} title={`Remove ${r.remove.what}`} onClick={r.remove.onClick ?? (() => remove(r.remove!.id))} data-testid={`twin-remove-${r.remove.test}`}>✕</button>}</span>
                    </div>
                  ))}
                  <div className="bill-total"><span>Total</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt" data-testid="twin-bill-total">{usd(cost.total)}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row sub"><span className="bill-label">Budget</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{usd(T.settings.budget)}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row"><span className="bill-label"><b>Remaining</b></span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt"><b>{usd(cost.remaining)}</b></span><span className="bill-x-slot" /></div>
                </div>
              );
            })()}
          </Section>}
        </>
      );
      case 2: return (
        <>
          {mission !== 4 && <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })} testId="twin-back-equipment">← Change equipment</Btn></div>}
          <Section title="Place your equipment">
            {unitList}
            <Btn sm variant={placeMode ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => { setPlaceMode((v) => !v); setRouteMode(false); }} disabled={!sel} testId="twin-place">{placeMode ? `Placing ${unitName}: click the plan or scene` : `Place ${unitName} by clicking`}</Btn>
            {selL && mission !== 4 && <Toggle label={`Show only LiDAR ${d.lidars.indexOf(selL) + 1}'s points`} checked={solo} onChange={setSolo} hint="Shows only the surfaces this LiDAR reaches, and nothing from the other scanners." />}
            {selectedUnitEditor()}
          </Section>
          {mission !== 4 && d.lidars.some(isMobile) && (
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
          <p className="hint">{mission === 4 ? 'Click the plan (top left) or the scene to move the camera, then turn and tilt it to aim at the outlined bay.' : 'Click the plan (top left) to move the selected unit. Numbers are in the card below the view.'}</p>
          {cov && <p className="hint" data-testid="twin-coverage-note">Coverage counts surface with a clear line of sight (red dots are unseen). Run the measured test to add point density, noise and dropout.</p>}
          {mission !== 4 && <Toggle label="Show the safety zones" checked={showZones} onChange={setShowZones} />}
        </>
      );
      case 3: return (
        <>
          {mission !== 4 && <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })}>← Change equipment</Btn></div>}
          {mission === 4 && <p className="hint" data-testid="twin-combined-note">Your LiDAR clouds are already registered into one. The camera is registered with that combined cloud, cropped to the inspection bay: match the red crosses to the green squares, then watch the bay points take the camera's colours.</p>}
          {mission !== 4 && <Callout kind="edu" title="How calibration works">
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 3 }}>
              <li><b>Connect</b> each camera to a LiDAR: drag a wire from its dot (several cameras can share one).</li>
              <li><b>Match</b> the red crosses to the green squares, inspect the marker error and try a manual correction; assistance is available afterwards.</li>
              <li><b>Watch</b> the view: that LiDAR's points take the camera's colours. When it is right, the labels land on the right objects.</li>
            </ol>
          </Callout>}
          {d.cameras.length === 0 ? <p className="hint">You have no cameras. Colour-coded labels require a camera with a view of the measured labels.</p> : (
            <>
              {mission !== 4 && <PairBoard cams={d.cameras.map((u) => ({ id: u.id, label: `Camera ${d.cameras.indexOf(u) + 1}`, sub: cameraItem(u.item).name, done: u.cal.done, to: pairedLidar(u)?.id ?? null }))} lids={d.lidars.map((u, i) => ({ id: u.id, label: `LiDAR ${i + 1}`, sub: lidarItem(u.item).name, nearestOf: d.cameras.filter((c) => nearestLidar(c)?.id === u.id).map((c) => c.id) }))} selected={sel} onSelect={(id) => T.set({ selectedUnit: id })} onPair={(cid, lid) => setDesign((q) => ({ ...q, cameras: q.cameras.map((c) => c.id === cid ? { ...c, pairedLidarId: lid, cal: c.pairedLidarId === lid ? c.cal : { est: nominalOf(c), fov: cameraItem(c.item).fov, done: false } } : c) }))} />}
              {selC && d.lidars.length > 0 && (
                <>

                  {calLid && <FovOverlapChart cam={selC} lid={calLid} camNo={d.cameras.indexOf(selC) + 1} lidNo={d.lidars.indexOf(calLid) + 1} dist={fovDist} onDist={setFovDist} />}
                  <div className="caption" data-testid="twin-cal-colour">{calBusy ? 'Preparing the combined cloud and the colours…' : calCloud ? `${connected.length > 1 ? `Cameras ${connected.map((c) => d.cameras.indexOf(c) + 1).join(' + ')} together colour` : `Camera ${d.cameras.indexOf(selC) + 1} colours`} ${calCloud.coloured.toLocaleString()} of ${calCloud.total.toLocaleString()} points of ${mission === 4 ? 'the combined cloud in the inspection bay' : calLid ? `LiDAR ${d.lidars.indexOf(calLid) + 1}` : 'the combined cloud'} (${calCloud.total ? Math.round((100 * calCloud.coloured) / calCloud.total) : 0} %). Grey points are not in ${connected.length > 1 ? 'any of their' : "this camera's"} view.` : ''}</div>
                </>
              )}
              {selC ? <CalPanel key={selC.id + JSON.stringify([selC.x, selC.y, selC.z, selC.yaw, selC.pitch, selC.kit])} unit={selC} index={d.cameras.indexOf(selC)} lights={d.lights} onChange={(c) => setDesign((q) => ({ ...q, cameras: q.cameras.map((x) => (x.id === c.id ? c : x)) }))} /> : <p className="hint">Pick a camera above. A ✓ means it is calibrated.</p>}
            </>
          )}
        </>
      );
      case 4: return (
        <>
          {survey && (() => {
            const cam = d.cameras.length > 0; // the camera column only matters when there is a camera
            const col = (i: number) => (surveyView?.[i]?.cam ? `${surveyView[i].coloured.toLocaleString()} (${Math.round((100 * surveyView[i].coloured) / Math.max(1, survey.visible.scans[i].cloud.count))} %)` : '…');
            return (
              <table className="table survey-table" data-testid="twin-survey"><thead><tr><td>Scan</td><td className="num">Points</td>{cam && <td className="num">Coloured</td>}</tr></thead><tbody>
                {survey.visible.scans.map((s2, i) => <tr key={s2.index}><td>{s2.name}</td><td className="mono num">{s2.cloud.count.toLocaleString()}</td>{cam && <td className="mono num">{col(i)}</td>}</tr>)}
                <tr><td><b>All</b></td><td className="mono num"><b>{survey.visible.stats.points.toLocaleString()}</b></td>{cam && <td className="mono num"><b>{surveyView ? surveyView.reduce((a, v) => a + v.coloured, 0).toLocaleString() : ''}</b></td>}</tr>
              </tbody></table>
            );
          })()}
          {survey && d.cameras.length > 0 && <div className="view-options" data-testid="survey-options"><Toggle label="Camera colours" checked={camColour} onChange={setCamColour} hint="Points a camera sees take its colours." /></div>}
          {mission === 5 && <p className="hint">Practice survey = Time A. Time B is taken automatically when you compare surveys.</p>}
        </>
      );
      case 5: {
        if (mission === 5) return <ChangesExplorer shown={!!practice && !!T.progress.results[5] && !T.progress.results[5].stale} busy={!!T.busy} changes={practice?.found.changes ?? []} safety={practice?.found.safety ?? []} focus={changeFocus} onFocus={setChangeFocus} onShow={() => void showChanges()} best={bestChange} reality={practice ? { real: practice.tasks.change.truth, matched: practice.tasks.change.tp } : undefined} />;
        const names = (ks: BlockKind[]) => ks.map((k) => BLOCKS[k].name.replace(/ \(.*\)$/, ''));
        const has = (kinds: BlockKind[]) => T.pipeline.some((x) => kinds.includes(x.kind) && !x.bypass);
        const checklist: { ok: boolean; text: string; add?: BlockKind }[] = [
          { ok: has(['icp', 'mobileicp', 'merge']), text: 'The scans are joined (registration)' },
          { ok: has(['euclid', 'dbscan']), text: 'Points grouped into objects', add: 'euclid' },
          { ok: has(['classify']), text: 'Objects named', add: 'classify' },
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
              {canRunParallel(b.kind) && mission < 2 && ( // cleaning and detection (missions 3 and 4) always run one block after the other
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
            settings={icpBlock ? <>{BLOCKS.icp.params.map((p) => { const cur = scanSettings(alignActive); return p.options
              ? <Select<string> key={`${alignActive}-${p.key}`} label={p.label} value={String(cur[p.key] ?? p.def)} options={p.options.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(v) => setScanParam(alignActive, p.key, Number(v))} hint={p.hint} />
              : <Slider key={`${alignActive}-${p.key}`} label={p.label} value={cur[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} unit={p.unit} format={(v) => (p.step < 1 ? v.toFixed(p.step < 0.05 ? 2 : 1) : String(v))} onChange={(v) => setScanParam(alignActive, p.key, v)} hint={p.hint} />; })}</> : null} />
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
          if (mission === 5 && ph.id === 'safety' && !inPhase.length) return (
            <button className="btn primary" style={{ width: '100%' }} data-testid="twin-add-safety-lane" onClick={() => T.set({ pipeline: insertBlock(T.pipeline, newBlock('safety')), practice: null })}>+ Add Safety zone check</button>
          );
          if (ph.id === 'naming' && mission === 3 && !inPhase.length) return (
            <button className="btn primary" style={{ width: '100%' }} data-testid="twin-add-classify-lane" onClick={() => T.set({ pipeline: insertBlock(T.pipeline, newBlock('classify')), practice: null })}>+ Add Classify objects</button>
          );
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
                  <div className="pipe-lane-head"><b>{mission === 4 && ph.id === 'naming' ? '1 · Read the colour labels' : `${PHASES.slice(0, pi).filter((q) => q.kinds.some((k) => missionDef.blocks.includes(k))).length + 1} · ${ph.title.replace(/^\d+ · /, '')}`}</b>{(ph.required || (mission === 3 && (ph.id === 'objects' || ph.id === 'naming')) || (mission === 5 && (ph.id === 'compare' || ph.id === 'safety'))) && <span className="pipe-req">required</span>}<div className="caption">{ph.id === 'naming' ? (mission === 3 ? 'Name each group by its size and shape. Needed to get a score.' : 'Read each object’s label colour from the camera.') : ph.why}</div></div>
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
              <Btn sm onClick={() => setPipeExpanded(false)} testId="twin-collapse-builder">Collapse ⤡</Btn>
            </div>
            <div data-testid="twin-checklist-wide" className="pipe-chips">{checklist.filter((c, i) => mission === 1 ? i === 0 : false).map((c) => <span key={c.text} className={`pipe-chip ${c.ok ? 'ok' : ''}`}>{c.ok ? '✓' : '○'} {c.text}</span>)}</div>
            {lanesView(true)}
          </div>, document.body);
        return (
          <>
            {expandedView}
            <p className="hint">{mission === 3 ? <>Starts from your cleaned cloud: remove the building, group the points, name each group. <b>Test pipeline</b> shows each step in 3D: <span style={{ color: '#30a14e' }}>green boxes</span> are named objects, <span style={{ color: '#ff453a' }}>red points</span> were removed.</> : (mission === 5 ? 'Starts from the objects you found. Find what changed between Time A and Time B, then check the safety zones.' : mission === 4 ? 'Reads the label colours of the objects you found in task 4.' : 'Starts from your earlier missions’ results. Add this mission’s tools, then evaluate.')}</p>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm onClick={() => setPipeExpanded(true)} testId="twin-expand-builder" title="Open the builder full size">Expand ⤢</Btn>
              <Btn sm onClick={() => T.set({ pipeline: T.pipeline.filter((b) => !missionDef.blocks.includes(b.kind)), practice: null })}>Clear mission tools</Btn>
            </div>
            <div data-testid="twin-checklist" style={{ display: 'grid', gap: 2 }}>{checklist.filter((c, i) => mission === 1 ? i === 0 : false).map((c) => <div key={c.text} className="caption" style={{ color: c.ok ? '#30a14e' : undefined }}>{c.ok ? '✓' : '○'} {c.text}{!c.ok && c.add && mission === 3 && <button className="btn sm" style={{ marginLeft: 8 }} data-testid={`twin-add-${c.add}`} onClick={() => T.set({ pipeline: insertBlock(T.pipeline, newBlock(c.add!)), practice: null })}>+ Add {BLOCKS[c.add].name.replace(/ \(.*\)$/, '').toLowerCase()}</button>}</div>)}</div>
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
            <Btn variant="good" onClick={submitFinal} busy={!!T.busy} disabled={!readyForFinal(T.progress) || !cost.ok || !chk.ok || (T.settings.maxSubmissions > 0 && finalsUsed >= T.settings.maxSubmissions)} testId="twin-final">Final evaluation{T.settings.maxSubmissions > 0 ? ` (${Math.max(0, T.settings.maxSubmissions - finalsUsed)} left)` : ''}</Btn>
          </div>
          {T.final && currentPass(T.progress.results[6]) && <div className="celebrate-card" data-testid="celebrate-card"><h3>Your digital twin is commissioned</h3><p>All seven missions are complete. Celebrate it: add your name, then watch the point cloud celebration, keep it as a video and save your certificate as a picture.</p><Btn variant="primary" onClick={() => setCelebrate(true)} testId="twin-celebrate">Celebrate and get my certificate</Btn></div>}
          {(() => { const todo = MISSIONS.slice(0, 6).map((m, i) => ({ m, i })).filter(({ i }) => !currentPass(T.progress.results[i]));
            return todo.length ? <div className="final-todo" data-testid="final-todo"><b>Finish these first</b>{todo.map(({ m, i }) => <button key={i} type="button" onClick={() => goMission(i)}>{i + 1} · {m.title}{T.progress.results[i]?.stale ? ' (run it again)' : ''}</button>)}</div>
              : !cost.ok ? <p className="hint">{cost.errors[0]}</p> : !T.final ? <p className="hint">Runs your system, unchanged, on 2 other scenarios and averages them.</p> : null; })()}
          {T.busy && <p className="hint" data-testid="twin-busy">{T.busy}</p>}
          {T.final && <CompletionReport result={T.final} design={d} progress={T.progress} />}
          {workshopConfigured() && accept.known && accept.accepting && <Section title="Send my score">
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
          </Section>}
          <Section title="Save, share and report">
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm icon={<Download size={14} />} onClick={exportConfig} testId="twin-export">Export configuration</Btn>
              <Btn sm icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Import</Btn>
              <Btn sm icon={<Download size={14} />} onClick={exportReport} disabled={!practice && !T.final} testId="twin-report">Results report</Btn>
              <Btn sm onClick={() => { if (confirm('Clear the whole workspace (equipment, pipeline, attempts)?')) T.reset(); }}>Start over</Btn>
            </div>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importConfig(e.target.files?.[0])} data-testid="twin-import" />
          </Section>
        </>
      );
    }
  })();

  // mission 1: what the last test measured, against each of its two requirements (dashes until tested, or when the design has changed since)
  const readout0: CoverageReadout | undefined = mission === 0 ? (() => {
    const saved = T.progress.results[0], r0 = d.lidars.length && saved && !saved.stale ? saved : null, val = (label: string) => r0?.metrics.find((m) => m.label === label)?.value;
    return { coverage: { value: val('Critical-area measured coverage') as number, target: 70 }, density: Object.entries(ZONE_DENSITY_MIN).map(([zone, target]) => ({ zone, target, color: CRITICAL_AREAS.find((q) => q.id === zone)?.color, value: val(`${zone[0].toUpperCase()}${zone.slice(1)} point density`) })) };
  })() : undefined;
  // what each LiDAR contributes to each critical area, from the last measured test (only while it still matches the design)
  const breakdown0: LidarBreakdown | undefined = (() => {
    const c = mission === 0 ? practice?.coverage : undefined; if (!c || c.perScanner.length !== d.lidars.length) return undefined;
    const cell = (k: number, z: string) => ({ coverage: c.perScanner[k].coverage[z] ?? 0, density: c.perScanner[k].density[z] ?? 0 });
    return {
      areas: CRITICAL_AREAS.map((z) => ({ id: z.id, name: z.name, color: z.color })),
      rows: d.lidars.map((u, k) => ({ label: `LiDAR ${k + 1}`, sub: lidarItem(u.item).name.match(/\(([^)]+)\)/)?.[1] ?? lidarItem(u.item).name, color: UNIT_COLOURS[k % 6], cells: Object.fromEntries(CRITICAL_AREAS.map((z) => [z.id, cell(k, z.id)])) })),
      total: Object.fromEntries(CRITICAL_AREAS.map((z) => [z.id, { coverage: c.zones[z.id] ?? 0, density: c.zoneDensity[z.id] ?? 0 }])),
    };
  })();
  // mission 2, after the evaluation: the error of each scan on its own, so the pair that goes wrong is easy to find
  const pairRows: PairRow[] = mission === 1 && practice?.tasks.twin.poseEach?.length && practice.registration
    ? practice.tasks.twin.poseEach.map((e, i) => ({ name: practice.registration!.scans[i]?.name ?? `LiDAR ${i + 2}`, cm: e.cm, deg: e.deg, overlap: practice.registration!.scans[i]?.overlapAfter ?? 0, accepted: practice.registration!.scans[i]?.accepted ?? true }))
    : [];
  const missionCheck = mission < 6 && <MissionCheck
    readout={readout0}
    breakdown={breakdown0}
    target={MISSION_TARGETS[mission]}
    coverage={mission === 0}
    busy={!!T.busy || regBusy}
    disabled={!cost.ok || (mission > 0 && !chk.ok) || (mission === 1 && alignmentPending)}
    disabledReason={!d.lidars.length ? 'Add a LiDAR from the catalogue to begin.' : !cost.ok ? 'Review your equipment and budget before testing.' : mission === 1 && alignmentPending ? !survey ? 'Acquire your scans first.' : 'Align each scan first.' : 'Complete the processing steps before testing.'}
    onEvaluate={() => void runPractice()}
    auto={mission === 0}
    calculating={calc}
    fresh={!covStale}
  />;
  const controls = (
    <>
      <MissionBrief key={mission} mission={mission} progress={T.progress} cost={cost.total} budget={T.settings.budget} hasLidar={!!d.lidars.length} finalDone={!!T.final} onContinue={() => goMission(mission + 1)} onReference={() => { const i = tabIndex(missionDef.reference); if (i >= 0) lab.setTab(i); }} />
      {[1, 2, 8].includes(stage) && mission !== 4 && mission !== 6 && <BudgetSummary cost={cost} budget={T.settings.budget} hasLidar={!!d.lidars.length} mandatory={d.cameras.some((u) => u.id === INSPECTION_CAMERA_ID) ? { label: 'inspection camera', amount: Math.round((cameraItem(d.cameras.find((u) => u.id === INSPECTION_CAMERA_ID)!.item).cost + INSTALL.camera) * T.settings.priceScale) } : undefined} />}
      {mission !== 4 && mission !== 5 && <div className="mission-tools"><Seg label="Mission tools" value={stage} onChange={(stage) => { if (!regBusy && !T.busy) T.set({ stage }); }} options={missionDef.tools.map((value, idx) => {
        const locked = (value === 2 && !d.lidars.length) || (value === 3 && !d.cameras.length), next = !locked && stage === 1 && value === 2 && mission === 0; // Deploy opens with the first LiDAR, and points the way
        const name = mission === 1 ? value === 4 ? 'Acquire scans' : 'Align scans' : TOOL_NAMES[value];
        const body = <><i className="step-num" aria-hidden="true">{locked ? '🔒' : idx + 1}</i>{name}</>; // the number is decoration: the button's name stays the plain step name
        return { value, disabled: locked, label: locked ? <span className="step-label" title={value === 2 ? 'Choose a LiDAR first' : 'Add a camera first'}>{body}</span> : next ? <span className="step-label step-ready" title="Next step">{body}</span> : <span className="step-label">{body}</span> };
      })} /></div>}
      {mission === 0 && stage === 1 && (d.lidars.length > 0
        ? <div className="align-acquire"><Btn variant="primary" block onClick={() => T.set({ stage: 2 })} testId="twin-next-deploy">Next: place your sensors →</Btn></div>
        : <p className="hint" data-testid="twin-pick-first">Choose a LiDAR below to continue.</p>)}
      {stage === 4 && <div className="align-acquire"><Btn variant="primary" block icon={<Play size={16} />} onClick={acquire} busy={T.busy === 'Acquiring the survey…'} disabled={!cost.ok || !!T.busy || regBusy} testId="twin-acquire">{survey ? 'Acquire the survey again' : 'Acquire the practice survey'}</Btn>{mission === 1 && survey && <Btn block onClick={() => T.set({ stage: 5 })} disabled={!!T.busy || regBusy} testId="align-open">Continue to alignment →</Btn>}</div>}
      {mission === 6 && <p className="mission-check-target mission-final-target" data-testid="mission-targets">{MISSION_TARGETS[mission]}</p>}
      {mission === 4 && <InspectionMission camera={inspectionCam} preview={inspectionPreview} busy={!!T.busy} stage={stage} panel={panel} hasColour={T.pipeline.some((b) => b.kind === 'colour' && !b.bypass)} resultLevel={T.progress.results[4]?.level} stale={T.progress.results[4]?.stale} canEvaluate={cost.ok && chk.ok}
        onOpen={(st) => T.set({ stage: st, selectedUnit: st === 2 || st === 3 ? inspectionCam?.id ?? null : T.selectedUnit })}
        onPlace={() => { T.set({ stage: 2, selectedUnit: inspectionCam?.id ?? null }); setPlaceMode(true); }}
        onColours={() => T.set({ stage: 5, ...(T.pipeline.some((b) => b.kind === 'colour') ? {} : { pipeline: insertBlock(T.pipeline, newBlock('colour')), practice: null }) })}
        onEvaluate={() => { void runPractice().then(() => useTwin.getState().set({ stage: 7 })); }} />}
      {mission === 0 && missionCheck}  {/* the first mission recalculates by itself, so its check stays at the top; the others are evaluated after the tools are set up, so theirs is at the bottom */}
      {mission !== 4 && <div key={stage} className="mission-workspace">{panel}</div>}
      {mission >= 1 && mission !== 5 && !(mission === 1 && stage === 4) && missionCheck}
      {mission === 1 && stage === 5 && pairRows.length > 0 && <PairErrors reference={survey?.visible.scans[0]?.name ?? 'LiDAR 1'} rows={pairRows} />}  {/* scans are only judged after they are aligned, so the check is not shown while acquiring */}
      <div className="mission-project-details">{mission === 0 && <Section title="Project identity" open={false}><div className="field"><label htmlFor="twin-team">Team name (optional)</label><input id="twin-team" value={T.team} onChange={(e) => T.set({ team: e.target.value })} /></div><Btn sm onClick={exportConfig}>Export configuration</Btn><Btn sm onClick={() => { if (confirm("Start a new project? Export first if you want to keep this configuration.")) T.reset(); }}>Start a new project</Btn><Btn sm onClick={() => fileRef.current?.click()}>Import configuration</Btn><input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importConfig(e.target.files?.[0])} /></Section>}</div>
    </>
  );
  const basePlan = { markers: [...d.lidars.map((u, i) => ({ x: u.x, y: u.y, color: UNIT_COLOURS[i % 6], label: `L${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.cameras.map((u, i) => ({ x: u.x, y: u.y, color: '#0a84ff', label: `C${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.lights.map((u, i) => ({ x: u.x, y: u.y, color: '#ffcc00', label: `Lamp ${i + 1}`, r: 5 })), ...(d.lidars.some(isMobile) ? d.route.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: `${i + 1}`, r: 4 })) : [])], paths: [...(d.lidars.some(isMobile) && d.route.length > 1 ? [{ pts: d.route, color: '#ff9f0a', dashed: true }] : []), ...((mission === 0 || mission === 4 || mission === 6) ? [{ pts: [[-3.7,-7.5],[3.4,-7.5],[3.4,-6.1],[-3.7,-6.1],[-3.7,-7.5]] as [number, number][], color: '#af52de', dashed: true, width: 2 }] : [])] };
  /** later stages keep the plan and add what that stage is about: where the real objects were found or missed, and where changes happened */
  const taskMarks = stage === 7 && practice ? (taskTab === 'detect'
    ? refs.map((r, i) => ({ x: r.centre[0], y: r.centre[1], color: matchRef?.get(i) === undefined ? '#ff453a' : matchRef.get(i) ? '#30d158' : '#ff9f0a', r: 3 }))
    : taskTab === 'change' ? [...practice.truth.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#30d158', r: 5 })), ...practice.found.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#ff9f0a', r: 3 }))] : []) : [];
  const zonePaths = mission === 0 && stage <= 2 ? CRITICAL_AREAS.map((z) => ({ pts: [[z.min[0], z.min[1]], [z.max[0], z.min[1]], [z.max[0], z.max[1]], [z.min[0], z.max[1]], [z.min[0], z.min[1]]] as [number, number][], color: z.color })) : [];
  const planLayers = { ...basePlan, paths: [...((basePlan as { paths?: { pts: [number, number][]; color: string; dashed?: boolean }[] }).paths ?? []), ...zonePaths], markers: [...basePlan.markers, ...taskMarks] };
  const result = d.lidars.length ? T.progress.results[mission] : null;
  const stats = result ? currentMissionMetrics(result, cost.total, T.settings.budget).filter((m) => m.unit !== 'credits').map((m) => ({ k: m.label, v: fmtMetric(m.value, m.unit), s: m.info ? 'For information' : result.stale ? 'Revalidation required' : !Number.isFinite(m.value) ? (mission === 3 ? (T.pipeline.some((b) => (b.kind === 'euclid' || b.kind === 'dbscan') && !b.bypass) ? 'Add Classify to score' : 'Add clustering + Classify') : 'Not measured yet') : `Target ${m.lower ? '≤' : '≥'} ${fmtMetric(m.target, m.unit)}` })) : [{ k: 'Project budget', v: `${usd(cost.remaining)} left`, s: `${usd(cost.total)} spent of ${usd(T.settings.budget)}` }];
  const legend = stage === 5 && mission === 1 ? [{ color: '#1d78dc', label: 'Reference + earlier scans' }, { color: '#f4a21e', label: 'Current scan' }] : mission === 4 && [2, 3].includes(stage) ? [{ color: '#3b82f6', label: 'Point cloud' }, { color: '#af52de', label: 'Inspection bay: the camera’s own colours' }] : stage === 2 && soloCov ? [{ color: UNIT_COLOURS[soloIndex % 6], label: `Only what LiDAR ${soloIndex + 1} sees` }] : stage === 2 ? [{ color: HEAT[0], label: 'No LiDAR sees it' }, { color: HEAT[1], label: 'One LiDAR' }, { color: HEAT[2], label: 'Two or more LiDARs' }] : stage === 6 ? [{ color: '#ff453a', label: 'True surface not covered' }] : stage === 7 ? [{ color: '#30d158', label: 'Found' }, { color: '#ff9f0a', label: 'Misnamed' }, { color: '#ff453a', label: 'Missed' }] : ZONES.map((z, i) => ({ color: ['#c7a28a', '#9ab', '#8ac', '#bb9', '#667'][i], label: z.name }));
  void STATUS_COLOURS;
  const celebration = <CompletionExperience open={celebrate} onClose={() => setCelebrate(false)} sendScore={workshopConfigured() && accept.known && accept.accepting && T.final ? { accepting: true, defaultIndex: T.student.index, alreadySent: T.sent.some((x) => x.kind === 'final'), send: async (name, index) => {
    T.set({ student: { ...T.student, name, index } });
    const body = buildSubmission({ name, index, consent: true, team: T.team }, { practice: T.practice, final: T.final, design: d, pipeline: T.pipeline, settings: T.settings, attempts: T.attempts, startedAt: T.startedAt, progress: T.progress }, 'final');
    if (!body) return { ok: false, message: 'Run the final evaluation first.' };
    const r = await submitChallengeScore(body); if (r.ok) T.set({ sent: [...useTwin.getState().sent, { at: Date.now(), kind: 'final', total: body.total }] });
    return r; } } : undefined} stats={{ score: T.final?.grade.total ?? null, objectsFound: T.final ? 100 * T.final.runs.reduce((a, r) => a + r.tasks.detect.recall, 0) / Math.max(1, T.final.runs.length) : undefined, coverage: T.final ? 100 * T.final.runs.reduce((a, r) => a + (r.coverage?.critical ?? 0), 0) / Math.max(1, T.final.runs.length) : undefined, markerPx: T.final ? Math.max(...T.final.runs.map((r) => r.calibration?.maxRms ?? 0)) : undefined }} />;
  return <TabFrame title="Industrial Digital Twin Challenge" topExtras={<MissionMap progress={T.progress} busy={!!T.busy || regBusy} onSelect={goMission} />} tab={17} viewport={viewport} controls={controls} learn={null} hideGuideControls noPanelTabs noEnv stats={mission === 5 || mission === 6 ? [] : stats} statsWide viewInset={stage >= 2 ? (planOpen ? 292 : 96) : 0} overlays={<>{celebration}{stage === 5 && mission !== 1 && mission !== 5 && (() => {
    const why = !cost.ok ? cost.errors[0] : chk.global[0] ?? (chk.perBlock.find(Boolean) as string | undefined) ?? (T.pipeline.length ? '' : 'Add a registration block to begin.'), withView = practice ? practice.steps.map((x, i) => (x.preview ? i : -1)).filter((i) => i >= 0) : [], at = withView.indexOf(T.selectedStep), go = (d2: number) => { if (!withView.length) return; const n = at < 0 ? (d2 > 0 ? 0 : withView.length - 1) : at + d2; if (n >= 0 && n < withView.length) T.set({ selectedStep: withView[n] }); };
    const cur = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
    return (
      <div className="overlay glass card canvas-run" data-testid="twin-canvas-run" style={{ left: 12, right: 'auto', bottom: statsLift, maxWidth: 'calc(100% - 24px)' }}>
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
  })()}{mission === 5 && timeline && <>
    {activeAlerts.length > 0 && <div className="overlay glass card safety-warning" role="alert" data-testid="safety-warning"><b>⚠ Safety warning</b>{activeAlerts.map((a, i) => <span key={i} className={a.step === tick ? 'now' : ''}>{a.text}</span>)}</div>}
    {bayLook && <BayInset view={bayLook.view} events={bayLook.events} tick={tick} />}
    <div className="overlay glass card time-play" data-testid="time-play">
      <div className="time-stops">
        <button type="button" className="play" onClick={() => { if (playing) setPlaying(false); else { setTick(0); setPlaying(true); } }} data-testid="time-play-btn" aria-label={playing ? 'Pause' : 'Play the four moments'}>{playing ? '❚❚' : '▶'}</button>
        {['Time A', 'Things moved', 'Added and gone', 'Time B'].map((name, k) => <button key={k} type="button" aria-pressed={tick === k} onClick={() => { setPlaying(false); setTick(k); }} data-testid={`time-stop-${k}`}>{k + 1} · {name}</button>)}
      </div>
      <div className="time-caption" data-testid="time-caption">{tick === 0 ? 'Time A: the factory as it was at commissioning.' : tick === 1 ? `${practice!.found.changes.filter((c) => c.kind === 'moved').length} objects moved (orange = where they are now, red = where they were).` : tick === 2 ? `${practice!.found.changes.filter((c) => c.kind === 'added').length} appeared (green) and ${practice!.found.changes.filter((c) => c.kind === 'removed').length} are gone (red).` : `Time B: ${bayLook?.events.length ?? 0} labels have changed colour.`}{activeAlerts.filter((a) => a.step === tick).map((a, i) => <span key={i} className="alert"> ⚠ {a.text}.</span>)}</div>
    </div>
  </>}{stage >= 2 && <div className="overlay glass card" style={{ left: 12, top: 10, width: planOpen ? 268 : 'auto', padding: 6 }} data-testid="twin-plan"><div className="plan-head"><b>Plan</b><button className="stats-toggle" onClick={() => setPlanOpen((o) => !o)} aria-expanded={planOpen} title={planOpen ? 'Fold the plan away' : 'Show the plan'} data-testid="twin-plan-toggle">{planOpen ? 'Hide' : 'Show'}</button></div>{planOpen && <Plan2D scene={scene} height={176} onClick={stage === 2 ? (x: number, y: number) => place(x, y, true) : undefined} layers={planLayers} />}</div>}<KindLegend top={legendTop} items={legend} active={stage === 2 && !soloCov && mission === 0 ? legendOnly : null} onPick={stage === 2 && !soloCov && mission === 0 ? (k) => setLegendOnly((cur) => (cur === k ? null : k)) : undefined} side={stage >= 2 ? 'right' : 'left'} /></>}
    viewExtras={<>{mission === 6 && T.final && <Seg label="Final scenario" value={finalVariant} onChange={setFinalVariant} options={T.final.runs.map((r, value) => ({ value, label: `Scenario ${r.seed}` }))} />}{(stage === 5 || stage === 6) && mission >= 2 && mission <= 4 && <Btn sm icon={<Circle size={15} />} onClick={() => setCloudColour((c) => (c === 'objects' ? 'solid' : c === 'solid' ? 'intensity' : c === 'intensity' ? 'height' : hasObjectView ? 'objects' : 'solid'))} testId="twin-colour-mode" title="Click to change how the points are coloured: solid, intensity, height">Colour: {cloudColour === 'objects' ? 'By object' : cloudColour === 'solid' ? 'Solid' : cloudColour === 'intensity' ? 'Intensity' : 'Height'}</Btn>}{stage === 5 && mission >= 2 && mission <= 3 && step?.removed && <span className="hint" data-testid="twin-removed-key" style={{ color: '#ff453a', fontWeight: 600 }}>● Red = removed by this step</span>}{mission === 0 && stage <= 2 && <ToolbarSwitch label="Zone names" checked={zoneNames} onChange={setZoneNames} testId="twin-zone-names" title="Show or hide the names on the critical-area boxes" />}<ToolbarSwitch label="Roof" checked={roof} onChange={setRoof} testId="twin-roof" title={roof ? 'Roof on: the complete view. Switch it off to see inside.' : 'Roof off: the roof and its points are gone.'} /><Seg<'scene' | 'points' | 'both'> value={viewMode} onChange={setViewMode} block={false} label="What the 3D view shows" options={[{ value: 'scene', label: 'Scene' }, { value: 'points', label: 'Points' }, { value: 'both', label: 'Both' }]} /></>} />;
}
