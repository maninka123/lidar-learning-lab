import { Vec3 } from '../core/math';

/** Camera mounted on a LiDAR. Frame of the LiDAR: x forward, y left, z up. Angles in degrees; the camera is not rolled. */
export interface Extrinsic { tx: number; ty: number; tz: number; yawDeg: number; pitchDeg: number }
export interface Rig { x: number; y: number; z: number; yaw: number }
export interface CamPose { pos: Vec3; f: Vec3; r: Vec3; u: Vec3 }
export interface Image { w: number; h: number; fovDeg: number; rgb: Uint8ClampedArray; depth: Float32Array; hitMask: Uint8Array }

const D = Math.PI / 180;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Where the camera is in the world and which way it looks, from where the rig stands and the offset between the sensors. */
export function cameraPose(rig: Rig, e: Extrinsic): CamPose {
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw), rot = (v: Vec3): Vec3 => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  const ps = e.yawDeg * D, th = e.pitchDeg * D;
  const f = norm(rot([Math.cos(th) * Math.cos(ps), Math.cos(th) * Math.sin(ps), Math.sin(th)]));
  const pos = rot([e.tx, e.ty, e.tz]);
  const r = norm(cross(f, [0, 0, 1])), u = cross(r, f);
  return { pos: [rig.x + pos[0], rig.y + pos[1], rig.z + pos[2]], f, r, u };
}

/** Pinhole projection of a world point into the image (pixel u to the right, v down), or null if it is behind the camera. */
export function project(cam: CamPose, p: Vec3, w: number, h: number, fovDeg: number): { u: number; v: number; z: number } | null {
  const dx = p[0] - cam.pos[0], dy = p[1] - cam.pos[1], dz = p[2] - cam.pos[2];
  const z = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
  if (z < 0.1) return null;
  const x = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2], y = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
  const t = Math.tan((fovDeg * D) / 2), aspect = w / h;
  return { u: ((x / z) / (t * aspect) + 1) / 2 * w - 0.5, v: (1 - (y / z) / t) / 2 * h - 0.5, z };
}

/** Give every LiDAR point the colour of the photo pixel it lands on (skipping points the camera cannot see). */
export function colourise(pos: Float32Array, n: number, rig: Rig, e: Extrinsic, img: Image, occlusion = true): { colors: Uint8Array; valid: Uint8Array; count: number } {
  const cam = cameraPose(rig, e), colors = new Uint8Array(n * 3).fill(170), valid = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const q = project(cam, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], img.w, img.h, img.fovDeg);
    if (!q) continue;
    const iu = Math.round(q.u), iv = Math.round(q.v);
    if (iu < 0 || iv < 0 || iu >= img.w || iv >= img.h) continue;
    const k = iv * img.w + iu;
    if (!img.hitMask[k]) continue;
    if (occlusion && Math.abs(q.z - img.depth[k]) > 0.12 + 0.04 * q.z) continue; // the camera sees something nearer: this point is hidden from it
    colors[i * 3] = img.rgb[k * 4]; colors[i * 3 + 1] = img.rgb[k * 4 + 1]; colors[i * 3 + 2] = img.rgb[k * 4 + 2];
    valid[i] = 1; count++;
  }
  return { colors, valid, count };
}

const asE = (p: number[]): Extrinsic => ({ tx: p[0], ty: p[1], tz: p[2], yawDeg: p[3], pitchDeg: p[4] });

function solve5(A: number[][], b: number[]): number[] | null {
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

export function reprojection(rig: Rig, e: Extrinsic, X: Vec3[], m: [number, number][], w: number, h: number, fovDeg: number): number[] {
  const cam = cameraPose(rig, e), out: number[] = [];
  X.forEach((p, i) => { const q = project(cam, p, w, h, fovDeg); out.push(q ? q.u - m[i][0] : 500, q ? q.v - m[i][1] : 500); });
  return out;
}
export const rmsPx = (res: number[]) => Math.sqrt(res.reduce((a, v) => a + v * v, 0) / Math.max(1, res.length / 2));

/** Find the camera offset from 3D–2D matches by minimising the reprojection error (Levenberg–Marquardt). This is the "PnP" step of calibration. */
export function solveExtrinsic(rig: Rig, X: Vec3[], m: [number, number][], init: Extrinsic, w: number, h: number, fovDeg: number): { e: Extrinsic; rms: number; iters: number } {
  let p = [init.tx, init.ty, init.tz, init.yawDeg, init.pitchDeg], lambda = 1e-2, it = 0;
  let res = reprojection(rig, asE(p), X, m, w, h, fovDeg), cost = res.reduce((a, v) => a + v * v, 0);
  const eps = [1e-3, 1e-3, 1e-3, 0.02, 0.02];
  for (; it < 60; it++) {
    const J: number[][] = res.map(() => new Array(5).fill(0));
    for (let k = 0; k < 5; k++) { const q = p.slice(); q[k] += eps[k]; const r2 = reprojection(rig, asE(q), X, m, w, h, fovDeg); for (let i = 0; i < res.length; i++) J[i][k] = (r2[i] - res[i]) / eps[k]; }
    const A = Array.from({ length: 5 }, (_, a) => Array.from({ length: 5 }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0))), g = Array.from({ length: 5 }, (_, a) => -J.reduce((s, row, i) => s + row[a] * res[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const Ad = A.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
      const dx = solve5(Ad, g); if (!dx) { lambda *= 10; continue; }
      const q = p.map((v, i) => v + dx[i]), r2 = reprojection(rig, asE(q), X, m, w, h, fovDeg), c2 = r2.reduce((a, v) => a + v * v, 0);
      if (c2 < cost) { p = q; res = r2; cost = c2; lambda = Math.max(1e-6, lambda / 3); improved = true; } else lambda *= 4;
    }
    if (!improved || Math.sqrt(cost / Math.max(1, res.length / 2)) < 1e-3) break;
  }
  return { e: asE(p), rms: rmsPx(res), iters: it };
}
