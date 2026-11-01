/**
 * The point cloud of the intro: a small hall (floor, walls with an arched window and a doorway, columns, beams, a bench and two plants),
 * built once from simple geometry. Units are metres; x is right, y is up, z runs away from the viewer.
 * Pure functions, no drawing: so it is easy to test and to change.
 */
export const HALL = { w: 10, depth: 12, h: 5 };
/** Colour classes: 0-5 run from deep blue (low) to teal (high); 6 amber; 7 green; 8 rose; 9 the bright cyan-white of a point the scan has just passed. */
export const CLASS_RGB: [number, number, number][] = [[70, 130, 255], [60, 160, 255], [56, 190, 255], [60, 214, 255], [70, 226, 236], [90, 236, 214], [255, 190, 90], [110, 228, 140], [255, 140, 165], [200, 248, 255]];

export const SENSOR = { x: 0, z: -0.5 }; // where the floor rings are centred
export const ORB = { x: 2.1, y: 1.7, z: 5.6 };
export interface Scene {
  n: number; pos: Float32Array; cls: Uint8Array; size: Float32Array; base: Float32Array; phase: Float32Array;
  rad: Float32Array;              // distance from the sensor for floor points (-1 for the others): the radar pulse uses it
  dynStart: number; dyn: Float32Array; // points that move (the orb's rings, drifting dust): their parameters, 4 numbers each
}

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

export function buildScene(seed = 11): Scene {
  const r = rng(seed), P: number[] = [], C: number[] = [];
  const { w, depth, h } = HALL, X = w / 2;
  const add = (x: number, y: number, z: number, cls?: number) => { P.push(x + (r() - 0.5) * 0.04, y + (r() - 0.5) * 0.04, z + (r() - 0.5) * 0.04); C.push(cls ?? Math.max(0, Math.min(5, Math.floor((y / h) * 6)))); };
  const inArch = (x: number, y: number) => { const cx = 0, base = 1.1, rad = 1.35; return Math.abs(x - cx) < rad && (y < base + rad && y > base) && (y < base + Math.sqrt(Math.max(0, rad * rad - (x - cx) ** 2)) + (Math.abs(x - cx) < rad ? 0 : -9)); };
  // the floor as the rings of a spinning LiDAR around a sensor at the front
  for (let ring = 0; ring < 24; ring++) {
    const R = 1.1 + ring * 0.56, step = 0.3 / R;
    for (let a = -Math.PI * 0.5 + 0.05; a < Math.PI * 0.5 - 0.05; a += step) { const x = Math.sin(a) * R, z = Math.cos(a) * R - 0.5; if (Math.abs(x) <= X && z > 0 && z <= depth) add(x, 0, z, ring % 5 === 0 ? 1 : 0); }
  }
  // back wall with an arched window
  for (let x = -X; x <= X; x += 0.27) for (let y = 0; y <= h; y += 0.27) { if (inArch(x, y)) continue; add(x, y, depth); }
  for (let t = 0; t <= Math.PI; t += 0.06) add(Math.cos(t) * 1.35, 1.1 + Math.sin(t) * 1.35, depth - 0.03, 5); // the arch itself, sharply drawn
  // side walls, the left one with a doorway
  for (const sx of [-X, X]) for (let z = 0.6; z <= depth; z += 0.27) for (let y = 0; y <= h; y += 0.27) { if (sx < 0 && z > 3.2 && z < 4.6 && y < 2.5) continue; add(sx, y, z); }
  // ceiling beams
  for (const z of [3, 6.5, 10]) for (let x = -X; x <= X; x += 0.2) { add(x, h, z, 5); if (r() < 0.6) add(x, h - 0.2, z, 4); }
  // columns
  for (const [cx, cz] of [[-2.5, 4.5], [2.5, 4.5], [-2.5, 8.5], [2.5, 8.5]]) {
    for (let y = 0; y <= h - 0.3; y += 0.18) for (let a = 0; a < Math.PI * 2; a += 0.5) add(cx + Math.cos(a) * 0.3, y, cz + Math.sin(a) * 0.3);
    for (let a = 0; a < Math.PI * 2; a += 0.35) add(cx + Math.cos(a) * 0.42, h - 0.3, cz + Math.sin(a) * 0.42, 5);
  }
  // a low bench in the middle (warm accent)
  for (let x = -1.1; x <= 1.1; x += 0.13) for (let z = 6.1; z <= 6.9; z += 0.13) { add(x, 0.55, z, 6); }
  for (const lx of [-1.0, 1.0]) for (let y = 0; y < 0.55; y += 0.11) for (const lz of [6.2, 6.8]) add(lx, y, lz, 6);
  // two plants: green and a restrained rose
  for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, u = r() * Math.PI, rr = 0.35 * Math.cbrt(r()); add(-3.7 + Math.sin(u) * Math.cos(a) * rr, 0.5 + Math.cos(u) * rr * 1.4, 2.2 + Math.sin(u) * Math.sin(a) * rr, 7); }
  for (let i = 0; i < 46; i++) { const a = r() * Math.PI * 2, u = r() * Math.PI, rr = 0.26 * Math.cbrt(r()); add(3.6 + Math.sin(u) * Math.cos(a) * rr, 0.45 + Math.cos(u) * rr * 1.3, 7.4 + Math.sin(u) * Math.sin(a) * rr, 8); }
  const dynStart = P.length / 3, D: number[] = []; // dynamic points: [kind, a, b, c]. kind 0 = ring A, 1 = ring B, 2 = dust
  add(ORB.x, ORB.y, ORB.z, 9); D.push(9, 0, 0, 0);                                                      // the core of the orb stays put
  for (let i = 0; i < 70; i++) { add(0, 0, 0, 6); D.push(0, (i / 70) * Math.PI * 2, 0.82, 0); }          // ring A, amber
  for (let i = 0; i < 56; i++) { add(0, 0, 0, 5); D.push(1, (i / 56) * Math.PI * 2, 0.62, 0); }          // ring B, teal
  for (let i = 0; i < 150; i++) { add(0, 0, 0, i % 3 ? 4 : 3); D.push(2, (r() - 0.5) * (w - 1), 0.4 + r() * (h - 0.8), 1 + r() * (depth - 2)); } // dust
  const n = P.length / 3, size = new Float32Array(n), base = new Float32Array(n), phase = new Float32Array(n), rad = new Float32Array(n).fill(-1);
  for (let i = 0; i < n; i++) { size[i] = 0.8 + r() * 0.5; base[i] = 0.5 + r() * 0.5; phase[i] = r() * Math.PI * 2; if (i < dynStart && Math.abs(P[i * 3 + 1]) < 0.05) rad[i] = Math.hypot(P[i * 3] - SENSOR.x, P[i * 3 + 2] - SENSOR.z); }
  for (let i = dynStart; i < n; i++) if (D[(i - dynStart) * 4] === 2) { size[i] = 0.6; base[i] = 0.35 + r() * 0.4; }
  const S: Scene = { n, pos: new Float32Array(P), cls: Uint8Array.from(C), size, base, phase, rad, dynStart, dyn: new Float32Array(D) };
  updateDynamic(S, 0); return S;
}

/** Move the points that move: two thin rings turning around the orb, and a little dust drifting very slowly. */
export function updateDynamic(S: Scene, t: number) {
  for (let i = S.dynStart; i < S.n; i++) {
    const k = (i - S.dynStart) * 4, kind = S.dyn[k], a = S.dyn[k + 1], b = S.dyn[k + 2], c = S.dyn[k + 3];
    if (kind === 9) continue;
    if (kind === 2) { const ph = S.phase[i]; S.pos[i * 3] = a + Math.sin(t * 0.12 + ph) * 0.35; S.pos[i * 3 + 1] = b + Math.sin(t * 0.09 + ph * 1.7) * 0.28; S.pos[i * 3 + 2] = c + Math.cos(t * 0.1 + ph) * 0.3; continue; }
    const ang = a + t * (kind === 0 ? 0.32 : -0.24), tilt = kind === 0 ? 1.15 : -0.6, x = Math.cos(ang) * b, z0 = Math.sin(ang) * b;
    S.pos[i * 3] = ORB.x + x; S.pos[i * 3 + 1] = ORB.y + z0 * Math.sin(tilt); S.pos[i * 3 + 2] = ORB.z + z0 * Math.cos(tilt);
  }
}

export interface Cam { x: number; y: number; z: number; sy: number; cy: number; sp: number; cp: number; f: number }
/** A camera that looks at the middle of the hall and swings gently side to side (±5°) and up and down (about ±1.5°). */
export function camera(t: number, o: { calm: boolean; px: number; py: number; w: number; h: number }): Cam {
  const yaw = o.calm ? 0 : (4 * Math.PI / 180) * Math.sin(t * 0.26) + o.px * 0.03, pitch = (o.calm ? 0 : (1 * Math.PI / 180) * Math.sin(t * 0.19 + 1)) - 0.12 + o.py * 0.025;
  const tx = 0, ty = 1.4, tz = 6, R = 14, x = tx + Math.sin(yaw) * R, z = tz - Math.cos(yaw) * R, y = 3.2;
  const look = Math.atan2(tx - x, tz - z); // face the target from wherever the camera swung to
  return { x, y, z, sy: Math.sin(look), cy: Math.cos(look), sp: Math.sin(pitch), cp: Math.cos(pitch), f: Math.max(o.w * 0.95, o.h * 1.5) };
}
/** Perspective projection to pixels; returns false when the point is behind the camera. */
export function project(c: Cam, x: number, y: number, z: number, cx: number, cy: number, out: { x: number; y: number; d: number }): boolean {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const rx = dx * c.cy - dz * c.sy, rz = dx * c.sy + dz * c.cy;      // turn about the vertical axis
  const ry = dy * c.cp - rz * c.sp, rz2 = dy * c.sp + rz * c.cp;     // tilt
  if (rz2 < 0.5) return false;
  out.x = cx + (c.f * rx) / rz2; out.y = cy - (c.f * ry) / rz2; out.d = rz2; return true;
}
