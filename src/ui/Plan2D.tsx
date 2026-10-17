import { useEffect, useRef, useState } from 'react';
import { SceneDef, primAABB } from '../scenes/geometry';
import { useLab } from '../state/store';

export interface PlanLayer {
  points?: { pos: Float32Array; count: number; color: string; stride?: number }[];
  paths?: { pts: [number, number][]; color: string; dashed?: boolean; width?: number }[];
  markers?: { x: number; y: number; color: string; label?: string; yaw?: number; r?: number }[];
  fov?: { x: number; y: number; yaw: number; hFov: number; range: number; color: string };
}

/** Top-down 2D plan: object footprints + overlays. Click reports world coordinates. */
export function Plan2D({ scene, layers, onClick, height = 280, zRange }: { scene: SceneDef; layers: PlanLayer; onClick?: (x: number, y: number) => void; height?: number | 'fill'; zRange?: [number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bg = useLab((s) => s.view.background);
  const geo = useRef({ s: 1, ox: 0, oy: 0, h: 0 });
  const [, tick] = useState(0);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => tick((n) => n + 1));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = height === 'fill' ? cv.clientHeight : height;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const light = bg === 'light';
    g.fillStyle = light ? '#f2f2f7' : '#11131a';
    g.fillRect(0, 0, W, H);
    const { min, max } = scene.bounds;
    const pad = 14;
    const sc = Math.min((W - 2 * pad) / (max[0] - min[0]), (H - 2 * pad) / (max[1] - min[1]));
    const ox = W / 2 - ((min[0] + max[0]) / 2) * sc, oy = H / 2 + ((min[1] + max[1]) / 2) * sc;
    geo.current = { s: sc, ox, oy, h: H };
    const X = (x: number) => ox + x * sc, Y = (y: number) => oy - y * sc;
    // footprints
    for (const o of scene.objects) {
      if (!o.scannable || o.hideFlag === 'ceiling') continue;
      g.fillStyle = o.structural ? (light ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)') : `rgba(${o.color[0]},${o.color[1]},${o.color[2]},.55)`;
      g.strokeStyle = o.structural ? (light ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.3)') : `rgba(${o.color[0]},${o.color[1]},${o.color[2]},.9)`;
      g.lineWidth = 1;
      for (const p of o.parts) {
        if (o.structural && (p.size && p.size[2] < 0.3)) continue;
        if (p.kind === 'box') {
          const [sx, sy] = p.size!;
          g.save(); g.translate(X(p.c[0]), Y(p.c[1])); g.rotate(-p.yaw);
          g.fillRect((-sx / 2) * sc, (-sy / 2) * sc, sx * sc, sy * sc); g.strokeRect((-sx / 2) * sc, (-sy / 2) * sc, sx * sc, sy * sc);
          g.restore();
        } else {
          const b = primAABB(p);
          g.beginPath(); g.ellipse(X(p.c[0]), Y(p.c[1]), ((b.max[0] - b.min[0]) / 2) * sc, ((b.max[1] - b.min[1]) / 2) * sc, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        }
      }
    }
    // corridor
    if (scene.corridor) {
      const c = scene.corridor;
      g.save(); g.strokeStyle = 'rgba(48,209,88,.9)'; g.setLineDash([5, 4]); g.lineWidth = 1.5;
      const dx = c.end[0] - c.start[0], dy = c.end[1] - c.start[1], L = Math.hypot(dx, dy);
      g.translate(X(c.start[0]), Y(c.start[1])); g.rotate(-Math.atan2(dy, dx));
      g.strokeRect(0, (-c.width / 2) * sc, L * sc, c.width * sc); g.restore();
    }
    if (layers.fov) {
      const f = layers.fov;
      g.fillStyle = f.color + '33'; g.strokeStyle = f.color + 'aa'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(f.x), Y(f.y));
      if (f.hFov >= 359) g.arc(X(f.x), Y(f.y), f.range * sc, 0, Math.PI * 2);
      else g.arc(X(f.x), Y(f.y), f.range * sc, -(f.yaw + (f.hFov / 2) * Math.PI / 180), -(f.yaw - (f.hFov / 2) * Math.PI / 180));
      g.closePath(); g.fill(); g.stroke();
    }
    for (const L of layers.points ?? []) {
      g.fillStyle = L.color;
      const st = L.stride ?? Math.max(1, Math.floor(L.count / 12000));
      for (let i = 0; i < L.count; i += st) {
        const z = L.pos[i * 3 + 2];
        if (zRange && (z < zRange[0] || z > zRange[1])) continue;
        g.fillRect(X(L.pos[i * 3]) - 0.8, Y(L.pos[i * 3 + 1]) - 0.8, 1.7, 1.7);
      }
    }
    for (const P of layers.paths ?? []) {
      if (P.pts.length < 2) continue;
      g.save(); g.strokeStyle = P.color; g.lineWidth = P.width ?? 2; if (P.dashed) g.setLineDash([6, 5]);
      g.beginPath(); P.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); g.restore();
    }
    for (const M of layers.markers ?? []) {
      g.fillStyle = M.color; g.beginPath(); g.arc(X(M.x), Y(M.y), M.r ?? 5, 0, Math.PI * 2); g.fill();
      if (M.yaw !== undefined) { g.strokeStyle = M.color; g.lineWidth = 2; g.beginPath(); g.moveTo(X(M.x), Y(M.y)); g.lineTo(X(M.x) + Math.cos(M.yaw) * 16, Y(M.y) - Math.sin(M.yaw) * 16); g.stroke(); }
      if (M.label) { g.fillStyle = light ? '#111' : '#fff'; g.font = '600 12px -apple-system, sans-serif'; g.fillText(M.label, X(M.x) + 8, Y(M.y) - 6); }
    }
  });

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: height === 'fill' ? '100%' : height, borderRadius: height === 'fill' ? 0 : 14, display: 'block', cursor: onClick ? 'crosshair' : 'default' }}
      onClick={(e) => {
        if (!onClick) return;
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const { s, ox, oy } = geo.current;
        onClick((e.clientX - r.left - ox) / s, -(e.clientY - r.top - oy) / s);
      }}
      aria-label="Top-down plan view"
    />
  );
}
