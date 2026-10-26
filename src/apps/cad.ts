import { makeRng } from '../core/rng';

export interface Seg2 { x1: number; y1: number; x2: number; y2: number }
export const segLen = (s: Seg2) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** x, y of every point whose height is inside [zMin, zMax]. */
export function slicePoints(pos: Float32Array, n: number, zMin: number, zMax: number): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const z = pos[i * 3 + 2]; if (z >= zMin && z <= zMax) out.push(pos[i * 3], pos[i * 3 + 1]); }
  return Float32Array.from(out);
}

export interface Grid { w: number; h: number; x0: number; y0: number; cell: number; count: Uint16Array; max: number }
export function rasterize(xy: Float32Array, cell: number, bounds?: { x0: number; y0: number; x1: number; y1: number }): Grid {
  const n = xy.length / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (bounds) ({ x0, y0, x1, y1 } = bounds); else for (let i = 0; i < n; i++) { x0 = Math.min(x0, xy[i * 2]); x1 = Math.max(x1, xy[i * 2]); y0 = Math.min(y0, xy[i * 2 + 1]); y1 = Math.max(y1, xy[i * 2 + 1]); }
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  const w = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), h = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
  const count = new Uint16Array(w * h); let max = 0;
  for (let i = 0; i < n; i++) { const ix = Math.floor((xy[i * 2] - x0) / cell), iy = Math.floor((xy[i * 2 + 1] - y0) / cell); if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue; const v = ++count[iy * w + ix]; if (v > max) max = v; }
  return { w, h, x0, y0, cell, count, max };
}

/**
 * Wall lines from the slice: repeat "find the line with most points near it" (RANSAC in 2D), cut the inliers into runs
 * at gaps, keep runs that are long enough to be a wall, remove the inliers and look for the next line.
 */
export function extractWalls(xy: Float32Array, o: { tol: number; minLen: number; minPts: number; maxLines: number; gap: number; seed: number }): Seg2[] {
  const rng = makeRng(o.seed);
  let pts: number[] = Array.from({ length: xy.length / 2 }, (_, i) => i);
  const segs: Seg2[] = [];
  for (let line = 0; line < o.maxLines && pts.length >= o.minPts; line++) {
    let best = { cnt: 0, a: 0, b: 0, c: 0 };
    for (let t = 0; t < 400; t++) {
      const i = pts[rng.int(pts.length)], j = pts[rng.int(pts.length)];
      const dx = xy[j * 2] - xy[i * 2], dy = xy[j * 2 + 1] - xy[i * 2 + 1], l = Math.hypot(dx, dy);
      if (l < 0.3) continue;
      const a = -dy / l, b = dx / l, c = -(a * xy[i * 2] + b * xy[i * 2 + 1]);
      let cnt = 0;
      for (let k = 0; k < pts.length; k += 3) { const p = pts[k]; if (Math.abs(a * xy[p * 2] + b * xy[p * 2 + 1] + c) <= o.tol) cnt++; }
      if (cnt > best.cnt) best = { cnt, a, b, c };
    }
    if (best.cnt * 3 < o.minPts) break;
    const inl: number[] = [], rest: number[] = [];
    for (const p of pts) (Math.abs(best.a * xy[p * 2] + best.b * xy[p * 2 + 1] + best.c) <= o.tol ? inl : rest).push(p);
    pts = rest;
    // position along the line, then split into runs where there is a gap
    const dirx = best.b, diry = -best.a;
    const ts = inl.map((p) => ({ t: xy[p * 2] * dirx + xy[p * 2 + 1] * diry, p })).sort((u, v) => u.t - v.t);
    let start = 0;
    for (let k = 1; k <= ts.length; k++) {
      if (k === ts.length || ts[k].t - ts[k - 1].t > o.gap) {
        const run = ts.slice(start, k); start = k;
        if (run.length < o.minPts || run[run.length - 1].t - run[0].t < o.minLen) continue;
        // snap the run's ends onto the fitted line (mean offset removed)
        let off = 0; for (const r of run) off += best.a * xy[r.p * 2] + best.b * xy[r.p * 2 + 1] + best.c; off /= run.length;
        const bx = -best.a * (best.c + off) * -1, by = -best.b * (best.c + off) * -1; // point on the line: −(c)·(a, b), shifted by the mean offset
        const px = -best.a * (best.c + off), py = -best.b * (best.c + off);
        void bx; void by;
        const t0 = run[0].t, t1 = run[run.length - 1].t, tp = px * dirx + py * diry;
        segs.push({ x1: px + dirx * (t0 - tp), y1: py + diry * (t0 - tp), x2: px + dirx * (t1 - tp), y2: py + diry * (t1 - tp) });
      }
    }
  }
  return segs.sort((u, v) => segLen(v) - segLen(u));
}

/** CAD clean-up: turn the wall directions into exact right angles (within tolDeg) and optionally rotate the plan so walls run along x and y. */
export function straighten(segs: Seg2[], tolDeg = 10, alignToAxes = true): Seg2[] {
  if (!segs.length) return segs;
  const ang = (s: Seg2) => Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const a0 = ang(segs[0]); // longest wall defines the main direction
  const D = Math.PI / 180;
  let out = segs.map((s) => {
    const rel = ((ang(s) - a0) % Math.PI + Math.PI) % Math.PI; // 0..π
    const target = Math.abs(rel) < tolDeg * D || Math.abs(rel - Math.PI) < tolDeg * D ? 0 : Math.abs(rel - Math.PI / 2) < tolDeg * D ? Math.PI / 2 : null;
    if (target === null) return s;
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, h = segLen(s) / 2, a = a0 + target;
    return { x1: mx - Math.cos(a) * h, y1: my - Math.sin(a) * h, x2: mx + Math.cos(a) * h, y2: my + Math.sin(a) * h };
  });
  if (alignToAxes) {
    const c = Math.cos(-a0), s2 = Math.sin(-a0);
    const rot = (x: number, y: number): [number, number] => [x * c - y * s2, x * s2 + y * c];
    out = out.map((s) => { const [x1, y1] = rot(s.x1, s.y1), [x2, y2] = rot(s.x2, s.y2); return { x1, y1, x2, y2 }; });
  }
  return out;
}

export const bboxOf = (segs: Seg2[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) { x0 = Math.min(x0, s.x1, s.x2); x1 = Math.max(x1, s.x1, s.x2); y0 = Math.min(y0, s.y1, s.y2); y1 = Math.max(y1, s.y1, s.y2); }
  return { x0, y0, x1, y1 };
};

/** Minimal ASCII DXF (R12) with one LINE per wall on layer WALLS. Opens in AutoCAD, BricsCAD, LibreCAD, QCAD and most CAD viewers. */
export function toDXF(segs: Seg2[], layer = 'WALLS'): string {
  const f = (v: number) => v.toFixed(4);
  const L = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const s of segs) L.push('0', 'LINE', '8', layer, '10', f(s.x1), '20', f(s.y1), '30', '0.0', '11', f(s.x2), '21', f(s.y2), '31', '0.0');
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\n') + '\n';
}

/** Direction (radians) of the longest straight wall in the slice: used to turn the plan so walls run along x and y. */
export function dominantAngle(xy: Float32Array, seed = 4): number {
  const w = extractWalls(xy, { tol: 0.05, minLen: 1, minPts: 40, maxLines: 3, gap: 3, seed });
  return w.length ? Math.atan2(w[0].y2 - w[0].y1, w[0].x2 - w[0].x1) : 0;
}

export interface Plan { angle: number; walls: Seg2[]; /** the same walls back in the scan's own frame */ world: Seg2[] }

/**
 * Walls of a room whose walls meet at right angles (most buildings): turn the slice so the walls are along x and y,
 * find where the points pile up along each axis (those piles are the walls), then draw each wall from its first to its
 * last point. Doors and windows leave gaps; gaps shorter than `gap` are drawn across.
 */
export function extractPlan(xy: Float32Array, o: { tol: number; minLen: number; gap: number; seed?: number; angle?: number }): Plan {
  const n = xy.length / 2;
  if (n < 50) return { angle: o.angle ?? 0, walls: [], world: [] };
  const angle = o.angle ?? dominantAngle(xy, o.seed ?? 4), c = Math.cos(-angle), s = Math.sin(-angle);
  const R = new Float32Array(xy.length);
  for (let i = 0; i < n; i++) { R[i * 2] = xy[i * 2] * c - xy[i * 2 + 1] * s; R[i * 2 + 1] = xy[i * 2] * s + xy[i * 2 + 1] * c; }
  const walls: Seg2[] = [];
  for (const axis of [0, 1] as const) {
    const other = 1 - axis, bin = 0.04;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const v = R[i * 2 + axis]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const nb = Math.max(1, Math.ceil((hi - lo) / bin) + 1), hist = new Float64Array(nb);
    for (let i = 0; i < n; i++) hist[Math.floor((R[i * 2 + axis] - lo) / bin)]++;
    const half = Math.max(1, Math.round(o.tol / bin));
    const score = Float64Array.from(hist, (_, b) => { let t = 0; for (let k = -half; k <= half; k++) t += hist[b + k] ?? 0; return t; });
    // a wall is a pile that is also a local maximum within 0.4 m
    const order = Array.from(score.keys()).sort((a, b) => score[b] - score[a]), taken: number[] = [];
    const need = Math.max(40, o.minLen * 12);
    for (const b of order) {
      if (score[b] < need) break;
      if (taken.some((t) => Math.abs(t - b) * bin < 0.4)) continue;
      taken.push(b);
      const pos = lo + b * bin + bin / 2;
      const along: number[] = [];
      for (let i = 0; i < n; i++) if (Math.abs(R[i * 2 + axis] - pos) <= o.tol) along.push(R[i * 2 + other]);
      along.sort((p, q) => p - q);
      let start = 0;
      for (let k = 1; k <= along.length; k++) {
        if (k === along.length || along[k] - along[k - 1] > o.gap) {
          const a0 = along[start], a1 = along[k - 1], cnt = k - start;
          start = k;
          if (a1 - a0 < o.minLen || cnt < 20) continue;
          walls.push(axis === 0 ? { x1: pos, y1: a0, x2: pos, y2: a1 } : { x1: a0, y1: pos, x2: a1, y2: pos });
        }
      }
    }
  }
  walls.sort((p, q) => segLen(q) - segLen(p));
  const ci = Math.cos(angle), si = Math.sin(angle);
  const back = (x: number, y: number): [number, number] => [x * ci - y * si, x * si + y * ci];
  const world = walls.map((w) => { const [x1, y1] = back(w.x1, w.y1), [x2, y2] = back(w.x2, w.y2); return { x1, y1, x2, y2 }; });
  return { angle, walls, world };
}

/**
 * Furniture hides a wall low down and windows hide it higher up, so one slice can miss a wall. Look at the lower half,
 * the upper half and the whole band with the same wall direction, and keep each wall once (the longer one wins).
 */
export function extractPlanBands(pos: Float32Array, n: number, z0: number, z1: number, o: { tol: number; minLen: number; gap: number; seed?: number }): Plan {
  const whole = extractPlan(slicePoints(pos, n, z0, z1), o), mid = (z0 + z1) / 2;
  const runs = [whole, extractPlan(slicePoints(pos, n, z0, mid), { ...o, angle: whole.angle }), extractPlan(slicePoints(pos, n, mid, z1), { ...o, angle: whole.angle })];
  const walls: Seg2[] = [];
  for (const w of runs.flatMap((r) => r.walls).sort((p, q) => segLen(q) - segLen(p))) {
    const vert = w.x1 === w.x2, at = vert ? w.x1 : w.y1;
    const dup = walls.some((k) => (k.x1 === k.x2) === vert && Math.abs((vert ? k.x1 : k.y1) - at) < 0.3);
    if (!dup) walls.push(w);
  }
  const ci = Math.cos(whole.angle), si = Math.sin(whole.angle);
  const back = (x: number, y: number): [number, number] => [x * ci - y * si, x * si + y * ci];
  const world = walls.map((w) => { const [x1, y1] = back(w.x1, w.y1), [x2, y2] = back(w.x2, w.y2); return { x1, y1, x2, y2 }; });
  return { angle: whole.angle, walls, world };
}
