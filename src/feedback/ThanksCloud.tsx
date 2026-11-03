import { useEffect, useRef } from 'react';

/**
 * A warm picture made of points: a mother showing her child a small floating point cloud, the way the lab has shown it to the learner.
 * Everything moves slowly. They breathe, the lesson turns and glows, the mother's hand drifts, and fireflies rise. Both heads, the child's raised arm and the whole
 * scene follow the pointer, and points near the pointer part and glow. Canvas 2D only (no WebGL context), at most 30 frames a second, and one still
 * frame when the visitor prefers reduced motion.
 */
export interface Pointer { x: number; y: number; on: boolean; /** the button is held: drag to turn the scene */ down?: boolean; /** counts presses: each one sends a shockwave through the points */ pulse?: number }
const FRAME_MS = 1000 / 30, SETTLE_S = 3.6, RING_S = 10, LEVELS = 8;

// parts that move on their own: 1 mother's head, 2 child's head, 3 mother's forearm, 4 child's raised forearm, 5 the lesson (a small cloud), 6 fireflies; 0 body, 7 ground
const MX = -0.46, CX = 0.5;
const NECK_M = [MX, 1.45, 0], NECK_C = [CX, 0.93, 0], ELBOW_M = [MX + 0.34, 1.42, 0], ELBOW_C = [CX - 0.2, 0.98, 0], HOLO_Y = 1.78;

interface Cloud { n: number; x: Float32Array; y: Float32Array; z: Float32Array; sx: Float32Array; sy: Float32Array; sz: Float32Array; r: Float32Array; d: Float32Array; part: Uint8Array; hue: Uint8Array; ph: Float32Array }
let cached: Cloud | undefined;

function build(): Cloud {
  let seed = 7771; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const P: { x: number; y: number; z: number; part: number; hue: number }[] = [];
  const add = (x: number, y: number, z: number, part: number, hue: number) => P.push({ x, y, z, part, hue });
  /** points on an ellipsoid; `keep` can cut a piece away (hair only on the top and back of a head) */
  const ell = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number, part: number, hue: number, keep?: (x: number, y: number, z: number) => boolean) => {
    for (let i = 0, made = 0; made < n && i < n * 6; i++) {
      const u = rnd() * 2 - 1, a = rnd() * 6.2832, s = Math.sqrt(1 - u * u), k = 0.96 + 0.04 * rnd(), x = cx + rx * s * Math.cos(a) * k, y = cy + ry * u * k, z = cz + rz * s * Math.sin(a) * k;
      if (!keep || keep(x - cx, y - cy, z - cz)) { add(x, y, z, part, hue); made++; }
    }
  };
  /** a tube from a to b whose radius runs from r0 to r1 (flat: how much thinner it is front to back) */
  const cap = (a: number[], b: number[], r0: number, r1: number, n: number, part: number, hue: number, flat = 1) => {
    const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(ax[0], ax[1], ax[2]) || 1, u = ax.map((v) => v / len);
    const h = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], p = [u[1] * h[2] - u[2] * h[1], u[2] * h[0] - u[0] * h[2], u[0] * h[1] - u[1] * h[0]], pl = Math.hypot(p[0], p[1], p[2]) || 1, e1 = p.map((v) => v / pl), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    for (let i = 0; i < n; i++) {
      const t = rnd(), a2 = rnd() * 6.2832, r = r0 + (r1 - r0) * t, c = Math.cos(a2) * r, s = Math.sin(a2) * r * flat;
      add(a[0] + ax[0] * t + e1[0] * c + e2[0] * s, a[1] + ax[1] * t + e1[1] * c + e2[1] * s, a[2] + ax[2] * t + e1[2] * c + e2[2] * s, part, hue);
    }
  };
  // palette: 0 ground, 1 mother, 2 child, 3 hair, 4 light (the lesson, the book, fireflies)
  // the mother
  ell(MX, 1.56, 0, 0.105, 0.125, 0.1, 260, 1, 1);
  ell(MX, 1.58, -0.015, 0.113, 0.13, 0.112, 130, 1, 3, (_x, y, z) => y > 0.02 || z < -0.02);
  ell(MX, 1.69, -0.08, 0.06, 0.055, 0.06, 80, 1, 3);
  cap([MX, 1.42, 0], [MX, 1.49, 0], 0.045, 0.045, 36, 0, 1);
  cap([MX, 1.38, 0], [MX, 1.0, 0], 0.16, 0.12, 560, 0, 1, 0.72);
  cap([MX, 1.0, 0], [MX, 0.34, 0], 0.12, 0.3, 700, 0, 1, 0.85);
  cap([MX - 0.07, 0.36, 0], [MX - 0.07, 0.03, 0], 0.045, 0.04, 110, 0, 1); cap([MX + 0.07, 0.36, 0], [MX + 0.07, 0.03, 0], 0.045, 0.04, 110, 0, 1);
  cap([MX - 0.18, 1.37, 0], [MX - 0.27, 1.15, 0.02], 0.045, 0.04, 100, 0, 1); cap([MX - 0.27, 1.15, 0.02], [MX - 0.22, 0.93, 0.05], 0.04, 0.03, 100, 0, 1); ell(MX - 0.22, 0.9, 0.05, 0.035, 0.04, 0.03, 36, 0, 1);
  cap([MX + 0.18, 1.38, 0], ELBOW_M, 0.045, 0.04, 110, 0, 1); // the arm she holds out towards the lesson
  cap(ELBOW_M, [MX + 0.54, 1.66, 0], 0.04, 0.028, 120, 3, 1); ell(MX + 0.56, 1.69, 0, 0.035, 0.04, 0.03, 40, 3, 1);
  // the child
  ell(CX, 0.97, 0, 0.088, 0.102, 0.084, 220, 2, 2);
  ell(CX, 0.99, -0.012, 0.094, 0.104, 0.09, 110, 2, 3, (_x, y, z) => y > 0.015 || z < -0.02);
  cap([CX, 0.9, 0], [CX, 0.95, 0], 0.035, 0.035, 26, 0, 2);
  cap([CX, 0.9, 0], [CX, 0.6, 0], 0.1, 0.085, 300, 0, 2, 0.75);
  cap([CX - 0.045, 0.62, 0], [CX - 0.045, 0.03, 0], 0.038, 0.032, 120, 0, 2); cap([CX + 0.045, 0.62, 0], [CX + 0.045, 0.03, 0], 0.038, 0.032, 120, 0, 2);
  cap([CX - 0.1, 0.88, 0], ELBOW_C, 0.032, 0.028, 70, 0, 2); cap(ELBOW_C, [CX - 0.3, 1.2, 0], 0.028, 0.022, 80, 4, 2); ell(CX - 0.31, 1.23, 0, 0.028, 0.032, 0.024, 30, 4, 2);
  cap([CX + 0.1, 0.88, 0], [CX + 0.15, 0.72, 0.03], 0.032, 0.028, 70, 0, 2); cap([CX + 0.15, 0.72, 0.03], [CX + 0.1, 0.6, 0.06], 0.028, 0.024, 60, 0, 2);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) { const x = CX + 0.04 + i * 0.016, y = 0.54 + j * 0.016; add(x, y, 0.08, 0, 4); if (i % 2 === 0) add(x, y, 0.1, 0, 4); } // a small book
  // the lesson: a little point cloud (a cube, with a ring beneath) turning between them
  for (let f = 0; f < 6; f++) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const u = (i / 5 - 0.5) * 0.3, v = (j / 5 - 0.5) * 0.3, s = f % 2 ? 0.15 : -0.15, p = f < 2 ? [s, u, v] : f < 4 ? [u, s, v] : [u, v, s];
    add(p[0], HOLO_Y + p[1], p[2], 5, 4);
  }
  for (let i = 0; i < 70; i++) { const a = (i / 70) * 6.2832; add(Math.cos(a) * 0.27, HOLO_Y - 0.24, Math.sin(a) * 0.27, 5, 4); }
  for (let i = 0; i < 40; i++) add((rnd() - 0.5) * 0.24, HOLO_Y + (rnd() - 0.5) * 0.24, (rnd() - 0.5) * 0.24, 5, 4);
  // the ground, in soft rings, and fireflies that drift upwards
  // in front of the figures the ground slopes down towards the viewer, so the scan spreads out under the words too
  for (let r = 0.45; r < 6.4; r += 0.12 + 0.03 * r) { const n = Math.max(8, Math.round((Math.PI * 2 * r) / (0.15 + 0.03 * r))), off = rnd() * 6.28; for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2, x = Math.cos(a) * r * 1.5, z = Math.sin(a) * r * 0.9; if (z > -4.2 && z < 3.4) add(x, z < -0.8 ? -0.3 * Math.pow(-z - 0.8, 1.7) : 0, z, 7, 0); } }
  // both sides of the picture: trees, lamp posts, small houses and distant ridges, so the scene fills a wide window
  const tree = (x: number, z: number, h: number) => { cap([x, 0, z], [x, 0.3 + h * 0.4, z], 0.05, 0.035, 60, 0, 3); ell(x, 0.35 + h * 0.62, z, 0.2 + h * 0.2, 0.25 + h * 0.3, 0.2 + h * 0.2, Math.round(160 + 150 * h), 0, rnd() < 0.5 ? 2 : 1); };
  const lamp = (x: number, z: number) => { cap([x, 0, z], [x, 1.35, z], 0.022, 0.016, 40, 0, 0); ell(x, 1.4, z, 0.05, 0.05, 0.05, 40, 0, 4); };
  const house = (cx: number, cz: number, w: number, d: number, h: number, hue: number) => {
    for (let i = 0; i <= Math.round(w / 0.07); i++) for (let j = 0; j * 0.08 < h; j++) { const x = cx - w / 2 + i * 0.07; add(x, j * 0.08, cz + d / 2, 0, hue); add(x, j * 0.08, cz - d / 2, 0, hue); }
    for (let i = 0; i <= Math.round(d / 0.07); i++) for (let j = 0; j * 0.08 < h; j++) { const z = cz - d / 2 + i * 0.07; add(cx - w / 2, j * 0.08, z, 0, hue); add(cx + w / 2, j * 0.08, z, 0, hue); }
    for (let i = 0; i <= Math.round(w / 0.07); i++) for (let k = 0; k <= 6; k++) { const x = cx - w / 2 + i * 0.07, rz = (k / 6 - 0.5) * d, y = h + (0.5 - Math.abs(k / 6 - 0.5)) * 0.35; add(x, y, cz + rz, 0, 3); } // a gable roof
  };
  for (const [x, z, h] of [[-2.3, 0.5, 1.1], [-2.9, -0.7, 1.5], [-3.5, 0.6, 1.2], [-4.2, -0.3, 1.6], [2.4, 0.6, 1.2], [3.0, -0.6, 1.5], [3.6, 0.5, 1.1], [4.3, -0.4, 1.7], [-1.6, -1.5, 0.9], [1.7, -1.6, 1.0]] as [number, number, number][]) tree(x, z, h);
  for (const [x, z] of [[-1.95, 0.9], [1.95, 0.9], [-3.2, 1.0], [3.3, 1.0]] as [number, number][]) lamp(x, z);
  house(-3.3, -1.7, 0.9, 0.7, 0.7, 1); house(-4.6, -0.9, 0.8, 0.7, 0.55, 2); house(3.5, -1.8, 1.0, 0.7, 0.8, 2); house(4.7, -0.8, 0.8, 0.7, 0.6, 1);
  for (const [z, amp, sh] of [[-2.9, 0.5, 0], [-3.4, 0.7, 1.7]] as [number, number, number][]) for (let x = -6.5; x <= 6.5; x += 0.06) { const y = 0.25 + amp * (0.5 + 0.35 * Math.sin(0.9 * x + sh) + 0.15 * Math.sin(2.3 * x + sh * 2)); add(x, y, z, 0, 0); if (Math.floor((x + 7) / 0.06) % 3 === 0) for (let k = 1; k <= 3; k++) add(x, y * (1 - k * 0.28), z, 0, 0); }
  for (let i = 0; i < 150; i++) add((rnd() - 0.5) * 9.2, rnd() * 2.6, (rnd() - 0.5) * 3.2, 6, 4);

  const n = P.length, c: Cloud = { n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n), r: new Float32Array(n), d: new Float32Array(n), part: new Uint8Array(n), hue: new Uint8Array(n), ph: new Float32Array(n) };
  P.forEach((p, i) => {
    c.x[i] = p.x; c.y[i] = p.y; c.z[i] = p.z; c.part[i] = p.part; c.hue[i] = p.hue; c.r[i] = Math.hypot(p.x, p.z); c.ph[i] = rnd() * 6.28;
    c.d[i] = p.part === 7 ? 0.1 + 0.4 * Math.min(1, c.r[i] / 6.4) : 0.35 + 0.5 * (1 - Math.min(1, p.y / 1.9)) + rnd() * 0.15; // the ground settles first, then the figures from the feet up
    const a = rnd() * 6.28; c.sx[i] = p.x + Math.cos(a) * (0.4 + rnd() * 0.8); c.sy[i] = p.y + 0.8 + rnd() * 1.4; c.sz[i] = p.z + Math.sin(a) * (0.4 + rnd() * 0.8); // each point drifts in from above
  });
  return c;
}

const PALETTE = ['255,196,150', '255,168,128', '255,214,142', '236,138,122', '255,240,205', '221,120,92', '226,126,96', '230,152,96', '200,100,96', '240,170,92']; // the last five are the same colours, deeper, for points that fall over the light part of the page
const STYLES = PALETTE.map((h) => Array.from({ length: LEVELS }, (_, l) => `rgba(${h},${(0.16 + 0.8 * ((l + 0.5) / LEVELS)).toFixed(3)})`));

export function ThanksCloud({ still, par, paused = false }: { still: boolean; par: React.RefObject<Pointer>; paused?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), stop = useRef(paused); stop.current = paused; // while the intro is leaving the picture freezes, so the app underneath gets the whole machine
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const g = cv.getContext('2d'); if (!g) return;
    const C = (cached ??= build()), N = C.n, HUES = 5, B = PALETTE.length * LEVELS, sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), bk = new Int16Array(N), counts = new Int32Array(B), start = new Int32Array(B + 1), fill = new Int32Array(B), order = new Int32Array(N);
    let frameNo = 0, W = 0, H = 0, heroH = 0, copy = { x0: 0, y0: 0, x1: 0, y1: 0 }, dpr = 1, raf = 0, t = still ? 16 : 0, last = performance.now(), lastDraw = 0, running = true, mx = 0, my = 0, mon = 0, cpx = 0.5, cpy = 0.5, dragYaw = 0, dragPit = 0, vYaw = 0, vPit = 0, lx = 0, ly = 0, wasDown = false, seenPulse = 0, pulseAt = -9;
    const fit = () => { dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); };
    const measure = () => { // where the hero ends and where the words are, so the scene is sized to the hero and leaves the words clear
      const root = cv.parentElement, r0 = cv.getBoundingClientRect(), hero = root?.querySelector('[data-cloud-hero]')?.getBoundingClientRect(), cp = root?.querySelector('[data-cloud-copy]')?.getBoundingClientRect();
      heroH = hero ? hero.height : H; copy = cp ? { x0: cp.left - r0.left, y0: cp.top - r0.top, x1: cp.right - r0.left, y1: cp.bottom - r0.top } : { x0: 0, y0: 0, x1: 0, y1: 0 };
    };
    fit(); measure(); const ro = new ResizeObserver(() => { fit(); measure(); frame(0); }); ro.observe(cv);

    /** world point -> screen, with the same turn and camera as the points */
    let cam3 = { ca: 1, sa: 0, cp: 1, sp: 0, scale: 1, cam: 5.5, cx: 0, cy: 0 };
    const proj = (x: number, y: number, z: number): [number, number, number] => { const y2 = y - 0.95, rx = x * cam3.ca + z * cam3.sa, rz = -x * cam3.sa + z * cam3.ca, ry = y2 * cam3.cp - rz * cam3.sp, dz = Math.max(1, y2 * cam3.sp + rz * cam3.cp + cam3.cam), f = (cam3.scale * cam3.cam) / dz; return [cam3.cx + rx * f, cam3.cy - ry * f, f / cam3.scale]; };
    /** one fairy at a time on each side: it drifts in from the edge on a lazy curve to the mother (left) or the child (right), lingers in a small shower of sparkles, and is gone for a while */
    const FAIRY_CYCLE = 13, FAIRY_TRAVEL = 7.5, FAIRY_STAY = 1.6;
    const fairy = (side: -1 | 1) => {
      const local = (t + (side < 0 ? 0 : FAIRY_CYCLE / 2)) % FAIRY_CYCLE; if (t < 5 || local > FAIRY_TRAVEL + FAIRY_STAY) return;
      const to = side < 0 ? [MX - 0.3, 1.55, 0.05] : [CX + 0.24, 1.02, 0.05], cyc = Math.floor((t + (side < 0 ? 0 : FAIRY_CYCLE / 2)) / FAIRY_CYCLE), r = Math.sin(cyc * 12.9898 + side * 78.233) * 43758.5453, ang = (r - Math.floor(r)) * 6.2832, // each visit comes from a different direction: above, below, either side or a diagonal
        from = [to[0] + Math.cos(ang) * 3.1, Math.max(0.2, to[1] + Math.sin(ang) * 1.8), to[2] + 0.5 * Math.cos(ang * 2)], col = side < 0 ? '255,196,214' : '255,226,160';
      const at = (u: number): [number, number, number] => { const e = u * u * (3 - 2 * u); return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e + 0.28 * Math.sin(u * 9 + side) * (1 - u), from[2] + (to[2] - from[2]) * e + 0.16 * Math.sin(u * 5)]; };
      const u = Math.min(1, local / FAIRY_TRAVEL), fade = local > FAIRY_TRAVEL ? Math.max(0, 1 - (local - FAIRY_TRAVEL) / FAIRY_STAY) : Math.min(1, local / 0.8);
      g!.globalCompositeOperation = 'lighter';
      for (let k = 14; k >= 1; k--) { const q = proj(...at(Math.max(0, u - k * 0.013))), a = (1 - k / 15) ** 2 * 0.55 * fade; g!.fillStyle = `rgba(${col},${a.toFixed(3)})`; const r = 2.6 * (1 - k / 17) * q[2] + 0.6; g!.beginPath(); g!.arc(q[0], q[1], r, 0, 6.2832); g!.fill(); } // a soft trail
      const h = proj(...at(u)), hr = 15 * h[2], gr = g!.createRadialGradient(h[0], h[1], 0, h[0], h[1], hr); gr.addColorStop(0, `rgba(${col},${(0.75 * fade).toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`); g!.fillStyle = gr; g!.fillRect(h[0] - hr, h[1] - hr, hr * 2, hr * 2);
      const flap = 0.55 + 0.45 * Math.sin(t * 22 + side); g!.fillStyle = `rgba(255,255,255,${(0.35 * fade).toFixed(3)})`; // two small wings
      for (const w of [-1, 1]) { g!.beginPath(); g!.ellipse(h[0] + w * 5 * h[2], h[1] - 3 * h[2], 6.5 * h[2] * flap + 0.5, 2.6 * h[2], w * -0.7, 0, 6.2832); g!.fill(); }
      g!.fillStyle = `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`; g!.beginPath(); g!.arc(h[0], h[1], 2.1 * h[2] + 0.6, 0, 6.2832); g!.fill();
      if (local > FAIRY_TRAVEL) { const age = (local - FAIRY_TRAVEL) / FAIRY_STAY; for (let j = 0; j < 12; j++) { const ang = j * 0.5236 + side, r = age * 0.42 * (0.6 + 0.4 * ((j * 7) % 5) / 4), q = proj(to[0] + Math.cos(ang) * r, to[1] + Math.sin(ang) * r * 0.9, to[2]); g!.fillStyle = `rgba(${col},${((1 - age) * 0.8).toFixed(3)})`; g!.beginPath(); g!.arc(q[0], q[1], 1.6 * q[2] + 0.5, 0, 6.2832); g!.fill(); } } // sparkles where it arrives
      g!.globalCompositeOperation = 'source-over';
    };
    function frame(dt: number) {
      t += dt;
      const p = par.current, live = !still && !!p?.on, k = Math.min(1, dt * 3);
      mx += ((live ? p!.x : 0) - mx) * k; my += ((live ? p!.y : 0) - my) * k; mon += ((live ? 1 : 0) - mon) * k; // the scene follows the pointer gently
      // the cursor itself follows quickly (the scene follows it slowly); a held button turns the scene, which keeps turning a little and then eases back
      const down = live && !!p!.down, kc = Math.min(1, dt * 14); if (live) { cpx += (p!.x + 0.5 - cpx) * kc; cpy += (p!.y + 0.5 - cpy) * kc; }
      if (live && (p!.pulse ?? 0) !== seenPulse) { seenPulse = p!.pulse ?? 0; pulseAt = t; }
      if (down) { if (wasDown && dt > 0) { const dyw = (p!.x - lx) * 5.6, dpt = (p!.y - ly) * 2.4; dragYaw += dyw; dragPit += dpt; vYaw = dyw / dt; vPit = dpt / dt; } lx = p!.x; ly = p!.y; }
      else if (dt > 0) { dragYaw += vYaw * dt; dragPit += vPit * dt; const f = Math.exp(-dt * 3.2); vYaw *= f; vPit *= f; const back = Math.exp(-dt * 0.32); dragYaw *= back; dragPit *= back; }
      wasDown = down; dragYaw = Math.max(-1.5, Math.min(1.5, dragYaw)); dragPit = Math.max(-0.35, Math.min(0.55, dragPit));
      const yaw = Math.sin(t * 0.13) * 0.26 + mx * 0.6 + dragYaw, pit = 0.1 + my * 0.2 + dragPit, ca = Math.cos(yaw), sa = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
      if (!(frameNo++ % 30)) measure();
      const scale = Math.min(W / 4.6, heroH / 2.5), cam = 5.5, cx = W * 0.5, cy = heroH * 0.43, breath = 1 + 0.007 * Math.sin(t * 1.15);
      const hyM = 0.32 + mx * 0.7 + 0.07 * Math.sin(t * 0.4), hpM = -0.04 + my * 0.45, hyC = -0.3 + mx * 0.6, hpC = -0.4 + my * 0.45 + 0.05 * Math.sin(t * 0.5);
      const armM = 0.14 * Math.sin(t * 0.7), armC = 0.22 * Math.sin(t * 0.9 + 1) - my * 0.3, holoA = t * 0.5, holoBob = 0.04 * Math.sin(t * 0.9), ringR = ((t % RING_S) / RING_S) * 4 - 0.3;
      const mpx = cpx * W, mpy = cpy * H, R = Math.max(62, Math.min(W, H * 2) * 0.055), age = t - pulseAt, pr = age * 640, pLife = Math.max(0, 1 - age / 1.5);
      const hc = Math.cos(holoA), hs = Math.sin(holoA);
      cam3 = { ca, sa, cp, sp, scale, cam, cx, cy };
      g!.setTransform(dpr, 0, 0, dpr, 0, 0); g!.clearRect(0, 0, W, H);
      // a warm glow where the lesson floats
      { const y = HOLO_Y + holoBob - 0.95, ry = y * cp, dz = y * sp + cam, f = (scale * cam) / dz, gx = cx, gy = cy - ry * f, rad = scale * 1.15, gr = g!.createRadialGradient(gx, gy, 0, gx, gy, rad); gr.addColorStop(0, 'rgba(255,205,150,0.22)'); gr.addColorStop(1, 'rgba(255,205,150,0)'); g!.fillStyle = gr; g!.fillRect(gx - rad, gy - rad, rad * 2, rad * 2); }
      if (mon > 0.02) { const hr = R * 1.5, hg = g!.createRadialGradient(mpx, mpy, 0, mpx, mpy, hr); hg.addColorStop(0, `rgba(255,214,160,${(0.2 * mon * (down ? 1.4 : 1)).toFixed(3)})`); hg.addColorStop(1, 'rgba(255,214,160,0)'); g!.fillStyle = hg; g!.fillRect(mpx - hr, mpy - hr, hr * 2, hr * 2); } // a warm glow under the cursor
      counts.fill(0);
      for (let i = 0; i < N; i++) {
        const part = C.part[i], ph = C.ph[i];
        const e0 = Math.min(1, Math.max(0, (t - 0.25 - C.d[i] * 2.6) / SETTLE_S)), e = e0 * e0 * (3 - 2 * e0); bk[i] = -1; if (e <= 0.01) continue;
        let x = C.sx[i] + (C.x[i] - C.sx[i]) * e, y = C.sy[i] + (C.y[i] - C.sy[i]) * e, z = C.sz[i] + (C.z[i] - C.sz[i]) * e;
        if (part === 6) { y = (C.y[i] + t * (0.05 + 0.04 * (ph % 1))) % 2.6; x += Math.sin(t * 0.3 + ph) * 0.06; }
        else if (part === 1 || part === 2) { // a head turns on its neck
          const n = part === 1 ? NECK_M : NECK_C, ya = part === 1 ? hyM : hyC, pa = part === 1 ? hpM : hpC, dx = x - n[0], dy = y - n[1], dz = z - n[2], c1 = Math.cos(ya), s1 = Math.sin(ya), x1 = dx * c1 + dz * s1, z1 = -dx * s1 + dz * c1, c2 = Math.cos(pa), s2 = Math.sin(pa);
          x = n[0] + x1; y = n[1] + dy * c2 - z1 * s2; z = n[2] + dy * s2 + z1 * c2;
        } else if (part === 3 || part === 4) { // a forearm swings about the elbow
          const n = part === 3 ? ELBOW_M : ELBOW_C, a = part === 3 ? armM : armC, dx = x - n[0], dy = y - n[1], c = Math.cos(a), s = Math.sin(a);
          x = n[0] + dx * c - dy * s; y = n[1] + dx * s + dy * c;
        } else if (part === 5) { const dx = x, dz = z; x = dx * hc + dz * hs; z = -dx * hs + dz * hc; y += holoBob; }
        if (part < 6) y *= breath;
        y -= 0.95;
        const rx = x * ca + z * sa, rz = -x * sa + z * ca, ry = y * cp - rz * sp, dzc = y * sp + rz * cp + cam; if (dzc < 1) continue;
        const f = (scale * cam) / dzc; let px = cx + rx * f, py = cy - ry * f, glow = 0;
        { const ddx = px - mpx, ddy = py - mpy, d = Math.hypot(ddx, ddy) + 0.001;
          if (mon > 0.02 && d < R) { const w = (1 - d / R) ** 1.5 * mon * (down ? 0.6 : 1); const sh = Math.sin(Math.min(1, d / (R * 0.5)) * 1.5708); /* no push right at the cursor, so no hole opens in the middle */ px += (ddx / d) * w * sh * 22 - (ddy / d) * w * sh * 10; py += (ddy / d) * w * sh * 22 + (ddx / d) * w * sh * 10; glow = Math.max(glow, w); } // points near the cursor are pushed away, swirl a little and light up
          if (pLife > 0 && mon > 0.02) { const wv = Math.exp(-(((d - pr) / 70) ** 2)) * pLife; if (wv > 0.02) { px += (ddx / d) * wv * 46; py += (ddy / d) * wv * 46; glow = Math.max(glow, wv); } } } // a press sends a ring outwards that shoves the points it passes
        const lit = Math.exp(-(((C.r[i] - ringR) / 0.2) ** 2)) * (t > 4 ? 1 : 0) * (part === 7 || part === 0 ? 1 : 0.5), tw = 0.9 + 0.1 * Math.sin(t * 0.8 + ph), depth = Math.min(1, Math.max(0.4, 1.3 - dzc / 12));
        const gap = Math.max(copy.x0 - 40 - px, px - copy.x1 - 40, copy.y0 - 14 - py, py - copy.y1 - 14), keepClear = copy.x1 > copy.x0 ? Math.max(0.08, Math.min(1, gap / 90)) : 1; // points drawn behind the words fade out, so the words stay easy to read
        const a0 = part === 6 ? (0.08 + 0.55 * Math.max(0, Math.sin(t * 1.2 + ph))) * e : Math.min(1, (0.58 * tw * depth + lit * 0.7 + glow * 1.1) * (0.25 + 0.75 * e)), a = a0 * keepClear;
        sx[i] = px; sy[i] = py; sz[i] = Math.max(1.1, Math.min(3, 1.9 * (f / scale) * (part === 6 ? 0.9 : 1) + lit * 1.2 + glow * 1.6));
        const hue0 = glow > 0.55 || lit > 0.5 ? 4 : C.hue[i], hue = py > heroH * 0.86 ? hue0 + HUES : hue0; bk[i] = hue * LEVELS + Math.min(LEVELS - 1, Math.floor(a * LEVELS)); counts[bk[i]]++;
      }
      start[0] = 0; for (let b = 0; b < B; b++) start[b + 1] = start[b] + counts[b];
      fill.set(start.subarray(0, B)); for (let i = 0; i < N; i++) if (bk[i] >= 0) order[fill[bk[i]]++] = i;
      for (let b = 0; b < B; b++) {
        if (start[b + 1] === start[b]) continue; g!.fillStyle = STYLES[(b / LEVELS) | 0][b % LEVELS]; g!.beginPath();
        for (let q = start[b]; q < start[b + 1]; q++) { const i = order[q], s = sz[i]; g!.rect(sx[i] - s / 2, sy[i] - s / 2, s, s); }
        g!.fill();
      }
      // a quiet scan floor under the picture: rows of warm dots that drift towards the viewer and thin out around the words, so the lower part of the page belongs to the scene too
      if (H > heroH * 1.08) {
        const y0 = heroH * 0.74, rows = 18;
        for (let k = 0; k < rows; k++) {
          const u = ((k + t * 0.16) % rows) / rows, yy = y0 + (H - y0) * u ** 1.7, sp = 12 + 52 * u ** 1.4, sz2 = 1.6 + 3.2 * u, base = 0.9 * Math.sin(Math.PI * u) ** 0.8, off = (k * 37) % sp;
          for (let x = -off; x < W; x += sp) {
            const gy = copy.x1 > copy.x0 ? Math.max(copy.x0 - 30 - x, x - copy.x1 - 30, copy.y0 - 10 - yy, yy - copy.y1 - 10) : 99, a2 = base * Math.max(0.05, Math.min(1, gy / 100)); if (a2 < 0.02) continue;
            g!.fillStyle = `rgba(222,112,84,${a2.toFixed(3)})`; const ywv = yy + Math.sin(x * 0.012 + t * 0.9 + k) * 2.2 * u; g!.fillRect(x - sz2 / 2, ywv - sz2 / 2, sz2, sz2);
          }
        }
      }
      fairy(-1); fairy(1);
    }
    const loop = (now: number) => {
      if (!running) return; raf = requestAnimationFrame(loop);
      if (document.hidden || stop.current) { last = now; return; }
      if (now - lastDraw < FRAME_MS - 2) return; const gap = now - last; last = now; lastDraw = now; frame(Math.min(0.1, gap / 1000));
    };
    frame(0); if (!still) raf = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [still, par]);
  return <canvas ref={ref} className="thanks-canvas" aria-hidden="true" data-testid="thanks-canvas" />;
}
