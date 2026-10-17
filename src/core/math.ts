export type Vec3 = [number, number, number];
/** Rigid transform: x' = R x + t, R is row-major 3x3. */
export interface Rigid {
  R: number[];
  t: Vec3;
}

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const identity = (): Rigid => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });

/** R = Rz(yaw) * Ry(pitch) * Rx(roll); angles in radians. */
export function eulerToR(yaw: number, pitch: number, roll: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

export function rRoll(R: number[]): { yaw: number; pitch: number; roll: number } {
  const pitch = Math.asin(clamp(-R[6], -1, 1));
  const yaw = Math.atan2(R[3], R[0]);
  const roll = Math.atan2(R[7], R[8]);
  return { yaw, pitch, roll };
}

export function rigidFromEuler(tx: number, ty: number, tz: number, yaw: number, pitch: number, roll: number): Rigid {
  return { R: eulerToR(yaw, pitch, roll), t: [tx, ty, tz] };
}

export function mulR(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}

export function transposeR(a: number[]): number[] {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function applyR(R: number[], v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

export function rigidApply(T: Rigid, v: Vec3): Vec3 {
  const r = applyR(T.R, v);
  return [r[0] + T.t[0], r[1] + T.t[1], r[2] + T.t[2]];
}

/** a ∘ b : apply b first, then a. */
export function rigidCompose(a: Rigid, b: Rigid): Rigid {
  const R = mulR(a.R, b.R);
  const t = rigidApply(a, b.t);
  return { R, t };
}

export function rigidInverse(a: Rigid): Rigid {
  const Rt = transposeR(a.R);
  const t = applyR(Rt, a.t);
  return { R: Rt, t: [-t[0], -t[1], -t[2]] };
}

/** Rotation angle (rad) of R. */
export function rotationAngle(R: number[]): number {
  return Math.acos(clamp((R[0] + R[4] + R[8] - 1) / 2, -1, 1));
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Eigen-decomposition of a symmetric NxN matrix (Jacobi). Returns eigenvalues
 * and eigenvectors (columns of V, row-major n*n).
 */
export function jacobiEigen(Ain: number[], n: number): { values: number[]; vectors: number[] } {
  const A = Ain.slice();
  const V = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-24) break;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  const values = Array.from({ length: n }, (_, i) => A[i * n + i]);
  return { values, vectors: V };
}

/**
 * Best-fit rigid (optionally similarity) transform mapping src -> dst for
 * corresponding points (Horn's quaternion method / Umeyama scale).
 */
export function bestFitTransform(
  src: Float32Array | number[],
  dst: Float32Array | number[],
  n: number,
  withScale = false,
): Rigid & { scale: number } {
  let sx = 0, sy = 0, sz = 0, dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i * 3]; sy += src[i * 3 + 1]; sz += src[i * 3 + 2];
    dx += dst[i * 3]; dy += dst[i * 3 + 1]; dz += dst[i * 3 + 2];
  }
  sx /= n; sy /= n; sz /= n; dx /= n; dy /= n; dz /= n;
  const S = new Array(9).fill(0);
  let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const a0 = src[i * 3] - sx, a1 = src[i * 3 + 1] - sy, a2 = src[i * 3 + 2] - sz;
    const b0 = dst[i * 3] - dx, b1 = dst[i * 3 + 1] - dy, b2 = dst[i * 3 + 2] - dz;
    S[0] += a0 * b0; S[1] += a0 * b1; S[2] += a0 * b2;
    S[3] += a1 * b0; S[4] += a1 * b1; S[5] += a1 * b2;
    S[6] += a2 * b0; S[7] += a2 * b1; S[8] += a2 * b2;
    varSrc += a0 * a0 + a1 * a1 + a2 * a2;
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ];
  const { values, vectors } = jacobiEigen(N, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const q = [vectors[best], vectors[4 + best], vectors[8 + best], vectors[12 + best]];
  const [w, x, y, z] = q;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  let sc = 1;
  if (withScale && varSrc > 0) {
    // Umeyama: s = trace(D S) / var_src, using projected correlation of rotated source.
    let num = 0;
    for (let i = 0; i < n; i++) {
      const a: Vec3 = [src[i * 3] - sx, src[i * 3 + 1] - sy, src[i * 3 + 2] - sz];
      const ra = applyR(R, a);
      num += ra[0] * (dst[i * 3] - dx) + ra[1] * (dst[i * 3 + 1] - dy) + ra[2] * (dst[i * 3 + 2] - dz);
    }
    sc = num / varSrc;
  }
  const rs = applyR(R, [sx, sy, sz]);
  return { R, t: [dx - sc * rs[0], dy - sc * rs[1], dz - sc * rs[2]], scale: sc };
}
