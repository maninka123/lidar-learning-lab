import { useEffect, useRef } from 'react';
import { buildScene, camera, CLASS_RGB, HALL, project, Scene, SENSOR, updateDynamic } from './scene';

const FRAME_MS = 1000 / 30; // the motion is slow, so 30 frames a second looks the same as 60 and costs half
const LEVELS = 8, SWEEP_S = 11, GLOW_S = 1.7, PULSE_S = 14; // calm: one scan every 11 s, lit points settle over a couple of seconds, one radar pulse every 14 s
// (brightness steps per colour; seconds per scan sweep; seconds a lit point takes to settle) // brightness steps per colour; seconds per scan sweep; seconds a lit point takes to settle
const sceneOnce: { s?: Scene } = {};

/** The living point cloud: a hall of points seen in perspective, a slow camera swing, and a thin cyan scan plane that makes the points it passes glow. Canvas 2D only. */
export function LivingCloud({ calm, par, paused = false }: { calm: boolean; par: React.RefObject<{ x: number; y: number }>; paused?: boolean }) {
  const stop = useRef(paused); stop.current = paused; // when the exit starts, the picture freezes: the CPU and GPU go to the app
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const ctx = cv.getContext('2d', { alpha: true }); if (!ctx) return;
    const S = (sceneOnce.s ??= buildScene()), n = S.n, lit = new Float32Array(n), sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n), br = new Uint8Array(n), vis = new Uint8Array(n);
    const bucketCount = CLASS_RGB.length * LEVELS, fill = new Int32Array(bucketCount), counts = new Int32Array(bucketCount), start = new Int32Array(bucketCount + 1), order = new Int32Array(n);
    const tmp = { x: 0, y: 0, d: 0 }; let W = 0, H = 0, dpr = 1, stride = 1, slow = 0, raf = 0, last = performance.now(), t = calm ? 3.2 : 0, running = true;
    const fit = () => { dpr = Math.min(window.devicePixelRatio || 1, 1.25); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); };
    fit(); const ro = new ResizeObserver(() => { fit(); if (calm) frame(0); }); ro.observe(cv);

    function frame(dt: number) {
      t += dt; if (!calm) updateDynamic(S, t); const cam = camera(t, { calm, px: par.current?.x ?? 0, py: par.current?.y ?? 0, w: W, h: H });
      const phase = (t % SWEEP_S) / SWEEP_S, ease = phase * phase * (3 - 2 * phase), planeX = -HALL.w * 0.62 + ease * HALL.w * 1.24, active = calm ? 0.7 : Math.sin(Math.PI * Math.min(1, phase * 1.05)) ** 0.6; // the plane fades in and out at the edges
      const pp = (t % PULSE_S) / PULSE_S, pulseR = 1 + pp * 17, pulseA = calm ? 0 : Math.sin(Math.PI * pp) ** 0.8, decay = Math.exp(-dt / GLOW_S), cx = W * 0.5, cyy = H * 0.5;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); ctx!.clearRect(0, 0, W, H); ctx!.globalCompositeOperation = 'lighter';
      counts.fill(0); const tw = calm ? 0 : t;
      for (let i = 0; i < n; i++) {
        vis[i] = 0; if (i % stride) continue;
        const x = S.pos[i * 3], y = S.pos[i * 3 + 1], z = S.pos[i * 3 + 2];
        if (!project(cam, x, y, z, cx, cyy, tmp)) continue;
        const px = tmp.x, py = tmp.y; if (px < -6 || px > W + 6 || py < -6 || py > H + 6) continue;
        let hit = Math.exp(-(((x - planeX) / 0.34) ** 2)) * active; if (S.rad[i] >= 0) hit = Math.max(hit, Math.exp(-(((S.rad[i] - pulseR) / 0.55) ** 2)) * 0.7 * pulseA); lit[i] = Math.max(lit[i] * decay, hit);
        const depthFade = Math.max(0.6, Math.min(1, 1.35 - tmp.d / 30)), twinkle = 0.9 + 0.1 * Math.sin(tw * 0.5 + S.phase[i]);
        const a = Math.min(1, (0.35 + 0.65 * S.base[i]) * twinkle * depthFade + lit[i] * 0.6);
        sx[i] = px; sy[i] = py; sz[i] = Math.min(3.8, Math.max(1.9, (S.size[i] * cam.f * 0.0105) / tmp.d * 2.9)); br[i] = Math.min(LEVELS - 1, Math.floor(a * LEVELS)); vis[i] = 1;
        counts[S.cls[i] * LEVELS + br[i]]++;
      }
      start[0] = 0; for (let b = 0; b < bucketCount; b++) start[b + 1] = start[b] + counts[b];
      fill.set(start.subarray(0, bucketCount)); for (let i = 0; i < n; i++) if (vis[i]) order[fill[S.cls[i] * LEVELS + br[i]]++] = i;
      for (let b = 0; b < bucketCount; b++) {
        if (start[b + 1] === start[b]) continue; const c = CLASS_RGB[(b / LEVELS) | 0], al = 0.34 + 0.66 * (((b % LEVELS) + 0.5) / LEVELS);
        ctx!.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${al.toFixed(3)})`; ctx!.beginPath();
        for (let k = start[b]; k < start[b + 1]; k++) { const i = order[k], s = sz[i]; ctx!.rect(sx[i] - s / 2, sy[i] - s / 2, s, s); }
        ctx!.fill();
      }
      // a soft halo around points that are lit right now
      ctx!.fillStyle = 'rgba(150,236,255,0.16)'; ctx!.beginPath();
      for (let i = 0; i < n; i++) if (vis[i] && lit[i] > 0.45) { const s = sz[i] * 3.2; ctx!.rect(sx[i] - s / 2, sy[i] - s / 2, s, s); }
      ctx!.fill();
      // the scan plane itself: a thin, soft cyan sheet standing across the hall
      if (active > 0.02) {
        const q: [number, number][] = []; let ok = true;
        for (const [y, z] of [[0, 0.8], [HALL.h, 0.8], [HALL.h, HALL.depth], [0, HALL.depth]]) { if (!project(cam, planeX, y, z, cx, cyy, tmp)) { ok = false; break; } q.push([tmp.x, tmp.y]); }
        if (ok) {
          const g = ctx!.createLinearGradient(q[0][0], 0, q[3][0], 0); g.addColorStop(0, `rgba(90,216,255,${(0.075 * active).toFixed(3)})`); g.addColorStop(1, `rgba(90,216,255,${(0.025 * active).toFixed(3)})`);
          ctx!.fillStyle = g; ctx!.beginPath(); ctx!.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) ctx!.lineTo(q[k][0], q[k][1]); ctx!.closePath(); ctx!.fill();
          ctx!.strokeStyle = `rgba(170,240,255,${(0.4 * active).toFixed(3)})`; ctx!.lineWidth = 1.2; ctx!.beginPath(); ctx!.moveTo(q[0][0], q[0][1]); ctx!.lineTo(q[1][0], q[1][1]); ctx!.moveTo(q[3][0], q[3][1]); ctx!.lineTo(q[2][0], q[2][1]); ctx!.stroke();
          ctx!.strokeStyle = `rgba(200,248,255,${(0.65 * active).toFixed(3)})`; ctx!.lineWidth = 1.6; ctx!.beginPath(); ctx!.moveTo(q[0][0], q[0][1]); ctx!.lineTo(q[3][0], q[3][1]); ctx!.stroke(); // where the sheet cuts the floor
        }
      }
      // the radar pulse on the floor: a faint expanding ring
      if (pulseA > 0.02) {
        ctx!.strokeStyle = `rgba(140,230,255,${(0.2 * pulseA * (1 - pp * 0.6)).toFixed(3)})`; ctx!.lineWidth = 1.2; ctx!.beginPath(); let started = false;
        for (let k = 0; k <= 72; k++) { const a = -Math.PI / 2 + (k / 72) * Math.PI; if (project(cam, SENSOR.x + Math.sin(a) * pulseR, 0, SENSOR.z + Math.cos(a) * pulseR, cx, cyy, tmp)) { if (started) ctx!.lineTo(tmp.x, tmp.y); else { ctx!.moveTo(tmp.x, tmp.y); started = true; } } }
        ctx!.stroke();
      }
      ctx!.globalCompositeOperation = 'source-over';
      // small instrument readouts in the corners
      let shown = 0; for (let i = 0; i < n; i++) shown += vis[i];
      ctx!.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; ctx!.fillStyle = 'rgba(150,205,235,0.55)'; ctx!.textBaseline = 'alphabetic';
      ctx!.textAlign = 'left'; ctx!.fillText('LIDAR  ·  905 nm  ·  10 Hz', 64, H - 40);
      ctx!.textAlign = 'right'; ctx!.fillText(`${shown.toLocaleString('en-US')} points in view`, W - 64, H - 40);
    }
    let lastDraw = 0;
    const loop = (now: number) => {
      if (!running) return; raf = requestAnimationFrame(loop);
      if (stop.current || document.hidden) { last = now; return; }
      const gap = now - last; if (now - lastDraw < FRAME_MS - 2) return; // 30 frames a second at most
      last = now; lastDraw = now; const t0 = performance.now(); frame(Math.min(0.1, gap / 1000));
      const cost = performance.now() - t0;
      // draw fewer points if frames are costly, or if the page is busy with other work (the app loading) and frames arrive late
      slow = cost > 6 || gap > 70 ? slow + 1 : Math.max(0, slow - 1); if (slow > 12 && stride < 3) { stride++; slow = 0; }
    };
    if (calm) frame(0); else raf = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [calm, par]);
  return <canvas ref={ref} className="intro-canvas" aria-hidden="true" />;
}
