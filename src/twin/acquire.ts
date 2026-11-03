import { simulateScan, staticPose } from '../sensor/simulate';
import { raysPerSweep, isSteered } from '../sensor/presets';
import { PointCloud, makeId } from '../core/pointcloud';
import { Rigid, Vec3, D2R, clamp, eulerToR, applyR, transposeR, rigidApply } from '../core/math';
import { makeRng, hashSeed } from '../core/rng';
import type { Factory } from './factory';
import { TwinDesign, LidarUnit, lidarItem, sensorFor, isMobile, HW_SEED } from './catalogue';

/** Turning the design into measurements. Everything here is seeded, so the same design in the same scenario gives the same data.
 *  The student-visible survey and the hidden truth are separate objects on purpose: only `visible` is ever given to the pipeline. */

export interface ScanData {
  index: number; unit: string; name: string; mobile: boolean;
  /** points in the world frame, placed using the pose the team RECORDED (installation error or dead-reckoning drift included) */
  cloud: PointCloud;
  /** the same points in the scanner's OWN coordinate system: what the scanner actually delivers */
  local: PointCloud;
  /** the recorded sensor pose (sensor → world) */
  pose: Rigid;
}
export interface Truth {
  /** per measured point (indexed by its provenance id): scene object instance id, class id, and whether it is a floating outlier */
  obj: Int32Array; cls: Int32Array; outlier: Uint8Array;
}
export interface VisibleSurvey { epoch: 'A' | 'B'; scans: ScanData[]; mobileScans: number; stats: { rays: number; points: number; ms: number } }
export interface HiddenSurvey { truth: Truth; truePoses: Rigid[]; epoch: 'A' | 'B' }
export interface Survey { visible: VisibleSurvey; hidden: HiddenSurvey }

const poseR = (yaw: number, pitch: number) => eulerToR(yaw, pitch, 0);
const toRigid = (x: number, y: number, z: number, yaw: number, pitch: number): Rigid => ({ R: poseR(yaw, pitch), t: [x, y, z] });
const inv = (T: Rigid): Rigid => { const Rt = transposeR(T.R), t = applyR(Rt, T.t); return { R: Rt, t: [-t[0], -t[1], -t[2]] }; };

class TruthBuilder {
  obj: number[] = []; cls: number[] = []; out: number[] = [];
  push(o: number, c: number, outlier: number) { this.obj.push(o); this.cls.push(c); this.out.push(outlier); return this.obj.length - 1; }
  build(): Truth { return { obj: Int32Array.from(this.obj), cls: Int32Array.from(this.cls), outlier: Uint8Array.from(this.out) }; }
}

/** How many rays one scan may use. Spinning heads are limited by their angle step (finer step, more rays) and by how long the scan may run. */
export function raysFor(u: LidarUnit): number {
  const it = lidarItem(u.item), s = sensorFor(u);
  if (isSteered(s.pattern)) return Math.round(it.maxRays * (u.res === 'coarse' ? 0.5 : u.res === 'fine' ? 1.5 : 1));
  return Math.min(it.maxRays, raysPerSweep(s));
}

/** One scan from one pose: ray casting, then the imperfections of a real head. Returns the cloud in the sensor frame, with provenance. */
function scanFrom(f: Factory, u: LidarUnit, pose: { x: number; y: number; z: number; yaw: number; pitch: number }, rays: number, seed: number, idx: number, tb: TruthBuilder, moving?: { to: { x: number; y: number }; distort: boolean }): PointCloud {
  const sensor = sensorFor(u), it = lidarItem(u.item), rng = makeRng(seed);
  const traj = moving
    ? [{ t: 0, ...pose, roll: 0 }, { t: 1 / Math.max(1e-6, sensor.frequency), x: moving.to.x, y: moving.to.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, roll: 0 }]
    : staticPose(pose.x, pose.y, pose.z, pose.yaw, pose.pitch);
  const r = simulateScan({ scene: f.scene, sensor, trajectory: traj, sweeps: 1, seed, maxRays: rays, distortion: !!moving?.distort, scanId: idx, name: `Scan ${idx + 1}` });
  const c = r.cloud, T = toRigid(pose.x, pose.y, pose.z, pose.yaw, pose.pitch), Ti = inv(T);
  const keep: number[] = [], isOut: number[] = [];
  const pos = new Float32Array(c.count * 3);
  for (let i = 0; i < c.count; i++) {
    const I = c.intensity![i], range = c.ranges![i];
    // returns from dark surfaces and long ranges are the first to be lost
    const pDrop = it.dropout * (1 + 2 * (1 - Math.min(1, 4 * I))) * (1 + range / sensor.maxRange);
    if (rng.next() < pDrop) continue;
    let p: Vec3 = [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]], out = 0;
    if (rng.next() < it.outliers) { // a floating point: the beam "returned" from somewhere in front of the surface (dust, a mixed pixel)
      const k = rng.range(0.25, 0.95), o: Vec3 = [pose.x, pose.y, pose.z];
      p = [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k, o[2] + (p[2] - o[2]) * k]; out = 1;
    }
    const q = rigidApply(Ti, p); // sensor frame
    pos[keep.length * 3] = q[0]; pos[keep.length * 3 + 1] = q[1]; pos[keep.length * 3 + 2] = q[2];
    keep.push(i); isOut.push(out);
  }
  const n = keep.length, prov = new Int32Array(n), inten = new Float32Array(n), ranges = new Float32Array(n), scanIds = new Uint16Array(n);
  keep.forEach((i, k) => {
    prov[k] = tb.push(c.instances![i], c.labels![i], isOut[k]);
    inten[k] = c.intensity![i]; ranges[k] = Math.hypot(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); scanIds[k] = idx;
  });
  return {
    id: makeId('twin'), name: `Scan ${idx + 1}`, count: n, positions: pos.slice(0, n * 3), intensity: inten, ranges, scanIds, instances: prov,
    meta: { kind: 'simulated', source: `${it.name}`, units: 'm', sensor: it.name, seed, description: 'Team measurement in the sensor frame. `instances` holds a provenance index, not an object id.', coordinateFrame: 'Sensor' },
  };
}

const compose2 = (a: { x: number; y: number; yaw: number }, d: { x: number; y: number; yaw: number }) => ({ x: a.x + Math.cos(a.yaw) * d.x - Math.sin(a.yaw) * d.y, y: a.y + Math.sin(a.yaw) * d.x + Math.cos(a.yaw) * d.y, yaw: a.yaw + d.yaw });
const inv2 = (a: { x: number; y: number; yaw: number }) => ({ x: -(Math.cos(a.yaw) * a.x + Math.sin(a.yaw) * a.y), y: -(-Math.sin(a.yaw) * a.x + Math.cos(a.yaw) * a.y), yaw: -a.yaw });

/** Poses of the mobile platform along the route: equal steps along the drawn polyline, heading along the path. */
export function routePoses(route: [number, number][], steps: number, z: number): { x: number; y: number; z: number; yaw: number }[] {
  const pts = route.length >= 2 ? route : [[-9, -0.3], [9, -0.3]] as [number, number][];
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1] || 1, out: { x: number; y: number; z: number; yaw: number }[] = [], n = Math.max(2, steps);
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * total; let i = 1; while (i < pts.length - 1 && L[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = (L[i] - L[i - 1]) || 1, fr = clamp((s - L[i - 1]) / seg, 0, 1);
    out.push({ x: a[0] + (b[0] - a[0]) * fr, y: a[1] + (b[1] - a[1]) * fr, z, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return out;
}

/** The whole LiDAR survey for one epoch. Stationary units: recorded pose = true pose + a small installation error. Mobile unit: poses from dead reckoning, which drifts. */
export function acquireSurvey(f: Factory, d: TwinDesign, scenarioSeed: number): Survey {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tb = new TruthBuilder(), scans: ScanData[] = [], truePoses: Rigid[] = [];
  let rays = 0, mobileScans = 0, idx = 0;
  d.lidars.forEach((u, ui) => {
    const seed = hashSeed('lidar', scenarioSeed, ui, f.epoch === 'A' ? 0 : 1);
    if (!isMobile(u)) {
      const er = makeRng(hashSeed('install', HW_SEED, ui)); // the installation error belongs to the unit, not to the scenario: it is the same in A, B and the final variants
      const rec = { x: u.x + 0.02 * er.gauss(), y: u.y + 0.02 * er.gauss(), z: u.z + 0.01 * er.gauss(), yaw: u.yaw + 0.25 * D2R * er.gauss(), pitch: u.pitch + 0.15 * D2R * er.gauss() };
      const n = raysFor(u); rays += n;
      const local = scanFrom(f, u, u, n, seed, idx, tb), Trec = toRigid(rec.x, rec.y, rec.z, rec.yaw, rec.pitch);
      scans.push({ index: idx, unit: u.id, name: `LiDAR ${ui + 1}`, mobile: false, cloud: place(local, Trec), local, pose: Trec });
      truePoses.push(toRigid(u.x, u.y, u.z, u.yaw, u.pitch)); idx++;
      return;
    }
    // mobile: the platform drives the route; every step is a scan, and the pose of each step is only known by dead reckoning
    const poses = routePoses(d.route, d.routeSteps, u.z), er = makeRng(hashSeed('odom', scenarioSeed, ui));
    let est = { x: poses[0].x, y: poses[0].y, yaw: poses[0].yaw };
    const n = raysFor(u);
    poses.forEach((p, k) => {
      if (k > 0) {
        const rel = compose2(inv2(poses[k - 1]), p), s = 1.015; // true motion, in the previous frame
        est = compose2(est, { x: rel.x * s + 0.012 * er.gauss(), y: rel.y * s + 0.012 * er.gauss(), yaw: rel.yaw + (0.15 + 0.2 * er.gauss()) * D2R });
      }
      const next = poses[Math.min(k + 1, poses.length - 1)], sp = Math.hypot(next.x - p.x, next.y - p.y);
      const mv = d.distortion && sp > 0 ? { to: { x: p.x + Math.cos(p.yaw) * Math.min(0.12, sp), y: p.y + Math.sin(p.yaw) * Math.min(0.12, sp) }, distort: true } : undefined;
      rays += n;
      const local = scanFrom(f, u, { ...p, pitch: 0 }, n, hashSeed('mob', seed, k), idx, tb, mv), Trec = toRigid(est.x, est.y, p.z, est.yaw, 0);
      scans.push({ index: idx, unit: u.id, name: `Mobile ${k + 1}`, mobile: true, cloud: place(local, Trec), local, pose: Trec });
      truePoses.push(toRigid(p.x, p.y, p.z, p.yaw, 0)); idx++; mobileScans++;
    });
  });
  const points = scans.reduce((a, s) => a + s.cloud.count, 0);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { visible: { epoch: f.epoch, scans, mobileScans, stats: { rays, points, ms: t1 - t0 } }, hidden: { truth: tb.build(), truePoses, epoch: f.epoch } };
}

/** Move a sensor-frame cloud to the world with a pose; provenance and all other attributes ride along. */
export function place(c: PointCloud, T: Rigid): PointCloud {
  const p = new Float32Array(c.count * 3);
  for (let i = 0; i < c.count; i++) { const q = rigidApply(T, [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]]); p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; }
  return { ...c, id: makeId('twin'), positions: p, meta: { ...c.meta, coordinateFrame: 'World (recorded pose)' } };
}
