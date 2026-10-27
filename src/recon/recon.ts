import { PointCloud, makeId, concatClouds } from '../core/pointcloud';
import { makeRng } from '../core/rng';
import { KDTree } from '../core/kdtree';
import { SceneDef, RayScene, newHit, box, cyl, sph, finalize, SceneObject, Primitive } from '../scenes/geometry';
import { chair, crate, table } from '../scenes/rooms';
import { simulateScan, staticPose } from '../sensor/simulate';
import { PRESETS, presetToConfig } from '../sensor/presets';
import { voxelDownsample } from '../processing/ops';
import { icp, applySim } from '../registration/icp';
import { Rigid, Vec3, rigidFromEuler, D2R, norm, cross, sub } from '../core/math';
import { sampleSurfaces } from '../scenes/surface';

export type ReconObjectId = 'chair' | 'crate' | 'desk' | 'living' | 'garden';
export type ReconMethod = 'photogrammetry' | 'rgbd' | 'monocular';

type RGB = [number, number, number];
type Obj = ReturnType<typeof chair> & { pattern?: 'checker' | 'stripes' };
const mat = (color: RGB, reflectivity = 0.45) => ({ mat: { color, reflectivity } });
const part = (id: string, name: string, classId: number, color: RGB, parts: Primitive[], pattern?: 'checker' | 'stripes'): Obj => ({ id, name, classId, parts, color, reflectivity: 0.45, ...(pattern ? { pattern } : {}) });

/** What each simulated scene looks like and how far the cameras and the LiDAR stand from it. */
export interface ReconSceneInfo { label: string; blurb: string; floor: number; floorColor: RGB; radius: number; centerZ: number; elev: number; lidarR: number; lidarZ: number; build: () => Obj[] }

export const RECON_SCENES: Record<ReconObjectId, ReconSceneInfo> = {
  chair: { label: 'Chair', blurb: 'One small object: the simplest case.', floor: 3.2, floorColor: [200, 200, 195], radius: 2.2, centerZ: 0.4, elev: 30, lidarR: 1.9, lidarZ: 1.0,
    build: () => [{ ...chair('chair', 0, 0, 0.35, [175, 105, 60]), name: 'Chair', pattern: 'stripes' }] },
  crate: { label: 'Wooden crate', blurb: 'Flat faces and sharp corners.', floor: 3.2, floorColor: [200, 200, 195], radius: 2.2, centerZ: 0.4, elev: 30, lidarR: 1.9, lidarZ: 1.0,
    build: () => {
      const c = crate('crate', 0, 0, 0.6, 0.5, 0.4, 0.4, [190, 140, 80], 6);
      const lid = box([0, 0, 0.43], [0.66, 0.56, 0.06], 0.4, { mat: { color: [150, 100, 60], reflectivity: 0.5 } });
      const feet = [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]].map(([x, y]) => cyl([x * Math.cos(0.4) - y * Math.sin(0.4), x * Math.sin(0.4) + y * Math.cos(0.4), 0.02], 0.04, 0.04, 'z'));
      return [{ ...c, name: 'Wooden crate', pattern: 'stripes', parts: [...c.parts, lid, ...feet] }];
    } },
  desk: { label: 'Study desk', blurb: 'A desk with a chair, monitor, lamp, books and a plant.', floor: 5, floorColor: [196, 190, 180], radius: 3.1, centerZ: 0.6, elev: 26, lidarR: 2.6, lidarZ: 1.2,
    build: () => [
      { ...table('desk', 0, 0, 1.3, 0.65), pattern: 'stripes' as const },
      chair('chair', 0, -0.8, 0, [66, 120, 200]),
      part('monitor', 'Monitor', 6, [30, 32, 38], [box([0, 0.15, 0.78], [0.1, 0.06, 0.06], 0, mat([60, 60, 66])), box([0, 0.15, 1.08], [0.6, 0.035, 0.36], 0, mat([24, 26, 32], 0.2)), box([0, -0.12, 0.76], [0.42, 0.14, 0.022], 0, mat([200, 200, 205]))]),
      part('lamp', 'Desk lamp', 6, [235, 200, 70], [cyl([-0.5, 0.2, 0.755], 0.07, 0.02), cyl([-0.5, 0.2, 0.95], 0.012, 0.4, 'z'), cyl([-0.5, 0.2, 1.17], 0.1, 0.1, 'z', mat([235, 200, 70], 0.55))]),
      part('books', 'Books', 6, [170, 60, 60], [box([0.5, 0.18, 0.77], [0.22, 0.28, 0.04], 0.2, mat([170, 60, 60])), box([0.5, 0.18, 0.81], [0.2, 0.26, 0.04], -0.1, mat([60, 100, 170])), box([0.5, 0.18, 0.85], [0.18, 0.24, 0.04], 0.3, mat([90, 150, 80]))]),
      part('mug', 'Mug', 6, [240, 240, 240], [cyl([0.28, -0.12, 0.8], 0.04, 0.1, 'z')]),
      part('plant', 'Plant', 3, [60, 140, 70], [cyl([1.0, 0.15, 0.13], 0.13, 0.26, 'z', mat([180, 100, 70])), sph([1.0, 0.15, 0.5], 0.24, mat([60, 140, 70], 0.4)), sph([0.9, 0.05, 0.72], 0.15, mat([70, 155, 80], 0.4))]),
    ] },
  living: { label: 'Living corner', blurb: 'Sofa, shelf, coffee table, floor lamp and a plant.', floor: 6, floorColor: [190, 178, 160], radius: 3.8, centerZ: 0.5, elev: 24, lidarR: 3.2, lidarZ: 1.3,
    build: () => [
      part('sofa', 'Sofa', 5, [95, 120, 150], [box([0, 0.1, 0.22], [1.9, 0.85, 0.3], 0, mat([95, 120, 150])), box([0, 0.45, 0.62], [1.9, 0.18, 0.5], 0, mat([85, 108, 138])), box([-0.97, 0.1, 0.42], [0.16, 0.85, 0.2], 0, mat([85, 108, 138])), box([0.97, 0.1, 0.42], [0.16, 0.85, 0.2], 0, mat([85, 108, 138])), box([-0.45, 0.02, 0.43], [0.8, 0.6, 0.14], 0, mat([110, 136, 166])), box([0.45, 0.02, 0.43], [0.8, 0.6, 0.14], 0, mat([110, 136, 166]))]),
      { ...table('coffee', 0, -1.0, 0.9, 0.5), pattern: 'stripes' as const, parts: table('coffee', 0, -1.0, 0.9, 0.5).parts.map((q) => ({ ...q, c: [q.c[0], q.c[1], q.c[2] * 0.58] as Vec3, size: q.size ? ([q.size[0], q.size[1], q.size[2] * 0.58] as Vec3) : q.size })) },
      part('lamp', 'Floor lamp', 6, [230, 220, 190], [cyl([1.7, 0.4, 0.015], 0.14, 0.03), cyl([1.7, 0.4, 0.75], 0.015, 1.5, 'z', mat([60, 60, 66])), cyl([1.7, 0.4, 1.58], 0.18, 0.3, 'z', mat([230, 220, 190], 0.6))]),
      part('plant', 'Plant', 3, [60, 140, 70], [cyl([-1.6, 0.5, 0.17], 0.17, 0.34, 'z', mat([185, 105, 70])), sph([-1.6, 0.5, 0.7], 0.34, mat([60, 140, 70], 0.4)), sph([-1.5, 0.4, 1.0], 0.22, mat([70, 155, 80], 0.4))]),
      part('shelf', 'Shelf', 4, [150, 105, 65], [box([0, 1.0, 0.5], [1.4, 0.3, 1.0], 0, mat([150, 105, 65])), box([0, 0.84, 0.25], [1.2, 0.02, 0.4], 0, mat([60, 50, 40]))]),
    ] },
  garden: { label: 'Garden bench', blurb: 'A bench next to a tree, with a bush and a stone.', floor: 8, floorColor: [120, 160, 90], radius: 4.6, centerZ: 1.0, elev: 20, lidarR: 4.0, lidarZ: 1.4,
    build: () => [
      part('bench', 'Bench', 4, [150, 100, 60], [0, 1, 2].map((i) => box([0, -0.78 + i * 0.12, 0.45], [1.5, 0.1, 0.04], 0, mat([160, 108, 64]))).concat([0, 1, 2].map((i) => box([0, -0.62 + 0.0, 0.62 + i * 0.1], [1.5, 0.03, 0.08], 0, mat([160, 108, 64]))), [-0.65, 0.65].flatMap((x) => [box([x, -0.78, 0.22], [0.06, 0.4, 0.44], 0, mat([100, 70, 45])), box([x, -0.62, 0.55], [0.06, 0.05, 0.6], 0, mat([100, 70, 45]))])), 'stripes'),
      part('trunk', 'Tree trunk', 3, [110, 80, 55], [cyl([1.2, 0.9, 1.1], 0.14, 2.2, 'z', mat([110, 80, 55], 0.35))]),
      part('canopy', 'Tree canopy', 3, [70, 140, 70], [sph([1.2, 0.9, 2.7], 1.0, { ...mat([70, 140, 70], 0.4), porous: 0.2 }), sph([0.6, 0.6, 2.3], 0.6, { ...mat([80, 150, 75], 0.4), porous: 0.2 }), sph([1.8, 1.2, 2.4], 0.6, { ...mat([65, 130, 65], 0.4), porous: 0.2 })]),
      part('bush', 'Bush', 3, [50, 120, 60], [sph([-1.7, 0.8, 0.35], 0.45, mat([50, 120, 60], 0.4)), sph([-1.35, 0.95, 0.3], 0.35, mat([60, 130, 65], 0.4))]),
      part('stone', 'Stone', 1, [140, 140, 145], [sph([-1.0, -0.1, 0.06], 0.26, mat([140, 140, 145], 0.5))]),
    ] },
};

export function reconScene(id: ReconObjectId): SceneDef {
  const info = RECON_SCENES[id], f = info.floor;
  const floor = { id: 'floor', name: 'Ground plane', classId: 1, structural: true, color: info.floorColor, reflectivity: 0.4, pattern: 'checker' as const, parts: [box([0, 0, -0.025], [f, f, 0.05])] };
  return {
    id: `R-${id}`, name: info.label, description: info.blurb,
    objects: finalize([floor, ...info.build()] as never) as SceneObject[], bounds: { min: [-f / 2, -f / 2, 0], max: [f / 2, f / 2, 3.2] },
    defaultPose: { x: 0, y: 0, z: 0, yaw: 0 }, cameraHome: [info.radius, -info.radius, info.radius * 0.7], cameraTarget: [0, 0, info.centerZ],
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
export interface ReconParams { object: ReconObjectId; method: ReconMethod; views: number; seed: number; /** photos the user took; without them the cameras orbit the scene evenly */ cams?: Camera[] }

/** A camera looking at the middle of a scene from a compass angle, a height angle and a distance. */
export function captureCamera(object: ReconObjectId, azimuthDeg: number, elevDeg: number, distance: number): Camera {
  const info = RECON_SCENES[object], a = azimuthDeg * D2R, e = elevDeg * D2R;
  return { pos: [distance * Math.cos(e) * Math.cos(a), distance * Math.cos(e) * Math.sin(a), info.centerZ + distance * Math.sin(e)] as Vec3, target: [0, 0, info.centerZ], fovDeg: 50 };
}
export interface ReconOutput {
  cloud: PointCloud;
  mesh: { positions: Float32Array; indices: Uint32Array };
  photo: { w: number; h: number; rgb: Uint8ClampedArray };
  photos: { label: string; w: number; h: number; rgb: Uint8ClampedArray }[]; // the scene overview plus every image the method used
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

export function voxelSurfaceMesh(c: PointCloud, vs: number, closing = 0): { positions: Float32Array; indices: Uint32Array } {
  let occ = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  let cells: [number, number, number][] = [];
  for (let i = 0; i < c.count; i++) {
    const x = Math.floor(c.positions[i * 3] / vs), y = Math.floor(c.positions[i * 3 + 1] / vs), z = Math.floor(c.positions[i * 3 + 2] / vs);
    const k = key(x, y, z);
    if (!occ.has(k)) { occ.add(k); cells.push([x, y, z]); }
  }
  // "close gaps": grow the filled cells by `closing` cells, then shrink them back. Small holes stay filled, the outline stays put.
  if (closing > 0) {
    const N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let r = 0; r < closing; r++) { const grown = new Set(occ); for (const [x, y, z] of cells) for (const d of N) grown.add(key(x + d[0], y + d[1], z + d[2])); occ = grown; cells = Array.from(occ).map((k) => k.split(',').map(Number) as [number, number, number]); }
    for (let r = 0; r < closing; r++) { const keep = new Set<string>(); for (const [x, y, z] of cells) if (N.every((d) => occ.has(key(x + d[0], y + d[1], z + d[2])))) keep.add(key(x, y, z)); occ = keep; cells = Array.from(occ).map((k) => k.split(',').map(Number) as [number, number, number]); }
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

/** Surface reconstruction from a point cloud: a blocky voxel surface, or the same surface with welded vertices and Laplacian smoothing. */
export function surfaceMesh(c: PointCloud, o: { method: 'voxel' | 'smooth'; voxel: number; iterations?: number; closing?: number }): { positions: Float32Array; indices: Uint32Array } {
  const m = voxelSurfaceMesh(c, o.voxel, o.closing ?? 0);
  if (o.method === 'voxel') return m;
  // weld duplicate vertices
  const map = new Map<string, number>(), remap = new Uint32Array(m.positions.length / 3), vp: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
    const k = `${Math.round(x / o.voxel * 4)},${Math.round(y / o.voxel * 4)},${Math.round(z / o.voxel * 4)}`;
    let id = map.get(k);
    if (id === undefined) { id = vp.length / 3; map.set(k, id); vp.push(x, y, z); }
    remap[i] = id;
  }
  const idx = Uint32Array.from(m.indices, (i) => remap[i]);
  const n = vp.length / 3, nbr: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; nbr[a].add(b); nbr[b].add(a); }
  // Taubin smoothing: pull every vertex towards the average of its neighbours (λ), then push it back out a little (μ).
  // Plain averaging would shrink the surface until thin parts vanish; the second step cancels the shrinking.
  let cur = Float32Array.from(vp);
  const pass = (k: number) => {
    const next = new Float32Array(cur.length);
    for (let v = 0; v < n; v++) {
      const s = nbr[v];
      if (!s.size) { next.set(cur.subarray(v * 3, v * 3 + 3), v * 3); continue; }
      let x = 0, y = 0, z = 0; for (const u of s) { x += cur[u * 3]; y += cur[u * 3 + 1]; z += cur[u * 3 + 2]; }
      next[v * 3] = cur[v * 3] + k * (x / s.size - cur[v * 3]); next[v * 3 + 1] = cur[v * 3 + 1] + k * (y / s.size - cur[v * 3 + 1]); next[v * 3 + 2] = cur[v * 3 + 2] + k * (z / s.size - cur[v * 3 + 2]);
    }
    cur = next;
  };
  for (let it = 0; it < (o.iterations ?? 6); it++) { pass(0.5); pass(-0.53); }
  return { positions: cur, indices: idx };
}

export function reconstruct(p: ReconParams): ReconOutput {
  const scene = reconScene(p.object);
  const rng = makeRng(p.seed);
  const info = RECON_SCENES[p.object];
  const center: Vec3 = [0, 0, info.centerZ];
  const W = 200, H = 150;
  const notes: string[] = [];
  const k = info.radius / 2.2;
  const photoCam: Camera = p.cams?.[0] ?? { pos: [1.8 * k, -1.6 * k, info.centerZ + 0.7 * k], target: center, fovDeg: 50 };
  const PW = 400, PH = 300;
  const photoView = renderView(scene, photoCam, PW, PH);
  const photo = { w: PW, h: PH, rgb: photoView.rgb };
  const photos: ReconOutput['photos'] = [
    { label: 'Scene overview (wide shot)', w: PW, h: PH, rgb: renderView(scene, { pos: [4.2 * k, -3.8 * k, 2.6 * k], target: [0, 0, info.centerZ + 0.1], fovDeg: 62 }, PW, PH).rgb },
    { label: 'Main photo', ...photo },
  ];

  const pos: number[] = [], col: number[] = [];
  let cams: Camera[];
  if (p.method === 'monocular') {
    cams = [photoCam];
    const v = renderView(scene, photoCam, W, H);
    // Error model of a monocular depth estimator: unknown scale + shift, smooth low-frequency distortion, blur, no back side.
    const a = 1.12, b = -0.12, phase = rng.range(0, 6.28);
    backProject(v, (i, j, z) => a * z + b * k + 0.05 * k * Math.sin(i / 17 + phase) * Math.cos(j / 23 - phase) + 0.004 * rng.gauss(), 1, col, pos);
    notes.push('Error model of a single-image depth estimator (scale/shift ambiguity + smooth distortion). Not a neural network output.');
  } else {
    cams = p.cams && p.cams.length >= 2 ? p.cams : orbitCameras(Math.max(2, p.views), info.radius, p.method === 'rgbd' ? info.elev - 3 : info.elev + 3, center, rng.range(0, 60));
    const pc: PointCloud[] = [];
    cams.forEach((cam, ci) => {
      if (ci < 6) photos.push({ label: `${p.cams?.length ? 'Your' : ''} ${p.method === 'rgbd' ? 'RGB-D frame' : 'photo'} ${ci + 1} of ${cams.length}`.trim().replace(/^./, (c) => c.toUpperCase()), w: PW, h: PH, rgb: renderView(scene, cam, PW, PH).rgb });
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
        return z + 0.007 * (z * 2.2 / info.radius) ** 2 * rng.gauss(); // depth error relative to the working distance
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
  return { cloud, mesh, photo, photos, hiddenTransform: hidden, notes };
}

// ---------------------------------------------------------------- LiDAR reference + comparison
export function scanObject(object: ReconObjectId, seed: number, stations = 2): PointCloud {
  const scene = reconScene(object);
  const cfg = { ...presetToConfig(PRESETS.find((q) => q.id === 'rot64')!), hRes: 0.25, noise: 0.003, vMin: -30, vMax: 30, maxRange: 20 };
  const parts: PointCloud[] = [];
  const angles = [-0.7, 1.3, 3.4, 5.0];
  for (let s = 0; s < stations; s++) {
    const a = angles[s % 4], R = RECON_SCENES[object].lidarR;
    const x = R * Math.cos(a), y = R * Math.sin(a);
    const yaw = Math.atan2(-y, -x);
    const r = simulateScan({ scene, sensor: cfg, trajectory: staticPose(x, y, RECON_SCENES[object].lidarZ, yaw), sweeps: 1, seed: seed + s, maxRays: 120000, distortion: false, scanId: s });
    const keep: number[] = [];
    for (let i = 0; i < r.cloud.count; i++) if (r.cloud.instances![i] >= 2) keep.push(i); // everything but the ground plane (drop the ground plane)
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
  return { aligned: out, scale: res.scale, T: res.T, rmse: res.finalRmse, fitness: res.fitness, valid: res.fitness > 0.5 && res.finalRmse < Math.max(0.08, 0.04 * ext(lidar)) }; // bigger scenes are allowed a proportionally larger residual
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
  for (let i = 0; i < gt.count; i++) if (gt.obj[i] >= 1) keep.push(i);
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
