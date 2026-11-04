import { PointCloud, concatClouds, selectPoints, transformCloud } from '../core/pointcloud';
import { Rigid, Vec3, identity, rigidCompose, rotationAngle } from '../core/math';
import { KDTree } from '../core/kdtree';
import * as ops from '../processing/ops';
import { detectPlanes } from '../apps/planes';
import { dbscan, euclideanClustering } from '../segmentation/clustering';
import type { VisibleSurvey } from './acquire';
import { registerScans, RegParams, RegReport } from './register';
import { icp } from '../registration/icp';
import { CalibratedCamera, colourPoints, labelVote } from './camera';
import { TwinClass, LabelColour, SAFETY_ZONES } from './factory';

/** The block pipeline. Every block has a typed input and output and runs on the data the team measured: it never sees the hidden truth.
 *  Blocks read the latest output of the type they need, so a block placed too early (or after something changed the cloud) is reported instead of silently doing nothing. */

export type DataType = 'scans' | 'cloud' | 'segments' | 'objects' | 'changes' | 'safety';
export type BlockKind = 'merge' | 'icp' | 'mobileicp' | 'crop' | 'voxel' | 'random' | 'sor' | 'ror' | 'normals' | 'ground' | 'planes' | 'euclid' | 'dbscan' | 'classify' | 'colour' | 'diff' | 'objmatch' | 'safety';

export interface ParamDef { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string; hint?: string; options?: { value: number; label: string }[] }
export interface BlockInfo { kind: BlockKind; name: string; group: 'Registration' | 'Cleaning' | 'Planes' | 'Objects' | 'Change' | 'Safety'; in: DataType; out: DataType; params: ParamDef[]; help: string; needsCameras?: boolean; needsB?: boolean }
export interface Block { id: string; kind: BlockKind; params: Record<string, number>; bypass?: boolean; /** keys of the planes or clusters the team switched off in this block (planes: left in; clusters: dropped), so they choose what is removed and what is kept */ off?: string[]; /** runs at the same time as the neighbouring parallel blocks of its phase instead of one after the other */ parallel?: boolean }

const P = (key: string, label: string, min: number, max: number, step: number, def: number, unit = '', hint = '', options?: ParamDef['options']): ParamDef => ({ key, label, min, max, step, def, unit, hint, options });
const METHOD = [{ value: 0, label: 'Point-to-point' }, { value: 1, label: 'Point-to-plane' }];

/** The tab where each block was taught, so a block carries the same name as the lesson it comes from. */
export const BLOCK_TAB: Record<BlockKind, string> = {
  merge: 'Point Cloud Registration', icp: 'Point Cloud Registration', mobileicp: 'SLAM & Mobile Scanning',
  crop: 'Point Cloud Processing', voxel: 'Point Cloud Processing', random: 'Point Cloud Processing', sor: 'Point Cloud Processing', ror: 'Point Cloud Processing', normals: 'Point Cloud Processing',
  ground: 'Unsupervised Learning', planes: 'Unsupervised Learning', euclid: 'Unsupervised Learning', dbscan: 'Unsupervised Learning',
  classify: 'Supervised Learning', colour: 'LiDAR + Camera Fusion', diff: 'Change Detection', objmatch: 'Change Detection', safety: 'Industrial Challenge',
};
export const BLOCKS: Record<BlockKind, BlockInfo> = {
  merge: { kind: 'merge', name: 'No registration (scanner positions only)', group: 'Registration', in: 'scans', out: 'cloud', params: [], help: 'Place each scan where its scanner stands. No fitting.' },
  icp: { kind: 'icp', name: 'ICP registration', group: 'Registration', in: 'scans', out: 'cloud', params: [P('method', 'Method', 0, 1, 1, 1, '', 'Point-to-plane converges faster on walls and floors.', METHOD), P('dist', 'Match distance', 0.1, 3, 0.1, 0.5, ' m', 'Bigger than the installation error, small enough to avoid wrong pairs.'), P('iters', 'Iterations', 5, 80, 5, 40), P('trim', 'Keep best pairs', 40, 100, 5, 60, ' %', 'Ignore the worst pairs: helps when scans overlap only partly.'), P('voxel', 'Thinning for speed', 0.03, 0.4, 0.01, 0.1, ' m', 'Registration uses a thinned copy of each scan. Too coarse loses detail.'), P('guess', 'Start from', 0, 1, 1, 1, '', 'Without a starting guess every scan begins at the origin of its own frame and ICP usually gets lost.', [{ value: 1, label: 'The positions I placed' }, { value: 0, label: 'Nothing (own frame)' }])], help: 'Fit each scan to the first one, then merge. Aim for a low RMSE.' },
  mobileicp: { kind: 'mobileicp', name: 'Scan-to-scan registration (SLAM)', group: 'Registration', in: 'scans', out: 'cloud', params: [P('method', 'Method', 0, 1, 1, 1, '', '', METHOD), P('dist', 'Match distance', 0.1, 3, 0.1, 0.6, ' m', 'Bigger than the drift between steps, or ICP cannot find its way back.'), P('iters', 'Iterations', 5, 80, 5, 30), P('voxel', 'Thinning for speed', 0.03, 0.4, 0.01, 0.1, ' m'), P('guess', 'Start from', 0, 1, 1, 1, '', '', [{ value: 1, label: 'The positions I placed' }, { value: 0, label: 'Nothing (own frame)' }])], help: 'Fit each scan to the one before it (no loop closure).' },
  crop: { kind: 'crop', name: 'Crop box (height range)', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('zmin', 'Lowest height', -1, 3, 0.1, -0.5, ' m'), P('zmax', 'Highest height', 0.5, 7, 0.1, 6.2, ' m', 'Cutting at 3 m removes the ceiling, the pipes and the lamps.'), P('margin', 'Margin from walls', 0, 2, 0.1, 0, ' m')], help: 'Keep only a height range.' },
  voxel: { kind: 'voxel', name: 'Voxel downsample', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('size', 'Voxel size', 0.02, 0.5, 0.01, 0.08, ' m', 'Bigger voxels are faster but wipe out small objects.')], help: 'One point per small cube.' },
  random: { kind: 'random', name: 'Random downsample', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('ratio', 'Keep', 5, 100, 5, 50, ' %')], help: 'Keep a random share of the points.' },
  sor: { kind: 'sor', name: 'Statistical outlier removal', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('k', 'Neighbours', 4, 40, 1, 12), P('std', 'Std ratio', 0.5, 4, 0.1, 1.5, '', 'Lower removes more.')], help: 'Remove points far from their neighbours.' },
  ror: { kind: 'ror', name: 'Radius outlier removal', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('radius', 'Radius', 0.05, 1, 0.01, 0.2, ' m'), P('minN', 'Min neighbours', 1, 20, 1, 4)], help: 'Remove points with too few neighbours nearby.' },
  normals: { kind: 'normals', name: 'Estimate normals', group: 'Cleaning', in: 'cloud', out: 'cloud', params: [P('k', 'Neighbours', 6, 40, 1, 16)], help: 'Estimate the surface direction at each point.' },
  ground: { kind: 'ground', name: 'Ground removal', group: 'Planes', in: 'cloud', out: 'cloud', params: [P('tol', 'Thickness', 0.02, 0.3, 0.01, 0.08, ' m', 'Everything this close to the floor plane goes.')], help: 'Fit the floor (RANSAC) and remove it.' },
  planes: { kind: 'planes', name: 'Plane detection (RANSAC)', group: 'Planes', in: 'cloud', out: 'cloud', params: [P('max', 'Most planes', 1, 12, 1, 8), P('minpct', 'Smallest plane', 0.5, 10, 0.5, 2, ' %'), P('conf', 'Confidence', 90, 99.9, 0.1, 99, ' %')], help: 'Find big flat surfaces (RANSAC) and remove them.' },
  euclid: { kind: 'euclid', name: 'Euclidean clustering', group: 'Objects', in: 'cloud', out: 'segments', params: [P('radius', 'Link distance', 0.05, 1, 0.01, 0.2, ' m', 'Points closer than this join one object.'), P('min', 'Smallest cluster', 3, 300, 1, 25, ' pts')], help: 'Group nearby points into objects.' },
  dbscan: { kind: 'dbscan', name: 'DBSCAN clustering', group: 'Objects', in: 'cloud', out: 'segments', params: [P('eps', 'Radius', 0.05, 1, 0.01, 0.2, ' m'), P('min', 'Min points', 2, 40, 1, 6)], help: 'Group dense points into objects; leave noise out.' },
  classify: { kind: 'classify', name: 'Classify objects (by shape)', group: 'Objects', in: 'segments', out: 'objects', params: [P('minpts', 'Ignore clusters under', 5, 200, 1, 30, ' pts'), P('small', 'Small-object size', 0.1, 0.8, 0.01, 0.45, ' m', 'Objects with all sides under this are "small".')], help: 'Name each object by its size and shape.' },
  colour: { kind: 'colour', name: 'Read label colours (camera)', group: 'Objects', in: 'objects', out: 'objects', params: [P('votes', 'Votes needed', 1, 30, 1, 4, ' px'), P('share', 'Agreement', 40, 100, 5, 60, ' %')], help: 'Read the red, green or yellow labels with your camera calibration.', needsCameras: true },
  diff: { kind: 'diff', name: 'Change detection (points, A vs B)', group: 'Change', in: 'cloud', out: 'changes', needsB: true, params: [P('align', 'Align B to A first', 0, 1, 1, 1, '', 'Fit the two surveys together before comparing.', [{ value: 0, label: 'No' }, { value: 1, label: 'ICP' }]), P('thr', 'Change threshold', 0.03, 0.6, 0.01, 0.18, ' m', 'Points farther than this from the other survey count as changed.'), P('min', 'Smallest change', 5, 200, 1, 25, ' pts'), P('pair', 'Pair removed + added as moved', 0, 1, 1, 1, '', '', [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }])], help: 'Find points that changed between survey A and B.' },
  objmatch: { kind: 'objmatch', name: 'Change detection (objects, A vs B)', group: 'Change', in: 'objects', out: 'changes', needsB: true, params: [P('dist', 'Match distance', 0.2, 4, 0.1, 1.2, ' m'), P('move', 'Moved if shifted by', 0.1, 2, 0.05, 0.4, ' m')], help: 'Compare objects between survey A and B.' },
  safety: { kind: 'safety', name: 'Safety zone check', group: 'Safety', in: 'objects', out: 'safety', params: [P('margin', 'Safety margin', 0, 1, 0.05, 0, ' m')], help: 'Flag objects that overlap a safety zone (a learning check only).' },
};
/** The pipeline in plain phases, in the order they must happen. Blocks are kept in this order automatically, so the order cannot be wrong. */
export const PHASES: { id: string; title: string; why: string; kinds: BlockKind[]; required?: boolean }[] = [
  { id: 'register', title: '1 · Join the scans', why: 'Put every scan in one common frame.', kinds: ['icp', 'mobileicp', 'merge'], required: true },
  { id: 'clean', title: '2 · Clean the points', why: 'Thin the points and remove noise. Too much removes small objects.', kinds: ['crop', 'voxel', 'random', 'sor', 'ror', 'normals'] },
  { id: 'structure', title: '3 · Remove the building', why: 'Remove the floor, walls and ceiling.', kinds: ['ground', 'planes'] },
  { id: 'objects', title: '4 · Find the objects', why: 'Group points, name the objects, read label colours.', kinds: ['euclid', 'dbscan', 'classify', 'colour'] },
  { id: 'compare', title: '5 · Changes and safety', why: 'Find changes and check safety zones (optional).', kinds: ['diff', 'objmatch', 'safety'] },
];
export const phaseIndex = (k: BlockKind) => PHASES.findIndex((ph) => ph.kinds.includes(k));
/** Put a new block at the end of its own phase, so the pipeline stays in a sensible order. */
export function insertBlock(blocks: Block[], b: Block): Block[] {
  const ph = phaseIndex(b.kind), order = (k: BlockKind) => PHASES[phaseIndex(k)].kinds.indexOf(k); let at = 0; // inside a phase the usual order is kept (clustering before naming)
  blocks.forEach((x, i) => { const xp = phaseIndex(x.kind); if (xp < ph || (xp === ph && order(x.kind) <= order(b.kind))) at = i + 1; });
  return [...blocks.slice(0, at), b, ...blocks.slice(at)];
}
export const GROUPS = ['Registration', 'Cleaning', 'Planes', 'Objects', 'Change', 'Safety'] as const;
export const defaultParams = (k: BlockKind): Record<string, number> => Object.fromEntries(BLOCKS[k].params.map((p) => [p.key, p.def]));
export const newBlock = (kind: BlockKind): Block => ({ id: `${kind}-${Math.random().toString(36).slice(2, 7)}`, kind, params: defaultParams(kind) });

// ----------------------------------------------------------------------------- checking
export interface Check { perBlock: (string | null)[]; global: string[]; ok: boolean }

const REPLACES_CLOUD = new Set<DataType>(['cloud']);
/** Walk the blocks in order, track which data exist, and say precisely what is missing. */
export function checkPipeline(blocks: Block[], ctx: { cameras: number; hasB: boolean }): Check {
  const avail = new Set<DataType>(['scans']); const per: (string | null)[] = [], global: string[] = [];
  let cloudMade = false;
  for (const b of blocks) {
    const info = BLOCKS[b.kind]; let msg: string | null = null;
    if (b.bypass) { per.push(null); continue; }
    if (info.in === 'scans' && cloudMade) msg = 'Registration must come first: a merged cloud already exists.';
    else if (!avail.has(info.in)) msg = `${info.name} needs ${article(info.in)}, but nothing earlier produces one.${hint(info.in)}`;
    else if (info.needsCameras && ctx.cameras < 1) msg = 'This block needs at least one camera. Buy and calibrate one.';
    else if (info.needsB && !ctx.hasB) msg = 'This block needs the second survey (Time B).';
    per.push(msg);
    if (msg) continue;
    if (REPLACES_CLOUD.has(info.out)) { avail.delete('segments'); avail.delete('objects'); avail.delete('changes'); avail.delete('safety'); cloudMade = true; }
    if (info.out !== 'cloud' || info.in === 'scans') avail.add(info.out);
    if (info.in === 'scans') avail.delete('scans');
    if (info.out === 'segments') { avail.delete('objects'); }
  }
  if (!blocks.some((b) => !b.bypass && BLOCKS[b.kind].in === 'scans')) global.push('Start with a registration or merge block: the scans have to become one cloud.');
  return { perBlock: per, global, ok: global.length === 0 && per.every((m) => !m) };
}
const article = (t: DataType) => ({ scans: 'scans', cloud: 'a point cloud', segments: 'clusters', objects: 'a list of objects', changes: 'changes', safety: 'a safety report' }[t]);
const hint = (t: DataType) => ({ scans: '', cloud: ' Add Merge or Register first.', segments: ' Add a clustering block first.', objects: ' Add "Classify objects" after clustering.', changes: '', safety: '' }[t]);

// ----------------------------------------------------------------------------- results
export interface DetObject { id: number; cls: TwinClass; min: Vec3; max: Vec3; centre: Vec3; n: number; round: number; colour?: LabelColour | 'unknown'; votes?: number; idx: Int32Array }
export interface ChangeFound { kind: 'added' | 'removed' | 'moved'; centre: Vec3; from?: Vec3; size: Vec3; n: number; cls?: TwinClass }
export interface SafetyFound { zone: string; violated: boolean; clearance: number; objects: number[] }
export interface Workspace { cloud?: PointCloud; /** the cloud as it stood before any plane removal or clustering: this is what the digital-twin task judges */ twin?: PointCloud; scanPoses?: Rigid[]; segLabels?: Int32Array; segCount?: number; objects?: DetObject[] }
export interface PickItem { key: string; label: string; pts: number; on: boolean }
/** `remove`: ticked planes are taken out. `keep`: ticked clusters are kept. Either way an unticked one is the opposite. */
export interface PickList { mode: 'remove' | 'keep'; items: PickItem[]; hidden: number }
const planeKey = (kind: string, n: number[], d: number) => (kind === 'floor' || kind === 'ceiling' ? kind : `wall:${Math.round(n[0] * 10)},${Math.round(n[1] * 10)}:${(Math.round(d * 2) / 2).toFixed(1)}`);
const planeLabel = (kind: string, n: number[], d: number) => { if (kind === 'floor') return 'Floor'; if (kind === 'ceiling') return 'Ceiling'; const ax = Math.abs(n[0]) >= Math.abs(n[1]) ? 0 : 1; return `Wall at ${ax ? 'y' : 'x'} = ${(-d / (n[ax] || 1)).toFixed(1)} m`; };
/** List the clusters (biggest first) and cut the switched-off ones out of the labelling. Keys come from where a cluster sits, so a choice survives a re-run. */
function pickClusters(pos: Float32Array, labels: Int32Array, count: number, off: string[], maxList = 40): PickList {
  const n = new Float64Array(count), sx = new Float64Array(count), sy = new Float64Array(count), sz = new Float64Array(count), lo = new Float64Array(count).fill(Infinity), hi = new Float64Array(count).fill(-Infinity);
  for (let i = 0; i < labels.length; i++) { const l = labels[i]; if (l < 0) continue; n[l]++; sx[l] += pos[i * 3]; sy[l] += pos[i * 3 + 1]; const z = pos[i * 3 + 2]; sz[l] += z; if (z < lo[l]) lo[l] = z; if (z > hi[l]) hi[l] = z; }
  const used = new Map<string, number>(), rows: { id: number; key: string; pts: number; label: string }[] = [];
  const order = Array.from({ length: count }, (_, i) => i).filter((i) => n[i] > 0).sort((a, b) => n[b] - n[a]), q = (v: number) => (Math.round(v / 0.4) * 0.4).toFixed(1);
  order.forEach((id, rank) => {
    let key = `c:${q(sx[id] / n[id])},${q(sy[id] / n[id])},${q(sz[id] / n[id])}`; const seen = used.get(key) ?? 0; used.set(key, seen + 1); if (seen) key += `#${seen + 1}`;
    rows.push({ id, key, pts: n[id], label: `Cluster ${rank + 1} · ${(hi[id] - lo[id]).toFixed(1)} m tall · near (${(sx[id] / n[id]).toFixed(1)}, ${(sy[id] / n[id]).toFixed(1)})` });
  });
  const dropped = new Set(rows.filter((r) => off.includes(r.key)).map((r) => r.id));
  if (dropped.size) for (let i = 0; i < labels.length; i++) if (dropped.has(labels[i])) labels[i] = -1;
  return { mode: 'keep', items: rows.slice(0, maxList).map((r) => ({ key: r.key, label: r.label, pts: r.pts, on: !off.includes(r.key) })), hidden: Math.max(0, rows.length - maxList) };
}
export interface StepInfo { id: string; kind: BlockKind; bypassed: boolean; ms: number; before: number; after: number; note: string; error?: string; preview?: PointCloud; /** blocks that ran side by side share a number */ group?: number; /** for a registration block: how well the scans fit afterwards */ reg?: RegReport; /** planes or clusters this block found, for the team to switch on or off */ pick?: PickList }
export interface PipelineOutput { A: Workspace; B?: Workspace; /** registration quality of survey A (the RMSE the team tuned) */ registration?: RegReport; changes?: ChangeFound[]; safety?: SafetyFound[]; steps: StepInfo[]; ms: number }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const thin = (c: PointCloud, max: number): PointCloud => { if (c.count <= max) return c; const s = Math.ceil(c.count / max), ids: number[] = []; for (let i = 0; i < c.count; i += s) ids.push(i); return selectPoints(c, ids, c.name); };

function vox(c: PointCloud, size: number): PointCloud { return ops.voxelDownsample(c, size); }

/** Block settings → registration settings. Registration works on the scans as delivered: each in its own scanner's coordinate system. */
export function regParamsOf(kind: BlockKind, p: Record<string, number>): RegParams {
  return { mode: kind === 'merge' ? 'merge' : kind === 'mobileicp' ? 'sequential' : 'first', method: p.method === 0 ? 0 : 1, dist: p.dist ?? 0.5, iters: p.iters ?? 40, trim: p.trim ?? 60, voxel: p.voxel ?? 0.1, guess: kind === 'merge' ? true : p.guess !== 0 };
}

const boxOf = (pos: Float32Array, ids: ArrayLike<number>): { min: Vec3; max: Vec3; c: Vec3 } => {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < ids.length; k++) { const i = ids[k]; for (let a = 0; a < 3; a++) { const v = pos[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; } }
  return { min, max, c: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
};

/** Rules that turn a cluster's size and shape into a class name. The thresholds are the factory's typical sizes: a cluster of two things that touch will be named as one. */
export function classifyShape(dx: number, dy: number, h: number, round: number, small: number): TwinClass {
  const major = Math.max(dx, dy), minor = Math.min(dx, dy), foot = major * minor;
  if (major <= small && minor <= small && h <= small + 0.05) return 'small';
  if (major <= small + 0.05 && h <= 0.3) return 'small';
  if (major > 4) return 'conveyor';
  if (major >= 1.9 && major <= 3.4 && minor >= 0.9 && minor <= 1.6 && h >= 2.1 && h <= 3.0 && foot < 4) return 'forklift';
  if (major >= 1.8 && minor <= 1.0 && h >= 1.8) return 'rack';
  if (major >= 1.7 && minor >= 1.2) return 'machine';
  if (major >= 1.0 && major <= 1.45 && minor >= 0.6 && minor <= 1.05 && h <= 1.5) return 'pallet';
  if (major <= 0.75 && minor <= 0.75 && round >= 0.9 && h <= 0.8) return h >= 0.5 && major < 0.55 ? 'obstacle' : 'drum';
  if (major <= 0.75 && minor <= 0.75 && round >= 0.9) return 'drum';
  if (major <= 0.7 && minor <= 0.7 && h >= 1.0) return 'container';
  if (major <= 1.0 && minor <= 1.0) return 'box';
  return major >= 1.2 ? 'machine' : 'box';
}

function clustersToObjects(cloud: PointCloud, labels: Int32Array, count: number, p: Record<string, number>): DetObject[] {
  const groups: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < cloud.count; i++) if (labels[i] >= 0) groups[labels[i]].push(i);
  const out: DetObject[] = [], minpts = p.minpts ?? 30, small = p.small ?? 0.45, pos = cloud.positions;
  groups.forEach((g, id) => {
    if (g.length < minpts) return;
    const b = boxOf(pos, g), dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], h = b.max[2] - b.min[2];
    const r: number[] = g.map((i) => Math.hypot(pos[i * 3] - b.c[0], pos[i * 3 + 1] - b.c[1])).sort((a, c) => a - c);
    const round = r.length ? r[r.length >> 1] / Math.max(1e-6, r[r.length - 1]) : 0;
    out.push({ id, cls: classifyShape(dx, dy, h, round, small), min: b.min, max: b.max, centre: b.c, n: g.length, round, idx: Int32Array.from(g) });
  });
  return out;
}

const xyDist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** One-to-one matching by smallest distance first. */
function matchNearest(a: Vec3[], b: Vec3[], maxD: number, ok: (i: number, j: number) => boolean): [number, number][] {
  const pairs: [number, number, number][] = [];
  a.forEach((p, i) => b.forEach((q, j) => { const d = xyDist(p, q); if (d <= maxD && ok(i, j)) pairs.push([d, i, j]); }));
  pairs.sort((x, y) => x[0] - y[0]);
  const ua = new Set<number>(), ub = new Set<number>(), out: [number, number][] = [];
  for (const [, i, j] of pairs) if (!ua.has(i) && !ub.has(j)) { ua.add(i); ub.add(j); out.push([i, j]); }
  return out;
}

function regions(c: PointCloud, ids: number[], radius: number, minPts: number): { centre: Vec3; size: Vec3; n: number }[] {
  if (ids.length < minPts) return [];
  const sub = new Float32Array(ids.length * 3); ids.forEach((i, k) => sub.set(c.positions.subarray(i * 3, i * 3 + 3), k * 3));
  const r = euclideanClustering(sub, ids.length, radius, minPts), groups: number[][] = Array.from({ length: r.clusters }, () => []);
  for (let k = 0; k < ids.length; k++) if (r.labels[k] >= 0) groups[r.labels[k]].push(k);
  return groups.map((g) => { const b = boxOf(sub, g); return { centre: b.c, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as Vec3, n: g.length }; });
}

export interface PipelineInput { A: VisibleSurvey; B?: VisibleSurvey; camerasA: CalibratedCamera[] }

/** Blocks that can run side by side: filters that only REMOVE points (the results are combined by keeping what every branch kept), and independent checks (their findings are combined). */
export const PARALLEL_KINDS: BlockKind[] = ['crop', 'sor', 'ror', 'ground', 'planes', 'diff', 'objmatch', 'safety'];
const SUBSET_KINDS: BlockKind[] = ['crop', 'sor', 'ror', 'ground', 'planes'];
export const canRunParallel = (k: BlockKind) => PARALLEL_KINDS.includes(k);
/** Which blocks form a side-by-side group: neighbours, same phase, all flagged parallel and able to. Returns a group number per block (or -1). */
export function parallelGroups(blocks: Block[]): number[] {
  const g = new Array(blocks.length).fill(-1); let n = 0;
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i]; if (!b.parallel || b.bypass || !canRunParallel(b.kind)) { i++; continue; }
    let j = i + 1; while (j < blocks.length && blocks[j].parallel && !blocks[j].bypass && canRunParallel(blocks[j].kind) && phaseIndex(blocks[j].kind) === phaseIndex(b.kind)) j++;
    if (j - i >= 2) { for (let k = i; k < j; k++) g[k] = n; n++; }
    i = j;
  }
  return g;
}
const mergeChanges = (a: ChangeFound[], b: ChangeFound[]): ChangeFound[] => { const out = [...a]; for (const c of b) if (!out.some((o) => xyDist(o.centre, c.centre) < 1.0)) out.push(c); return out; };

/** Run the blocks on survey A (and B when there is one). Blocks that compare surveys wait for both. */
export function runPipeline(blocks: Block[], input: PipelineInput, seed = 1): PipelineOutput {
  const t0 = now(), steps: StepInfo[] = [], ws: { A: Workspace; B?: Workspace } = { A: {}, B: input.B ? {} : undefined };
  const chk = checkPipeline(blocks, { cameras: input.camerasA.length, hasB: !!input.B });
  let changes: ChangeFound[] | undefined, safety: SafetyFound[] | undefined, registration: RegReport | undefined;
  const groupOf = parallelGroups(blocks);
  let gBase: { A?: PointCloud; B?: PointCloud } = {}, gOuts: { A: PointCloud[]; B: PointCloud[] } = { A: [], B: [] };
  blocks.forEach((b, bi) => {
    const grp = groupOf[bi], first = grp >= 0 && groupOf[bi - 1] !== grp, last = grp >= 0 && groupOf[bi + 1] !== grp, subset = SUBSET_KINDS.includes(b.kind);
    if (first) { gBase = { A: ws.A.cloud, B: ws.B?.cloud }; gOuts = { A: [], B: [] }; }
    const info = BLOCKS[b.kind], s0 = now(), cur = (grp >= 0 && subset ? gBase.A?.count : undefined) ?? ws.A.cloud?.count ?? input.A.scans.reduce((a, q) => a + q.cloud.count, 0);
    const base: StepInfo = { id: b.id, kind: b.kind, bypassed: !!b.bypass, ms: 0, before: cur, after: cur, note: '', group: grp >= 0 ? grp : undefined };
    if (b.bypass) { steps.push({ ...base, note: 'Bypassed' }); return; }
    if (chk.perBlock[bi]) { steps.push({ ...base, error: chk.perBlock[bi]!, note: 'Skipped' }); return; }
    const p = { ...defaultParams(b.kind), ...b.params };
    const epochs: ('A' | 'B')[] = info.in === 'cloud' && info.out === 'changes' ? [] : input.B && b.kind !== 'colour' ? ['A', 'B'] : ['A'];
    let note = '', reg: RegReport | undefined, pick: PickList | undefined;
    const surveyOf = (e: 'A' | 'B') => (e === 'A' ? input.A : input.B!);
    for (const e of epochs) {
      const w = ws[e]!;
      if (!w.twin && w.cloud && (info.group === 'Planes' || info.out === 'segments')) w.twin = w.cloud;
      if (grp >= 0 && subset && gBase[e]) w.cloud = gBase[e]; // every branch starts from the same points
      switch (b.kind) {
        case 'merge': case 'icp': case 'mobileicp': {
          const r = registerScans(surveyOf(e).scans, regParamsOf(b.kind, p)); w.cloud = r.cloud; w.scanPoses = r.poses; note = r.report.note + (Number.isFinite(r.report.rmse) ? ` · RMSE ${(r.report.rmse * 100).toFixed(1)} cm` : '');
          if (e === 'A') { reg = r.report; }
          break;
        }
        case 'crop': { const bb = { x: 12 - p.margin, y: 8 - p.margin }; w.cloud = ops.cropBox(w.cloud!, [-bb.x, -bb.y, p.zmin], [bb.x, bb.y, p.zmax]); break; }
        case 'voxel': w.cloud = ops.voxelDownsample(w.cloud!, p.size); break;
        case 'random': w.cloud = ops.randomDownsample(w.cloud!, p.ratio / 100, seed + bi); break;
        case 'sor': w.cloud = ops.statisticalOutlierRemoval(w.cloud!, p.k, p.std); break;
        case 'ror': w.cloud = ops.radiusOutlierRemoval(w.cloud!, p.radius, p.minN); break;
        case 'normals': w.cloud = ops.estimateNormals(w.cloud!, p.k); break;
        case 'ground': {
          const c = w.cloud!, run = detectPlanes(c.positions, c.count, null, { mode: 'adaptive', threshold: p.tol, iterations: 100, confidence: 0.99, minFraction: 0.02, maxPlanes: 3, seed: seed + bi });
          const fl = run.planes.find((q) => q.kind === 'floor'); if (!fl) { note = 'No floor plane found'; break; }
          const drop = new Uint8Array(c.count); for (const i of fl.inliers) { const d = Math.abs(fl.normal[0] * c.positions[i * 3] + fl.normal[1] * c.positions[i * 3 + 1] + fl.normal[2] * c.positions[i * 3 + 2] + fl.d); if (d <= Math.max(p.tol, 0.01)) drop[i] = 1; }
          const keep: number[] = []; for (let i = 0; i < c.count; i++) if (!drop[i]) keep.push(i);
          w.cloud = selectPoints(c, keep, c.name); break;
        }
        case 'planes': {
          const c = w.cloud!, run = detectPlanes(c.positions, c.count, null, { mode: 'adaptive', threshold: 0.03, iterations: 100, confidence: p.conf / 100, minFraction: p.minpct / 100, maxPlanes: p.max, seed: seed + bi });
          const drop = new Uint8Array(c.count), off = b.off ?? [], items: PickItem[] = []; let nPl = 0;
          for (const pl of run.planes) if (pl.kind === 'floor' || pl.kind === 'ceiling' || pl.kind === 'wall') {
            const key = planeKey(pl.kind, pl.normal, pl.d), on = !off.includes(key); items.push({ key, label: planeLabel(pl.kind, pl.normal, pl.d), pts: pl.inliers.length, on });
            if (on) { nPl++; for (const i of pl.inliers) drop[i] = 1; }
          }
          if (e === 'A') pick = { mode: 'remove', items: items.sort((x, y) => y.pts - x.pts), hidden: 0 };
          const keep: number[] = []; for (let i = 0; i < c.count; i++) if (!drop[i]) keep.push(i);
          w.cloud = selectPoints(c, keep, c.name); note = `${nPl} building planes removed`; break;
        }
        case 'euclid': { const c = w.cloud!, r = euclideanClustering(c.positions, c.count, p.radius, p.min); w.segLabels = r.labels; w.segCount = r.clusters; const pk = pickClusters(c.positions, r.labels, r.clusters, b.off ?? []); if (e === 'A') pick = pk; note = `${r.clusters} clusters${b.off?.length ? ` (${pk.items.filter((x) => !x.on).length} dropped)` : ''}`; break; }
        case 'dbscan': { const c = w.cloud!, r = dbscan(c.positions, c.count, p.eps, p.min); w.segLabels = r.labels; w.segCount = r.clusters; const pk = pickClusters(c.positions, r.labels, r.clusters, b.off ?? []); if (e === 'A') pick = pk; note = `${r.clusters} clusters${b.off?.length ? ` (${pk.items.filter((x) => !x.on).length} dropped)` : ''}`; break; }
        case 'classify': { w.objects = clustersToObjects(w.cloud!, w.segLabels!, w.segCount!, p); note = `${w.objects.length} objects`; break; }
        case 'colour': {
          const c = w.cloud!, objs = w.objects!, col = colourPoints(c.positions, c.count, input.camerasA, c.scanIds);
          const colors = col.colors.slice();
          for (let i = 0; i < c.count; i++) if (!col.valid[i]) colors.fill(125, i * 3, i * 3 + 3);
          w.cloud = { ...c, colors };
          let named = 0;
          for (const o of objs) {
            const votes = { red: 0, green: 0, yellow: 0 }; let tot = 0;
            for (const i of o.idx) { if (!col.valid[i]) continue; const v = labelVote(col.colors[i * 3], col.colors[i * 3 + 1], col.colors[i * 3 + 2]); if (v) { votes[v]++; tot++; } }
            const top = (Object.keys(votes) as (keyof typeof votes)[]).sort((x, y) => votes[y] - votes[x])[0];
            o.votes = tot; o.colour = tot >= p.votes && votes[top] / tot >= p.share / 100 ? top : 'unknown'; if (o.colour !== 'unknown') named++;
          }
          note = `${named} of ${objs.length} objects got a label colour (${col.count.toLocaleString()} points coloured)`; break;
        }
        default: break;
      }
    }
    if (grp >= 0 && subset) { for (const e of epochs) if (ws[e]?.cloud) gOuts[e].push(ws[e]!.cloud!); }
    if (last && gOuts.A.length >= 2) {
      // join: keep the points that every branch kept
      for (const e of epochs) {
        const w = ws[e]!, bs = gBase[e], outs = gOuts[e]; if (!bs?.instances || outs.some((o) => !o.instances)) { if (outs.length) w.cloud = outs[outs.length - 1]; continue; }
        const sets = outs.map((o) => new Set(Array.from(o.instances!))), keep: number[] = [];
        for (let i = 0; i < bs.count; i++) if (sets.every((s2) => s2.has(bs.instances![i]))) keep.push(i);
        w.cloud = selectPoints(bs, keep, bs.name);
      }
      note = `${note ? note + ' · ' : ''}joined: kept the points every parallel block kept`;
    }
    // comparisons across surveys
    if (b.kind === 'diff' && ws.B?.cloud && ws.A.cloud) {
      let B = ws.B.cloud; const A = ws.A.cloud;
      if (p.align === 1) { const sa = vox(A, 0.2), sb = vox(B, 0.2), r = icp(sb.positions, sb.count, sa.positions, sa.count, { maxIterations: 30, tolerance: 1e-5, maxCorrDist: 0.4, sampleMax: 6000, method: 'plane', trim: 0.7 }); if (r.history.length && r.fitness > 0.3) B = transformCloud(B, r.T); }
      const ta = new KDTree(A.positions, A.count), tb = new KDTree(B.positions, B.count), thr2 = p.thr * p.thr;
      const add: number[] = [], rem: number[] = [];
      for (let i = 0; i < B.count; i++) if (ta.nearest(B.positions[i * 3], B.positions[i * 3 + 1], B.positions[i * 3 + 2], thr2).index < 0) add.push(i);
      for (let i = 0; i < A.count; i++) if (tb.nearest(A.positions[i * 3], A.positions[i * 3 + 1], A.positions[i * 3 + 2], thr2).index < 0) rem.push(i);
      const ra = regions(B, add, Math.max(0.2, p.thr * 1.5), p.min).filter((r) => r.centre[2] > -1), rr = regions(A, rem, Math.max(0.2, p.thr * 1.5), p.min);
      const found: ChangeFound[] = [], usedA = new Set<number>(), usedR = new Set<number>();
      if (p.pair === 1) {
        const m = matchNearest(rr.map((r) => r.centre), ra.map((r) => r.centre), 9, (i, j) => { const a = rr[i].size, b2 = ra[j].size, s1 = a[0] * a[1] * a[2], s2 = b2[0] * b2[1] * b2[2]; return s1 > 0 && s2 > 0 && Math.max(s1, s2) / Math.min(s1, s2) < 3; });
        for (const [i, j] of m) { usedR.add(i); usedA.add(j); found.push({ kind: 'moved', centre: ra[j].centre, from: rr[i].centre, size: ra[j].size, n: ra[j].n }); }
      }
      ra.forEach((r, j) => { if (!usedA.has(j)) found.push({ kind: 'added', centre: r.centre, size: r.size, n: r.n }); });
      rr.forEach((r, i) => { if (!usedR.has(i)) found.push({ kind: 'removed', centre: r.centre, size: r.size, n: r.n }); });
      changes = b.parallel && changes ? mergeChanges(changes, found) : found; note = `${found.length} changes`;
    }
    if (b.kind === 'objmatch' && ws.A.objects && ws.B?.objects) {
      const oa = ws.A.objects, ob = ws.B.objects, m = matchNearest(oa.map((o) => o.centre), ob.map((o) => o.centre), p.dist, (i, j) => oa[i].cls === ob[j].cls);
      const ma = new Set(m.map((x) => x[0])), mb = new Set(m.map((x) => x[1])), found: ChangeFound[] = [];
      for (const [i, j] of m) if (xyDist(oa[i].centre, ob[j].centre) > p.move) found.push({ kind: 'moved', centre: ob[j].centre, from: oa[i].centre, size: [ob[j].max[0] - ob[j].min[0], ob[j].max[1] - ob[j].min[1], ob[j].max[2] - ob[j].min[2]], n: ob[j].n, cls: ob[j].cls });
      oa.forEach((o, i) => { if (!ma.has(i)) found.push({ kind: 'removed', centre: o.centre, size: [o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]], n: o.n, cls: o.cls }); });
      ob.forEach((o, j) => { if (!mb.has(j)) found.push({ kind: 'added', centre: o.centre, size: [o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]], n: o.n, cls: o.cls }); });
      changes = b.parallel && changes ? mergeChanges(changes, found) : found; note = `${found.length} changes`;
    }
    if (b.kind === 'safety') {
      const objs = (ws.B?.objects ?? ws.A.objects)!, margin = p.margin;
      safety = SAFETY_ZONES.map((z) => {
        const hit: number[] = []; let clear = Infinity;
        objs.forEach((o, i) => {
          if (o.max[2] < z.zMin) return;
          const dx = Math.max(z.min[0] - o.max[0], o.min[0] - z.max[0], 0), dy = Math.max(z.min[1] - o.max[1], o.min[1] - z.max[1], 0), d = Math.hypot(dx, dy);
          if (d <= margin) hit.push(i); clear = Math.min(clear, d);
        });
        return { zone: z.id, violated: hit.length > 0, clearance: Number.isFinite(clear) ? clear : 99, objects: hit };
      });
      note = `${safety.filter((s) => s.violated).length} of ${safety.length} zones violated`;
    }
    const after = ws.A.cloud?.count ?? cur;
    if (reg) registration = reg;
    steps.push({ ...base, ms: now() - s0, after, note, reg, pick, preview: ws.A.cloud && (info.out === 'cloud' || info.out === 'segments' || info.out === 'objects') ? thin(ws.A.cloud, 40000) : undefined });
  });
  for (const w of [ws.A, ws.B]) if (w && !w.twin) w.twin = w.cloud;
  return { A: ws.A, B: ws.B, registration, changes, safety, steps, ms: now() - t0 };
}
