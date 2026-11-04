import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Slider } from '../../ui/controls';
import { cameraItem, HW_SEED, type CameraUnit, type LidarUnit, type TwinDesign } from '../catalogue';
import { buildFactory } from '../factory';
import { PRACTICE_SEED } from '../runner';
import { camPose, nominalOf, calibrationTarget, residuals, rmsOf, autoCalibrate, renderPreview } from '../camera';
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
  const [inspected, setInspected] = useState(false), [manual, setManual] = useState(false);
  const it = cameraItem(unit.item);
  const sig = JSON.stringify([unit.item, unit.x, unit.y, unit.z, unit.yaw, unit.pitch, unit.kit, lights]);
  const scene = useMemo(() => buildFactory(PRACTICE_SEED, 'A'), []);
  const img = useMemo(() => renderPreview(scene, unit, HW_SEED, index, lights, 480), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => calibrationTarget(unit, HW_SEED, index, lights), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = residuals(target, unit.cal.est, unit.cal.fov), rms = rmsOf(res);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    c.width = img.w; c.height = img.h; const g = c.getContext('2d')!;
    g.putImageData(new ImageData(new Uint8ClampedArray(img.rgb), img.w, img.h), 0, 0);
    const sc = img.w / it.w, k = Math.max(1, Math.round(img.w / 160)); // the preview is a smaller view of the camera's pixels: marker positions are scaled to match
    target.m.forEach((m, i) => {
      g.strokeStyle = '#30d158'; g.lineWidth = 1; g.strokeRect(m[0] * sc - 2.5 * k, m[1] * sc - 2.5 * k, 5 * k, 5 * k);
      const q = project(camPose(unit.cal.est), target.X[i], it.w, it.h, unit.cal.fov);
      if (q) { const qx = q.u * sc, qy = q.v * sc; g.strokeStyle = '#ff453a'; g.beginPath(); g.moveTo(qx - 3 * k, qy); g.lineTo(qx + 3 * k, qy); g.moveTo(qx, qy - 3 * k); g.lineTo(qx, qy + 3 * k); g.stroke(); g.strokeStyle = 'rgba(255,69,58,.5)'; g.beginPath(); g.moveTo(qx, qy); g.lineTo(m[0] * sc, m[1] * sc); g.stroke(); }
    });
  }, [img, target, unit.cal.est, unit.cal.fov]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = unit.cal.est, nom = nominalOf(unit), set = (p: Partial<typeof e>) => { setManual(true); onChange({ ...unit, cal: { ...unit.cal, est: { ...e, ...p }, done: false } }); };
  const rmsHd = rms * (1280 / it.w); // judged as if the picture were 720p, so a 4K camera is not punished for having smaller pixels
  const [initialRms] = useState(rmsHd);
  const quality = rmsHd < 1 ? 'Excellent' : rmsHd < 2 ? 'Good' : rmsHd < 4 ? 'Fair' : 'Poor';
  return (
    <>
      <canvas ref={cv} data-testid="twin-cal-canvas" style={{ width: '100%', borderRadius: 12, background: '#111', imageRendering: 'pixelated' }} aria-label="Camera image with calibration markers" />
      <div className="caption">Green squares: markers found in the photo. Red crosses: where your calibration puts them. Close them up.</div>
      <div className="mono" data-testid="twin-cal-rms" style={{ fontWeight: 600 }}>Reprojection error {rms.toFixed(2)} px{it.w !== 1280 ? ` (${rmsHd.toFixed(2)} px at 720p)` : ''} · {quality}{unit.cal.done ? ' · saved' : ''}</div>
      <div className="caption">Corner detection noise on this camera: about {target.sigmaPx.toFixed(1)} px (darker or smaller pictures are noisier).</div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <Btn sm onClick={() => setInspected(true)}>Inspect marker error</Btn>
        <Btn sm disabled={!inspected || !manual} title="Inspect the error and try a manual correction first" variant="primary" onClick={() => { const r = autoCalibrate(target, e, unit.cal.fov); onChange({ ...unit, cal: { est: r.e, fov: r.fov, done: true } }); }} testId="twin-cal-auto">Assist calibration</Btn>
        <Btn sm onClick={() => onChange({ ...unit, cal: { est: nominalOf(unit), fov: it.fov, done: false } })} testId="twin-cal-reset">Reset</Btn>
        <Btn sm disabled={!Number.isFinite(rmsHd) || rmsHd > 4} onClick={() => onChange({ ...unit, cal: { ...unit.cal, done: true } })}>Save calibration</Btn>
      </div>
      {inspected && <p className="hint">Marker error: {initialRms.toFixed(2)} → {rmsHd.toFixed(2)} px at 720p. Move a calibration parameter to test how the markers respond, then use assistance if needed.</p>}
      <Slider label="Camera x" value={e.tx} min={nom.tx - 0.4} max={nom.tx + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tx: v })} />
      <Slider label="Camera y" value={e.ty} min={nom.ty - 0.4} max={nom.ty + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ ty: v })} />
      <Slider label="Camera z" value={e.tz} min={nom.tz - 0.4} max={nom.tz + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tz: v })} />
      <Slider label="Turn (yaw)" value={e.yawDeg} min={nom.yawDeg - 8} max={nom.yawDeg + 8} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ yawDeg: v })} />
      <Slider label="Tilt (pitch)" value={e.pitchDeg} min={nom.pitchDeg - 8} max={nom.pitchDeg + 8} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ pitchDeg: v })} />
      <Slider label="Field of view (focal length)" value={unit.cal.fov} min={it.fov * 0.9} max={it.fov * 1.1} step={0.1} unit="°" format={(v) => v.toFixed(1)} onChange={(v) => onChange({ ...unit, cal: { ...unit.cal, fov: v, done: false } })} hint="Intrinsic: the lens. Extrinsic: where the camera sits and points." />
    </>
  );
}

