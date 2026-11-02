import { RayScene, SceneDef, newHit } from '../scenes/geometry';
import { sampleSurfaces, SurfaceSamples } from '../scenes/surface';
import { getPreset, presetToConfig, SensorConfig } from '../sensor/presets';
import { eulerToR, transposeR, applyR, D2R } from '../core/math';

/** One scanner the student has placed. Angles in radians, lengths in metres. */
export interface Scanner { id: number; x: number; y: number; z: number; yaw: number; pitch: number; preset: string }

/** What a surface sample looks like from one scanner. Order = how close it is to being measured. */
export const SEEN = 0, HIDDEN = 1, OUT_FOV = 2, OUT_RANGE = 3;
export type Status = 0 | 1 | 2 | 3;

export const MAX_SCANNERS = 4;
export const STATION_COLOURS = ['#e63946', '#1d78dc', '#28aa5a', '#f4a21e'];
export const sensorOf = (preset: string): SensorConfig => presetToConfig(getPreset(preset));

/** Surface samples are expensive to build and never change for a scene: build once. */
const sampleCache = new Map<string, SurfaceSamples>();
export function samplesFor(scene: SceneDef, count = 9000): SurfaceSamples {
  const key = `${scene.id}:${count}`;
  let s = sampleCache.get(key);
  if (!s) { s = sampleSurfaces(scene, count); sampleCache.set(key, s); }
  return s;
}
const rayCache = new WeakMap<SceneDef, RayScene>();
export const raySceneFor = (scene: SceneDef): RayScene => { let r = rayCache.get(scene); if (!r) { r = new RayScene(scene); rayCache.set(scene, r); } return r; };

/** Where is a world point as seen by the scanner: azimuth / elevation (deg) in the scanner's own frame, and the distance. */
export function toSensorAngles(sc: Pick<Scanner, 'x' | 'y' | 'z' | 'yaw' | 'pitch'>, px: number, py: number, pz: number) {
  const Rt = transposeR(eulerToR(sc.yaw, sc.pitch, 0)), l = applyR(Rt, [px - sc.x, py - sc.y, pz - sc.z]);
  const flat = Math.hypot(l[0], l[1]);
  return { az: Math.atan2(l[1], l[0]) / D2R, el: Math.atan2(l[2], flat) / D2R, dist: Math.hypot(l[0], l[1], l[2]) };
}
/** Is a direction inside the sensor's field of view? A beam spacing tolerance keeps the lowest and highest beams in. */
export function inFov(sensor: SensorConfig, az: number, el: number): boolean {
  const tol = sensor.channels > 1 ? (sensor.vMax - sensor.vMin) / (sensor.channels - 1) / 2 : 0.5;
  if (sensor.hFov < 359.5 && Math.abs(az) > sensor.hFov / 2) return false;
  return el >= sensor.vMin - tol && el <= sensor.vMax + tol;
}

/**
 * Geometric visibility of every surface sample from one scanner, cheapest test first:
 * range → field of view → facing → line of sight (one ray against all geometry, using the same ray caster as the scanner simulation).
 */
export function visibilityStatus(scene: SceneDef, samples: SurfaceSamples, sc: Scanner, sensor: SensorConfig = sensorOf(sc.preset)): Uint8Array {
  const rs = raySceneFor(scene), hit = newHit(), out = new Uint8Array(samples.count);
  for (let i = 0; i < samples.count; i++) {
    const px = samples.pos[i * 3], py = samples.pos[i * 3 + 1], pz = samples.pos[i * 3 + 2];
    const dx = px - sc.x, dy = py - sc.y, dz = pz - sc.z, d = Math.hypot(dx, dy, dz);
    if (d > sensor.maxRange || d < sensor.minRange) { out[i] = OUT_RANGE; continue; }
    const a = toSensorAngles(sc, px, py, pz);
    if (!inFov(sensor, a.az, a.el)) { out[i] = OUT_FOV; continue; }
    const facing = -(dx * samples.normal[i * 3] + dy * samples.normal[i * 3 + 1] + dz * samples.normal[i * 3 + 2]);
    if (facing <= 0 || rs.cast(sc.x, sc.y, sc.z, dx / d, dy / d, dz / d, 0.01, d - 0.06, hit)) { out[i] = HIDDEN; continue; }
    out[i] = SEEN;
  }
  return out;
}

export interface CoverageStats {
  scanners: number;
  samples: number;
  /** share of surface AREA observed by at least one scanner (0..1) */
  coverage: number;
  /** share observed by two or more scanners */
  overlap: number;
  unobserved: number;
  /** per scanner: share seen, and share seen by this scanner only */
  perScanner: { seen: number; unique: number }[];
  /** among unobserved surface: the best reason any scanner has for not seeing it */
  why: { hidden: number; outFov: number; outRange: number };
  /** how many scanners see each sample */
  times: Uint8Array;
}

/** Combine per-scanner status arrays. Area-weighted, so a big wall counts for more than a table leg. */
export function coverageStats(samples: SurfaceSamples, status: Uint8Array[]): CoverageStats {
  const n = samples.count, times = new Uint8Array(n);
  let total = 0, cov = 0, ov = 0;
  const seen = status.map(() => 0), uniq = status.map(() => 0), why = { hidden: 0, outFov: 0, outRange: 0 };
  for (let i = 0; i < n; i++) {
    const a = samples.area[i]; total += a;
    let k = 0, last = -1, best = OUT_RANGE as number;
    status.forEach((s, j) => { if (s[i] === SEEN) { k++; last = j; seen[j] += a; } if (s[i] < best) best = s[i]; });
    times[i] = k;
    if (k >= 1) cov += a; if (k >= 2) ov += a; if (k === 1) uniq[last] += a;
    if (k === 0 && status.length) { if (best === HIDDEN) why.hidden += a; else if (best === OUT_FOV) why.outFov += a; else why.outRange += a; }
  }
  const f = (v: number) => (total ? v / total : 0);
  const unobs = total - cov;
  return {
    scanners: status.length, samples: n, coverage: f(cov), overlap: f(ov), unobserved: f(unobs),
    perScanner: status.map((_, j) => ({ seen: f(seen[j]), unique: f(uniq[j]) })),
    why: { hidden: unobs ? why.hidden / unobs : 0, outFov: unobs ? why.outFov / unobs : 0, outRange: unobs ? why.outRange / unobs : 0 },
    times,
  };
}

/** Share of the surface area for each status from a single scanner (for the Explore activity). */
export function statusShares(samples: SurfaceSamples, st: Uint8Array): { seen: number; hidden: number; outFov: number; outRange: number } {
  let total = 0; const a = [0, 0, 0, 0];
  for (let i = 0; i < samples.count; i++) { total += samples.area[i]; a[st[i]] += samples.area[i]; }
  const f = (v: number) => (total ? v / total : 0);
  return { seen: f(a[0]), hidden: f(a[1]), outFov: f(a[2]), outRange: f(a[3]) };
}

/** Compare two arrangements sample by sample (same scene, same samples). */
export function compareArrangements(samples: SurfaceSamples, a: CoverageStats, b: CoverageStats) {
  let gained = 0, lost = 0, total = 0;
  for (let i = 0; i < samples.count; i++) { total += samples.area[i]; const ca = a.times[i] > 0, cb = b.times[i] > 0; if (cb && !ca) gained += samples.area[i]; if (ca && !cb) lost += samples.area[i]; }
  return { gained: total ? gained / total : 0, lost: total ? lost / total : 0, delta: b.coverage - a.coverage };
}

/** Evaluate several scanners (cached per scanner configuration while the scene is unchanged). */
const statusCache = new Map<string, Uint8Array>();
export function evaluate(scene: SceneDef, scanners: Scanner[], count = 9000) {
  const samples = samplesFor(scene, count);
  const status = scanners.map((sc) => {
    const key = `${scene.id}:${count}:${sc.preset}:${[sc.x, sc.y, sc.z, sc.yaw, sc.pitch].map((v) => v.toFixed(3)).join(',')}`;
    let s = statusCache.get(key);
    if (!s) { s = visibilityStatus(scene, samples, sc); if (statusCache.size > 400) statusCache.clear(); statusCache.set(key, s); }
    return s;
  });
  return { samples, status, stats: coverageStats(samples, status) };
}

/** Rays for the Explore animation: a fan around the scanner, with where each beam ends and whether it hit something. */
export function rayFan(scene: SceneDef, sc: Scanner, sensor: SensorConfig, nAz = 120, nEl = 5) {
  const rs = raySceneFor(scene), hit = newHit(), n = nAz * nEl, ends = new Float32Array(n * 3), hits = new Uint8Array(n);
  const R = eulerToR(sc.yaw, sc.pitch, 0), reach = Math.min(sensor.maxRange, 40);
  const span = sensor.hFov >= 359.5 ? 360 : sensor.hFov;
  for (let i = 0; i < nAz; i++) for (let j = 0; j < nEl; j++) {
    const az = (-span / 2 + ((i + 0.5) / nAz) * span) * D2R;
    const el = (nEl === 1 ? (sensor.vMin + sensor.vMax) / 2 : sensor.vMin + (j / (nEl - 1)) * (sensor.vMax - sensor.vMin)) * D2R;
    const l = applyR(R, [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]), k = i * nEl + j;
    const h = rs.cast(sc.x, sc.y, sc.z, l[0], l[1], l[2], Math.max(0.05, sensor.minRange), reach, hit);
    const t = h ? hit.t : reach;
    ends[k * 3] = sc.x + l[0] * t; ends[k * 3 + 1] = sc.y + l[1] * t; ends[k * 3 + 2] = sc.z + l[2] * t; hits[k] = h ? 1 : 0;
  }
  return { ends, hit: hits, n };
}

/** Is a point inside any solid object of the scene? (A scanner cannot stand inside a wall or a cabinet.) */
export function insideSolid(scene: SceneDef, x: number, y: number, z: number): boolean {
  for (const o of scene.objects) {
    if (!o.scannable || o.structural) continue;
    for (const p of o.parts) {
      const rx = x - p.c[0], ry = y - p.c[1], rz = z - p.c[2], c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = c * rx + s * ry, ly = -s * rx + c * ry;
      if (p.kind === 'box') { if (Math.abs(lx) <= p.size![0] / 2 + 0.15 && Math.abs(ly) <= p.size![1] / 2 + 0.15 && Math.abs(rz) <= p.size![2] / 2) return true; }
      else if (p.kind === 'sphere') { if (lx * lx + ly * ly + rz * rz <= p.r! * p.r!) return true; }
      else { const [a, b, w] = p.axis === 'x' ? [ly, rz, lx] : p.axis === 'y' ? [rz, lx, ly] : [lx, ly, rz]; if (a * a + b * b <= (p.r! + 0.15) ** 2 && Math.abs(w) <= p.h! / 2) return true; }
    }
  }
  return false;
}
