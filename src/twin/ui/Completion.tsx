import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from '../../ui/controls';

export interface CompletionStats { score: number | null; objectsFound?: number; coverage?: number; markerPx?: number }

// ---------------------------------------------------------------------------------------------------------------- a point cloud to look at
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** A small factory as points: the floor, the walls' edges, shelves and machines. Always the same. */
const CLOUD = (() => {
  const r = rng(11), pts: number[] = [];
  const line = (a: number[], b: number[], n: number) => { for (let i = 0; i < n; i++) { const t = i / n; pts.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); } };
  for (let i = 0; i < 1500; i++) pts.push(r() * 24 - 12, r() * 16 - 8, 0);
  const c = [[-12, -8], [12, -8], [12, 8], [-12, 8]];
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; line([a[0], a[1], 0], [a[0], a[1], 6], 90); line([a[0], a[1], 6], [b[0], b[1], 6], 150); line([a[0], a[1], 0], [b[0], b[1], 0], 150); }
  for (let k = 0; k < 16; k++) {
    const x = r() * 20 - 10, y = r() * 12 - 6, w = 0.8 + r() * 2.2, d = 0.8 + r() * 1.6, h = 0.8 + r() * 2.6;
    for (let i = 0; i < 150; i++) { const f = r(); if (f < 0.34) pts.push(x + r() * w, y + (r() < 0.5 ? 0 : d), r() * h); else if (f < 0.68) pts.push(x + (r() < 0.5 ? 0 : w), y + r() * d, r() * h); else pts.push(x + r() * w, y + r() * d, h); }
  }
  return Float32Array.from(pts);
})();

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** One frame of the background: a rotating point cloud of the factory, a scan wave that sweeps over it, a deep blue sky. */
function drawBackground(g: CanvasRenderingContext2D, w: number, h: number, t: number, calm = false) {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#040a1c'); sky.addColorStop(0.6, '#0a1d3f'); sky.addColorStop(1, '#10336b');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.55); glow.addColorStop(0, 'rgba(56,130,246,.30)'); glow.addColorStop(1, 'rgba(56,130,246,0)'); g.fillStyle = glow; g.fillRect(0, 0, w, h);
  const ang = t * (calm ? 0.12 : 0.22) + 0.6, ca = Math.cos(ang), sa = Math.sin(ang), el = 0.5, ce = Math.cos(el), se = Math.sin(el), D = 31, f = h * 1.05, wave = ((t * 0.55) % 1.35) * 17;
  const lo = [59, 130, 246], mid = [125, 211, 252], hi = [255, 255, 255];
  for (let i = 0; i < CLOUD.length; i += 3) {
    const x = CLOUD[i], y = CLOUD[i + 1], z = CLOUD[i + 2], xr = x * ca - y * sa, yr = x * sa + y * ca, yy = yr * ce - (z - 2) * se, zz = yr * se + (z - 2) * ce + D;
    if (zz < 4) continue;
    const px = w / 2 + (f * xr) / zz, py = h * 0.62 - (f * yy) / zz;
    if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
    const near = Math.abs(Math.hypot(x, y) - wave), hot = Math.max(0, 1 - near / 1.6), zt = Math.min(1, z / 5), col = zt < 0.5 ? mix(lo, mid, zt * 2) : mix(mid, hi, (zt - 0.5) * 2);
    const a = Math.min(0.95, Math.max(0.2, 1.25 - zz / 46)) + hot * 0.4, s = Math.max(1, (w / 640) * (1.5 + (hot * 2.2)) * (22 / zz));
    g.fillStyle = hot > 0.15 ? `rgba(180,235,255,${Math.min(1, a)})` : `rgba(${col[0]},${col[1]},${col[2]},${a})`; g.fillRect(px - s / 2, py - s / 2, s, s);
  }
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------------------------------------------- the celebration, all made of points
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
type Cam = { w: number; h: number; ang: number; el: number; D: number; f: number; cy: number };
const project = (c: Cam, x: number, y: number, z: number): [number, number, number] | null => {
  const ca = Math.cos(c.ang), sa = Math.sin(c.ang), xr = x * ca - y * sa, yr = x * sa + y * ca, ce = Math.cos(c.el), se = Math.sin(c.el), yy = yr * ce - z * se, zz = yr * se + z * ce + c.D;
  return zz < 2 ? null : [c.w / 2 + (c.f * xr) / zz, c.cy - (c.f * yy) / zz, zz];
};
const dot = (g: CanvasRenderingContext2D, x: number, y: number, s: number, style: string) => { g.fillStyle = style; g.fillRect(x - s / 2, y - s / 2, s, s); };

/** A LiDAR in the middle of the factory: rings of points, one for every channel, turning round it. */
const RINGS = (() => { const out: number[] = []; for (let k = 0; k < 40; k++) { const ph = -0.62 + k * 0.026, rr = ph < -0.02 ? 1.6 / Math.tan(-ph) : 18; for (let a = 0; a < 190; a++) { const th = (a / 190) * Math.PI * 2; out.push(Math.cos(th) * Math.min(rr, 26), Math.sin(th) * Math.min(rr, 26), ph < -0.02 ? 0 : 1.6 + (k - 24) * 0.6, k / 40); } } return Float32Array.from(out); })();
function bgRings(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cam: Cam = { w, h, ang: t * 0.16, el: 0.62, D: 26, f: h * 1.0, cy: h * 0.64 }, u = w / 1280;
  for (let i = 0; i < RINGS.length; i += 4) { const p = project(cam, RINGS[i], RINGS[i + 1], RINGS[i + 2]); if (!p) continue; const k = RINGS[i + 3], beam = Math.max(0, 1 - Math.abs(((Math.atan2(RINGS[i + 1], RINGS[i]) - t * 1.3) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / 0.35); dot(g, p[0], p[1], Math.max(1.2, (1.6 + beam * 2.2) * u * 18 / p[2]), `hsla(${190 + k * 140},90%,${60 + beam * 30}%,${Math.min(1, 0.25 + 20 / p[2] + beam * 0.5)})`); }
  dot(g, w / 2, cam.cy - 40 * u, 9 * u, '#fff');
}
/** A surface of points that rolls like water. */
function bgWaves(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cam: Cam = { w, h, ang: Math.sin(t * 0.07) * 0.5, el: 0.55, D: 30, f: h * 1.05, cy: h * 0.62 }, u = w / 1280;
  for (let gx = -30; gx <= 30; gx++) for (let gy = -20; gy <= 20; gy++) {
    const x = gx * 0.8, y = gy * 0.8, z = Math.sin(x * 0.45 + t * 0.9) * 0.9 + Math.cos(y * 0.5 - t * 0.7) * 0.7 + Math.sin((x + y) * 0.25 + t * 0.4) * 0.6, p = project(cam, x, y, z); if (!p) continue;
    const k = clamp01((z + 2.2) / 4.4); dot(g, p[0], p[1], Math.max(1.2, 2.2 * u * 22 / p[2]), `rgba(${Math.round(70 + 180 * k)},${Math.round(140 + 100 * k)},255,${Math.min(1, 0.22 + 18 / p[2])})`);
  }
}
/** A galaxy of points turning slowly. */
const GALAXY = (() => { const r = rng(23), out: number[] = []; for (let i = 0; i < 5200; i++) { const arm = i % 3, d = Math.pow(r(), 0.7) * 17, a = arm * 2.094 + d * 0.42 + (r() - 0.5) * 0.5; out.push(Math.cos(a) * d, Math.sin(a) * d, (r() - 0.5) * (2.4 - d * 0.1), d / 17); } return Float32Array.from(out); })();
function bgGalaxy(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cam: Cam = { w, h, ang: t * 0.12, el: 1.0, D: 34, f: h * 1.15, cy: h * 0.55 }, u = w / 1280;
  for (let i = 0; i < GALAXY.length; i += 4) { const p = project(cam, GALAXY[i], GALAXY[i + 1], GALAXY[i + 2]); if (!p) continue; const k = GALAXY[i + 3]; dot(g, p[0], p[1], Math.max(1.2, 2.1 * u * 24 / p[2]), `hsla(${48 + k * 230},85%,${72 - k * 18}%,${Math.min(1, 0.3 + 22 / p[2])})`); }
}

/** Text as points: the pixels of the letters, sampled. Each point flies in from outside, settles with a small shimmer, and flies away again at the end. */
interface TextCloud { x: Float32Array; y: Float32Array; seed: Float32Array; n: number }
const textCache = new Map<string, TextCloud>();
function textCloud(text: string, w: number, h: number, cy: number, size: number, weight = 800): TextCloud {
  const key = `${text}|${w}|${h}|${cy}|${size}|${weight}`, hit = textCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true })!; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  let px = size; g.font = `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`; const maxW = w * 0.86; const m = g.measureText(text).width; if (m > maxW) { px = Math.floor(px * maxW / m); g.font = `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`; }
  g.fillText(text, w / 2, cy); const data = g.getImageData(0, 0, w, h).data; let step = Math.max(2, Math.round(w / 420)), xs: number[] = [], ys: number[] = [];
  for (;;) { xs = []; ys = []; for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] > 120) { xs.push(x); ys.push(y); } if (xs.length <= 5200) break; step++; }
  const r = rng(text.length * 131 + 7), seed = new Float32Array(xs.length); for (let i = 0; i < seed.length; i++) seed[i] = r();
  const out = { x: Float32Array.from(xs), y: Float32Array.from(ys), seed, n: xs.length }; textCache.set(key, out); return out;
}
/** `t0` the first point starts to fly in, it is all in place about 3 s later, `t1` they start to leave (omit to stay). */
function drawText(g: CanvasRenderingContext2D, tc: TextCloud, w: number, h: number, t: number, t0: number, t1: number | null, hue0 = 190, hue1 = 50) {
  const u = w / 1280, s = Math.max(2, 2.7 * u);
  for (let i = 0; i < tc.n; i++) {
    const sd = tc.seed[i], delay = (tc.x[i] / w) * 1.7 + sd * 0.8, p = ease((t - t0 - delay) / 2.4), leave = t1 === null ? 0 : ease((t - t1 - sd * 0.9) / 1.4);
    if (p <= 0 || leave >= 1) continue;
    const a = sd * 6.2832, far = (0.55 + sd * 0.8) * h, sx = w / 2 + Math.cos(a) * far * 1.5, sy = h / 2 + Math.sin(a) * far, ox = Math.cos(a + 1.1) * 40 * u * leave, oy = Math.sin(a + 1.1) * 40 * u * leave;
    const x = sx + (tc.x[i] - sx) * p + (p >= 1 ? Math.sin(t * 2.1 + i) * 0.9 * u : 0) + (leave > 0 ? Math.cos(a) * leave * w * 0.5 + ox : 0), y = sy + (tc.y[i] - sy) * p + (p >= 1 ? Math.cos(t * 1.7 + i * 1.3) * 0.9 * u : 0) + (leave > 0 ? Math.sin(a) * leave * h * 0.5 + oy : 0);
    const arrive = clamp01((p - 0.7) / 0.3), tw = 0.8 + 0.2 * Math.sin(t * 3 + i), hue = hue0 + (hue1 - hue0) * (tc.x[i] / w);
    dot(g, x, y, s * (0.8 + 0.5 * arrive) * (p < 1 ? 1.2 : tw), `hsla(${hue},${70 + 25 * arrive}%,${58 + 32 * arrive}%,${(0.35 + 0.65 * arrive) * (1 - leave)})`);
  }
}
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif', SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "Times New Roman", serif';
const fadeText = (g: CanvasRenderingContext2D, txt: string, y: number, size: number, weight: number, colour: string, a: number, family = SANS, style = '', tracking = 0) => {
  if (a <= 0) return; const w = g.canvas.width, u = w / 1280; g.save(); g.globalAlpha = clamp01(a); g.font = `${style} ${weight} ${size * u}px ${family}`.trim(); (g as unknown as { letterSpacing: string }).letterSpacing = `${tracking * u}px`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = colour; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 14 * u; g.fillText(txt, w / 2, y); g.restore();
};

/** How long the whole celebration lasts, in seconds. It is the length of the video too. */
export const CELEBRATION_SECONDS = 40;
const SCENES: [number, number][] = [[0, 10.5], [9.5, 21.5], [20.5, 31.5], [30.5, 40.5]]; // each background fades in and out over a second
const sceneAlpha = (t: number, [a, b]: [number, number]) => clamp01((t - a) / 1.2) * clamp01((b - t) / 1.2);

/** The celebration: four backgrounds made of points, one after the other, with the words made of points flying in. */
export function drawCelebration(g: CanvasRenderingContext2D, w: number, h: number, t0: number, name: string, stats: CompletionStats) {
  const t = t0 % CELEBRATION_SECONDS, u = w / 1280;
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#040a1c'); sky.addColorStop(0.6, '#0a1d3f'); sky.addColorStop(1, '#10336b'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const bgs = [(a: number) => { g.save(); g.globalAlpha = a; drawBackground(g, w, h, t); g.restore(); }, (a: number) => { g.save(); g.globalAlpha = a; bgRings(g, w, h, t); g.restore(); }, (a: number) => { g.save(); g.globalAlpha = a; bgWaves(g, w, h, t); g.restore(); }, (a: number) => { g.save(); g.globalAlpha = a; bgGalaxy(g, w, h, t); g.restore(); }];
  bgs.forEach((draw, i) => { const a = i === 0 && t < SCENES[0][1] - 1.2 ? clamp01((t + 0.0001) / 1.2) : sceneAlpha(t, SCENES[i]); if (a > 0.01) draw(a); });
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = vg; g.fillRect(0, 0, w, h);
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  // 1 · the title
  fadeText(g, 'CERTIFICATE OF COMPLETION', h * 0.18, 17, 700, '#7dd3fc', clamp01((t - 0.8) / 1.2) * clamp01((10.2 - t) / 0.8), SANS, '', 5);
  drawText(g, textCloud('Congratulations', w, h, h * 0.4, 150 * u), w, h, t, 1.2, 8.6, 200, 45);
  // 2 · the name
  drawText(g, textCloud(name, w, h, h * 0.42, 130 * u), w, h, t, 10.2, 19.2, 40, 200);
  const aName = clamp01((t - 14.6) / 1.4) * clamp01((20.2 - t) / 0.8);
  fadeText(g, 'for completing all seven missions of the', h * 0.6, 30, 400, '#cfe3ff', aName, SERIF, 'italic');
  fadeText(g, 'Industrial Digital Twin Challenge', h * 0.69, 50, 700, '#fde68a', clamp01((t - 15.6) / 1.4) * clamp01((20.2 - t) / 0.8), SERIF);
  fadeText(g, 'SENSING  ·  ALIGNING  ·  CLEANING  ·  DETECTING  ·  COLOUR  ·  CHANGE  ·  COMMISSIONING', h * 0.77, 13, 600, 'rgba(165,216,255,.85)', clamp01((t - 16.6) / 1.4) * clamp01((20.2 - t) / 0.8), SANS, '', 2.5);
  // 3 · what was done
  if (stats.score != null) drawText(g, textCloud(`${stats.score.toFixed(1)} / 100`, w, h, h * 0.4, 170 * u), w, h, t, 21.2, 29.4, 150, 300);
  fadeText(g, 'FINAL SCORE', h * 0.22, 18, 700, '#7dd3fc', clamp01((t - 21.2) / 1.2) * clamp01((30 - t) / 0.8), SANS, '', 5);
  const bits = [stats.objectsFound != null ? `${stats.objectsFound.toFixed(0)}% of the objects found` : '', stats.coverage != null ? `${stats.coverage.toFixed(0)}% of the critical areas covered` : ''].filter(Boolean);
  bits.forEach((b, k) => fadeText(g, b, h * (0.63 + k * 0.07), 24, 600, '#fde68a', clamp01((t - (25 + k * 1.2)) / 1.2) * clamp01((30 - t) / 0.8)));
  // 4 · the end
  drawText(g, textCloud('Well done', w, h, h * 0.4, 150 * u), w, h, t, 31.5, null, 280, 200);
  fadeText(g, 'LiDAR Learning Lab', h * 0.62, 34, 700, 'rgba(255,255,255,.92)', clamp01((t - 36) / 1.2), SERIF, 'italic');
  fadeText(g, date, h * 0.69, 15, 500, 'rgba(255,255,255,.65)', clamp01((t - 36.6) / 1.2), SANS, '', 1.5);
}

// ---------------------------------------------------------------------------------------------------------------- the certificate as a picture
const certId = (name: string, score: number | null) => { let h = 2166136261; for (const ch of `${name}|${score ?? ''}|${new Date().toDateString()}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return `LL-${(h >>> 0).toString(16).toUpperCase().padStart(8, '0')}`; };
/** A4 landscape at 300 dpi. */
export function certificateCanvas(name: string, stats: CompletionStats): HTMLCanvasElement {
  const w = 3508, h = 2480, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!, u = w / 1600;
  // paper: warm white with a quiet surface of points rising from the bottom and a galaxy of points in the top corner
  const paper = g.createLinearGradient(0, 0, w, h); paper.addColorStop(0, '#fffdf8'); paper.addColorStop(1, '#eef4fc'); g.fillStyle = paper; g.fillRect(0, 0, w, h);
  const cam: Cam = { w, h, ang: 0.35, el: 0.5, D: 30, f: h * 1.15, cy: h * 1.02 };
  for (let gx = -34; gx <= 34; gx++) for (let gy = -24; gy <= 24; gy++) { const x = gx * 0.8, y = gy * 0.8, z = Math.sin(x * 0.45 + 1.3) * 0.9 + Math.cos(y * 0.5 - 0.7) * 0.7 + Math.sin((x + y) * 0.25) * 0.6, p = project(cam, x, y, z); if (!p) continue; const k = clamp01((z + 2.2) / 4.4); dot(g, p[0], p[1], Math.max(2.5, 5.2 * u * 22 / p[2]), `rgba(${Math.round(29 + 40 * k)},${Math.round(78 + 70 * k)},216,${(0.10 + 0.22 * k).toFixed(3)})`); }
  const cam2: Cam = { w, h, ang: 0.9, el: 1.0, D: 34, f: h * 0.9, cy: h * 0.12 };
  for (let i2 = 0; i2 < GALAXY.length; i2 += 4) { const p = project(cam2, GALAXY[i2] * 0.9, GALAXY[i2 + 1] * 0.9, GALAXY[i2 + 2]); if (!p) continue; const k = GALAXY[i2 + 3]; dot(g, w * 0.86 + (p[0] - w / 2) * 0.55, p[1], Math.max(2.5, 4.2 * u * 24 / p[2]), `hsla(${38 + k * 12},75%,52%,${(0.10 + 0.25 * (1 - k)).toFixed(3)})`); }
  const edge = g.createRadialGradient(w / 2, h / 2, h * 0.5, w / 2, h / 2, h * 0.95); edge.addColorStop(0, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(255,255,255,.55)'); g.fillStyle = edge; g.fillRect(0, 0, w, h);
  // a double border in gold and navy, with a small flourish in each corner
  const frame = (inset: number, colour: string, width: number) => { g.strokeStyle = colour; g.lineWidth = width * u; g.strokeRect(inset * u, inset * u, w - 2 * inset * u, h - 2 * inset * u); };
  frame(120, '#0b1f3a', 7); frame(150, '#c9a227', 3);
  for (const [cx0, cy0, a0, a1] of [[150, 150, 0, Math.PI / 2], [w / u - 150, 150, Math.PI / 2, Math.PI], [150, h / u - 150, -Math.PI / 2, 0], [w / u - 150, h / u - 150, Math.PI, Math.PI * 1.5]]) { g.strokeStyle = '#c9a227'; g.lineWidth = 3 * u; g.beginPath(); g.arc(cx0 * u, cy0 * u, 46 * u, a0, a1); g.stroke(); }
  const text = (s: string, y: number, size: number, weight: number, colour: string, spacing = 0, family = SANS, style = '') => { g.font = `${style} ${weight} ${size * u}px ${family}`.trim(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = colour; (g as unknown as { letterSpacing: string }).letterSpacing = `${spacing * u}px`; g.fillText(s, w / 2, y * u); (g as unknown as { letterSpacing: string }).letterSpacing = '0px'; };
  text('LIDAR LEARNING LAB', 228, 22, 700, '#1d4ed8', 8);
  text('Certificate of Completion', 322, 86, 700, '#0b1f3a', 1, SERIF);
  g.strokeStyle = '#c9a227'; g.lineWidth = 3 * u; g.beginPath(); g.moveTo(w / 2 - 240 * u, 380 * u); g.lineTo(w / 2 + 240 * u, 380 * u); g.stroke();
  text('This is to certify that', 432, 28, 400, '#475569', 1, SERIF, 'italic');
  text(name || 'Student', 522, 96, 700, '#1d4ed8', 0, SERIF, 'italic');
  g.strokeStyle = '#94a3b8'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(w / 2 - 420 * u, 582 * u); g.lineTo(w / 2 + 420 * u, 582 * u); g.stroke();
  text('has completed all seven missions of the', 642, 30, 400, '#334155', 0.5, SERIF, 'italic');
  text('Industrial Digital Twin Challenge', 706, 54, 700, '#0b1f3a', 0.5, SERIF);
  const rows: [string, string][] = [];
  if (stats.score != null) rows.push(['Final score', `${stats.score.toFixed(1)} / 100`]);
  if (stats.objectsFound != null) rows.push(['Objects found', `${stats.objectsFound.toFixed(0)} %`]);
  if (stats.coverage != null) rows.push(['Critical coverage', `${stats.coverage.toFixed(0)} %`]);
  if (stats.markerPx != null) rows.push(['Camera marker error', `${stats.markerPx.toFixed(1)} px`]);
  const colW = 330 * u, x0 = w / 2 - (rows.length * colW) / 2;
  rows.forEach(([k, v], i2) => { const cx = x0 + colW * (i2 + 0.5); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#0b1f3a'; g.font = `700 ${50 * u}px ${SERIF}`; g.fillText(v, cx, 812 * u); g.fillStyle = '#64748b'; g.font = `500 ${21 * u}px ${SANS}`; g.fillText(k, cx, 860 * u); });
  g.textAlign = 'left'; g.fillStyle = '#334155'; g.font = `600 ${22 * u}px ${SANS}`;
  g.fillText(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), 205 * u, 930 * u);
  g.textAlign = 'right'; g.fillText(`Certificate ${certId(name, stats.score)}`, w - 205 * u, 930 * u);
  return c;
}

const download = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
const fileName = (name: string, ext: string) => `Digital-Twin-${(name || 'Certificate').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}.${ext}`;

/** The finishing moment of the challenge: ask for a name, then a celebration with a turning point cloud, a video to keep and a certificate as a picture. */
export interface SendScore { /** only when the instructor is accepting scores */ accepting: boolean; defaultIndex: string; alreadySent: boolean; send: (name: string, index: string) => Promise<{ ok: boolean; message: string }> }
export function CompletionExperience({ open, onClose, defaultName, stats, sendScore }: { open: boolean; onClose: () => void; defaultName?: string; stats: CompletionStats; sendScore?: SendScore }) {
  const [name, setName] = useState(defaultName ?? '');
  const [stage, setStage] = useState<'ask' | 'show'>('ask'), [busy, setBusy] = useState<string | null>(null), [note, setNote] = useState('');
  const [index, setIndex] = useState(sendScore?.defaultIndex ?? ''), [agree, setAgree] = useState(false), [sentNote, setSentNote] = useState<{ ok: boolean; text: string } | null>(null);
  const canSend = !!sendScore?.accepting && !sendScore.alreadySent, indexOk = /^[A-Za-z0-9]{3,24}$/.test(index.trim()), sendNow = canSend && agree && indexOk;
  const cv = useRef<HTMLCanvasElement>(null), clock = useRef({ start: 0 }), frame = useRef(0);
  const recorder = useRef<{ rec: MediaRecorder; timer: ReturnType<typeof setInterval>; cancelled: boolean } | null>(null), [progress, setProgress] = useState(0);
  /** Closing always works: a recording in progress is stopped and thrown away. */
  const closeNow = () => { const r = recorder.current; if (r) { r.cancelled = true; clearInterval(r.timer); try { r.rec.stop(); } catch { /* already stopped */ } recorder.current = null; } setBusy(null); setProgress(0); onClose(); };
  useEffect(() => { if (open) { setStage('ask'); setNote(''); setBusy(null); setSentNote(null); setAgree(false); setName((n) => n || defaultName || ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef({ name, stats }); live.current = { name, stats }; // the picture reads these when it draws, so a new object from the page never restarts it
  useEffect(() => {
    if (!open || stage !== 'show') return;
    const c = cv.current; if (!c) return; c.width = 1280; c.height = 720; const g = c.getContext('2d')!; clock.current.start = performance.now();
    const tick = () => { drawCelebration(g, c.width, c.height, (performance.now() - clock.current.start) / 1000, live.current.name.trim() || 'Student', live.current.stats); frame.current = requestAnimationFrame(tick); };
    frame.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame.current);
  }, [open, stage]);
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const begin = () => {
    setStage('show');
    if (sendNow) void sendScore!.send(name.trim(), index.trim()).then((r) => setSentNote({ ok: r.ok, text: r.message }));
  };
  const savePicture = () => { setBusy('Making the certificate…'); setTimeout(() => { certificateCanvas(name.trim() || 'Student', stats).toBlob((b) => { setBusy(null); if (b) { download(b, fileName(name.trim(), 'png')); setNote('Certificate saved.'); } else setNote('The picture could not be made in this browser.'); }, 'image/png'); }, 30); };
  const saveVideo = () => {
    const c = cv.current; if (!c || typeof MediaRecorder === 'undefined' || !c.captureStream) { setNote('This browser cannot record the video. The certificate picture can still be saved.'); return; }
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)); if (!type) { setNote('This browser cannot record the video. The certificate picture can still be saved.'); return; }
    const chunks: BlobPart[] = [], rec = new MediaRecorder(c.captureStream(30), { mimeType: type, videoBitsPerSecond: 10_000_000 }), secs = CELEBRATION_SECONDS;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => { const me = recorder.current; recorder.current = null; setProgress(0); if (!me || me.cancelled) { setBusy(null); return; } const mp4 = type.startsWith('video/mp4'), blob = new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' }); download(blob, fileName(name.trim(), mp4 ? 'mp4' : 'webm')); setBusy(null); setNote(mp4 ? 'Video saved (MP4).' : 'Video saved. This browser records WebM, which plays in most players and converts easily to MP4.'); };
    clock.current.start = performance.now(); rec.start(); let left = secs; setBusy(`Recording the video: ${left} s left. Keep this window open.`); setProgress(0);
    const id = setInterval(() => { left -= 1; setProgress(1 - left / secs); if (left <= 0) { clearInterval(id); rec.stop(); } else setBusy(`Recording the video: ${left} s left. Keep this window open.`); }, 1000);
    recorder.current = { rec, timer: id, cancelled: false };
  };

  return createPortal(
    <div className="celebrate-back" role="presentation" data-testid="celebrate">
      <div className="celebrate-win" role="dialog" aria-modal="true" aria-label="Congratulations">
        {stage === 'ask'
          ? <div className="celebrate-ask">
            <h2>You did it!</h2>
            <p>All seven missions are done and your digital twin is commissioned. What name should go on your certificate?</p>
            <label htmlFor="cert-name">Your name</label>
            <input id="cert-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Full name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) begin(); }} data-testid="celebrate-name" />
            {canSend && <div className="celebrate-send" data-testid="celebrate-send">
              <p>Your instructor is collecting scores. You can send yours now.</p>
              <label htmlFor="cert-index">Index number</label>
              <input id="cert-index" value={index} onChange={(e) => setIndex(e.target.value)} maxLength={24} placeholder="Your index number" data-testid="celebrate-index" />
              <label className="celebrate-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="celebrate-agree" /> Send my name, index number and score to my instructor. The network address of this computer is recorded with it.</label>
            </div>}
            <div className="celebrate-actions"><Btn variant="primary" disabled={!name.trim() || (agree && !indexOk)} onClick={begin} testId="celebrate-go">{sendNow ? 'Send my score and show my certificate' : 'Show my certificate'}</Btn><Btn onClick={closeNow}>Not now</Btn></div>
          </div>
          : <>
            <button type="button" className="celebrate-x" onClick={closeNow} aria-label="Close" data-testid="celebrate-x">×</button>
            <canvas ref={cv} className="celebrate-canvas" aria-label={`Congratulations ${name}: you commissioned the Industrial Digital Twin`} data-testid="celebrate-canvas" />
            <div className="celebrate-actions">
              <Btn variant="primary" onClick={saveVideo} disabled={!!busy} testId="celebrate-video">Download video</Btn>
              <Btn onClick={savePicture} disabled={!!busy} testId="celebrate-picture">Save certificate</Btn>
              <Btn onClick={() => { clock.current.start = performance.now(); }} disabled={!!busy}>Play again</Btn>
              <Btn onClick={closeNow} testId="celebrate-close">{busy ? 'Cancel and close' : 'Close'}</Btn>
            </div>
            {busy && <div className="celebrate-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress * 100}%` }} /></div>}
            <p className="celebrate-note" role="status">{busy ?? note}</p>
            {sentNote && <p className="celebrate-note" data-testid="celebrate-sent" style={{ color: sentNote.ok ? '#30a14e' : '#ff453a' }}>{sentNote.text}</p>}
          </>}
      </div>
    </div>, document.body);
}
