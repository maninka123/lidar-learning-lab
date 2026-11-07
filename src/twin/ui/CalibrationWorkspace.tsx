import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn, Slider } from '../../ui/controls';
import { cameraItem, HW_SEED, type CameraUnit, type LidarUnit, type TwinDesign } from '../catalogue';
import { buildFactory } from '../factory';
import { PRACTICE_SEED } from '../runner';
import { camPose, nominalOf, calibrationTarget, residuals, rmsOf, refineCalibration, renderPreview, CAL_MAX_PX, CAL_ASSIST_PX } from '../camera';
import { project } from '../../apps/fusion';
import { fovOverlap } from '../overlap';
/** A camera calibration workspace: the photo, the board markers found in it (green) and where your current calibration says they should be (red). */
/** Cameras on the left, LiDARs on the right. Drag from the dot of a camera to a LiDAR to connect them (or pick a camera and click a LiDAR). One wire per camera; many cameras may share a LiDAR. */
interface PairCam { id: string; label: string; sub: string; done: boolean; to: string | null }
interface PairLid { id: string; label: string; sub: string; nearestOf: string[] }
export function PairBoard({ cams, lids, selected, onSelect, onPair }: { cams: PairCam[]; lids: PairLid[]; selected: string | null; onSelect: (id: string) => void; onPair: (camId: string, lidId: string) => void }) {
  const box = useRef<HTMLDivElement>(null), [geo, setGeo] = useState<Record<string, { x: number; y: number }>>({}), [drag, setDrag] = useState<{ cam: string; x: number; y: number; over: string | null } | null>(null);
  const measure = () => {
    const root = box.current; if (!root) return; const r0 = root.getBoundingClientRect(), g: Record<string, { x: number; y: number }> = {};
    root.querySelectorAll<HTMLElement>('[data-port]').forEach((el) => { const r = el.getBoundingClientRect(); g[el.dataset.port!] = { x: r.left + r.width / 2 - r0.left, y: r.top + r.height / 2 - r0.top }; });
    setGeo((o) => (JSON.stringify(o) === JSON.stringify(g) ? o : g));
  };
  useEffect(() => { measure(); const ro = new ResizeObserver(measure); if (box.current) ro.observe(box.current); window.addEventListener('resize', measure); return () => { ro.disconnect(); window.removeEventListener('resize', measure); }; }); // eslint-disable-line react-hooks/exhaustive-deps
  const at = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const lidarUnder = (e: { clientX: number; clientY: number }) => (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-lidar]')?.dataset.lidar ?? null;
  const wire = (a: { x: number; y: number }, b: { x: number; y: number }) => { const k = Math.max(30, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + k},${a.y} ${b.x - k},${b.y} ${b.x},${b.y}`; };
  const camNo = (id: string) => cams.findIndex((c) => c.id === id) + 1, lidNo = (id: string | null) => lids.findIndex((l) => l.id === id) + 1;
  return (
    <div ref={box} data-testid="twin-pair-board" className="pairboard" onPointerMove={(e) => { if (drag) setDrag({ ...drag, ...at(e), over: lidarUnder(e) }); }} onPointerUp={(e) => { if (!drag) return; const l = lidarUnder(e); if (l) { onPair(drag.cam, l); onSelect(drag.cam); } setDrag(null); }} onPointerCancel={() => setDrag(null)}>
      <svg className="pairboard-wires" aria-hidden="true">
        {cams.map((c) => { const a = geo[`c:${c.id}`], b = c.to ? geo[`l:${c.to}`] : null; if (!a || !b || drag?.cam === c.id) return null; return <path key={c.id} d={wire(a, b)} className={c.id === selected ? 'sel' : ''} />; })}
        {drag && geo[`c:${drag.cam}`] && <path d={wire(geo[`c:${drag.cam}`], drag.over && geo[`l:${drag.over}`] ? geo[`l:${drag.over}`] : { x: drag.x, y: drag.y })} className="sel live" />}
      </svg>
      <div className="pairboard-col" data-testid="twin-cal-list" role="group" aria-label="Cameras">
        <div className="caption"><b>1 · Cameras</b></div>
        {cams.map((c) => (
          <div key={c.id} className={`pairnode cam ${c.id === selected ? 'on' : ''}`}>
            <button className="pairnode-main" aria-pressed={c.id === selected} onClick={() => onSelect(c.id)} data-testid={`twin-unit-c${camNo(c.id)}`}>
              <b>{c.label}{c.done ? ' ✓' : ''}</b><span>→ {c.to ? `LiDAR ${lidNo(c.to)}` : 'no LiDAR'}</span>
            </button>
            <span className="pairport" data-port={`c:${c.id}`} data-testid={`twin-port-c${camNo(c.id)}`} role="presentation" title="Drag to a LiDAR" onPointerDown={(e) => { e.preventDefault(); onSelect(c.id); (box.current as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ cam: c.id, ...at(e), over: null }); }} />
          </div>
        ))}
      </div>
      <div className="pairboard-col lids" role="group" aria-label="LiDARs">
        <div className="caption"><b>2 · LiDARs</b> <span>several cameras can share one</span></div>
        {lids.map((l) => {
          const mine = selected && cams.find((c) => c.id === selected)?.to === l.id;
          return (
            <div key={l.id} className={`pairnode lid ${mine ? 'on' : ''} ${drag?.over === l.id ? 'target' : ''}`} data-lidar={l.id}>
              <span className="pairport" data-port={`l:${l.id}`} role="presentation" />
              <button className="pairnode-main" aria-pressed={!!mine} disabled={!selected} onClick={() => selected && onPair(selected, l.id)} data-testid={`twin-pair-l${lidNo(l.id)}`} title={`${l.sub}${selected ? '' : ' — pick a camera first'}`}>
                <b>{l.label}</b><span>{cams.some((c) => c.to === l.id) ? cams.filter((c) => c.to === l.id).map((c) => `Cam ${camNo(c.id)}`).join(' + ') : l.nearestOf.length ? 'no camera yet' : 'no camera'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The two fields of view cut by a flat screen `dist` metres in front of the camera: the camera's rectangle against the LiDAR's reach. */
export function FovOverlapChart({ cam, lid, camNo, lidNo, dist, onDist }: { cam: CameraUnit; lid: LidarUnit; camNo: number; lidNo: number; dist: number; onDist: (v: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), o = useMemo(() => fovOverlap(cam, lid, dist), [cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.item, lid.x, lid.y, lid.z, lid.yaw, lid.pitch, lid.item, dist]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const g = cv.getContext('2d'); if (!g) return;
    const css = getComputedStyle(cv), ink = css.color || '#888', W = 340, Hh = Math.max(150, Math.min(260, Math.round((W * o.winH) / o.winW))), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = `${Hh}px`; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const pad = 26, pw = W - pad - 8, ph = Hh - pad - 8, X = (a: number) => pad + ((a + o.winW) / (2 * o.winW)) * pw, Y = (b: number) => 8 + ((o.winH - b) / (2 * o.winH)) * ph;
    g.fillStyle = 'rgba(10,132,255,0.28)'; const cw = pw / o.nx, ch = ph / o.ny;
    for (let j = 0; j < o.ny; j++) for (let i = 0; i < o.nx; i++) if (o.lidar[j * o.nx + i]) g.fillRect(pad + i * cw, 8 + j * ch, cw + 0.6, ch + 0.6);
    g.strokeStyle = ink; g.globalAlpha = 0.18; g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), 8); g.lineTo(X(0), 8 + ph); g.moveTo(pad, Y(0)); g.lineTo(pad + pw, Y(0)); g.stroke(); g.globalAlpha = 0.5; g.strokeRect(pad, 8, pw, ph); g.globalAlpha = 1;
    g.strokeStyle = '#ff9f0a'; g.lineWidth = 2.5; g.strokeRect(X(-o.halfW), Y(o.halfH), X(o.halfW) - X(-o.halfW), Y(-o.halfH) - Y(o.halfH));
    if (o.lidarAt && Math.abs(o.lidarAt.a) <= o.winW && Math.abs(o.lidarAt.b) <= o.winH) { g.fillStyle = '#0a84ff'; g.fillRect(X(o.lidarAt.a) - 3, Y(o.lidarAt.b) - 3, 6, 6); }
    g.fillStyle = ink; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.globalAlpha = 0.8;
    g.fillText(`${(-o.halfW).toFixed(1)}`, X(-o.halfW), Hh - 12); g.fillText('0', X(0), Hh - 12); g.fillText(`${o.halfW.toFixed(1)} m`, X(o.halfW), Hh - 12);
    g.textAlign = 'right'; g.fillText(`${o.halfH.toFixed(1)}`, pad - 3, Y(o.halfH) + 4); g.fillText(`${(-o.halfH).toFixed(1)}`, pad - 3, Y(-o.halfH) + 4); g.globalAlpha = 1;
  }, [o]);
  const pct = Math.round(o.coverage * 1000) / 10;
  return (
    <div data-testid="twin-fov-overlap" style={{ marginTop: 10 }}>
      <div className="caption" style={{ marginBottom: 2 }}><b>Where Camera {camNo} and LiDAR {lidNo} look at the same time</b>, on a flat screen {dist} m in front of the camera</div>
      <div data-testid="twin-fov-pct" style={{ fontWeight: 650 }}>LiDAR covers {pct} % of the camera's view</div>
      <canvas ref={ref} role="img" aria-label={`Fields of view of camera ${camNo} and LiDAR ${lidNo} at ${dist} metres. The LiDAR covers ${pct} percent of the camera view.`} style={{ width: '100%', maxWidth: 340, display: 'block', color: 'var(--text)' }} data-testid="twin-fov-canvas" />
      <div className="caption" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><span><i style={{ display: 'inline-block', width: 12, height: 8, border: '2px solid #ff9f0a', marginRight: 4 }} />camera view</span><span><i style={{ display: 'inline-block', width: 12, height: 8, background: 'rgba(10,132,255,.4)', marginRight: 4 }} />LiDAR reach</span><span>screen width {(2 * o.halfW).toFixed(1)} m</span></div>
      <Slider label="Distance from the camera" value={dist} min={1} max={30} step={0.5} unit=" m" onChange={onDist} hint="Slide to compare the two fields of view nearer or farther away. Up close a camera sees little; far away the LiDAR may reach only part of what the camera sees." />
    </div>
  );
}

export function CalPanel({ unit, index, lights, onChange }: { unit: CameraUnit; index: number; lights: TwinDesign['lights']; onChange: (c: CameraUnit) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [big, setBig] = useState(false);
  const it = cameraItem(unit.item);
  const sig = JSON.stringify([unit.item, unit.x, unit.y, unit.z, unit.yaw, unit.pitch, unit.kit, lights]);
  const scene = useMemo(() => buildFactory(PRACTICE_SEED, 'A'), []);
  const img = useMemo(() => renderPreview(scene, unit, HW_SEED, index, lights, big ? 960 : 480), [sig, big]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => calibrationTarget(unit, HW_SEED, index, lights), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = residuals(target, unit.cal.est, unit.cal.fov), rms = rmsOf(res);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    // the photo, zoomed to the board: the markers of a small board are otherwise a smudge
    const tmp = document.createElement('canvas'); tmp.width = img.w; tmp.height = img.h; tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgb), img.w, img.h), 0, 0);
    const sc = img.w / it.w, cam = camPose(unit.cal.est);
    const seen = target.m.map((m) => [m[0] * sc, m[1] * sc] as [number, number]);
    const proj = target.X.map((X) => { const q = project(cam, X, it.w, it.h, unit.cal.fov); return q ? [q.u * sc, q.v * sc] as [number, number] : null; });
    const xs = [...seen.map((m) => m[0]), ...proj.filter(Boolean).map((q) => q![0])], ys = [...seen.map((m) => m[1]), ...proj.filter(Boolean).map((q) => q![1])];
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, aspect = img.w / img.h;
    let w = Math.max(x1 - x0, (y1 - y0) * aspect) * 1.5, h = w / aspect; if (!Number.isFinite(w) || w < img.w * 0.12) { w = img.w; h = img.h; }
    w = Math.min(w, img.w); h = Math.min(h, img.h);
    const sx = Math.max(0, Math.min(img.w - w, cx - w / 2)), sy = Math.max(0, Math.min(img.h - h, cy - h / 2));
    c.width = big ? 1200 : 640; c.height = Math.round(c.width / aspect); const g = c.getContext('2d')!, z = c.width / w, f = c.width / 640;
    g.imageSmoothingEnabled = true; g.drawImage(tmp, sx, sy, w, h, 0, 0, c.width, c.height);
    const P = (p: [number, number]): [number, number] => [(p[0] - sx) * z, (p[1] - sy) * z];
    // the four corners of the board and its edges: where the photo has them (green) and where your calibration puts them (red)
    const corner = (pts: ([number, number] | null)[], f2: (p: [number, number]) => number, pick: 'min' | 'max') => { let b = -1; pts.forEach((p, i) => { if (p && (b < 0 || (pick === 'min' ? f2(p) < f2(pts[b]!) : f2(p) > f2(pts[b]!)))) b = i; }); return b; };
    const ids = [corner(seen, (p) => p[0] + p[1], 'min'), corner(seen, (p) => p[0] - p[1], 'max'), corner(seen, (p) => p[0] + p[1], 'max'), corner(seen, (p) => p[0] - p[1], 'min')];
    const edge = (pts: ([number, number] | null)[], col: string) => { if (ids.some((k) => k < 0 || !pts[k])) return; g.strokeStyle = col; g.lineWidth = 2.5 * f; g.beginPath(); ids.forEach((k, n) => { const [px, py] = P(pts[k]!); n ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.stroke(); };
    // every marker, small: a green square where the photo has it, a red cross where your calibration puts it, and a line between them
    seen.forEach((m, i) => { const [mx, my] = P(m), q = proj[i]; g.strokeStyle = 'rgba(48,209,88,.9)'; g.lineWidth = 1.4 * f; g.strokeRect(mx - 3 * f, my - 3 * f, 6 * f, 6 * f); if (q) { const [qx, qy] = P(q); g.strokeStyle = 'rgba(255,69,58,.85)'; g.beginPath(); g.moveTo(qx - 4 * f, qy); g.lineTo(qx + 4 * f, qy); g.moveTo(qx, qy - 4 * f); g.lineTo(qx, qy + 4 * f); g.stroke(); } });
    edge(seen, '#30d158'); edge(proj, '#ff453a');
    // the corners, large and numbered, with the line that has to close
    ids.forEach((k, n) => { if (k < 0) return; const [mx, my] = P(seen[k]); g.fillStyle = '#30d158'; g.strokeStyle = '#fff'; g.lineWidth = 2 * f; g.beginPath(); g.arc(mx, my, 7 * f, 0, Math.PI * 2); g.fill(); g.stroke(); const q = proj[k]; if (q) { const [qx, qy] = P(q); g.strokeStyle = '#ff453a'; g.lineWidth = 2 * f; g.beginPath(); g.moveTo(mx, my); g.lineTo(qx, qy); g.stroke(); g.fillStyle = '#ff453a'; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(qx, qy - 9 * f); g.lineTo(qx + 9 * f, qy); g.lineTo(qx, qy + 9 * f); g.lineTo(qx - 9 * f, qy); g.closePath(); g.fill(); g.stroke(); } g.fillStyle = '#fff'; g.font = `700 ${12 * f}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n + 1), mx, my + 0.5 * f); });
  }, [img, target, unit.cal.est, unit.cal.fov, big]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!big) return; const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setBig(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [big]);
  const e = unit.cal.est, nom = nominalOf(unit), set = (p: Partial<typeof e>) => { const next = { ...e, ...p }, err = rmsOf(residuals(target, next, unit.cal.fov)) * (1280 / it.w); onChange({ ...unit, cal: { ...unit.cal, est: next, done: err < CAL_MAX_PX } }); }; // below 3 px the calibration is kept by itself
  const rmsHd = rms * (1280 / it.w); // judged as if the picture were 720p, so a 4K camera is not punished for having smaller pixels
  const [initialRms] = useState(rmsHd);
  const ok = Number.isFinite(rmsHd) && rmsHd < CAL_MAX_PX, canAssist = Number.isFinite(rmsHd) && rmsHd < CAL_ASSIST_PX;
  const quality = rmsHd < 1 ? 'Excellent' : rmsHd < 2 ? 'Good' : ok ? 'Fair' : 'Poor';
  const range = (c: number, w: number) => ({ min: c - w, max: c + w });
  const sliders = (
    <>
      <Slider label="Camera x" value={e.tx} {...range(nom.tx, 0.4)} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tx: v })} />
      <Slider label="Camera y" value={e.ty} {...range(nom.ty, 0.4)} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ ty: v })} />
      <Slider label="Camera z" value={e.tz} {...range(nom.tz, 0.4)} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tz: v })} />
      <Slider label="Turn (yaw)" value={e.yawDeg} {...range(nom.yawDeg, 8)} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ yawDeg: v })} />
      <Slider label="Tilt (pitch)" value={e.pitchDeg} {...range(nom.pitchDeg, 8)} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ pitchDeg: v })} />
      <Slider label="Roll (lean sideways)" value={e.rollDeg ?? 0} {...range(0, 8)} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ rollDeg: v })} />
    </>
  );
  const photo = <canvas ref={cv} data-testid="twin-cal-canvas" style={{ width: '100%', borderRadius: 12, background: '#111', imageRendering: big ? 'auto' : 'pixelated' }} aria-label="Camera image with calibration markers" />;
  const readout = (
    <>
      <ul className="cal-points">
        <li>The photo is zoomed to the calibration board.</li>
        <li><b className="cal-green">Green</b>: the four board corners (1 to 4) and the edges, as the photo shows them.</li>
        <li><b className="cal-red">Red</b>: the same corners and edges, where your calibration puts the LiDAR points.</li>
        <li>Goal: make the red outline sit on the green one.</li>
      </ul>
      <div className="mono" data-testid="twin-cal-rms" style={{ fontWeight: 600 }}>Reprojection error {rms.toFixed(2)} px{it.w !== 1280 ? ` (${rmsHd.toFixed(2)} px at 720p)` : ''} · {quality}{unit.cal.done ? ' · kept' : ''}</div>
      <div className="caption">Goal: below {CAL_MAX_PX} px, measured as if the picture were 720p. Assist calibration opens below {CAL_ASSIST_PX} px.</div>
    </>
  );
  const buttons = (
    <div className="cal-actions">
      <Btn sm onClick={() => setBig(true)} testId="twin-cal-enlarge" block>Open large view</Btn>
      <Btn sm disabled={!canAssist} title={canAssist ? 'Correct most of the error that is left' : `Available once you have the error below ${CAL_ASSIST_PX} px yourself`} variant="primary" block onClick={() => { const r = refineCalibration(target, e, unit.cal.fov), err = rmsOf(residuals(target, r, unit.cal.fov)) * (1280 / it.w); onChange({ ...unit, cal: { est: r, fov: unit.cal.fov, done: err < CAL_MAX_PX } }); }} testId="twin-cal-auto">Assist calibration</Btn>
      <Btn sm onClick={() => onChange({ ...unit, cal: { est: nominalOf(unit), fov: it.fov, done: false } })} testId="twin-cal-reset" block>Reset</Btn>
    </div>
  );
  const hint = (
    <>
      <p className="hint">Marker error: {initialRms.toFixed(2)} → {rmsHd.toFixed(2)} px at 720p. It updates as you move a parameter.</p>
      {ok ? <p className="hint" data-testid="twin-cal-success">Below {CAL_MAX_PX} px: the calibration works and is kept. <b>Assist calibration</b> can still correct most of the error that is left.</p> : canAssist && <p className="hint" data-testid="twin-cal-close-enough">Close: below {CAL_ASSIST_PX} px. Press <b>Assist calibration</b> to correct most of the rest, or keep moving the sliders to get below {CAL_MAX_PX} px.</p>}
    </>
  );
  const bigView = big && createPortal(
    <div className="cal-pop-back" role="presentation" onClick={(ev) => { if (ev.target === ev.currentTarget) setBig(false); }} data-testid="twin-cal-pop">
      <div className="cal-pop" role="dialog" aria-modal="true" aria-label="Calibration, large view">
        <div className="cal-pop-head"><b>Calibrate the camera</b><Btn sm onClick={() => setBig(false)} testId="twin-cal-close">Close</Btn></div>
        <div className="cal-pop-body"><div className="cal-pop-photo">{photo}</div><div className="cal-pop-side">{readout}{buttons}{hint}{sliders}</div></div>
      </div>
    </div>, document.body);
  return (
    <>
      {!big && photo}
      {big ? <p className="hint">The calibration is open in the large view.</p> : readout}
      {!big && buttons}
      {!big && hint}
      {!big && sliders}
      {bigView}
    </>
  );
}
