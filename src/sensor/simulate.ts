import { D2R, eulerToR, Vec3 } from '../core/math';
import { makeRng } from '../core/rng';
import { PointCloud, makeId } from '../core/pointcloud';
import { RayScene, SceneDef, newHit } from '../scenes/geometry';
import { SensorConfig, raysPerSweep } from './presets';

export interface PoseSample { t: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number }

export interface ScanRequest {
  scene: SceneDef;
  sensor: SensorConfig;
  trajectory: PoseSample[]; // single sample => static station
  sweeps: number; // number of full sweeps to emit
  seed: number;
  maxRays: number; // point budget
  distortion: boolean; // assign one pose per sweep (shows motion distortion)
  scanId: number;
  wantViz?: boolean;
  name?: string;
  t0?: number;
}

export interface ScanResult {
  cloud: PointCloud;
  stats: { rays: number; hits: number; misses: number; sweeps: number; raysPerSweep: number; reduced: boolean; effectiveHRes: number; ms: number };
  viz?: { origin: Vec3; ends: Float32Array; hit: Uint8Array };
}

export function poseAt(traj: PoseSample[], t: number): PoseSample {
  if (traj.length === 1 || t <= traj[0].t) return traj[0];
  const last = traj[traj.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = traj.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (traj[m].t <= t) lo = m; else hi = m; }
  const a = traj[lo], b = traj[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, yaw: a.yaw + dy * f, pitch: a.pitch + (b.pitch - a.pitch) * f, roll: a.roll + (b.roll - a.roll) * f };
}

/** Beam directions (azimuth, elevation in radians, sensor frame, x forward / z up) for one sweep, in firing order. */
export function sweepDirections(s: SensorConfig, sweep: number, colStride = 1): { az: Float32Array; el: Float32Array; n: number } {
  const ch = Math.max(1, s.channels);
  const full = s.hFov >= 360;
  const stepDeg = s.hRes * colStride;
  const cols = Math.max(1, full ? Math.round(s.hFov / stepDeg) : Math.floor(s.hFov / stepDeg) + 1);
  const elAt = (c: number) => (ch === 1 ? (s.vMin + s.vMax) / 2 : s.vMin + ((s.vMax - s.vMin) * c) / (ch - 1));
  if (s.pattern === 'solidstate') {
    const n = Math.max(1, Math.round((cols * ch)));
    const az = new Float32Array(n), el = new Float32Array(n);
    const a = Math.sqrt(n) * 0.5, b = a * 1.6180339887;
    const phi = sweep * 2.399963, psi = sweep * 1.311;
    const mid = (s.vMin + s.vMax) / 2, hv = (s.vMax - s.vMin) / 2;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      az[k] = (s.hFov / 2) * Math.sin(2 * Math.PI * a * u + phi) * D2R;
      el[k] = (mid + hv * Math.sin(2 * Math.PI * b * u + psi)) * D2R;
    }
    return { az, el, n };
  }
  const n = cols * ch;
  const az = new Float32Array(n), el = new Float32Array(n);
  let k = 0;
  for (let j = 0; j < cols; j++) {
    const a = (full ? -s.hFov / 2 + j * stepDeg : -s.hFov / 2 + j * stepDeg) * D2R;
    for (let c = 0; c < ch; c++) {
      let e = elAt(c);
      if (s.pattern === 'hybrid') {
        const mid = (s.vMin + s.vMax) / 2, span = (s.vMax - s.vMin);
        e = mid + (e - mid) * 0.55 + span * 0.22 * Math.sin((2 * Math.PI * j) / Math.max(8, cols / 6));
      }
      az[k] = a; el[k] = e * D2R; k++;
    }
  }
  return { az, el, n };
}

function pattern(obj: { pattern?: string }, x: number, y: number): number {
  if (obj.pattern === 'checker') return (Math.floor(x) + Math.floor(y)) & 1 ? 0.86 : 1;
  if (obj.pattern === 'stripes') return Math.abs(y) < 0.1 || (Math.abs(y) < 3.4 && Math.abs(y) > 3.3) ? 1.9 : 1;
  return 1;
}

const LIGHT: Vec3 = [0.32, 0.22, 0.92];

export function simulateScan(req: ScanRequest): ScanResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { scene, sensor, trajectory } = req;
  const rs = new RayScene(scene);
  const rng = makeRng(req.seed);
  const perSweepFull = raysPerSweep(sensor);
  const totalFull = perSweepFull * req.sweeps;
  const colStride = sensor.pattern === 'solidstate' ? 1 : Math.max(1, Math.ceil(totalFull / req.maxRays));
  let streamLimit = req.maxRays;
  const dirsFirst = sweepDirections(sensor, 0, colStride);
  const perSweep = sensor.pattern === 'solidstate' ? Math.min(dirsFirst.n, Math.max(1, Math.floor(streamLimit / req.sweeps))) : dirsFirst.n;
  const reduced = colStride > 1 || perSweep < dirsFirst.n;
  const totalRays = perSweep * req.sweeps;
  streamLimit = totalRays * sensor.returns;

  const pos = new Float32Array(streamLimit * 3);
  const col = new Uint8Array(streamLimit * 3);
  const inten = new Float32Array(streamLimit);
  const rng_ = new Float32Array(streamLimit);
  const labels = new Int32Array(streamLimit);
  const inst = new Int32Array(streamLimit);
  const nrm = new Float32Array(streamLimit * 3);
  const times = new Float32Array(streamLimit);
  const scanIds = new Uint16Array(streamLimit);

  const hit = newHit();
  const T0 = req.t0 ?? trajectory[0].t;
  const sweepDur = 1 / Math.max(1e-6, sensor.frequency);
  const r0 = Math.max(1, 0.35 * sensor.maxRange);
  const vizStride = Math.max(1, Math.floor(perSweep / 600));
  const vizEnds: number[] = [];
  const vizHit: number[] = [];
  let m = 0, misses = 0;
  const static_ = trajectory.length === 1;

  for (let sw = 0; sw < req.sweeps; sw++) {
    const dirs = sensor.pattern === 'solidstate' ? sweepDirections(sensor, sw, 1) : dirsFirst;
    const startPose = poseAt(trajectory, T0 + sw * sweepDur);
    const startR = eulerToR(startPose.yaw, startPose.pitch, startPose.roll);
    for (let k = 0; k < perSweep; k++) {
      const t = T0 + sw * sweepDur + (k / perSweep) * sweepDur;
      const pose = static_ ? trajectory[0] : poseAt(trajectory, t);
      const R = static_ ? startR : eulerToR(pose.yaw, pose.pitch, pose.roll);
      const ce = Math.cos(dirs.el[k]), se = Math.sin(dirs.el[k]);
      const sx = ce * Math.cos(dirs.az[k]), sy = ce * Math.sin(dirs.az[k]), sz = se;
      const dx = R[0] * sx + R[1] * sy + R[2] * sz, dy = R[3] * sx + R[4] * sy + R[5] * sz, dz = R[6] * sx + R[7] * sy + R[8] * sz;
      let tmin = sensor.minRange;
      let produced = 0;
      for (let ret = 0; ret < sensor.returns; ret++) {
        if (!rs.cast(pose.x, pose.y, pose.z, dx, dy, dz, tmin, sensor.maxRange, hit)) break;
        const o = scene.objects[hit.obj];
        const part = o.parts[hit.part];
        const mat = part.mat ?? { color: o.color, reflectivity: o.reflectivity };
        const rho = sensor.reflectivityOverride ?? mat.reflectivity;
        const detect = sensor.maxRange * Math.min(1, Math.sqrt(Math.max(rho, 1e-3) / 0.8));
        if (hit.t > detect) break;
        // Range measurement with Gaussian noise, expressed in the sensor frame
        const rMeas = Math.max(0, hit.t + sensor.noise * rng.gauss());
        const refR = req.distortion ? startR : R;
        const refP = req.distortion ? startPose : pose;
        const wx = refP.x + (refR[0] * sx + refR[1] * sy + refR[2] * sz) * rMeas;
        const wy = refP.y + (refR[3] * sx + refR[4] * sy + refR[5] * sz) * rMeas;
        const wz = refP.z + (refR[6] * sx + refR[7] * sy + refR[8] * sz) * rMeas;
        // normal facing the sensor
        let nx = hit.nx, ny = hit.ny, nz = hit.nz;
        let cosT = -(nx * dx + ny * dy + nz * dz);
        if (cosT < 0) { nx = -nx; ny = -ny; nz = -nz; cosT = -cosT; }
        // Simplified educational intensity model: rho * cos(theta) / (1 + (r/r0)^2)
        const I = Math.min(1, Math.max(0, (rho * cosT) / (1 + (hit.t / r0) ** 2) + 0.01 * rng.gauss()));
        const shade = 0.55 + 0.45 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const pm = pattern(o, wx, wy);
        pos[m * 3] = wx; pos[m * 3 + 1] = wy; pos[m * 3 + 2] = wz;
        col[m * 3] = Math.min(255, mat.color[0] * shade * pm);
        col[m * 3 + 1] = Math.min(255, mat.color[1] * shade * pm);
        col[m * 3 + 2] = Math.min(255, mat.color[2] * shade * pm);
        inten[m] = I; rng_[m] = rMeas; labels[m] = o.classId; inst[m] = o.instanceId;
        nrm[m * 3] = nx; nrm[m * 3 + 1] = ny; nrm[m * 3 + 2] = nz;
        times[m] = t - T0; scanIds[m] = static_ ? req.scanId : Math.min(65535, sw);
        m++; produced++;
        if (sw === 0 && ret === 0 && k % vizStride === 0 && req.wantViz) { vizEnds.push(wx, wy, wz); vizHit.push(1); }
        if (part.porous && ret + 1 < sensor.returns && rng.next() < part.porous) { tmin = hit.t + 0.02; continue; }
        break;
      }
      if (produced === 0) {
        misses++;
        if (sw === 0 && k % vizStride === 0 && req.wantViz) {
          vizEnds.push(pose.x + dx * sensor.maxRange, pose.y + dy * sensor.maxRange, pose.z + dz * sensor.maxRange); vizHit.push(0);
        }
      }
    }
  }

  const cloud: PointCloud = {
    id: makeId('scan'),
    name: req.name ?? 'Simulated scan',
    count: m,
    positions: pos.slice(0, m * 3),
    colors: col.slice(0, m * 3),
    intensity: inten.slice(0, m),
    ranges: rng_.slice(0, m),
    labels: labels.slice(0, m),
    instances: inst.slice(0, m),
    normals: nrm.slice(0, m * 3),
    times: times.slice(0, m),
    scanIds: scanIds.slice(0, m),
    meta: {
      kind: 'simulated', source: 'Ray-cast LiDAR simulator', units: 'm', sensor: sensor.name, sceneId: scene.id, seed: req.seed,
      description: 'Synthetic measurement. Intensity is a simplified educational model (reflectivity × cosθ ÷ range falloff), not a calibrated return.',
      coordinateFrame: 'World, metres, Z-up, right-handed', labelSource: 'ground-truth', normalsSource: 'ground-truth', createdAt: Date.now(),
    },
  };
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const p0 = trajectory[0];
  return {
    cloud,
    stats: { rays: totalRays, hits: m, misses, sweeps: req.sweeps, raysPerSweep: perSweep, reduced, effectiveHRes: sensor.hRes * colStride, ms: t1 - t0 },
    viz: req.wantViz ? { origin: [p0.x, p0.y, p0.z], ends: new Float32Array(vizEnds), hit: new Uint8Array(vizHit) } : undefined,
  };
}

export const staticPose = (x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0): PoseSample[] => [{ t: 0, x, y, z, yaw, pitch, roll }];
