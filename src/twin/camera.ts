import { texture } from '../recon/recon';
import { RayScene, newHit } from '../scenes/geometry';
import { cameraPose, project, Extrinsic, CamPose } from '../apps/fusion';
import { makeRng, hashSeed } from '../core/rng';
import { Vec3, D2R, clamp, norm } from '../core/math';
import type { Factory } from './factory';
import { illuminationAt } from './factory';
import { CameraUnit, cameraItem, LightUnit, LIGHT_UNIT, LOWLIGHT_KIT } from './catalogue';

/** What a camera really records, and how a team tells the LiDAR where the camera is.
 *  The image is rendered from the TRUE camera pose and field of view; the team only knows the pose it intended and has to calibrate the rest. */

/** A camera image that is never stored whole. A 4K frame is 8 million pixels, so a pixel is computed when somebody asks for it: ray cast from the true camera,
 *  scaled by the light there, then noise that depends only on the pixel's position. Asking twice gives the same value, and any pixel equals what a full frame would hold. */
export interface CamSampler { camId: string; w: number; h: number; sample(u: number, v: number): [number, number, number] }
export interface CamImage { camId: string; w: number; h: number; rgb: Uint8ClampedArray }
const WORLD = { x: 0, y: 0, z: 0, yaw: 0 };

/** The hidden installation error of a camera: where it really points compared with where the team meant it to. Seeded, never shown. */
export function hiddenCamError(scenarioSeed: number, index: number): { e: Extrinsic; fovScale: number } {
  const r = makeRng(hashSeed('camerr', scenarioSeed, index));
  return { e: { tx: 0.06 * r.gauss(), ty: 0.06 * r.gauss(), tz: 0.04 * r.gauss(), yawDeg: 2 * r.gauss(), pitchDeg: 1.5 * r.gauss() }, fovScale: 1 + 0.015 * r.gauss() };
}
export const nominalOf = (c: CameraUnit): Extrinsic => ({ tx: c.x, ty: c.y, tz: c.z, yawDeg: c.yaw / D2R, pitchDeg: c.pitch / D2R });
/** The pose the camera really has in the world (the hidden truth). */
export function trueExtrinsic(c: CameraUnit, scenarioSeed: number, index: number): { e: Extrinsic; fov: number } {
  const h = hiddenCamError(scenarioSeed, index), n = nominalOf(c);
  return { e: { tx: n.tx + h.e.tx, ty: n.ty + h.e.ty, tz: n.tz + h.e.tz, yawDeg: n.yawDeg + h.e.yawDeg, pitchDeg: n.pitchDeg + h.e.pitchDeg }, fov: cameraItem(c.item).fov * h.fovScale };
}
/** Looking straight up or down has no 'right' direction, so the tilt stops a hair short of ±90°. */
export const camPose = (e: Extrinsic): CamPose => cameraPose(WORLD, { ...e, pitchDeg: clamp(e.pitchDeg, -89.5, 89.5) });

/** Light that reaches the scene: the zone's lamps and the lighting units the team installed. */
export const lightsOf = (ls: LightUnit[]) => ls.map((l) => ({ x: l.x, y: l.y, z: l.z, power: LIGHT_UNIT.power }));

/** Camera sensitivity after upgrades. */
export function sensitivity(c: CameraUnit) {
  const it = cameraItem(c.item);
  return { gain: it.gain * (c.kit ? LOWLIGHT_KIT.gain : 1), read: it.read * (c.kit ? LOWLIGHT_KIT.read : 1), shot: it.shot };
}

const hash3 = (a: number, b: number, c: number) => { let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const pixelGauss = (seed: number, u: number, v: number, ch: number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, hash3(seed * 3 + ch, u, v)))) * Math.cos(2 * Math.PI * hash3(seed * 5 + ch + 11, v, u));

/** The camera as a pixel sampler. Light, sensitivity, noise and 8-bit quantisation as in the description above; a dark scene is dark and noisy at any resolution. */
export function makeSampler(f: Factory, c: CameraUnit, scenarioSeed: number, index: number, lights: LightUnit[]): CamSampler {
  const it = cameraItem(c.item), tr = trueExtrinsic(c, scenarioSeed, index), cam = camPose(tr.e), w = it.w, h = it.h;
  const rs = new RayScene(f.scene), hit = newHit(), s = sensitivity(c), L = lightsOf(lights), seed = hashSeed('img', scenarioSeed, index, f.epoch === 'A' ? 0 : 1);
  const t = Math.tan((tr.fov * D2R) / 2), aspect = w / h, sun = norm([0.4, -0.3, 0.85] as Vec3);
  return {
    camId: c.id, w, h,
    sample(u, v) {
      const nx = (2 * (u + 0.5) / w - 1) * t * aspect, ny = (1 - 2 * (v + 0.5) / h) * t;
      const d = norm([cam.f[0] + nx * cam.r[0] + ny * cam.u[0], cam.f[1] + nx * cam.r[1] + ny * cam.u[1], cam.f[2] + nx * cam.r[2] + ny * cam.u[2]] as Vec3);
      let base: [number, number, number] = [20, 20, 22], e = 0.5;
      if (rs.cast(cam.pos[0], cam.pos[1], cam.pos[2], d[0], d[1], d[2], 0.05, 40, hit)) {
        const o = f.scene.objects[hit.obj], mat = o.parts[hit.part].mat ?? { color: o.color, reflectivity: o.reflectivity };
        let nxn = hit.nx, nyn = hit.ny, nzn = hit.nz; if (nxn * d[0] + nyn * d[1] + nzn * d[2] > 0) { nxn = -nxn; nyn = -nyn; nzn = -nzn; }
        const sh = 0.45 + 0.55 * Math.max(0, nxn * sun[0] + nyn * sun[1] + nzn * sun[2]);
        const px = cam.pos[0] + d[0] * hit.t, py = cam.pos[1] + d[1] * hit.t, pz = cam.pos[2] + d[2] * hit.t, tx = texture(o.pattern, px, py, pz);
        base = [mat.color[0] * sh * tx, mat.color[1] * sh * tx, mat.color[2] * sh * tx];
        e = illuminationAt(px, py, pz, L);
      }
      const out: [number, number, number] = [0, 0, 0];
      for (let ch = 0; ch < 3; ch++) { const signal = base[ch] * e * s.gain, sd = Math.sqrt(s.read * s.read + s.shot * Math.max(0, signal)); out[ch] = Math.round(clamp(signal + sd * pixelGauss(seed, u, v, ch), 0, 255)); }
      return out;
    },
  };
}
/** A small picture for the screen: the pixels of the camera sampled on a coarser grid (the same camera, shown smaller). */
export function renderPreview(f: Factory, c: CameraUnit, scenarioSeed: number, index: number, lights: LightUnit[], maxW = 480): CamImage {
  const sm = makeSampler(f, c, scenarioSeed, index, lights), W = Math.min(maxW, sm.w), H = Math.max(1, Math.round((sm.h * W) / sm.w)), rgb = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const p = sm.sample(Math.floor(((i + 0.5) * sm.w) / W), Math.floor(((j + 0.5) * sm.h) / H)), k = (j * W + i) * 4; rgb[k] = p[0]; rgb[k + 1] = p[1]; rgb[k + 2] = p[2]; rgb[k + 3] = 255; }
  return { camId: c.id, w: W, h: H, rgb };
}

// ----------------------------------------------------------------------------- calibration
export interface CalTarget { X: Vec3[]; m: [number, number][]; w: number; h: number; sigmaPx: number }

/** A calibration board: a grid of markers at surveyed positions in front of the camera. The corners are found in the image with a pixel error that grows when the picture is dark or small. */
export function calibrationTarget(c: CameraUnit, scenarioSeed: number, index: number, lights: LightUnit[]): CalTarget {
  const it = cameraItem(c.item), tr = trueExtrinsic(c, scenarioSeed, index), cam = camPose(tr.e), rng = makeRng(hashSeed('caltarget', scenarioSeed, index));
  const X: Vec3[] = [], m: [number, number][] = [];
  const e = illuminationAt(cam.pos[0] + 3 * cam.f[0], cam.pos[1] + 3 * cam.f[1], cam.pos[2], lightsOf(lights)), s = sensitivity(c);
  // brighter picture, more pixels: sharper corners
  const signal = Math.max(0.02, e * s.gain), sigmaPx = clamp((0.25 + 0.5 / Math.sqrt(signal)) * Math.sqrt(640 / it.w) * Math.max(1, it.w / 1280), 0.2, 12); // sharper corners with more pixels, but a pixel of a 4K frame is small
  for (const dist of [2.5, 4, 6]) {
    const side: Vec3 = [-cam.f[1], cam.f[0], 0], sl = Math.hypot(side[0], side[1]) || 1, sx = side[0] / sl, sy = side[1] / sl;
    const cx = cam.pos[0] + cam.f[0] * dist + sx * rng.range(-0.4, 0.4) * dist * 0.3, cy = cam.pos[1] + cam.f[1] * dist + sy * rng.range(-0.4, 0.4) * dist * 0.3, cz = cam.pos[2] + cam.f[2] * dist + rng.range(-0.3, 0.2);
    for (let a = -3; a <= 3; a++) for (let b = -2; b <= 2; b++) {
      const p: Vec3 = [cx + sx * a * 0.18 * (dist / 3), cy + sy * a * 0.18 * (dist / 3), cz + b * 0.18 * (dist / 3)];
      const q = project(cam, p, it.w, it.h, tr.fov); if (!q || q.u < 2 || q.v < 2 || q.u > it.w - 3 || q.v > it.h - 3) continue;
      X.push(p); m.push([q.u + sigmaPx * rng.gauss(), q.v + sigmaPx * rng.gauss()]);
    }
  }
  return { X, m, w: it.w, h: it.h, sigmaPx };
}

/** Reprojection residuals (pixels) of the board markers under an estimated extrinsic and field of view. */
export function residuals(t: CalTarget, e: Extrinsic, fov: number): number[] {
  const cam = camPose(e), out: number[] = [];
  t.X.forEach((p, i) => { const q = project(cam, p, t.w, t.h, fov); out.push(q ? q.u - t.m[i][0] : 400, q ? q.v - t.m[i][1] : 400); });
  return out;
}
export const rmsOf = (r: number[]) => Math.sqrt(r.reduce((a, v) => a + v * v, 0) / Math.max(1, r.length / 2));

function solveLin(A: number[][], b: number[]): number[] | null {
  const n = b.length, m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-14) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = m[r][n]; for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c]; x[r] = s / m[r][r]; }
  return x;
}

/** Automatic calibration: least squares (Levenberg–Marquardt) over the camera position, its two angles and its field of view. The same idea as the Fusion tab, plus the focal length. */
export function autoCalibrate(t: CalTarget, init: Extrinsic, fov0: number): { e: Extrinsic; fov: number; rms: number } {
  const unpack = (p: number[]): { e: Extrinsic; fov: number } => ({ e: { tx: p[0], ty: p[1], tz: p[2], yawDeg: p[3], pitchDeg: p[4] }, fov: p[5] });
  let p = [init.tx, init.ty, init.tz, init.yawDeg, init.pitchDeg, fov0], lambda = 1e-2;
  const eps = [1e-3, 1e-3, 1e-3, 0.02, 0.02, 0.05];
  const res = (q: number[]) => { const u = unpack(q); return residuals(t, u.e, u.fov); };
  let r = res(p), cost = r.reduce((a, v) => a + v * v, 0);
  for (let it = 0; it < 80; it++) {
    const J = r.map(() => new Array(6).fill(0));
    for (let k = 0; k < 6; k++) { const q = p.slice(); q[k] += eps[k]; const r2 = res(q); for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / eps[k]; }
    const A = Array.from({ length: 6 }, (_, a) => Array.from({ length: 6 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: 6 }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const dx = solveLin(A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v))), g);
      if (!dx) { lambda *= 10; continue; }
      const q = p.map((v, i) => v + dx[i]), r2 = res(q), c2 = r2.reduce((a, v) => a + v * v, 0);
      if (c2 < cost) { p = q; r = r2; cost = c2; lambda = Math.max(1e-6, lambda / 3); improved = true; } else lambda *= 4;
    }
    if (!improved) break;
  }
  const u = unpack(p);
  return { e: u.e, fov: u.fov, rms: rmsOf(r) };
}

/** Error of the team's calibration against the hidden truth. */
export function calibrationError(est: Extrinsic, fov: number, c: CameraUnit, scenarioSeed: number, index: number): { posCm: number; angDeg: number; fovPct: number } {
  const tr = trueExtrinsic(c, scenarioSeed, index);
  return { posCm: 100 * Math.hypot(est.tx - tr.e.tx, est.ty - tr.e.ty, est.tz - tr.e.tz), angDeg: Math.hypot(est.yawDeg - tr.e.yawDeg, est.pitchDeg - tr.e.pitchDeg), fovPct: (100 * Math.abs(fov - tr.fov)) / tr.fov };
}

// ----------------------------------------------------------------------------- colour from cameras
export interface CalibratedCamera { unit: CameraUnit; image: CamSampler; e: Extrinsic; fov: number; scanIds?: number[] }

/** Give each point the colour of the pixel it lands on. Occlusion is judged against the LiDAR points themselves (a depth map made from the cloud),
 *  so a point hidden behind a nearer surface takes no colour. The pose and field of view are the team's calibration, errors included.
 *  Only the pixels the points land on are computed, once each. */
export function colourPoints(pos: Float32Array, n: number, cams: CalibratedCamera[], scanIds?: Uint16Array): { colors: Uint8Array; valid: Uint8Array; count: number } {
  const colors = new Uint8Array(n * 3), valid = new Uint8Array(n), best = new Float32Array(n).fill(0);
  let count = 0;
  for (const c of cams) {
    const pose = camPose(c.e), { w, h } = c.image, zw = Math.min(w, 1024), zs = zw / w, zh = Math.max(1, Math.round(h * zs)), zbuf = new Float32Array(zw * zh).fill(Infinity);
    const proj = new Float32Array(n * 3).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (c.scanIds && (!scanIds || !c.scanIds.includes(scanIds[i]))) continue;
      const q = project(pose, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], w, h, c.fov);
      if (!q) continue; proj[i * 3] = q.u; proj[i * 3 + 1] = q.v; proj[i * 3 + 2] = q.z;
      const iu = Math.round(q.u * zs), iv = Math.round(q.v * zs);
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) { const u = iu + du, v = iv + dv; if (u >= 0 && v >= 0 && u < zw && v < zh && q.z < zbuf[v * zw + u]) zbuf[v * zw + u] = q.z; }
    }
    const tan = Math.tan((c.fov * D2R) / 2), cache = new Map<number, [number, number, number]>();
    for (let i = 0; i < n; i++) {
      const u = proj[i * 3]; if (Number.isNaN(u)) continue;
      const iu = Math.round(u), iv = Math.round(proj[i * 3 + 1]), z = proj[i * 3 + 2];
      if (iu < 0 || iv < 0 || iu >= w || iv >= h) continue;
      if (z > zbuf[Math.min(zh - 1, Math.round(iv * zs)) * zw + Math.min(zw - 1, Math.round(iu * zs))] + 0.12 + 0.04 * z) continue; // something nearer is in front
      const quality = w / (2 * z * tan); // pixels per metre at this distance: sharper is better
      if (quality <= best[i]) continue;
      best[i] = quality;
      const key = iv * w + iu; let px = cache.get(key); if (!px) { px = c.image.sample(iu, iv); cache.set(key, px); }
      colors[i * 3] = px[0]; colors[i * 3 + 1] = px[1]; colors[i * 3 + 2] = px[2];
      if (!valid[i]) { valid[i] = 1; count++; }
    }
  }
  return { colors, valid, count };
}

/** Which label colour does a measured RGB look like? Dark or grey pixels vote for nothing. */
export function labelVote(r: number, g: number, b: number): 'red' | 'green' | 'yellow' | null {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx === 0 ? 0 : (mx - mn) / mx;
  if (v < 0.22 || s < 0.5) return null;
  let h = 0; const d = mx - mn;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  if (h < 18 || h >= 340) return 'red';
  if (h >= 42 && h < 72) return 'yellow';
  if (h >= 95 && h < 165) return 'green';
  return null;
}
