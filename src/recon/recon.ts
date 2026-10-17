import { PointCloud, makeId, concatClouds } from '../core/pointcloud';
import { makeRng } from '../core/rng';
import { KDTree } from '../core/kdtree';
import { SceneDef, RayScene, newHit, box, cyl, finalize, SceneObject } from '../scenes/geometry';
import { chair, crate } from '../scenes/rooms';
import { simulateScan, staticPose } from '../sensor/simulate';
import { PRESETS, presetToConfig } from '../sensor/presets';
import { voxelDownsample } from '../processing/ops';
import { icp, applySim } from '../registration/icp';
import { Rigid, Vec3, rigidFromEuler, D2R, norm, cross, sub } from '../core/math';
import { sampleSurfaces } from '../scenes/surface';

export type ReconObjectId = 'chair' | 'crate';
export type ReconMethod = 'photogrammetry' | 'rgbd' | 'monocular';

export function reconScene(id: ReconObjectId): SceneDef {
  const floor = { id: 'floor', name: 'Ground plane', classId: 1, structural: true, color: [200, 200, 195] as [number, number, number], reflectivity: 0.4, pattern: 'checker' as const, parts: [box([0, 0, -0.025], [3.2, 3.2, 0.05])] };
  let objs: unknown[];
  if (id === 'chair') {
    const c = chair('chair', 0, 0, 0.35, [175, 105, 60]);
    objs = [floor, { ...c, name: 'Chair', pattern: 'stripes' }];
  } else {
    const c = crate('crate', 0, 0, 0.6, 0.5, 0.4, 0.4, [190, 140, 80], 6);
    const lid = box([0, 0, 0.43], [0.66, 0.56, 0.06], 0.4, { mat: { color: [150, 100, 60], reflectivity: 0.5 } });
    const feet = [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]].map(([x, y]) => cyl([x * Math.cos(0.4) - y * Math.sin(0.4), x * Math.sin(0.4) + y * Math.cos(0.4), 0.02], 0.04, 0.04, 'z'));
    objs = [floor, { ...c, name: 'Wooden crate', pattern: 'stripes', parts: [...c.parts, lid, ...feet] }];
  }
  return {
    id: `R-${id}`, name: id === 'chair' ? 'Chair' : 'Wooden crate', description: 'Small object used for the image-to-3D comparison.',
    objects: finalize(objs as never) as SceneObject[], bounds: { min: [-1.6, -1.6, 0], max: [1.6, 1.6, 2] },
    defaultPose: { x: 0, y: 0, z: 0, yaw: 0 }, cameraHome: [2.2, -2.2, 1.6], cameraTarget: [0, 0, 0.4],
  };
}

// --------------------------------------------------------------- synthetic camera
export interface Camera { pos: Vec3; target: Vec3; fovDeg: number }
export interface View { cam: Camera; w: number; h: number; rgb: Uint8ClampedArray; depth: Float32Array; hitMask: Uint8Array }

function basis(cam: Camera) {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  return { f, r, u };
}

function texture(objPattern: string | undefined, x: number, y: number, z: number): number {
  if (objPattern === 'checker') return (Math.floor(x * 5) + Math.floor(y * 5)) & 1 ? 0.8 : 1;
  if (objPattern === 'stripes') return 0.88 + 0.12 * Math.sin(z * 55 + x * 9 + y * 5);
  return 1;
}

export function renderView(scene: SceneDef, cam: Camera, w: number, h: number): View {
  const rs = new RayScene(scene);
  const { f, r, u } = basis(cam);
  const t = Math.tan((cam.fovDeg * D2R) / 2), aspect = w / h;
  const rgb = new Uint8ClampedArray(w * h * 4), depth = new Float32Array(w * h), hitMask = new Uint8Array(w * h);
  const hit = newHit();
  const L = norm([0.4, -0.3, 0.85] as Vec3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const nx = (2 * (i + 0.5) / w - 1) * t * aspect, ny = (1 - 2 * (j + 0.5) / h) * t;
    const d = norm([f[0] + nx * r[0] + ny * u[0], f[1] + nx * r[1] + ny * u[1], f[2] + nx * r[2] + ny * u[2]] as Vec3);
    const k = (j * w + i) * 4;
    if (rs.cast(cam.pos[0], cam.pos[1], cam.pos[2], d[0], d[1], d[2], 0.05, 20, hit)) {
      const o = scene.objects[hit.obj], mat = o.parts[hit.part].mat ?? { color: o.color, reflectivity: o.reflectivity };
      let nxn = hit.nx, nyn = hit.ny, nzn = hit.nz;
      if (nxn * d[0] + nyn * d[1] + nzn * d[2] > 0) { nxn = -nxn; nyn = -nyn; nzn = -nzn; }
      const sh = 0.45 + 0.55 * Math.max(0, nxn * L[0] + nyn * L[1] + nzn * L[2]);
      const px = cam.pos[0] + d[0] * hit.t, py = cam.pos[1] + d[1] * hit.t, pz = cam.pos[2] + d[2] * hit.t;
      const tx = texture(o.pattern, px, py, pz);
      rgb[k] = mat.color[0] * sh * tx; rgb[k + 1] = mat.color[1] * sh * tx; rgb[k + 2] = mat.color[2] * sh * tx; rgb[k + 3] = 255;
      depth[j * w + i] = hit.t * (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]); // z-depth
      hitMask[j * w + i] = 1;
    } else { rgb[k] = 28; rgb[k + 1] = 32; rgb[k + 2] = 40; rgb[k + 3] = 255; }
  }
  return { cam, w, h, rgb, depth, hitMask };
}

export function orbitCameras(k: number, radius: number, elevDeg: number, center: Vec3, startDeg = 20): Camera[] {
  return Array.from({ length: k }, (_, i) => {
    const a = (startDeg + (360 * i) / k) * D2R, e = elevDeg * D2R;
    return { pos: [center[0] + radius * Math.cos(e) * Math.cos(a), center[1] + radius * Math.cos(e) * Math.sin(a), center[2] + radius * Math.sin(e)] as Vec3, target: center, fovDeg: 50 };
  });
}

// ---------------------------------------------------------------- reconstruction (simulated pipelines)
export interface ReconParams { object: ReconObjectId; method: ReconMethod; views: number; seed: number }
export interface ReconOutput {
  cloud: PointCloud;
  mesh: { positions: Float32Array; indices: Uint32Array };
  photo: { w: number; h: number; rgb: Uint8ClampedArray };
  hiddenTransform: { scale: number; yawDeg: number; t: Vec3 } | null; // revealed only after alignment, for validation
  notes: string[];
}

function backProject(v: View, zEst: (i: number, j: number, z: number) => number | null, stride: number, colorOut: number[], posOut: number[]) {
  const { f, r, u } = basis(v.cam);
  const t = Math.tan((v.cam.fovDeg * D2R) / 2), aspect = v.w / v.h;
  for (let j = 0; j < v.h; j += stride) for (let i = 0; i < v.w; i += stride) {
    const idx = j * v.w + i;
    if (!v.hitMask[idx]) continue;
    const z = zEst(i, j, v.depth[idx]);
    if (z === null || z <= 0.05) continue;
    const nx = (2 * (i + 0.5) / v.w - 1) * t * aspect, ny = (1 - 2 * (j + 0.5) / v.h) * t;
    posOut.push(v.cam.pos[0] + (f[0] + nx * r[0] + ny * u[0]) * z, v.cam.pos[1] + (f[1] + nx * r[1] + ny * u[1]) * z, v.cam.pos[2] + (f[2] + nx * r[2] + ny * u[2]) * z);
    colorOut.push(v.rgb[idx * 4], v.rgb[idx * 4 + 1], v.rgb[idx * 4 + 2]);
  }
}

export function voxelSurfaceMesh(c: PointCloud, vs: number): { positions: Float32Array; indices: Uint32Array } {
  const occ = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const cells: [number, number, number][] = [];
  for (let i = 0; i < c.count; i++) {
    const x = Math.floor(c.positions[i * 3] / vs), y = Math.floor(c.positions[i * 3 + 1] / vs), z = Math.floor(c.positions[i * 3 + 2] / vs);
    const k = key(x, y, z);
    if (!occ.has(k)) { occ.add(k); cells.push([x, y, z]); }
  }
  const pos: number[] = [], idx: number[] = [];
  const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [x, y, z] of cells) {
    dirs.forEach((d, di) => {
      if (occ.has(key(x + d[0], y + d[1], z + d[2]))) return;
      const base = pos.length / 3;
      const ax = di >> 1; // axis
      const o: Vec3 = [x, y, z];
      if (d[ax] > 0) o[ax] += 1;
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([p, q]) => { const v: Vec3 = [o[0], o[1], o[2]]; v[a1] += p; v[a2] += q; return v; });
      corners.forEach((v) => pos.push(v[0] * vs, v[1] * vs, v[2] * vs));
      if (d[ax] > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

export function reconstruct(p: ReconParams): ReconOutput {
  const scene = reconScene(p.object);
  const rng = makeRng(p.seed);
  const center: Vec3 = [0, 0, 0.4];
  const W = 160, H = 120;
  const notes: string[] = [];
  const photoCam: Camera = { pos: [1.8, -1.6, 1.1], target: center, fovDeg: 50 };
  const photoView = renderView(scene, photoCam, 320, 240);
  const photo = { w: 320, h: 240, rgb: photoView.rgb };

  const pos: number[] = [], col: number[] = [];
  let cams: Camera[];
  if (p.method === 'monocular') {
    cams = [photoCam];
    const v = renderView(scene, photoCam, W, H);
    // Error model of a monocular depth estimator: unknown scale + shift, smooth low-frequency distortion, blur, no back side.
    const a = 1.12, b = -0.12, phase = rng.range(0, 6.28);
    backProject(v, (i, j, z) => a * z + b + 0.05 * Math.sin(i / 17 + phase) * Math.cos(j / 23 - phase) + 0.004 * rng.gauss(), 1, col, pos);
    notes.push('Error model of a single-image depth estimator (scale/shift ambiguity + smooth distortion). Not a neural network output.');
  } else {
    cams = orbitCameras(Math.max(2, p.views), 2.2, p.method === 'rgbd' ? 28 : 32, center, rng.range(0, 60));
    const pc: PointCloud[] = [];
    cams.forEach((cam) => {
      // Photogrammetry: camera poses come from SfM, so they are slightly wrong. RGB-D: tracked / known poses.
      const noisyCam: Camera = p.method === 'photogrammetry'
        ? { ...cam, pos: [cam.pos[0] + 0.012 * rng.gauss(), cam.pos[1] + 0.012 * rng.gauss(), cam.pos[2] + 0.012 * rng.gauss()] as Vec3, target: [cam.target[0] + 0.01 * rng.gauss(), cam.target[1] + 0.01 * rng.gauss(), cam.target[2] + 0.01 * rng.gauss()] as Vec3 }
        : cam;
      const v = renderView(scene, cam, W, H);
      const vv = { ...v, cam: noisyCam };
      const gray = (i: number, j: number) => { const k = (j * W + i) * 4; return 0.3 * v.rgb[k] + 0.59 * v.rgb[k + 1] + 0.11 * v.rgb[k + 2]; };
      const lp: number[] = [], lc: number[] = [];
      backProject(vv, (i, j, z) => {
        if (p.method === 'rgbd') return z + 0.004 * rng.gauss();
        // photogrammetry: matching fails on textureless pixels, depth error grows with z²
        const g = i + 1 < W && j + 1 < H ? Math.abs(gray(i + 1, j) - gray(i, j)) + Math.abs(gray(i, j + 1) - gray(i, j)) : 0;
        if (g < 2.2 && rng.next() < 0.8) return null;
        return z + 0.007 * z * z * rng.gauss();
      }, 1, lc, lp);
      const c: PointCloud = { id: makeId(), name: 'view', count: lp.length / 3, positions: Float32Array.from(lp), colors: Uint8Array.from(lc), meta: { kind: 'reconstructed', source: 'depth fusion', units: 'm' } };
      pc.push(c);
    });
    for (const c of pc) { for (let i = 0; i < c.count * 3; i++) pos.push(c.positions[i]); for (let i = 0; i < c.count * 3; i++) col.push(c.colors![i]); }
    notes.push(p.method === 'rgbd'
      ? `Depth fusion from ${cams.length} RGB-D frames with known poses, ~4 mm depth noise.`
      : `Multi-view depth fusion from ${cams.length} photographs. Matching is dropped on textureless pixels, depth error grows with distance², camera poses carry SfM-like error, and the model is in an arbitrary frame at unknown scale.`);
  }
  let cloud: PointCloud = { id: makeId('recon'), name: 'Image-derived reconstruction', count: pos.length / 3, positions: Float32Array.from(pos), colors: Uint8Array.from(col), meta: { kind: 'reconstructed', source: `Simulated ${p.method} pipeline`, units: 'm', description: notes.join(' '), notes } };
  cloud = voxelDownsample(cloud, 0.012);
  // Isolate the object: drop the ground plane (z ≈ 0), as a RANSAC ground removal would.
  const groundTol = p.method === 'photogrammetry' ? 0.12 : p.method === 'monocular' ? 0.05 : 0.03; // ≈ 3σ of the method's depth noise at the floor
  const above: number[] = [];
  for (let i = 0; i < cloud.count; i++) if (cloud.positions[i * 3 + 2] > groundTol) above.push(i);
  cloud = selectPoints(cloud, above, 'Image-derived reconstruction');
  notes.push('Ground plane removed so only the object is compared.');
  cloud.name = 'Image-derived reconstruction'; cloud.meta = { ...cloud.meta, kind: 'reconstructed' };

  // Photogrammetry output lives in an arbitrary frame at arbitrary scale until aligned.
  let hidden: ReconOutput['hiddenTransform'] = null;
  if (p.method !== 'rgbd') {
    const scale = p.method === 'photogrammetry' ? rng.range(0.88, 1.12) : 1;
    const yaw = rng.range(-35, 35), t: Vec3 = [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), 0];
    const T = rigidFromEuler(t[0], t[1], 0, yaw * D2R, 0, 0);
    for (let i = 0; i < cloud.count; i++) {
      const q = applySim(T, scale, [cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]);
      cloud.positions[i * 3] = q[0]; cloud.positions[i * 3 + 1] = q[1]; cloud.positions[i * 3 + 2] = q[2];
    }
    hidden = { scale, yawDeg: yaw, t };
    notes.push('Output is in an arbitrary frame; align it to the LiDAR cloud (with scale) before measuring any error.');
  }
  const mesh = voxelSurfaceMesh(cloud, 0.025);
  return { cloud, mesh, photo, hiddenTransform: hidden, notes };
}

// ---------------------------------------------------------------- LiDAR reference + comparison
export function scanObject(object: ReconObjectId, seed: number, stations = 2): PointCloud {
  const scene = reconScene(object);
  const cfg = { ...presetToConfig(PRESETS.find((q) => q.id === 'rot64')!), hRes: 0.25, noise: 0.003, vMin: -30, vMax: 30, maxRange: 20 };
  const parts: PointCloud[] = [];
  const angles = [-0.7, 1.3, 3.4, 5.0];
  for (let s = 0; s < stations; s++) {
    const a = angles[s % 4], R = 1.9;
    const x = R * Math.cos(a), y = R * Math.sin(a);
    const yaw = Math.atan2(-y, -x);
    const r = simulateScan({ scene, sensor: cfg, trajectory: staticPose(x, y, 1.0, yaw), sweeps: 1, seed: seed + s, maxRays: 120000, distortion: false, scanId: s });
    const keep: number[] = [];
    for (let i = 0; i < r.cloud.count; i++) if (r.cloud.instances![i] === 2) keep.push(i); // object only (drop the ground plane)
    const sel = new Float32Array(keep.length * 3);
    keep.forEach((k, i) => sel.set(r.cloud.positions.subarray(k * 3, k * 3 + 3), i * 3));
    const c = { ...r.cloud };
    parts.push(pickPoints(c, keep));
  }
  const merged = concatClouds(parts, 'LiDAR scan of object', { kind: 'simulated' });
  return merged;
}
import { selectPoints } from '../core/pointcloud';
function pickPoints(c: PointCloud, keep: number[]) { return selectPoints(c, keep, c.name); }

export interface AlignResult { aligned: PointCloud; scale: number; T: Rigid; rmse: number; fitness: number; valid: boolean }

/** Coarse yaw search + similarity ICP (scale estimated) of a reconstruction onto a LiDAR cloud. */
export function alignToLidar(recon: PointCloud, lidar: PointCloud): AlignResult {
  const cen = (c: PointCloud): Vec3 => { let x = 0, y = 0, z = 0; for (let i = 0; i < c.count; i++) { x += c.positions[i * 3]; y += c.positions[i * 3 + 1]; z += c.positions[i * 3 + 2]; } return [x / c.count, y / c.count, z / c.count]; };
  const cr = cen(recon), cl = cen(lidar);
  const ext = (c: PointCloud) => { const z = new Float32Array(c.count); for (let i = 0; i < c.count; i++) z[i] = c.positions[i * 3 + 2]; z.sort(); return z[Math.floor(c.count * 0.98)] - z[Math.floor(c.count * 0.02)]; };
  const s0 = ext(lidar) / (ext(recon) || 1);
  let best: ReturnType<typeof icp> | null = null;
  for (let k = 0; k < 24; k++) {
    const yaw = (k * 15) * D2R;
    const R0 = rigidFromEuler(0, 0, 0, yaw, 0, 0).R;
    // x' = s R (x - cr) + cl  =>  t = cl - s R cr
    const rc = [R0[0] * cr[0] + R0[1] * cr[1] + R0[2] * cr[2], R0[3] * cr[0] + R0[4] * cr[1] + R0[5] * cr[2], R0[6] * cr[0] + R0[7] * cr[1] + R0[8] * cr[2]];
    const init: Rigid = { R: R0, t: [cl[0] - s0 * rc[0], cl[1] - s0 * rc[1], cl[2] - s0 * rc[2]] };
    const res = icp(recon.positions, recon.count, lidar.positions, lidar.count, { maxIterations: 40, tolerance: 1e-6, maxCorrDist: 0.3, sampleMax: 2500, withScale: true, init, initScale: s0, scaleBounds: [0.6, 1.6] });
    if (!best || res.finalRmse * (2 - res.fitness) < best.finalRmse * (2 - best.fitness)) best = res;
  }
  const res = best!;
  const out = { ...recon, id: makeId('recon'), positions: new Float32Array(recon.positions.length), meta: { ...recon.meta } } as PointCloud;
  for (let i = 0; i < recon.count; i++) {
    const q = applySim(res.T, res.scale, [recon.positions[i * 3], recon.positions[i * 3 + 1], recon.positions[i * 3 + 2]]);
    out.positions.set(q, i * 3);
  }
  if (recon.colors) out.colors = recon.colors.slice();
  out.name = 'Reconstruction (aligned)';
  return { aligned: out, scale: res.scale, T: res.T, rmse: res.finalRmse, fitness: res.fitness, valid: res.fitness > 0.5 && res.finalRmse < 0.08 };
}

export interface DistanceStats { n: number; mean: number; rmse: number; median: number; p95: number; within2: number; within5: number; max: number }

export function nearestDistances(from: PointCloud, to: PointCloud | { positions: Float32Array; count: number }): Float32Array {
  const tree = new KDTree(to.positions, to.count);
  const d = new Float32Array(from.count);
  for (let i = 0; i < from.count; i++) d[i] = Math.sqrt(tree.nearest(from.positions[i * 3], from.positions[i * 3 + 1], from.positions[i * 3 + 2]).dist2);
  return d;
}

export function distanceStats(d: Float32Array): DistanceStats {
  const n = d.length;
  if (!n) return { n: 0, mean: 0, rmse: 0, median: 0, p95: 0, within2: 0, within5: 0, max: 0 };
  const s = Float32Array.from(d).sort();
  let sum = 0, sq = 0, w2 = 0, w5 = 0;
  for (let i = 0; i < n; i++) { sum += d[i]; sq += d[i] * d[i]; if (d[i] <= 0.02) w2++; if (d[i] <= 0.05) w5++; }
  return { n, mean: sum / n, rmse: Math.sqrt(sq / n), median: s[n >> 1], p95: s[Math.floor(n * 0.95)], within2: w2 / n, within5: w5 / n, max: s[n - 1] };
}

/** Compare an aligned reconstruction against (a) the LiDAR cloud and (b) ground-truth surface samples of the true model. */
export function compareReconstruction(object: ReconObjectId, recon: PointCloud, lidar: PointCloud) {
  const gt = sampleSurfaces(reconScene(object), 20000);
  // keep ground-truth samples that belong to the object (instance 2), above the ground plane
  const keep: number[] = [];
  for (let i = 0; i < gt.count; i++) if (gt.obj[i] === 1) keep.push(i);
  const gtPos = new Float32Array(keep.length * 3);
  keep.forEach((k, i) => gtPos.set(gt.pos.subarray(k * 3, k * 3 + 3), i * 3));
  const gtCloud = { positions: gtPos, count: keep.length };
  const reconToLidar = nearestDistances(recon, lidar);
  const lidarToRecon = nearestDistances(lidar, recon);
  const reconToGt = nearestDistances(recon, gtCloud);
  const gtToRecon = nearestDistances({ positions: gtPos, count: keep.length } as PointCloud, recon);
  const gtToLidar = nearestDistances({ positions: gtPos, count: keep.length } as PointCloud, lidar);
  const comp = (d: Float32Array, thr: number) => { let k = 0; for (let i = 0; i < d.length; i++) if (d[i] <= thr) k++; return d.length ? k / d.length : 0; };
  return {
    reconToLidar, lidarToRecon, reconToGt,
    stats: {
      accuracyVsLidar: distanceStats(reconToLidar),
      accuracyVsGroundTruth: distanceStats(reconToGt),
      completenessRecon: comp(gtToRecon, 0.03),
      completenessLidar: comp(gtToLidar, 0.03),
    },
  };
}
void [cyl];
