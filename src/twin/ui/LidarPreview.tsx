import { useEffect, useRef } from 'react';
import { isSteered } from '../../sensor/presets';
import { lidarItem, sensorFor } from '../catalogue';
import { usd } from '../pricing';

/** A simple picture of a LiDAR: what it looks like, how its beams fan out in a small room, and how it covers the floor plan.
 *  Everything is drawn from the model's own numbers (channels, vertical and horizontal field of view, range), so each sensor looks different. */

const W = 320, H = 190, FLOOR = 164, CEIL = 22, WALL = 304, BOX = { x0: 226, x1: 268, y0: 128 }; // the little room, in drawing units
const rad = (d: number) => (d * Math.PI) / 180;

/** Where a ray from (x, y) in direction (dx, dy) first meets the floor, the ceiling, the box or the back wall. */
function hit(x: number, y: number, dx: number, dy: number): [number, number] {
  let t = Infinity;
  const take = (v: number) => { if (v > 1e-6 && v < t) t = v; };
  if (dx > 1e-9) take((WALL - x) / dx);
  if (dy > 1e-9) take((FLOOR - y) / dy); else if (dy < -1e-9) take((CEIL - y) / dy);
  if (dx > 1e-9) { // the box: a front face at x0, and a top face
    const tf = (BOX.x0 - x) / dx, yf = y + dy * tf; if (tf > 0 && yf >= BOX.y0 && yf <= FLOOR) take(tf);
    if (dy > 1e-9) { const tt = (BOX.y0 - y) / dy, xt = x + dx * tt; if (tt > 0 && xt >= BOX.x0 && xt <= BOX.x1) take(tt); }
  }
  return [x + dx * t, y + dy * t];
}

/** The device itself: a spinning puck for the rotating models, a flat window box for the solid-state ones. */
function Device({ steered, channels }: { steered: boolean; channels: number }) {
  return steered ? (
    <svg viewBox="0 0 120 120" className="lp-device" role="img" aria-label="A solid-state LiDAR: a flat box with a window and no moving parts">
      <rect x="22" y="38" width="76" height="52" rx="10" className="lp-body" />
      <rect x="32" y="48" width="56" height="32" rx="6" className="lp-window" />
      <path d="M40 64 q10-12 20 0 t20 0" className="lp-wave" fill="none" />
      <rect x="40" y="90" width="40" height="8" rx="3" className="lp-base" />
    </svg>
  ) : (
    <svg viewBox="0 0 120 120" className="lp-device" role="img" aria-label={`A rotating LiDAR: a cylinder that spins, with ${channels} laser beams stacked inside`}>
      <ellipse cx="60" cy="96" rx="30" ry="8" className="lp-base" />
      <rect x="30" y="40" width="60" height="56" className="lp-body" />
      <ellipse cx="60" cy="96" rx="30" ry="8" className="lp-body" />
      {[52, 62, 72, 82].map((y) => <path key={y} d={`M30 ${y} q30 9 60 0`} className="lp-line" fill="none" />)}
      <ellipse cx="60" cy="40" rx="30" ry="8" className="lp-top" />
      <path d="M44 30 a20 8 0 0 1 32 0" className="lp-spin" fill="none" /><path d="M76 30 l-6 -3 m6 3 l-2 6" className="lp-spin" fill="none" />
    </svg>
  );
}

/** Side view: the beams leave the sensor, spread over its vertical field of view, and mark the floor, box and wall. */
function SideView({ vMin, vMax, channels, steered }: { vMin: number; vMax: number; channels: number; steered: boolean }) {
  const sx = 58, sy = 100, n = Math.min(channels, steered ? 11 : 17);
  const rays = Array.from({ length: n }, (_, i) => rad(vMin + ((vMax - vMin) * i) / Math.max(1, n - 1)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lp-side" role="img" aria-label={`Side view: the beams cover ${Math.round(vMax - vMin)} degrees up and down`}>
      <rect x="0" y="0" width={W} height={H} className="lp-room" />
      <line x1="0" y1={FLOOR} x2={W} y2={FLOOR} className="lp-floor" />
      <line x1={WALL} y1={CEIL} x2={WALL} y2={FLOOR} className="lp-wall" />
      <rect x={BOX.x0} y={BOX.y0} width={BOX.x1 - BOX.x0} height={FLOOR - BOX.y0} rx="3" className="lp-box" />
      <line x1={sx} y1={sy} x2={sx} y2={FLOOR} className="lp-pole" />
      {rays.map((a, i) => { const [hx, hy] = hit(sx, sy, Math.cos(a), -Math.sin(a)); return <g key={i}><line x1={sx} y1={sy} x2={hx} y2={hy} className="lp-ray" /><circle cx={hx} cy={hy} r="2.4" className="lp-dot" /></g>; })}
      <circle cx={sx} cy={sy} r="6" className="lp-sensor" />
      <text x="8" y="16" className="lp-cap">{Math.round(vMax - vMin)}° up and down</text>
    </svg>
  );
}

/** Top view: a rotating sensor sweeps all the way round; a narrow one covers a wedge in front of it. */
function TopView({ hFov, steered }: { hFov: number; steered: boolean }) {
  const c = 80, cy = 70, r = 58, full = hFov >= 359; // the circle sits a little high, leaving room for the caption below
  const a0 = rad(-hFov / 2), a1 = rad(hFov / 2), p = (a: number) => [c + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const dots = Array.from({ length: full ? 36 : 14 }, (_, i) => { const a = full ? rad((i * 360) / 36) : a0 + ((a1 - a0) * i) / 13; return p(a); });
  return (
    <svg viewBox="0 0 160 160" className="lp-top-view" role="img" aria-label={full ? 'Top view: it sees all the way round' : `Top view: it sees a wedge ${Math.round(hFov)} degrees wide`}>
      <rect x="6" y="6" width="148" height="148" rx="10" className="lp-room" />
      {full ? <circle cx={c} cy={cy} r={r} className="lp-cover" /> : <path d={`M${c} ${cy} L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`} className="lp-cover" />}
      {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" className="lp-dot" />)}
      <circle cx={c} cy={cy} r="5" className="lp-sensor" />
      <text x="10" y="150" className="lp-cap">{full ? '360° all round' : `${Math.round(hFov)}° wedge in front`}{steered && full ? ' · mostly upwards' : ''}</text>
    </svg>
  );
}

export function LidarPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), it = lidarItem(id);
  const s = sensorFor({ id: 'preview', item: id, res: 'standard', x: 0, y: 0, z: 1.8, yaw: 0, pitch: 0 }), steered = isSteered(s.pattern);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []); // no close on cleanup: closing would fire onClose and shut the popup the moment it opens
  return (
    <dialog ref={ref} className="lidar-dialog" aria-labelledby="lp-title" data-testid="lidar-preview" onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="lp-head"><h3 id="lp-title">{it.name}</h3><span className="lp-price">{usd(it.cost)}</span>
        <button type="button" className="lp-close" onClick={onClose} aria-label="Close the preview" data-testid="lidar-preview-close">✕</button></div>
      <p className="lp-blurb">{it.blurb}</p>
      <div className="lp-grid">
        <figure><Device steered={steered} channels={s.channels} /><figcaption>{steered ? 'No moving parts' : `Spins, ${s.channels} beams`}</figcaption></figure>
        <figure className="lp-wide"><SideView vMin={s.vMin} vMax={s.vMax} channels={s.channels} steered={steered} /><figcaption>Side view: where its laser beams go in a small room</figcaption></figure>
        <figure><TopView hFov={s.hFov} steered={steered} /><figcaption>From above</figcaption></figure>
        <dl className="lp-facts">
          <div><dt>Beams</dt><dd>{s.channels} {steered ? '(a non-repeating pattern)' : 'channels'}</dd></div>
          <div><dt>Sees</dt><dd>{s.hFov >= 359 ? '360° round' : `${Math.round(s.hFov)}° wide`} × {Math.round(s.vMax - s.vMin)}° up and down</dd></div>
          <div><dt>Reaches</dt><dd>{s.maxRange} m</dd></div>
          <div><dt>Detail</dt><dd>{s.hRes}° between beams</dd></div>
        </dl>
      </div>
      <p className="lp-note">A simplified drawing from this sensor's numbers, not a photograph.</p>
    </dialog>
  );
}
