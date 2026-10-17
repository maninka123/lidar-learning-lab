import { Vec3 } from '../core/math';

export interface PartMaterial { color: [number, number, number]; reflectivity: number }
export interface Primitive {
  kind: 'box' | 'cylinder' | 'sphere';
  c: Vec3; // world centre
  size?: Vec3; // box full extents in local (yaw-rotated) frame
  r?: number;
  h?: number;
  axis?: 'x' | 'y' | 'z';
  yaw: number;
  mat?: PartMaterial; // per-part material override
  porous?: number; // probability a ray passes through (foliage)
}
export interface SceneObject {
  id: string;
  name: string;
  classId: number;
  instanceId: number;
  parts: Primitive[];
  color: [number, number, number];
  reflectivity: number; // 0..1 near-IR surface reflectivity
  scannable: boolean; // false = visual-only model
  structural?: boolean; // floor / wall / road etc.
  hideFlag?: 'ceiling';
  pattern?: 'checker' | 'stripes';
  description?: string;
}
export interface SceneDef {
  id: string;
  name: string;
  description: string;
  objects: SceneObject[];
  bounds: { min: Vec3; max: Vec3 };
  corridor?: { start: [number, number]; end: [number, number]; width: number; height: number };
  defaultPose: { x: number; y: number; z: number; yaw: number };
  targetObjectId?: string;
  cameraHome: Vec3;
  cameraTarget: Vec3;
}

export const box = (c: Vec3, size: Vec3, yaw = 0, o: Partial<Primitive> = {}): Primitive => ({ kind: 'box', c, size, yaw, ...o });
export const cyl = (c: Vec3, r: number, h: number, axis: 'x' | 'y' | 'z' = 'z', o: Partial<Primitive> = {}): Primitive => ({ kind: 'cylinder', c, r, h, axis, yaw: 0, ...o });
export const sph = (c: Vec3, r: number, o: Partial<Primitive> = {}): Primitive => ({ kind: 'sphere', c, r, yaw: 0, ...o });

/** Rotate local-offset parts about (ox,oy) by yaw and translate: parts are authored around origin. */
export function place(parts: Primitive[], ox: number, oy: number, oz: number, yaw: number): Primitive[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return parts.map((p) => ({
    ...p,
    c: [ox + c * p.c[0] - s * p.c[1], oy + s * p.c[0] + c * p.c[1], oz + p.c[2]] as Vec3,
    yaw: p.yaw + yaw,
  }));
}

export function primAABB(p: Primitive): { min: Vec3; max: Vec3 } {
  const [cx, cy, cz] = p.c;
  if (p.kind === 'sphere') return { min: [cx - p.r!, cy - p.r!, cz - p.r!], max: [cx + p.r!, cy + p.r!, cz + p.r!] };
  if (p.kind === 'box') {
    const [sx, sy, sz] = p.size!;
    const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
    const hx = (c * sx + s * sy) / 2, hy = (s * sx + c * sy) / 2, hz = sz / 2;
    return { min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz] };
  }
  const r = p.r!, h = p.h! / 2;
  const e: Vec3 = p.axis === 'x' ? [h, r, r] : p.axis === 'y' ? [r, h, r] : [r, r, h];
  return { min: [cx - e[0], cy - e[1], cz - e[2]], max: [cx + e[0], cy + e[1], cz + e[2]] };
}

export function objectAABB(o: SceneObject): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of o.parts) {
    const b = primAABB(p);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a]); max[a] = Math.max(max[a], b.max[a]); }
  }
  return { min, max };
}

type ObjInit = Omit<SceneObject, 'instanceId' | 'scannable'> & { scannable?: boolean };
export function finalize(defs: ObjInit[]): SceneObject[] {
  return defs.map((d, i) => ({ scannable: true, ...d, instanceId: i + 1 }));
}

// ---------------------------------------------------------------- ray casting
export interface Hit {
  t: number;
  obj: number; // index into scene.objects
  part: number;
  nx: number; ny: number; nz: number;
}

interface FlatPrim {
  kind: 0 | 1 | 2;
  cx: number; cy: number; cz: number;
  cos: number; sin: number; // yaw rotation (local = Rz(-yaw) * (p - c))
  hx: number; hy: number; hz: number; // box half extents
  r: number; hh: number; axis: 0 | 1 | 2;
  bmin: Vec3; bmax: Vec3;
  obj: number; part: number; porous: number;
}

/** Analytic ray caster over boxes, cylinders and spheres. All geometry in metres, Z-up. */
export class RayScene {
  prims: FlatPrim[] = [];
  objects: SceneObject[];

  constructor(scene: { objects: SceneObject[] }) {
    this.objects = scene.objects;
    scene.objects.forEach((o, oi) => {
      if (!o.scannable) return;
      o.parts.forEach((p, pi) => {
        const bb = primAABB(p);
        const size = p.size ?? [0, 0, 0];
        this.prims.push({
          kind: p.kind === 'box' ? 0 : p.kind === 'cylinder' ? 1 : 2,
          cx: p.c[0], cy: p.c[1], cz: p.c[2],
          cos: Math.cos(p.yaw), sin: Math.sin(p.yaw),
          hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2,
          r: p.r ?? 0, hh: (p.h ?? 0) / 2, axis: p.axis === 'x' ? 0 : p.axis === 'y' ? 1 : 2,
          bmin: bb.min, bmax: bb.max, obj: oi, part: pi, porous: p.porous ?? 0,
        });
      });
    });
  }

  /** Nearest intersection with t in [tmin, tmax]. Returns false on miss. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, tmax: number, out: Hit): boolean {
    let bestT = tmax;
    let found = false;
    const idx = 1 / (dx || 1e-30), idy = 1 / (dy || 1e-30), idz = 1 / (dz || 1e-30);
    for (let i = 0; i < this.prims.length; i++) {
      const p = this.prims[i];
      // broad phase: world AABB slab test
      let t0 = tmin, t1 = bestT;
      let a = (p.bmin[0] - ox) * idx, b = (p.bmax[0] - ox) * idx;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;
      a = (p.bmin[1] - oy) * idy; b = (p.bmax[1] - oy) * idy;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;
      a = (p.bmin[2] - oz) * idz; b = (p.bmax[2] - oz) * idz;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) continue;

      // to local frame
      const rx = ox - p.cx, ry = oy - p.cy, rz = oz - p.cz;
      const lox = p.cos * rx + p.sin * ry, loy = -p.sin * rx + p.cos * ry, loz = rz;
      const ldx = p.cos * dx + p.sin * dy, ldy = -p.sin * dx + p.cos * dy, ldz = dz;
      let tHit = Infinity, lnx = 0, lny = 0, lnz = 0;
      const allowExit = p.porous > 0;

      if (p.kind === 0) {
        let tn = -Infinity, tf = Infinity, nax = 0, nsg = 1;
        const O = [lox, loy, loz], D = [ldx, ldy, ldz], H = [p.hx, p.hy, p.hz];
        let miss = false;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(D[k]) < 1e-12) { if (Math.abs(O[k]) > H[k]) { miss = true; break; } continue; }
          let s1 = (-H[k] - O[k]) / D[k], s2 = (H[k] - O[k]) / D[k], sg = -1;
          if (s1 > s2) { const t = s1; s1 = s2; s2 = t; sg = 1; }
          if (s1 > tn) { tn = s1; nax = k; nsg = sg; }
          if (s2 < tf) tf = s2;
        }
        if (miss || tn > tf) continue;
        if (tn >= tmin) { tHit = tn; if (nax === 0) lnx = nsg; else if (nax === 1) lny = nsg; else lnz = nsg; }
        else if (allowExit && tf >= tmin) { tHit = tf; }
        else continue;
      } else if (p.kind === 2) {
        const b2 = lox * ldx + loy * ldy + loz * ldz;
        const c2 = lox * lox + loy * loy + loz * loz - p.r * p.r;
        const disc = b2 * b2 - c2;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const s1 = -b2 - sq, s2 = -b2 + sq;
        if (s1 >= tmin) tHit = s1; else if (allowExit && s2 >= tmin) tHit = s2; else continue;
        lnx = (lox + tHit * ldx) / p.r; lny = (loy + tHit * ldy) / p.r; lnz = (loz + tHit * ldz) / p.r;
      } else {
        // remap so cylinder axis is 'w'
        let u0: number, u1: number, w: number, d0: number, d1: number, dw: number;
        if (p.axis === 2) { u0 = lox; u1 = loy; w = loz; d0 = ldx; d1 = ldy; dw = ldz; }
        else if (p.axis === 0) { u0 = loy; u1 = loz; w = lox; d0 = ldy; d1 = ldz; dw = ldx; }
        else { u0 = loz; u1 = lox; w = loy; d0 = ldz; d1 = ldx; dw = ldy; }
        let best = Infinity, n0 = 0, n1 = 0, nw = 0;
        const A = d0 * d0 + d1 * d1;
        if (A > 1e-12) {
          const B = u0 * d0 + u1 * d1, C = u0 * u0 + u1 * u1 - p.r * p.r;
          const disc = B * B - A * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            for (const s of [(-B - sq) / A, (-B + sq) / A]) {
              if (s < tmin || s >= best) continue;
              const ww = w + s * dw;
              if (Math.abs(ww) <= p.hh && (s === (-B - sq) / A || allowExit)) {
                best = s; n0 = (u0 + s * d0) / p.r; n1 = (u1 + s * d1) / p.r; nw = 0;
              }
            }
          }
        }
        if (Math.abs(dw) > 1e-12) {
          for (const sg of [-1, 1]) {
            const s = (sg * p.hh - w) / dw;
            if (s < tmin || s >= best) continue;
            const q0 = u0 + s * d0, q1 = u1 + s * d1;
            if (q0 * q0 + q1 * q1 <= p.r * p.r) { best = s; n0 = 0; n1 = 0; nw = sg; }
          }
        }
        if (best === Infinity) continue;
        tHit = best;
        if (p.axis === 2) { lnx = n0; lny = n1; lnz = nw; }
        else if (p.axis === 0) { lny = n0; lnz = n1; lnx = nw; }
        else { lnz = n0; lnx = n1; lny = nw; }
      }
      if (tHit < bestT && tHit >= tmin) {
        bestT = tHit; found = true;
        out.t = tHit; out.obj = p.obj; out.part = p.part;
        // local normal -> world
        out.nx = p.cos * lnx - p.sin * lny; out.ny = p.sin * lnx + p.cos * lny; out.nz = lnz;
      }
    }
    return found;
  }
}

export const newHit = (): Hit => ({ t: 0, obj: -1, part: -1, nx: 0, ny: 0, nz: 1 });
