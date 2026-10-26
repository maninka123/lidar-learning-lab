import { PointCloud, selectPoints } from '../core/pointcloud';
import { SceneDef, SceneObject, box, cyl, sph, finalize } from '../scenes/geometry';
import { car, person } from '../scenes/city';
import { voxelDownsample } from '../processing/ops';
import { euclideanClustering } from '../segmentation/clustering';
import { ransacPlane } from '../segmentation/ransac';
import { Vec3 } from '../core/math';

// ------------------------------------------------------------------ the drive: a vehicle with a LiDAR on the roof, driving through the city
export const N_FRAMES = 10, DT = 0.8; // one scan every 0.8 s
export const EGO = (t: number) => ({ x: -20 + 4 * t, y: -2.0, z: 1.8, yaw: 0 }); // 4 m/s along the road

interface Actor { id: string; kind: 'person' | 'car'; pos: (t: number) => { x: number; y: number; yaw: number } }
/** What moves in the street (the truth, used to make the scans): a pedestrian who crosses the road in front of the vehicle, one walking along the pavement, one standing, a slow car ahead and an oncoming car. */
export const ACTORS: Actor[] = [
  { id: 'crossing pedestrian', kind: 'person', pos: (t) => ({ x: 3, y: Math.max(-5.8, 6.2 - 1.6 * t), yaw: 0 }) },
  { id: 'pavement pedestrian', kind: 'person', pos: (t) => ({ x: -12 + 1.2 * t, y: 6.6, yaw: 0 }) },
  { id: 'standing pedestrian', kind: 'person', pos: () => ({ x: -3, y: 6.9, yaw: 0 }) },
  { id: 'slow car ahead', kind: 'car', pos: (t) => ({ x: -8 + 3.2 * t, y: -2.0, yaw: 0 }) },
  { id: 'oncoming car', kind: 'car', pos: (t) => ({ x: 14 - 7 * t, y: 2.0, yaw: Math.PI }) },
];

/** A clean street: road with lane markings, two pavements, buildings, parked cars, trees and poles, plus the moving actors at time t. `withEgo` adds the vehicle itself (for drawing only: the LiDAR must not scan its own car). */
export function sceneAt(t: number, withEgo = false): SceneDef {
  const O: Omit<SceneObject, 'instanceId' | 'scannable'>[] = [];
  const add = (o: Omit<SceneObject, 'instanceId' | 'scannable'>) => O.push(o);
  add({ id: 'road', name: 'Road', classId: 13, structural: true, color: [74, 78, 86], reflectivity: 0.15, parts: [box([0, 0, -0.1], [90, 10.4, 0.2])] });
  add({ id: 'pavements', name: 'Pavements', classId: 14, structural: true, color: [196, 194, 188], reflectivity: 0.4, parts: [box([0, 7.4, 0.05], [90, 4.4, 0.3]), box([0, -7.4, 0.05], [90, 4.4, 0.3])] });
  const marks = []; for (let x = -42; x < 44; x += 5) marks.push(box([x, 0, 0.011], [2.4, 0.16, 0.02]));
  add({ id: 'markings', name: 'Lane markings', classId: 13, structural: true, color: [250, 250, 250], reflectivity: 0.85, parts: [...marks, box([0, 5.0, 0.011], [90, 0.12, 0.02]), box([0, -5.0, 0.011], [90, 0.12, 0.02])] });
  const bcol: [number, number, number][] = [[226, 190, 140], [196, 108, 94], [150, 190, 214], [232, 212, 120], [176, 200, 160]];
  for (let i = 0; i < 6; i++) { const x = -42 + i * 15; add({ id: `building-n${i}`, name: `Building N${i}`, classId: 17, color: bcol[i % 5], reflectivity: 0.55, parts: [box([x + 6.5, 14, 4 + (i % 3) * 2], [13, 5, 8 + (i % 3) * 4])] }); add({ id: `building-s${i}`, name: `Building S${i}`, classId: 17, color: bcol[(i + 2) % 5], reflectivity: 0.55, parts: [box([x + 6.5, -14, 4 + ((i + 1) % 3) * 2], [13, 5, 8 + ((i + 1) % 3) * 4])] }); }
  [[-6, -4.1, 0], [8, -4.1, 0], [-11, 4.1, Math.PI]].forEach(([x, y, yaw], i) => add({ id: `parked-car-${i + 1}`, name: `Parked car ${i + 1}`, classId: 15, color: [60, 90, 190], reflectivity: 0.5, parts: car(x, y, yaw) }));
  [[-3, 8.4], [9, 8.6], [-14, -8.6]].forEach(([x, y], i) => add({ id: `tree-${i + 1}`, name: `Tree ${i + 1}`, classId: 16, color: [70, 150, 70], reflectivity: 0.5, parts: [cyl([x, y, 1.65], 0.15, 3, 'z'), sph([x, y, 3.9], 1.4)] }));
  [[-8, 5.7], [11, -5.7]].forEach(([x, y], i) => add({ id: `pole-${i + 1}`, name: `Pole ${i + 1}`, classId: 18, color: [90, 90, 96], reflectivity: 0.4, parts: [cyl([x, y, 3.15], 0.1, 6, 'z')] }));
  ACTORS.forEach((a) => {
    const p = a.pos(t);
    if (a.kind === 'person') add({ id: a.id, name: a.id, classId: 21, color: [255, 140, 60], reflectivity: 0.6, parts: person(p.x, p.y, Math.abs(p.y) >= 5.2 ? 0.2 : 0) });
    else add({ id: a.id, name: a.id, classId: 15, color: a.id === 'oncoming car' ? [250, 200, 40] : [230, 60, 60], reflectivity: 0.6, parts: car(p.x, p.y, p.yaw) });
  });
  if (withEgo) { const e = EGO(t); add({ id: 'ego', name: 'Our vehicle', classId: 15, color: [20, 150, 90], reflectivity: 0.5, parts: car(e.x, e.y, 0) }); }
  return { id: 'M', name: 'Moving street', description: 'A street with moving pedestrians and cars.', objects: finalize(O as never), bounds: { min: [-45, -20, 0], max: [45, 20, 12] }, defaultPose: { x: -20, y: -2, z: 1.8, yaw: 0 }, cameraHome: [0, -30, 18], cameraTarget: [0, 0, 1] };
}

// ------------------------------------------------------------------ fast segmentation of one frame
export interface Seg { id: number; cls: 'person' | 'car' | 'large vehicle' | 'pole / tree' | 'building / structure' | 'object'; centre: Vec3; size: Vec3; min: Vec3; max: Vec3; count: number }
export interface FrameSeg { points: PointCloud; labels: Int32Array; segs: Seg[]; ms: number; kept: number; ground: number }
export interface SegOpts { voxel: number; radius: number; minPts: number; range: number; origin: [number, number] }

/** Rule-based labels from the size of the box around a cluster: deliberately simple. */
export function classify(size: Vec3): Seg['cls'] {
  const [a, b, h] = size, foot = Math.max(a, b), small = Math.min(a, b);
  if (foot > 9 || (h > 6 && foot > 3)) return 'building / structure';
  if (h >= 0.7 && h <= 2.2 && foot <= 1.1) return 'person';
  if (foot >= 1.2 && foot <= 5.8 && h >= 0.6 && h <= 2.2 && foot > 1.1) return 'car'; // seen from one side, a car may show only its width
  if (foot > 5.8 && foot <= 12) return 'large vehicle';
  if (h > 2.2 && foot < 2.6) return 'pole / tree';
  return 'object';
}

/** Ground out with a plane, thin the rest with a voxel grid, then cluster: about a few tens of milliseconds per frame. */
export function segmentFrame(cloud: PointCloud, o: SegOpts): FrameSeg {
  const t0 = performance.now();
  // only what is near the vehicle and below roof height: far away the rings of a spinning LiDAR are too far apart to cluster
  const near: number[] = [];
  for (let i = 0; i < cloud.count; i++) { const x = cloud.positions[i * 3] - o.origin[0], y = cloud.positions[i * 3 + 1] - o.origin[1], z = cloud.positions[i * 3 + 2]; if (x * x + y * y < o.range * o.range && z > 0.3 && z < 4.2) near.push(i); }
  const thin = voxelDownsample(selectPoints(cloud, near, 'near'), o.voxel);
  const fit = ransacPlane(thin.positions, thin.count, { threshold: 0.15, iterations: 80, seed: 5, maxTiltDeg: 12 });
  const isGround = new Uint8Array(thin.count);
  if (fit) for (const i of fit.inliers) isGround[i] = 1;
  const keep: number[] = []; for (let i = 0; i < thin.count; i++) if (!isGround[i]) keep.push(i);
  const pts = selectPoints(thin, keep, 'objects');
  const cl = euclideanClustering(pts.positions, pts.count, o.radius, o.minPts);
  const buckets: number[][] = Array.from({ length: cl.clusters }, () => []);
  cl.labels.forEach((g, i) => { if (g >= 0) buckets[g].push(i); });
  const segs: Seg[] = [];
  for (const b of buckets) {
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const i of b) for (let a = 0; a < 3; a++) { const v = pts.positions[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    const size: Vec3 = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    const id = segs.length;
    if (b.length < o.minPts * 2 && classify(size) === 'object') { for (const i of b) cl.labels[i] = -1; continue; } // specks
    segs.push({ id, cls: classify(size), centre: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], size, min: mn, max: mx, count: b.length });
    for (const i of b) cl.labels[i] = id;
  }
  return { points: pts, labels: cl.labels, segs, ms: performance.now() - t0, kept: pts.count, ground: thin.count - pts.count };
}

// ------------------------------------------------------------------ tracking: the same object from frame to frame
export interface Obs { frame: number; seg: Seg }
export interface Track { id: number; cls: Seg['cls']; obs: Obs[]; speed: number; moving: boolean; vel: [number, number] }
const GATE: Record<Seg['cls'], number> = { person: 1.8, car: 7.5, 'large vehicle': 7.5, 'pole / tree': 0.8, 'building / structure': 1.5, object: 1.0 };
const TRACKED = new Set<Seg['cls']>(['person', 'car', 'large vehicle', 'pole / tree']);

export function trackObjects(frames: FrameSeg[]): Track[] {
  const tracks: Track[] = [];
  frames.forEach((f, k) => {
    const used = new Set<number>();
    const open = tracks.filter((t) => t.obs[t.obs.length - 1].frame === k - 1);
    const pairs: { d: number; t: Track; s: Seg }[] = [];
    for (const t of open) {
      const last = t.obs[t.obs.length - 1].seg, pred: [number, number] = [last.centre[0] + t.vel[0] * DT, last.centre[1] + t.vel[1] * DT];
      const gate = t.obs.length >= 2 ? Math.max(1.6, GATE[t.cls] * 0.35) : GATE[t.cls]; // once the velocity is known, look near where the object should be
      for (const s of f.segs) { if (!TRACKED.has(s.cls) || (s.cls !== t.cls && !(TRACKED.has(t.cls) && (s.cls === 'car' || s.cls === 'large vehicle') && (t.cls === 'car' || t.cls === 'large vehicle')))) continue; const d = Math.hypot(s.centre[0] - pred[0], s.centre[1] - pred[1]); if (d <= gate) pairs.push({ d, t, s }); }
    }
    pairs.sort((a, b) => a.d - b.d);
    const taken = new Set<Track>();
    for (const p of pairs) {
      if (taken.has(p.t) || used.has(p.s.id)) continue;
      taken.add(p.t); used.add(p.s.id);
      const last = p.t.obs[p.t.obs.length - 1].seg;
      p.t.obs.push({ frame: k, seg: p.s });
      p.t.vel = [(p.s.centre[0] - last.centre[0]) / DT, (p.s.centre[1] - last.centre[1]) / DT];
      p.t.cls = p.s.cls === 'object' ? p.t.cls : p.s.cls;
    }
    for (const s of f.segs) if (!used.has(s.id) && TRACKED.has(s.cls)) tracks.push({ id: tracks.length + 1, cls: s.cls, obs: [{ frame: k, seg: s }], speed: 0, moving: false, vel: [0, 0] });
  });
  // stitch: an object that was missed for a frame or two (hidden, too sparse) continues its old track
  for (let i = 0; i < tracks.length; i++) {
    const a = tracks[i]; if (!a) continue;
    for (let j = 0; j < tracks.length; j++) {
      const b = tracks[j]; if (!b || b === a) continue;
      const ea = a.obs[a.obs.length - 1], sb = b.obs[0], gap = sb.frame - ea.frame;
      if (gap < 2 || gap > 5 || a.cls !== b.cls || !TRACKED.has(a.cls)) continue;
      const v = a.obs.length >= 2 ? [(ea.seg.centre[0] - a.obs[a.obs.length - 2].seg.centre[0]) / DT, (ea.seg.centre[1] - a.obs[a.obs.length - 2].seg.centre[1]) / DT] : [0, 0];
      const px = ea.seg.centre[0] + v[0] * DT * gap, py = ea.seg.centre[1] + v[1] * DT * gap;
      if (Math.hypot(sb.seg.centre[0] - px, sb.seg.centre[1] - py) < 1.8 + 0.3 * gap) { a.obs.push(...b.obs); tracks[j] = undefined as never; }
    }
  }
  const alive = tracks.filter(Boolean); tracks.length = 0; alive.forEach((t, i) => { t.id = i + 1; tracks.push(t); });
  for (const t of tracks) {
    if (t.obs.length >= 2) { const a = t.obs[0].seg.centre, b = t.obs[t.obs.length - 1].seg.centre, dt = (t.obs[t.obs.length - 1].frame - t.obs[0].frame) * DT; t.speed = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(dt, 1e-6); }
    t.moving = t.speed > 0.5;
  }
  return tracks;
}

// ------------------------------------------------------------------ the temporal scene graph
export interface TEvent { frame: number; text: string; track: number }
export interface TemporalGraph { tracks: Track[]; events: TEvent[]; ego: { x: number; y: number }[] }
export const trackName = (t: Track) => `${t.cls} #${t.id}`;

export function buildTemporal(frames: FrameSeg[], tracks: Track[]): TemporalGraph {
  const ego = frames.map((_, k) => EGO(k * DT));
  const events: TEvent[] = [];
  const rel = (t: Track, k: number) => { const o = t.obs.find((q) => q.frame === k); return o ? { dx: o.seg.centre[0] - ego[k].x, dy: o.seg.centre[1] - ego[k].y, d: Math.hypot(o.seg.centre[0] - ego[k].x, o.seg.centre[1] - ego[k].y) } : null; };
  for (const t of tracks.filter((q) => q.cls !== 'building / structure' && q.obs.length >= 3)) {
    const f0 = t.obs[0].frame, f1 = t.obs[t.obs.length - 1].frame, nm = trackName(t);
    const dyn = t.moving || t.cls === 'person';
    if (dyn && f0 > 0) events.push({ frame: f0, text: `${nm} appears`, track: t.id });
    if (dyn && f1 < frames.length - 1) events.push({ frame: f1, text: `${nm} leaves the view`, track: t.id });
    // starts moving: static for the first frames, then moving
    const sp = t.obs.slice(1).map((o, i) => Math.hypot(o.seg.centre[0] - t.obs[i].seg.centre[0], o.seg.centre[1] - t.obs[i].seg.centre[1]) / DT);
    const first = sp.findIndex((v) => v > 0.8);
    if (first >= 2 && sp.slice(0, first).every((v) => v < 0.4)) events.push({ frame: t.obs[first].frame, text: `${nm} starts moving`, track: t.id });
    // passing the vehicle, crossing its path (side to side with a margin), approaching / moving away, coming close
    let crossed = false;
    for (let i = 1; i < t.obs.length; i++) {
      const a0 = rel(t, t.obs[i - 1].frame)!, a1 = rel(t, t.obs[i].frame)!, k = t.obs[i].frame;
      if (a0.dx > 0 && a1.dx <= 0 && Math.abs(a1.dy) < 6) events.push({ frame: k, text: `${nm} passes the vehicle (${Math.abs(a1.dy).toFixed(1)} m to the side)`, track: t.id });
      if (!crossed && t.moving && t.cls === 'person' && a0.dx > -2 && a1.dx > -2 && a1.dx < 16 && Math.sign(a0.dy + 0.6 * Math.sign(a0.dy)) !== Math.sign(a1.dy - 0.6 * Math.sign(a1.dy)) && Math.abs(a0.dy) + Math.abs(a1.dy) > 1) { crossed = true; events.push({ frame: k, text: `${nm} crosses the vehicle's path ${a1.dx.toFixed(1)} m ahead`, track: t.id }); }
    }
    const d0 = rel(t, f0)!, d1 = rel(t, f1)!;
    if (t.moving && d1.d < d0.d - 3) events.push({ frame: f1, text: `${nm} is approaching: ${d0.d.toFixed(1)} m → ${d1.d.toFixed(1)} m`, track: t.id });
    if (t.moving && d1.d > d0.d + 3) events.push({ frame: f1, text: `${nm} is moving away: ${d0.d.toFixed(1)} m → ${d1.d.toFixed(1)} m`, track: t.id });
    const close = t.obs.map((o) => ({ o, d: rel(t, o.frame)!.d })).filter((q) => q.d < 6).sort((x, y) => x.d - y.d)[0];
    if (close && dyn) events.push({ frame: close.o.frame, text: `${nm} comes within ${close.d.toFixed(1)} m of the vehicle`, track: t.id });
  }
  events.sort((a, b) => a.frame - b.frame);
  return { tracks, events, ego };
}

/** The temporal graph as plain text for a language model: moving things and their paths, the events, and a note on the rest. */
export function temporalText(g: TemporalGraph): string {
  const f = (v: number) => v.toFixed(1), real = g.tracks.filter((t) => t.cls !== 'building / structure' && t.obs.length >= 2);
  const L = [`The vehicle drives along +x at about 4 m/s. Frames are ${DT} s apart (frame 0 = t 0.0 s). Positions are x y in metres in the street frame; the vehicle is at x ${f(g.ego[0].x)} in frame 0 and x ${f(g.ego[g.ego.length - 1].x)} in the last frame, y ${f(g.ego[0].y)}.`, 'TRACKED OBJECTS (id, class, state, average speed, positions per frame):'];
  real.forEach((t) => L.push(`${trackName(t)} | ${t.moving ? 'moving' : 'static'} | ${f(t.speed)} m/s | ${t.obs.map((o) => `f${o.frame}:(${f(o.seg.centre[0])},${f(o.seg.centre[1])})`).join(' ')}`));
  L.push(`${g.tracks.filter((t) => t.cls === 'building / structure').length} large static structures (buildings) omitted.`, 'TEMPORAL EVENTS:');
  g.events.forEach((e) => L.push(`frame ${e.frame} (t ${f(e.frame * DT)} s): ${e.text}`));
  return L.join('\n');
}
