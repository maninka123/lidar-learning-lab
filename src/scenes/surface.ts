import { SceneDef, Primitive, RayScene, newHit } from './geometry';
import { KDTree } from '../core/kdtree';
import { SensorConfig } from '../sensor/presets';

export interface SurfaceSamples {
  count: number;
  pos: Float32Array;
  normal: Float32Array;
  obj: Int32Array;
  area: Float32Array; // m² represented by each sample
}

function inside(p: Primitive, x: number, y: number, z: number): boolean {
  const rx = x - p.c[0], ry = y - p.c[1], rz = z - p.c[2];
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const lx = c * rx + s * ry, ly = -s * rx + c * ry, lz = rz;
  if (p.kind === 'box') return Math.abs(lx) <= p.size![0] / 2 && Math.abs(ly) <= p.size![1] / 2 && Math.abs(lz) <= p.size![2] / 2;
  if (p.kind === 'sphere') return lx * lx + ly * ly + lz * lz <= p.r! * p.r!;
  const [a, b, w] = p.axis === 'x' ? [ly, lz, lx] : p.axis === 'y' ? [lz, lx, ly] : [lx, ly, lz];
  return a * a + b * b <= p.r! * p.r! && Math.abs(w) <= p.h! / 2;
}

/** Uniform samples on every scannable surface that a sensor inside `scene.bounds` could possibly see. */
export function sampleSurfaces(scene: SceneDef, targetCount = 30000): SurfaceSamples {
  // estimate total area for spacing
  const prims: { p: Primitive; obj: number }[] = [];
  scene.objects.forEach((o, oi) => { if (o.scannable) o.parts.forEach((p) => prims.push({ p, obj: oi })); });
  let area = 0;
  for (const { p } of prims) {
    if (p.kind === 'box') { const [a, b, c] = p.size!; area += 2 * (a * b + b * c + a * c); }
    else if (p.kind === 'sphere') area += 4 * Math.PI * p.r! ** 2;
    else area += 2 * Math.PI * p.r! * p.h! + 2 * Math.PI * p.r! ** 2;
  }
  const spacing = Math.max(0.06, Math.sqrt(area / (targetCount * 3.2)));
  const P: number[] = [], N: number[] = [], O: number[] = [], A: number[] = [];
  const { min, max } = scene.bounds;
  const eps = 0.03;

  const push = (p: Primitive, obj: number, lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, a: number) => {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const wx = p.c[0] + c * lx - s * ly, wy = p.c[1] + s * lx + c * ly, wz = p.c[2] + lz;
    const wnx = c * nx - s * ny, wny = s * nx + c * ny, wnz = nz;
    const qx = wx + wnx * eps, qy = wy + wny * eps, qz = wz + wnz * eps;
    if (qx < min[0] || qx > max[0] || qy < min[1] || qy > max[1] || qz < min[2] || qz > max[2]) return;
    for (const o of prims) if (o.p !== p && inside(o.p, qx, qy, qz)) return;
    P.push(wx, wy, wz); N.push(wnx, wny, wnz); O.push(obj); A.push(a);
  };

  for (const { p, obj } of prims) {
    if (p.kind === 'box') {
      const [sx, sy, sz] = p.size!;
      const face = (u: number, v: number, fn: (a: number, b: number) => void) => {
        const nu = Math.max(1, Math.round(u / spacing)), nv = Math.max(1, Math.round(v / spacing));
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) fn(((i + 0.5) / nu - 0.5) * u, ((j + 0.5) / nv - 0.5) * v);
      };
      const da = (u: number, v: number) => (u * v) / (Math.max(1, Math.round(u / spacing)) * Math.max(1, Math.round(v / spacing)));
      face(sy, sz, (a, b) => { push(p, obj, sx / 2, a, b, 1, 0, 0, da(sy, sz)); push(p, obj, -sx / 2, a, b, -1, 0, 0, da(sy, sz)); });
      face(sx, sz, (a, b) => { push(p, obj, a, sy / 2, b, 0, 1, 0, da(sx, sz)); push(p, obj, a, -sy / 2, b, 0, -1, 0, da(sx, sz)); });
      face(sx, sy, (a, b) => { push(p, obj, a, b, sz / 2, 0, 0, 1, da(sx, sy)); push(p, obj, a, b, -sz / 2, 0, 0, -1, da(sx, sy)); });
    } else if (p.kind === 'sphere') {
      const r = p.r!, nPts = Math.max(12, Math.round((4 * Math.PI * r * r) / (spacing * spacing)));
      const a = (4 * Math.PI * r * r) / nPts;
      for (let i = 0; i < nPts; i++) {
        const z = 1 - (2 * (i + 0.5)) / nPts, rr = Math.sqrt(1 - z * z), th = i * 2.399963;
        push(p, obj, r * rr * Math.cos(th), r * rr * Math.sin(th), r * z, rr * Math.cos(th), rr * Math.sin(th), z, a);
      }
    } else {
      const r = p.r!, h = p.h!;
      const nA = Math.max(8, Math.round((2 * Math.PI * r) / spacing)), nH = Math.max(1, Math.round(h / spacing));
      const a = (2 * Math.PI * r * h) / (nA * nH);
      // build in axis frame (u0,u1,w) then map to local
      const toLocal = (u0: number, u1: number, w: number): [number, number, number] => (p.axis === 'x' ? [w, u0, u1] : p.axis === 'y' ? [u1, w, u0] : [u0, u1, w]);
      for (let i = 0; i < nA; i++) for (let j = 0; j < nH; j++) {
        const th = (i + 0.5) * ((2 * Math.PI) / nA), w = ((j + 0.5) / nH - 0.5) * h;
        const l = toLocal(r * Math.cos(th), r * Math.sin(th), w), n = toLocal(Math.cos(th), Math.sin(th), 0);
        push(p, obj, l[0], l[1], l[2], n[0], n[1], n[2], a);
      }
      const nR = Math.max(1, Math.round(r / spacing));
      for (let ir = 0; ir < nR; ir++) {
        const rr = ((ir + 0.5) / nR) * r, cnt = Math.max(4, Math.round((2 * Math.PI * rr) / spacing)), ca = (Math.PI * r * r) / (nR * cnt) * (2 * (ir + 0.5) / nR);
        for (let k = 0; k < cnt; k++) for (const sg of [-1, 1]) {
          const th = (k + 0.5) * ((2 * Math.PI) / cnt);
          const l = toLocal(rr * Math.cos(th), rr * Math.sin(th), (sg * h) / 2), n = toLocal(0, 0, sg);
          push(p, obj, l[0], l[1], l[2], n[0], n[1], n[2], ca);
        }
      }
    }
  }
  return { count: O.length, pos: Float32Array.from(P), normal: Float32Array.from(N), obj: Int32Array.from(O), area: Float32Array.from(A) };
}

/** Which surface samples have at least one measured point within `radius`? */
export function coveredMask(samples: SurfaceSamples, pts: Float32Array, nPts: number, radius: number): Uint8Array {
  const mask = new Uint8Array(samples.count);
  if (nPts === 0) return mask;
  const tree = new KDTree(pts, nPts);
  const r2 = radius * radius;
  for (let i = 0; i < samples.count; i++) {
    if (tree.nearest(samples.pos[i * 3], samples.pos[i * 3 + 1], samples.pos[i * 3 + 2], r2).index >= 0) mask[i] = 1;
  }
  return mask;
}

export interface VisibilityStats {
  total: number;
  covered: number;
  undersampled: number; // visible, in FOV and range, but no measurement nearby
  occluded: number; // blocked by other geometry or facing away
  outOfFov: number;
  outOfRange: number;
  coveredPct: number;
  areas: { total: number; covered: number; occluded: number };
}

/** Classify every surface sample from a single sensor pose (used by the Tab 1 comparison). */
export function singleStationVisibility(scene: SceneDef, samples: SurfaceSamples, covered: Uint8Array, pose: { x: number; y: number; z: number; yaw: number }, sensor: SensorConfig): VisibilityStats {
  const rs = new RayScene(scene);
  const hit = newHit();
  const st: VisibilityStats = { total: samples.count, covered: 0, undersampled: 0, occluded: 0, outOfFov: 0, outOfRange: 0, coveredPct: 0, areas: { total: 0, covered: 0, occluded: 0 } };
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  for (let i = 0; i < samples.count; i++) {
    const dx = samples.pos[i * 3] - pose.x, dy = samples.pos[i * 3 + 1] - pose.y, dz = samples.pos[i * 3 + 2] - pose.z;
    const d = Math.hypot(dx, dy, dz);
    const a = samples.area[i];
    st.areas.total += a;
    const facing = -(dx * samples.normal[i * 3] + dy * samples.normal[i * 3 + 1] + dz * samples.normal[i * 3 + 2]);
    let occ = facing <= 0;
    if (!occ && d > 1e-6) occ = rs.cast(pose.x, pose.y, pose.z, dx / d, dy / d, dz / d, 0.01, d - 0.06, hit);
    if (occ) { st.occluded++; st.areas.occluded += a; continue; }
    if (d > sensor.maxRange || d < sensor.minRange) { st.outOfRange++; continue; }
    const lx = cy * dx + sy * dy, ly = -sy * dx + cy * dy;
    const az = Math.atan2(ly, lx) * (180 / Math.PI), el = Math.atan2(dz, Math.hypot(lx, ly)) * (180 / Math.PI);
    const elTol = sensor.channels > 1 ? (sensor.vMax - sensor.vMin) / (sensor.channels - 1) / 2 : 0.5;
    if ((sensor.hFov < 360 && Math.abs(az) > sensor.hFov / 2) || el < sensor.vMin - elTol || el > sensor.vMax + elTol) { st.outOfFov++; continue; }
    if (covered[i]) { st.covered++; st.areas.covered += a; } else st.undersampled++;
  }
  st.coveredPct = st.total ? (100 * st.covered) / st.total : 0;
  return st;
}
