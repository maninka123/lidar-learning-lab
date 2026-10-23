import { create } from 'zustand';
import { PointCloud } from '../core/pointcloud';
import { ColorMode } from '../core/colorize';
import { SceneId, getScene } from '../scenes';
import { SensorConfig, getPreset, presetToConfig } from '../sensor/presets';
import { OpSpec, PipelineResult } from '../processing/pipeline';
import { SegParams, SegResult } from '../segmentation/segment';
import { IcpResult } from '../registration/icp';
import { SlamResult, SlamParams } from '../registration/slam';
import { SceneGraph } from '../graph/sceneGraph';
import { ReconOutput, ReconMethod, ReconObjectId, AlignResult } from '../recon/recon';
import { ScanResult } from '../sensor/simulate';
import type { Rigid } from '../core/math';

export type Interaction = 'select' | 'place-sensor' | 'add-station' | 'add-waypoint' | 'pick-points';
export type Background = 'dark' | 'graphite' | 'gray' | 'light';

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
export interface Pick { cloudId: string; index: number; pos: [number, number, number] }
export interface Station { id: number; pose: Pose; cloud: PointCloud; trueCloud: PointCloud; err: { t: number; deg: number } }

export interface ViewOpts {
  colorMode: ColorMode;
  pointSize: number;
  background: Background;
  showGrid: boolean;
  showAxes: boolean;
  panMode: boolean; // left-drag pans (moves the cloud) instead of rotating, like CloudCompare's pan tool
  showScene: boolean;
  sceneOpacity: number;
  showCeiling: boolean;
  renderBudget: number;
  clipOn: boolean;
  clipMin: number;
  clipMax: number;
  showRays: boolean;
}

export interface ScanOpts { sweeps: number; maxRays: number; seed: number }
export interface CoverageInfo {
  total: number; covered: number; coveredPct: number; area: number; coveredArea: number; overlapPct?: number;
  vis?: { occluded: number; outOfFov: number; outOfRange: number; undersampled: number; covered: number; total: number } | null;
  missingPositions?: Float32Array;
}

export interface LabState {
  tab: number;
  sceneId: SceneId;
  sensorPresetId: string;
  sensor: SensorConfig;
  pose: Pose;
  scanOpts: ScanOpts;
  clouds: Record<string, PointCloud>;
  activeCloudId: string | null;
  view: ViewOpts;
  interaction: Interaction;
  picks: Pick[];
  selectedObjectId: string | null;
  busy: string | null;
  live: boolean;
  accumulate: boolean;
  toast: { msg: string; kind: 'info' | 'ok' | 'warn' | 'error'; n: number } | null;
  scanInfo: { stats: ScanResult['stats']; viz?: ScanResult['viz']; coverage?: CoverageInfo | null } | null;
  usedColorModes: string[];
  galleryViewed: string[];
  galleryRaw: boolean;
  mappingInit: boolean;
  scanLog: { label: string; hRes: number; channels: number; maxRange: number; points: number; spacing: number; coveragePct: number | null; occludedPct: number | null }[];
  exportsLog: { name: string; fmt: string; count: number }[];
  undoCount: number;
  rightOpen: boolean;
  navOpen: boolean;
  fps: number;

  // TLS / MLS
  stations: Station[];
  stationRegErr: { t: number; deg: number };
  tlsCoverage: CoverageInfo | null;
  waypoints: [number, number][];
  mls: { cloud: PointCloud; coverage: CoverageInfo | null; sceneId: string; seconds: number; length: number } | null;
  mlsOpts: { speed: number; height: number; distortion: boolean };
  mlsAnim: number; // 0..1 platform position for animation, -1 = off
  pendingStation: [number, number] | null;

  // SLAM / registration
  slamParams: SlamParams;
  slam: SlamResult | null;
  slamShow: { gt: boolean; est: boolean; corrected: boolean; mapEst: boolean; mapGt: boolean; mapCorr: boolean };
  reg: {
    errT: [number, number, number]; errYawDeg: number; errPitchDeg: number; errRollDeg: number;
    offset: number; // sensor displacement between the two scans (partial overlap)
    A: PointCloud | null; B: PointCloud | null; applied: Rigid | null;
    result: IcpResult | null; iter: number;
    before: { rmse: number; fitness: number } | null; after: { rmse: number; fitness: number } | null;
    recoveredErr: { t: number; deg: number } | null;
    icp: { maxIterations: number; maxCorrDist: number; sample: number };
  };

  // Processing
  proc: { sourceId: string | null; steps: OpSpec[]; seed: number; result: PipelineResult | null; selected: number; quality: { injected: number; injectedLeft: number; originalKept: number } | null; viewStep: number };

  // Segmentation
  seg: { params: SegParams; result: SegResult | null; gt: ReturnType<typeof emptyGt> | null; cloudId: string | null; labelledScanId?: string };

  // Reconstruction
  recon: {
    object: ReconObjectId; method: ReconMethod; views: number; seed: number;
    out: ReconOutput | null; lidar: PointCloud | null; ai: PointCloud | null;
    align: AlignResult | null; cmp: any | null; errMax: number;
    layer: 'photo' | 'lidar' | 'recon' | 'mesh' | 'overlay' | 'error';
    layout: 'single' | 'split';
    observations: Record<string, boolean>;
  };

  // Scene graph
  graph: { source: 'ground-truth' | 'segmentation'; nearThreshold: number; graph: SceneGraph | null; selectedNode: string | null; filters: Record<string, boolean>; answers: { q: string; a: string }[]; quizAnswer: string; queried: boolean };

  setTab: (t: number) => void;
  patch: (p: Partial<LabState>) => void;
  setScene: (id: SceneId) => void;
  setSensor: (p: Partial<SensorConfig>) => void;
  setPreset: (id: string) => void;
  setPose: (p: Partial<Pose>) => void;
  setView: (p: Partial<ViewOpts>) => void;
  setCloud: (id: string, c: PointCloud | null, activate?: boolean) => void;
  notify: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'error') => void;
  resetAll: () => void;
}

export function emptyGt() {
  return null as null | { gtObjects: number; recovered: { gt: number; cluster: number; iou: number; purity: number }[]; overSegmented: number; underSegmented: number; matches: { gt: number; cluster: number; iou: number; purity: number }[] };
}

export const DEFAULT_VIEW: ViewOpts = {
  colorMode: 'height', pointSize: 3, background: 'light', showGrid: true, showAxes: true, panMode: false, showScene: true, sceneOpacity: 0.28, showCeiling: false,
  renderBudget: 150000, clipOn: false, clipMin: -1, clipMax: 20, showRays: true,
};

const DEFAULT_SEG: SegParams = { removeGround: true, extraPlanes: 5, ransacThreshold: 0.03, ransacIterations: 200, algo: 'euclidean', eps: 0.15, minPts: 8, radius: 0.15, minCluster: 30, seed: 11 };
const DEFAULT_SLAM: SlamParams = { seed: 3, steps: 48, odom: 'noisy', transNoise: 0.012, rotNoiseDeg: 0.35, rotBiasDeg: 0.25, scaleErr: 0.015, loopClosure: false, z: 1.4 };

const initialScene = getScene('A');
const initialPose = (): Pose => ({ ...initialScene.defaultPose, pitch: 0 });

function initial() {
  return {
    tab: 0,
    sceneId: 'A' as SceneId,
    sensorPresetId: 'rot32',
    sensor: presetToConfig(getPreset('rot32')),
    pose: initialPose(),
    scanOpts: { sweeps: 1, maxRays: 150000, seed: 42 },
    clouds: {} as Record<string, PointCloud>,
    activeCloudId: null as string | null,
    view: { ...DEFAULT_VIEW },
    interaction: 'select' as Interaction,
    picks: [] as Pick[],
    selectedObjectId: null as string | null,
    busy: null as string | null,
    live: false,
    accumulate: true,
    toast: null,
    scanInfo: null,
    usedColorModes: [] as string[],
    galleryViewed: [] as string[],
    galleryRaw: false,
    mappingInit: false,
    scanLog: [] as LabState['scanLog'],
    exportsLog: [] as LabState['exportsLog'],
    undoCount: 0,
    rightOpen: true,
    navOpen: true,
    fps: 60,
    stations: [] as Station[],
    stationRegErr: { t: 0, deg: 0 },
    tlsCoverage: null,
    waypoints: [] as [number, number][],
    mls: null,
    mlsOpts: { speed: 1.5, height: 1.5, distortion: false },
    mlsAnim: -1,
    pendingStation: null as [number, number] | null,
    slamParams: { ...DEFAULT_SLAM },
    slam: null,
    slamShow: { gt: true, est: true, corrected: true, mapEst: true, mapGt: false, mapCorr: true },
    reg: {
      errT: [0.25, -0.15, 0.05] as [number, number, number], errYawDeg: 4, errPitchDeg: 0.5, errRollDeg: 0, offset: 0.4, A: null, B: null, applied: null, result: null, iter: 0,
      before: null, after: null, recoveredErr: null, icp: { maxIterations: 50, maxCorrDist: 1.0, sample: 3000 },
    },
    proc: { sourceId: null, steps: [] as OpSpec[], seed: 7, result: null, selected: -1, quality: null, viewStep: -1 },
    seg: { params: { ...DEFAULT_SEG }, result: null, gt: null, cloudId: null },
    recon: { object: 'chair' as ReconObjectId, method: 'photogrammetry' as ReconMethod, views: 8, seed: 5, out: null, lidar: null, ai: null, align: null, cmp: null, errMax: 0.05, layer: 'overlay' as const, layout: 'single' as const, observations: { occlusion: false, missing: false, texture: false, geometry: false } },
    graph: { source: 'ground-truth' as const, nearThreshold: 0.5, graph: null, selectedNode: null, filters: { near: true, above: false, below: false, inside: false, left_of: false, right_of: false, intersects: true, blocks_path: true }, answers: [], quizAnswer: '', queried: false },
  };
}

export const undoStack: { label: string; undo: () => void }[] = [];
export function pushUndo(label: string, undo: () => void) {
  undoStack.push({ label, undo });
  if (undoStack.length > 50) undoStack.shift();
  useLab.setState({ undoCount: undoStack.length });
}
export function doUndo() {
  const u = undoStack.pop();
  if (u) { u.undo(); useLab.getState().notify(`Undid: ${u.label}`, 'info'); }
  useLab.setState({ undoCount: undoStack.length });
}

let toastN = 0;
export const useLab = create<LabState>((set, get) => ({
  ...initial(),
  setTab: (tab) => set({ tab, interaction: 'select' }),
  patch: (p) => set(p),
  setScene: (id) => {
    const sc = getScene(id);
    undoStack.length = 0;
    set({
      sceneId: id, pose: { ...sc.defaultPose, pitch: 0 }, clouds: {}, activeCloudId: null, picks: [], selectedObjectId: null, scanInfo: null,
      stations: [], tlsCoverage: null, waypoints: [], mls: null, slam: null, undoCount: 0,
      proc: { ...get().proc, sourceId: null, result: null, steps: [], quality: null },
      seg: { ...get().seg, result: null, gt: null, cloudId: null },
      graph: { ...get().graph, graph: null, selectedNode: null },
      reg: { ...get().reg, A: null, B: null, result: null, before: null, after: null },
    });
  },
  setSensor: (p) => set({ sensor: { ...get().sensor, ...p } }),
  setPreset: (id) => {
    const tls = getPreset(id).pattern === 'panoramic';
    set({
      sensorPresetId: id, sensor: presetToConfig(getPreset(id)),
      // a terrestrial scanner is slow and dense and also records colour: show RGB and allow more points
      ...(tls ? { view: { ...get().view, colorMode: 'rgb' as const, renderBudget: Math.max(get().view.renderBudget, 600000) } } : {}),
    });
  },
  setPose: (p) => set({ pose: { ...get().pose, ...p } }),
  setView: (p) => set({ view: { ...get().view, ...p } }),
  setCloud: (id, c, activate = true) => {
    const clouds = { ...get().clouds };
    if (c) clouds[id] = c; else delete clouds[id];
    set({ clouds, activeCloudId: c && activate ? id : get().activeCloudId === id && !c ? null : get().activeCloudId });
  },
  notify: (msg, kind = 'info') => set({ toast: { msg, kind, n: ++toastN } }),
  resetAll: () => { undoStack.length = 0; set({ ...initial(), tab: get().tab }); },
}));

// ---------------------------------------------------------------- settings save / load
export function exportSettings() {
  const s = useLab.getState();
  return {
    app: 'LiDAR Learning Lab', version: 1,
    sceneId: s.sceneId, sensorPresetId: s.sensorPresetId, sensor: s.sensor, pose: s.pose, scanOpts: s.scanOpts, view: s.view,
    waypoints: s.waypoints, mlsOpts: s.mlsOpts, slamParams: s.slamParams, procSteps: s.proc.steps, procSeed: s.proc.seed, segParams: s.seg.params,
    recon: { object: s.recon.object, method: s.recon.method, views: s.recon.views, seed: s.recon.seed },
  };
}
export function importSettings(j: any) {
  if (!j || j.app !== 'LiDAR Learning Lab') throw new Error('Not a LiDAR Learning Lab settings file.');
  const s = useLab.getState();
  if (j.sceneId && j.sceneId !== s.sceneId) s.setScene(j.sceneId);
  useLab.setState((st) => ({
    sensorPresetId: j.sensorPresetId ?? st.sensorPresetId, sensor: j.sensor ?? st.sensor, pose: j.pose ?? st.pose, scanOpts: j.scanOpts ?? st.scanOpts,
    view: { ...st.view, ...(j.view ?? {}) }, waypoints: j.waypoints ?? st.waypoints, mlsOpts: j.mlsOpts ?? st.mlsOpts, slamParams: j.slamParams ?? st.slamParams,
    proc: { ...st.proc, steps: j.procSteps ?? st.proc.steps, seed: j.procSeed ?? st.proc.seed }, seg: { ...st.seg, params: j.segParams ?? st.seg.params },
    recon: { ...st.recon, ...(j.recon ?? {}) },
  }));
}
