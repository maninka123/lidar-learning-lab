import { Fragment, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useLab } from '../state/store';
import { Viewport } from '../ui/Viewport';
import { TabFrame } from '../ui/TabFrame';
import { Btn, Callout, Section, Select, Seg, Slider, Toggle } from '../ui/controls';
import { KindLegend } from '../ui/shared';
import { SceneLayer, CloudLayer, PolyLine, Marker, BoxOutline } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Crosshair, Play, Plus, Trash2, Download, Upload } from '../ui/icons';
import { runTask } from '../engine/client';
import { downloadBlob } from '../io/load';
import { buildFactory, ZONES, SAFETY_ZONES, TWIN_CLASSES } from '../twin/factory';
import { LIDARS, CAMERAS, LIGHT_UNIT, LOWLIGHT_KIT, MOBILE_PLATFORM, RES_TIERS, INSTALL, TASK_KEYS, TASK_NAMES, LIMITS, costOf, lidarItem, cameraItem, newId, isMobile, HW_SEED, ResTier, TwinDesign, LidarUnit, CameraUnit, TaskKey } from '../twin/catalogue';
import { raysFor, acquireSurvey, Survey } from '../twin/acquire';
import { camPose, nominalOf, calibrationTarget, residuals, rmsOf, autoCalibrate, renderPreview, makeSampler, colourPoints } from '../twin/camera';
import { project } from '../apps/fusion';
import { BLOCKS, BLOCK_TAB, PickList, PHASES, phaseIndex, insertBlock, regParamsOf, newBlock, checkPipeline, canRunParallel, parallelGroups, BlockKind, Block } from '../twin/pipeline';
import { registerScans, RegReport } from '../twin/register';
import { PRACTICE_SEED, RunResult } from '../twin/runner';
import { createPortal } from 'react-dom';
import { useTwin, STAGES, snapshot, parseSave } from '../twin/store';
import { evaluate } from '../occlusion/coverage';
import { FovVolume, ScannerMarkers, SamplePoints, paint, STATUS_COLOURS } from '../occlusion/OccView';
import { cameraView, lidarAsScanner } from '../twin/coverage';
import { fovOverlap } from '../twin/overlap';
import { insideSolid } from '../occlusion/coverage';
import { feedbackFor, reportMarkdown } from '../twin/feedback';
import { sensorOf } from '../occlusion/coverage';
import { PointCloud, concatClouds } from '../core/pointcloud';
import { D2R, Vec3 } from '../core/math';
import { tabIndex } from './nav';
import { workshopConfigured, submitChallengeScore, challengeAccepting } from '../apps/workshop';
import { buildSubmission, validIndex } from '../twin/submit';

const UNIT_COLOURS = ['#e63946', '#1d78dc', '#28aa5a', '#f4a21e', '#8c50c8', '#00b4be'];
const HEAT = ['#ff453a', '#30d158', '#0a84ff'];
/** Where a new item goes: the open floor spot that is farthest from everything already placed, so equipment starts scattered around the factory. */
function scatterSpot(scene: ReturnType<typeof buildFactory>['scene'], taken: [number, number][], z = 1.6): [number, number] {
  const b = scene.bounds; let best: [number, number] = [-8, -4], bestD = -1;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
    const x = b.min[0] + 1.5 + (i / 12) * (b.max[0] - b.min[0] - 3), y = b.min[1] + 1.2 + (j / 8) * (b.max[1] - b.min[1] - 2.4);
    if (insideSolid(scene, x, y, z) || insideSolid(scene, x, y, 0.4)) continue;
    const d = taken.length ? Math.min(...taken.map(([a, c]) => Math.hypot(a - x, c - y))) : Math.hypot(x + 8, y + 4) * -1 + 100; // the first item starts at the left of the floor
    if (d > bestD) { bestD = d; best = [x, y]; }
  }
  return best;
}
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)} %`;
const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const hexRgb = (h: string): [number, number, number] => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const cloudOf = (pos: Float32Array): PointCloud => ({ id: 'x', name: 'x', count: pos.length / 3, positions: pos, meta: { kind: 'processed', source: 'overlay', units: 'm' } });

/** A camera calibration workspace: the photo, the board markers found in it (green) and where your current calibration says they should be (red). */
/** Cameras on the left, LiDARs on the right. Drag from the dot of a camera to a LiDAR to connect them (or pick a camera and click a LiDAR). One wire per camera; many cameras may share a LiDAR. */
interface PairCam { id: string; label: string; sub: string; done: boolean; to: string | null }
interface PairLid { id: string; label: string; sub: string; nearestOf: string[] }
function PairBoard({ cams, lids, selected, onSelect, onPair }: { cams: PairCam[]; lids: PairLid[]; selected: string | null; onSelect: (id: string) => void; onPair: (camId: string, lidId: string) => void }) {
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

const blockSig = (b: Block) => JSON.stringify([b.kind, b.params, b.bypass]);
/** The practice score as a ring that fills and changes colour as it grows, a short word for where the team stands, and one thin bar per task so the weak spot is easy to see. */
const SCORE_SHORT: Record<string, string> = { twin: 'Twin', detect: 'Objects', colour: 'Colour', change: 'Change', quality: 'Noise', safety: 'Safety', budget: 'Budget' };
const scoreHue = (x: number) => `hsl(${Math.round(8 + Math.max(0, Math.min(1, x)) * 120)} 72% 44%)`;
function ScoreMeter({ value, tasks }: { value: number; tasks: { key: string; score: number; weight: number }[] }) {
  const v = Math.max(0, Math.min(100, value)), R = 21, C = 2 * Math.PI * R, col = scoreHue(v / 100);
  const verdict = v < 20 ? 'Just getting started' : v < 45 ? 'Taking shape' : v < 70 ? 'Good progress' : v < 85 ? 'Strong result' : 'Excellent';
  return (
    <span className="scoremeter" data-testid="twin-score-meter" role="img" aria-label={`Practice score ${v.toFixed(1)} out of 100: ${verdict}. ${tasks.map((t) => `${SCORE_SHORT[t.key] ?? t.key} ${Math.round(t.score * 100)} percent`).join(', ')}`}>
      <span className="scoremeter-main">
        <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r={R} fill="none" stroke="rgba(120,120,128,.22)" strokeWidth="6" /><circle cx="27" cy="27" r={R} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 27 27)" style={{ transition: 'stroke-dasharray .6s ease' }} /></svg>
        <span className="scoremeter-text"><b style={{ color: col }}>{v.toFixed(1)}</b><small>out of 100</small><em>{verdict}</em></span>
      </span>
      <span className="scoremeter-bars" aria-hidden="true">
        {tasks.filter((t) => t.weight > 0).map((t) => <span key={t.key} className="sb"><span>{SCORE_SHORT[t.key] ?? t.key}</span><span className="sb-t"><i style={{ width: `${Math.max(2, Math.round(t.score * 100))}%`, background: scoreHue(t.score) }} /></span><span className="sb-n">{Math.round(t.score * 100)}</span></span>)}
      </span>
    </span>
  );
}

/** The two fields of view cut by a flat screen `dist` metres in front of the camera: the camera's rectangle against the LiDAR's reach. */
function FovOverlapChart({ cam, lid, camNo, lidNo, dist, onDist }: { cam: CameraUnit; lid: LidarUnit; camNo: number; lidNo: number; dist: number; onDist: (v: number) => void }) {
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

function CalPanel({ unit, index, lights, onChange }: { unit: CameraUnit; index: number; lights: TwinDesign['lights']; onChange: (c: CameraUnit) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
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
  const e = unit.cal.est, nom = nominalOf(unit), set = (p: Partial<typeof e>) => onChange({ ...unit, cal: { ...unit.cal, est: { ...e, ...p }, done: false } });
  const rmsHd = rms * (1280 / it.w); // judged as if the picture were 720p, so a 4K camera is not punished for having smaller pixels
  const quality = rmsHd < 1 ? 'Excellent' : rmsHd < 2 ? 'Good' : rmsHd < 4 ? 'Fair' : 'Poor';
  return (
    <>
      <canvas ref={cv} data-testid="twin-cal-canvas" style={{ width: '100%', borderRadius: 12, background: '#111', imageRendering: 'pixelated' }} aria-label="Camera image with calibration markers" />
      <div className="caption">Green squares: markers found in the photo. Red crosses: where your calibration puts them. Close them up.</div>
      <div className="mono" data-testid="twin-cal-rms" style={{ fontWeight: 600 }}>Reprojection error {rms.toFixed(2)} px{it.w !== 1280 ? ` (${rmsHd.toFixed(2)} px at 720p)` : ''} · {quality}{unit.cal.done ? ' · saved' : ''}</div>
      <div className="caption">Corner detection noise on this camera: about {target.sigmaPx.toFixed(1)} px (darker or smaller pictures are noisier).</div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <Btn sm variant="primary" onClick={() => { const r = autoCalibrate(target, e, unit.cal.fov); onChange({ ...unit, cal: { est: r.e, fov: r.fov, done: true } }); }} testId="twin-cal-auto">Calibrate automatically</Btn>
        <Btn sm onClick={() => onChange({ ...unit, cal: { est: nominalOf(unit), fov: it.fov, done: false } })} testId="twin-cal-reset">Reset</Btn>
        <Btn sm onClick={() => onChange({ ...unit, cal: { ...unit.cal, done: true } })}>Mark as done</Btn>
      </div>
      <Slider label="Camera x" value={e.tx} min={nom.tx - 0.4} max={nom.tx + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tx: v })} />
      <Slider label="Camera y" value={e.ty} min={nom.ty - 0.4} max={nom.ty + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ ty: v })} />
      <Slider label="Camera z" value={e.tz} min={nom.tz - 0.4} max={nom.tz + 0.4} step={0.005} unit=" m" format={(v) => v.toFixed(3)} onChange={(v) => set({ tz: v })} />
      <Slider label="Turn (yaw)" value={e.yawDeg} min={nom.yawDeg - 8} max={nom.yawDeg + 8} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ yawDeg: v })} />
      <Slider label="Tilt (pitch)" value={e.pitchDeg} min={nom.pitchDeg - 8} max={nom.pitchDeg + 8} step={0.05} unit="°" format={(v) => v.toFixed(2)} onChange={(v) => set({ pitchDeg: v })} />
      <Slider label="Field of view (focal length)" value={unit.cal.fov} min={it.fov * 0.9} max={it.fov * 1.1} step={0.1} unit="°" format={(v) => v.toFixed(1)} onChange={(v) => onChange({ ...unit, cal: { ...unit.cal, fov: v, done: false } })} hint="Intrinsic: the lens. Extrinsic: where the camera sits and points." />
    </>
  );
}

if (typeof window !== 'undefined') (window as unknown as { __twin: typeof useTwin }).__twin = useTwin; // for the browser tests

export default function TabTwin() {
  const T = useTwin(), lab = useLab();
  const stage = T.stage, d = T.design;
  const factory = useMemo(() => buildFactory(PRACTICE_SEED, 'A'), []);
  const scene = factory.scene;
  const cost = useMemo(() => costOf(d, T.settings), [d, T.settings]);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [routeMode, setRouteMode] = useState(false), [placeMode, setPlaceMode] = useState(false);
  const [taskTab, setTaskTab] = useState<'detect' | 'colour' | 'change' | 'quality' | 'safety'>('detect');
  const [fovDist, setFovDist] = useState(5); // metres in front of the camera at which the two fields of view are compared
  const [calPair, setCalPair] = useState<Record<string, string>>({}); // camera id → the LiDAR chosen to check it against (a camera need not pair with the LiDAR of the same number)
  const [calCloud, setCalCloud] = useState<{ cloud: PointCloud; coloured: number; total: number } | null>(null), [calBusy, setCalBusy] = useState(false);
  const calCache = useRef<{ key: string; cloud: PointCloud } | null>(null);
  const [ownFrames, setOwnFrames] = useState(true); // acquired scans are shown as delivered: each in its own scanner's coordinate system
  const [camColour, setCamColour] = useState(true); // in the survey view: points a camera sees take its colours
  const [surveyView, setSurveyView] = useState<{ cloud: PointCloud; base: Uint8Array; cam: Uint8Array | null; coloured: number }[] | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null); // which block's settings are open
  const [regTest, setRegTest] = useState<{ id: string; report: RegReport; clouds: PointCloud[] } | null>(null), [regBusy, setRegBusy] = useState(false);
  const [pipeExpanded, setPipeExpanded] = useState(false); // the builder can fill the whole window
  const [lastRun, setLastRun] = useState<Record<string, { before: number; after: number; sig: string }>>({}); // what each block did to the point count in the latest test, kept until that block is changed
  const [lastPick, setLastPick] = useState<Record<string, PickList>>({}); // the planes and clusters each block found in the latest test, kept while the team ticks and unticks them
  const [rerunAt, setRerunAt] = useState(0); // set when a tick changes: the test runs again a moment later so the 3D view follows
  const [autoTest, setAutoTest] = useState(false); // in the pipeline stage: run the practice again a moment after every change to the blocks
  const [planOpen, setPlanOpen] = useState(true); // the plan in the corner of the view can be folded away and brought back
  const [viewMode, setViewMode] = useState<'both' | 'scene' | 'points'>('both'); // what the 3D view shows: the factory, the points, or both at once
  const [pname, setPname] = useState('Pipeline 1');
  const [consent, setConsent] = useState(false), [sendKind, setSendKind] = useState<'final' | 'practice'>('final'), [sending, setSending] = useState(false), [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showMissing, setShowMissing] = useState(true), [showZones, setShowZones] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const st = useLab.getState(); return () => { st.patch({ interaction: 'select' }); }; }, []);
  useEffect(() => { lab.patch({ interaction: (placeMode || routeMode) && stage === 2 ? 'add-station' : 'select' }); }, [placeMode, routeMode, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stage !== 5) setPipeExpanded(false); }, [stage]);
  useEffect(() => { setRegTest(null); }, [d.lidars, d.cameras, d.route, d.routeSteps, d.platform]);
  useEffect(() => { setSurvey(null); setSurveyView(null); }, [d.lidars, d.cameras, d.lights, d.routeSteps, d.route, d.platform]);

  /** Every change to the equipment goes through here. A change that raises the cost is refused when it would go over the budget: the budget can never be exceeded. */
  const setDesign = (f: (x: TwinDesign) => TwinDesign): boolean => {
    const s = useTwin.getState(), cur = s.design, next = f(cur), c0 = costOf(cur, s.settings), c1 = costOf(next, s.settings);
    if (c1.total > s.settings.budget && c1.total > c0.total) { lab.notify(`Not enough credits: that costs ${c1.total - c0.total} more and you have ${Math.max(0, s.settings.budget - c0.total)} left.`, 'warn'); return false; }
    s.set({ design: next, practice: null }); return true;
  };
  /** What adding something would cost, so the shop can grey out what you cannot afford. */
  const extra = (f: (x: TwinDesign) => TwinDesign) => costOf(f(d), T.settings).total - cost.total;
  const affordable = (f: (x: TwinDesign) => TwinDesign) => extra(f) <= cost.remaining;
  const sel = T.selectedUnit;
  const selL = d.lidars.find((u) => u.id === sel), selC = d.cameras.find((u) => u.id === sel), selLight = d.lights.find((u) => u.id === sel);
  const bounds = scene.bounds;
  const clampXY = (x: number, y: number): [number, number] => [Math.min(bounds.max[0] - 0.3, Math.max(bounds.min[0] + 0.3, x)), Math.min(bounds.max[1] - 0.3, Math.max(bounds.min[1] + 0.3, y))];
  const place = (x0: number, y0: number) => {
    if (stage !== 2) return; const [x, y] = clampXY(x0, y0);
    if (routeMode) { setDesign((q) => ({ ...q, route: [...q.route, [x, y]] })); return; }
    if (!placeMode || !sel) return;
    if (selL) patchLidar(selL.id, { x, y });
    else if (selC) patchCam(sel, { x, y }); else if (selLight) setDesign((q) => ({ ...q, lights: q.lights.map((u) => (u.id === sel ? { ...u, x, y } : u)) }));
  };
  useEffect(() => { if (lab.pendingStation) { place(lab.pendingStation[0], lab.pendingStation[1]); lab.patch({ pendingStation: null }); } }, [lab.pendingStation]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Moving or re-aiming a camera, or changing its optics, makes the old calibration wrong: it goes back to the intended pose. */
  function patchCam(id: string, p: Partial<CameraUnit>) {
    setDesign((q) => ({ ...q, cameras: q.cameras.map((c) => { if (c.id !== id) return c; const n = { ...c, ...p }, it = cameraItem(n.item); return { ...n, cal: { est: nominalOf(n), fov: it.fov, done: false } }; }) }));
  }
  /** every place already used by a scanner, camera or lamp */
  const taken = useMemo<[number, number][]>(() => [...d.lidars.map((u) => [u.x, u.y] as [number, number]), ...d.cameras.map((u) => [u.x, u.y] as [number, number]), ...d.lights.map((u) => [u.x, u.y] as [number, number])], [d]);
  const nextSpot = useMemo(() => scatterSpot(scene, taken), [scene, taken]);
  /** the spot from the latest design, so quick repeated clicks cannot put two items in the same place */
  const freshSpot = (): [number, number] => { const q = useTwin.getState().design; return scatterSpot(scene, [...q.lidars.map((u) => [u.x, u.y] as [number, number]), ...q.cameras.map((u) => [u.x, u.y] as [number, number]), ...q.lights.map((u) => [u.x, u.y] as [number, number])]); };
  const patchLidar = (id: string, p: Partial<LidarUnit>) => setDesign((q) => ({ ...q, lidars: q.lidars.map((u) => (u.id === id ? { ...u, ...p } : u)) }));

  // ---- buying
  const lidarPlan = (item: string, fresh = false): { u: LidarUnit; f: (q: TwinDesign) => TwinDesign } => {
    const [x, y] = fresh ? freshSpot() : nextSpot, u: LidarUnit = { id: newId('lidar'), item, res: 'standard', x, y, z: lidarItem(item).mobile ? 1.5 : 1.8, yaw: 0, pitch: 0 };
    return { u, f: (q) => ({ ...q, lidars: [...q.lidars, u], platform: q.platform || !!lidarItem(item).mobile }) }; // a mobile LiDAR comes with the platform it rides on
  };
  const buyLidar = (item: string) => { const { u, f } = lidarPlan(item, true); if (setDesign(f)) T.set({ selectedUnit: u.id }); };
  const buyCamera = (item: string) => {
    const [x, y] = freshSpot(), base: CameraUnit = { id: newId('cam'), item, x, y, z: 1.8, yaw: Math.atan2(-y, -x), // looks towards the middle of the factory
      pitch: 0, kit: false, cal: { est: { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 }, fov: 0, done: false } };
    const c = { ...base, cal: { est: nominalOf(base), fov: cameraItem(item).fov, done: false } };
    if (setDesign((q) => ({ ...q, cameras: [...q.cameras, c] }))) T.set({ selectedUnit: c.id });
  };
  const cameraPlan = (item: string) => (q: TwinDesign): TwinDesign => ({ ...q, cameras: [...q.cameras, { id: 'x', item, x: 0, y: 0, z: 1.8, yaw: 0, pitch: 0, kit: false, cal: { est: { tx: 0, ty: 0, tz: 1.8, yawDeg: 0, pitchDeg: 0 }, fov: 0, done: false } }] });
  const remove = (id: string) => { setDesign((q) => ({ ...q, lidars: q.lidars.filter((u) => u.id !== id), cameras: q.cameras.filter((u) => u.id !== id), lights: q.lights.filter((u) => u.id !== id) })); if (sel === id) T.set({ selectedUnit: null }); };

  // ---- running
  const cfg = { design: d, pipeline: T.pipeline, settings: T.settings };
  const chk = useMemo(() => checkPipeline(T.pipeline, { cameras: d.cameras.length, hasB: true }), [T.pipeline, d.cameras.length]);
  async function runPractice() {
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    setViewMode((m) => (m === 'scene' ? 'both' : m)); // the result is points: make sure the view shows them
    T.set({ busy: 'Running the practice survey and your pipeline…' });
    try {
      const r = await runTask('twinRun', { config: cfg, seed: PRACTICE_SEED });
      setLastPick(Object.fromEntries(r.steps.filter((x) => x.pick).map((x) => [x.id, x.pick as PickList])));
      setLastRun(Object.fromEntries(r.steps.filter((x) => !x.bypassed && !x.error).map((x) => { const b = T.pipeline.find((q) => q.id === x.id); return [x.id, { before: x.before, after: x.after, sig: b ? blockSig(b) : '' }]; })));
      useTwin.getState().set({ practice: r, selectedStep: r.steps.reduce((last, x, i) => (x.preview && !x.error && !x.bypassed ? i : last), -1), attempts: [...useTwin.getState().attempts, { at: Date.now(), kind: 'practice', seed: PRACTICE_SEED, total: r.grade.total, tasks: Object.fromEntries(r.grade.perTask.map((x) => [x.key, x.score])), cost: r.cost.total }] });
    } catch (e) { lab.notify((e as Error).message, 'error'); } finally { useTwin.getState().set({ busy: null }); }
  }
  const pipeSig = JSON.stringify(T.pipeline.map((b) => [b.kind, b.bypass, b.params, b.parallel]));
  useEffect(() => { // "test as I add": a short wait after the last change, then the practice run shows the result in the 3D view
    if (stage !== 5 || !autoTest || !chk.ok || !cost.ok || useTwin.getState().busy) return;
    const id = setTimeout(() => { if (!useTwin.getState().busy) void runPractice(); }, 1200); return () => clearTimeout(id);
  }, [pipeSig, autoTest, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rerunAt || stage !== 5 || !chk.ok || !cost.ok) return;
    const id = setTimeout(() => { if (!useTwin.getState().busy) void runPractice(); }, 700); return () => clearTimeout(id);
  }, [rerunAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalsUsed = T.attempts.filter((a) => a.kind === 'final').length;
  async function submitFinal() {
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    if (T.settings.maxSubmissions > 0 && finalsUsed >= T.settings.maxSubmissions) { lab.notify('No final evaluations left.', 'warn'); return; }
    T.set({ busy: 'Final evaluation on separate scenario variants…' });
    try {
      const r = await runTask('twinFinal', { config: cfg });
      const s = useTwin.getState();
      s.set({ final: r, finalSubmitted: { at: Date.now(), design: d, pipeline: T.pipeline, total: r.grade.total }, attempts: [...s.attempts, { at: Date.now(), kind: 'final', seed: r.runs.map((x) => x.seed), total: r.grade.total, tasks: Object.fromEntries(r.grade.perTask.map((x) => [x.key, x.score])), cost: r.cost.total }] });
    } catch (e) { lab.notify((e as Error).message, 'error'); } finally { useTwin.getState().set({ busy: null }); }
  }
  async function acquire() {
    if (!cost.ok) { lab.notify(cost.errors.join(' '), 'warn'); return; }
    T.set({ busy: 'Acquiring the survey…' }); await new Promise((r) => setTimeout(r, 30));
    try {
      const sv = acquireSurvey(factory, d, PRACTICE_SEED); setSurvey(sv);
      // where a camera sees a point, the point takes the camera's colour (with the calibration as set); all other points keep their scanner colour
      const cams = d.cameras.map((c, i) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, i, d.lights), e: c.cal.est, fov: c.cal.fov }));
      setSurveyView(sv.visible.scans.map((s2, i) => {
        const n = s2.cloud.count, [r, g, b] = hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]), base = new Uint8Array(n * 3);
        for (let k = 0; k < n; k++) { base[k * 3] = r; base[k * 3 + 1] = g; base[k * 3 + 2] = b; }
        if (!cams.length) return { cloud: s2.cloud, base, cam: null, coloured: 0 };
        const col = colourPoints(s2.cloud.positions, n, cams), cam = base.slice();
        for (let k = 0; k < n; k++) if (col.valid[k]) cam.set(col.colors.subarray(k * 3, k * 3 + 3), k * 3);
        return { cloud: s2.cloud, base, cam, coloured: col.count };
      }));
    } finally { T.set({ busy: null }); }
  }
  /** Try one registration block on the acquired survey and show its RMSE straight away, so the settings can be tuned without running everything */
  async function testRegistration(b: Block) {
    setViewMode((m) => (m === 'scene' ? 'both' : m));
    setRegBusy(true); await new Promise((r) => setTimeout(r, 30));
    try {
      const sv = survey ?? acquireSurvey(factory, d, PRACTICE_SEED); if (!survey) setSurvey(sv);
      const r = registerScans(sv.visible.scans, regParamsOf(b.kind, { ...Object.fromEntries(BLOCKS[b.kind].params.map((p2) => [p2.key, p2.def])), ...b.params }));
      setRegTest({ id: b.id, report: r.report, clouds: r.clouds }); useTwin.getState().set({ selectedStep: -1 }); // show this test in the 3D view, not an older run
    } finally { setRegBusy(false); }
  }
  const exportConfig = () => downloadBlob(new Blob([JSON.stringify(snapshot(useTwin.getState()), null, 1)], { type: 'application/json' }), `${(T.team || 'team').replace(/\W+/g, '_')}_twin_challenge.json`);
  const exportReport = () => downloadBlob(new Blob([reportMarkdown(T.team, T.members, T.practice, T.final ? { total: T.final.grade.total, perTask: T.final.grade.perTask.map((x) => ({ key: x.key, points: x.points, weight: x.weight })) } : null, cost.total, T.settings.budget)], { type: 'text/markdown' }), `${(T.team || 'team').replace(/\W+/g, '_')}_twin_report.md`);
  const [accept, setAccept] = useState<{ known: boolean; accepting: boolean; until: number | null }>({ known: false, accepting: false, until: null });
  useEffect(() => {
    if (!workshopConfigured()) return;
    let on = true;
    const ask = () => challengeAccepting().then((a) => {
      if (!on) return; setAccept({ known: a.known, accepting: a.accepting, until: a.until });
      // the instructor's grading settings win over anything saved here; a change makes old results stale
      const cur = useTwin.getState().settings;
      if (a.settings && JSON.stringify(a.settings) !== JSON.stringify(cur)) useTwin.getState().set({ settings: a.settings, practice: null, final: null });
    });
    ask(); const id = setInterval(ask, 30000);
    return () => { on = false; clearInterval(id); };
  }, []);
  const canSendFinal = !!T.final, canSendPractice = !!T.practice;
  const kindToSend: 'final' | 'practice' = sendKind === 'final' && canSendFinal ? 'final' : canSendPractice ? 'practice' : 'final';
  async function sendScore() {
    const kind = kindToSend, st = T.student;
    if (st.name.trim().length < 2) { setSendMsg({ ok: false, text: 'Enter your name.' }); return; }
    if (!validIndex(st.index)) { setSendMsg({ ok: false, text: 'Enter your index number (3 to 24 letters or digits).' }); return; }
    if (!consent) { setSendMsg({ ok: false, text: 'Tick the box to agree to send this.' }); return; }
    if (accept.known && !accept.accepting) { setSendMsg({ ok: false, text: 'Scores are not being accepted right now. Keep grading, and send when it opens.' }); return; }
    const body = buildSubmission({ name: st.name.trim(), index: st.index.trim(), consent, team: T.team }, { practice: T.practice, final: T.final, design: d, pipeline: T.pipeline, settings: T.settings, attempts: T.attempts, startedAt: T.startedAt }, kind);
    if (!body) { setSendMsg({ ok: false, text: kind === 'final' ? 'Submit for the final evaluation first.' : 'Run the practice first.' }); return; }
    setSending(true); setSendMsg(null);
    const r = await submitChallengeScore(body); setSending(false); setSendMsg({ ok: r.ok, text: r.message }); if (!r.ok && /not being accepted/.test(r.message)) setAccept({ known: true, accepting: false, until: null });
    if (r.ok) T.set({ sent: [...useTwin.getState().sent, { at: Date.now(), kind, total: body.total }] });
  }
  const importConfig = (f: File | undefined) => { if (!f) return; f.text().then((t) => { const s = parseSave(t); if (s) { T.importSave(s); lab.notify('Challenge configuration loaded.', 'ok'); } else lab.notify('That file is not a challenge configuration.', 'error'); }); };

  // ---- calibration check: the points of one LiDAR, coloured by the selected camera with the calibration as it is now
  const nearestLidar = (c: CameraUnit) => d.lidars.reduce<LidarUnit | null>((b, u) => (!b || Math.hypot(u.x - c.x, u.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? u : b), null);
  const pairedLidar = (c: CameraUnit) => d.lidars.find((u) => u.id === calPair[c.id]) ?? nearestLidar(c);
  const calLid = selC ? pairedLidar(selC) : null;
  /** every camera wired to that LiDAR: they all colour its points, each with its own calibration */
  const connected = calLid ? d.cameras.filter((c) => pairedLidar(c)?.id === calLid.id) : [];
  const connSig = JSON.stringify(connected.map((c) => [c.id, c.cal.est, c.cal.fov, c.x, c.y, c.z, c.yaw, c.pitch, c.kit, c.item]));
  useEffect(() => {
    if (stage !== 3 || !selC || !calLid) { setCalCloud(null); return; }
    setCalBusy(true);
    const id = setTimeout(() => {
      try {
        const key = JSON.stringify([calLid, d.platform, d.route, d.routeSteps, d.distortion]);
        if (calCache.current?.key !== key) { const sv = acquireSurvey(factory, { ...d, lidars: [calLid] }, PRACTICE_SEED); calCache.current = { key, cloud: concatClouds(sv.visible.scans.map((s2) => s2.cloud), 'Calibration check') }; }
        const cloud = calCache.current.cloud, col = colourPoints(cloud.positions, cloud.count, connected.map((c) => ({ unit: c, image: makeSampler(factory, c, HW_SEED, d.cameras.findIndex((x) => x.id === c.id), d.lights), e: c.cal.est, fov: c.cal.fov })));
        const colors = new Uint8Array(cloud.count * 3); for (let i = 0; i < cloud.count; i++) { if (col.valid[i]) colors.set(col.colors.subarray(i * 3, i * 3 + 3), i * 3); else colors.fill(110, i * 3, i * 3 + 3); } // grey: no connected camera sees the point
        setCalCloud({ cloud: { ...cloud, colors, instances: undefined }, coloured: col.count, total: cloud.count });
      } finally { setCalBusy(false); }
    }, 250); // wait for the slider to settle
    return () => clearTimeout(id);
  }, [stage, selC?.id, connSig, calLid?.id, d.lidars, d.lights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- planning aids
  const scanners = useMemo(() => d.lidars.map(lidarAsScanner), [d.lidars]);
  const cov = useMemo(() => (stage === 2 && scanners.length ? evaluate(scene, scanners) : null), [stage, scanners, scene]);
  const covColours = useMemo(() => (cov ? paint(cov.samples.count, (i) => HEAT[Math.min(2, cov.stats.times[i])]) : null), [cov]);
  const camStats = useMemo(() => (stage === 2 && selC ? cameraView(scene, selC, factory.targets) : null), [stage, selC, scene, factory.targets]);
  const rayCount = (u: LidarUnit) => raysFor(u);

  // ---- 3D
  const practice = T.practice, step = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
  const frustum = (c: CameraUnit, color: string) => {
    const it = cameraItem(c.item), p = camPose(nominalOf(c)), t = Math.tan((it.fov * D2R) / 2), a = it.w / it.h, L = 4, o = p.pos;
    const corner = (sx: number, sy: number): Vec3 => [o[0] + L * (p.f[0] + sx * t * a * p.r[0] + sy * t * p.u[0]), o[1] + L * (p.f[1] + sx * t * a * p.r[1] + sy * t * p.u[1]), o[2] + L * (p.f[2] + sx * t * a * p.r[2] + sy * t * p.u[2])];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    return <>{cs.map((q, i) => <PolyLine key={i} pts={[o as Vec3, q]} color={color} width={1.5} />)}<PolyLine pts={[...cs, cs[0]]} color={color} width={1.5} /></>;
  };
  const refs = practice?.refs ?? [];
  const matchRef = useMemo(() => { if (!practice) return null; const m = practice.tasks.detect.match; const ok = new Map(m.pairs.map((p) => [p.ref, practice.objects[p.pred]?.cls === refs[p.ref].cls])); return ok; }, [practice, refs]);
  const showScene = viewMode !== 'points', showPts = viewMode !== 'scene';
  const viewport = (
    <Viewport home={scene.cameraHome} target={scene.cameraTarget} bgOverride={!showScene ? '#ffffff' : undefined} hideGrid={!showScene} hideAxes>
      {showScene && <SceneLayer scene={scene} opacity={viewMode === 'both' && stage >= 3 && stage <= 6 ? 0.18 : 0.4} showCeiling={false} interactive={stage === 2} />}
      {showPts && stage === 2 && cov && covColours && <SamplePoints samples={cov.samples} colours={covColours} size={3} />}
      {stage <= 3 && <ScannerMarkers scanners={scanners} selected={scanners.findIndex((s2) => d.lidars[s2.id].id === sel) >= 0 ? scanners.findIndex((s2) => d.lidars[s2.id].id === sel) : null} sensorOf={(s2) => sensorOf(s2.preset)} />}
      {stage <= 3 && d.cameras.map((c, i) => <group key={c.id}><Marker p={[c.x, c.y, c.z]} color="#0a84ff" r={0.18} label={`Cam ${i + 1}`} />{c.id === sel && frustum(c, '#0a84ff')}</group>)}
      {stage <= 3 && d.lights.map((l, i) => <Marker key={l.id} p={[l.x, l.y, l.z]} color="#ffcc00" r={0.18} label={`Lamp ${i + 1}`} />)}
      {stage === 2 && selL && <FovVolume sc={lidarAsScanner(selL, 0)} sensor={sensorOf(lidarItem(selL.item).preset)} color={UNIT_COLOURS[d.lidars.indexOf(selL) % 6]} reach={14} opacity={0.08} />}
      {stage === 2 && d.lidars.some(isMobile) && d.route.length > 1 && <PolyLine pts={d.route.map(([x, y]) => [x, y, 0.2] as Vec3)} color="#ff9f0a" width={3} dashed />}
      {stage === 2 && d.route.map(([x, y], i) => (d.lidars.some(isMobile) || routeMode) ? <Marker key={i} p={[x, y, 0.2]} color="#ff9f0a" r={0.2} label={`${i + 1}`} /> : null)}
      {showPts && stage === 4 && survey && ownFrames && survey.visible.scans.map((s2, i) => { const v = surveyView?.[i]; return v && s2.local.count === v.base.length / 3 ? <CloudLayer key={`o${i}`} cloud={{ ...s2.local, instances: undefined, colors: camColour && v.cam ? v.cam : v.base }} mode="rgb" size={2.5} budget={120000} pickable={false} /> : <CloudLayer key={`o${i}`} cloud={{ ...s2.local, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) }} size={2.5} budget={120000} pickable={false} />; })}
      {showPts && stage === 4 && surveyView && !ownFrames && surveyView.map((v, i) => <CloudLayer key={i} cloud={{ ...v.cloud, instances: undefined, colors: camColour && v.cam ? v.cam : v.base }} mode="rgb" size={2.5} budget={120000} pickable={false} />)}
      {showPts && stage === 3 && calCloud && <CloudLayer cloud={calCloud.cloud} mode="rgb" size={3} budget={150000} pickable={false} />}
      {stage === 3 && selC && calLid && <PolyLine pts={[[selC.x, selC.y, selC.z], [calLid.x, calLid.y, calLid.z]]} color="#ff9f0a" width={3} dashed />}
      {showPts && stage === 5 && !step && regTest && regTest.clouds.map((c2, i) => <CloudLayer key={i} cloud={{ ...c2, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[i % 6]) }} size={2.5} budget={120000} pickable={false} />)}
      {showPts && stage === 5 && !step && !regTest && survey && survey.visible.scans.map((s2, i) => <CloudLayer key={`in${i}`} cloud={{ ...s2.cloud, instances: undefined }} mode="flat" colorOpts={{ flat: hexRgb(UNIT_COLOURS[(s2.mobile ? 0 : i) % 6]) }} size={2.5} budget={60000} pickable={false} />)}
      {showPts && stage === 5 && step?.preview && <CloudLayer cloud={step.preview} mode="height" size={2.5} budget={40000} pickable={false} />}
      {showPts && stage === 6 && practice?.twinPreview && <CloudLayer cloud={practice.twinPreview} mode="height" size={2.5} budget={40000} pickable={false} />}
      {showPts && stage === 6 && showMissing && practice?.tasks.twin.missing && practice.tasks.twin.missing.length > 0 && <CloudLayer cloud={cloudOf(practice.tasks.twin.missing)} mode="flat" colorOpts={{ flat: [255, 69, 58] }} size={3} budget={20000} pickable={false} />}
      {stage === 7 && taskTab === 'detect' && practice && refs.map((t, i) => { const found = matchRef?.get(i); return <BoxOutline key={t.id} bbox={t} color={found === undefined ? '#ff453a' : found ? '#30d158' : '#ff9f0a'} />; })}
      {stage === 7 && taskTab === 'detect' && practice && practice.objects.map((o, i) => practice.tasks.detect.match.spurious.includes(i) ? <BoxOutline key={`p${i}`} bbox={o} color="#8e8e93" dashed /> : null)}
      {stage === 7 && taskTab === 'change' && practice && <>{practice.truth.changes.map((c, i) => <Marker key={`t${i}`} p={[c.centre[0], c.centre[1], 2.5]} color="#30d158" r={0.25} label={`${c.kind}`} />)}{practice.found.changes.map((c, i) => <Marker key={`f${i}`} p={[c.centre[0], c.centre[1], 1.5]} color="#ff9f0a" r={0.18} />)}</>}
      {(stage === 7 && taskTab === 'safety' || stage === 2 && showZones) && SAFETY_ZONES.map((z) => <BoxOutline key={z.id} bbox={{ min: [z.min[0], z.min[1], z.zMin], max: [z.max[0], z.max[1], 0.8] }} color="#ff453a" dashed />)}
    </Viewport>
  );

  // ---- panels
  const SelectedUnitEditor = () => {
    if (selL) {
      const i = d.lidars.indexOf(selL), it = lidarItem(selL.item);
      return (
        <>
          <div className="caption"><b style={{ color: UNIT_COLOURS[i % 6] }}>LiDAR {i + 1}</b> · {it.name} · {rayCount(selL).toLocaleString()} rays per scan</div>
          <Slider label="Height" value={selL.z} min={0.3} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => patchLidar(selL.id, { z })} />
          <Slider label="Turn" value={Math.round(selL.yaw / D2R)} min={-180} max={180} step={5} unit="°" onChange={(v) => patchLidar(selL.id, { yaw: v * D2R })} />
          <Slider label="Tilt up (+) / down (−)" value={Math.round(-selL.pitch / D2R)} min={-90} max={90} step={5} unit="°" onChange={(v) => patchLidar(selL.id, { pitch: -v * D2R })} />
          {isMobile(selL) && <p className="hint">This unit rides the platform along the route below. Its position above is not used.</p>}
        </>
      );
    }
    if (selC) {
      const i = d.cameras.indexOf(selC), it = cameraItem(selC.item);
      return (
        <>
          <div className="caption"><b style={{ color: '#0a84ff' }}>Camera {i + 1}</b> · {it.name} · {it.w}×{it.h} px · {it.fov}° view{selC.cal.done ? ' · calibrated' : ' · not calibrated'}</div>
          <Slider label="Height" value={selC.z} min={0.5} max={5} step={0.1} unit=" m" format={(v) => v.toFixed(1)} onChange={(z) => patchCam(selC.id, { z })} />
          <Slider label="Turn" value={Math.round(selC.yaw / D2R)} min={-180} max={180} step={5} unit="°" onChange={(v) => patchCam(selC.id, { yaw: v * D2R })} />
          <Slider label="Tilt up (+) / down (−)" value={Math.round(-selC.pitch / D2R)} min={-90} max={90} step={5} unit="°" onChange={(v) => patchCam(selC.id, { pitch: -v * D2R })} />
          <Toggle label={`Low-light kit (+${LOWLIGHT_KIT.cost} credits)`} checked={selC.kit} onChange={(kit) => patchCam(selC.id, { kit })} />
          <p className="hint">Moving or re-aiming a camera undoes its calibration.</p>
          {camStats && <div className="caption" data-testid="twin-cam-stats">In view: {pct(camStats.coverage)} of the surface, {pct(camStats.sharp)} sharply · containers readable: {camStats.containers.filter((c2) => c2.px !== null && c2.px >= 8).length} of {camStats.containers.length} (label ≥ 8 px) · small objects in view {camStats.smalls} of {camStats.smallTotal}</div>}
        </>
      );
    }
    if (selLight) return <p className="hint">Lighting unit: adds light around it. Place it in or near the dark zone (top right).</p>;
    return <p className="hint">Pick a unit in the list to edit it.</p>;
  };

  const unitList = (
    <div className="btn-row" style={{ flexWrap: 'wrap' }}>
      {d.lidars.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} data-testid={`twin-unit-l${i + 1}`} style={{ borderColor: UNIT_COLOURS[i % 6], borderWidth: 2, borderStyle: 'solid' }}>LiDAR {i + 1}</button>)}
      {d.cameras.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} data-testid={`twin-unit-c${i + 1}`} style={{ borderColor: '#0a84ff', borderWidth: 2, borderStyle: 'solid' }}>Camera {i + 1}</button>)}
      {d.lights.map((u, i) => <button key={u.id} className="btn sm" aria-pressed={u.id === sel} onClick={() => T.set({ selectedUnit: u.id })} style={{ borderColor: '#ffcc00', borderWidth: 2, borderStyle: 'solid' }}>Lamp {i + 1}</button>)}
    </div>
  );

  const budgetBox = (
    <div data-testid="twin-budget" style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Budget</b><span className="mono">{cost.total} / {T.settings.budget} credits</span></div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--fill)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (100 * cost.total) / T.settings.budget)}%`, height: '100%', background: cost.total > T.settings.budget ? '#ff453a' : '#0a84ff' }} /></div>
      <div className="caption" data-testid="twin-remaining">Remaining: {cost.remaining} credits</div>
      {cost.errors.map((e) => <div key={e} className="caption" style={{ color: '#ff453a' }}>⚠ {e}</div>)}
      {cost.warnings.map((e) => <div key={e} className="caption" style={{ color: '#b36b00' }}>• {e}</div>)}
    </div>
  );

  const stageNav = (
    <div className="seg block" role="group" aria-label="Stages">
      {STAGES.map((s2, i) => <button key={s2} aria-pressed={i === stage} title={s2} onClick={() => T.set({ stage: i })} data-testid={`twin-stage-${i + 1}`} style={{ minWidth: 0, flex: '1 1 0', padding: '0.38rem 0' }}>{i + 1}</button>)}
    </div>
  );

  const fb = practice ? feedbackFor(practice) : null;
  const gradeRows = (g: { total: number; perTask: { key: TaskKey; points: number; weight: number; score: number; enabled: boolean }[] }) => (
    <table className="table" data-testid="twin-grade-table"><thead><tr><td>Task</td><td>Score</td><td>Points</td></tr></thead><tbody>
      {g.perTask.map((t) => <tr key={t.key} style={{ opacity: t.enabled ? 1 : 0.4 }}><td>{TASK_NAMES[t.key]}</td><td className="mono">{pct(t.score)}</td><td className="mono">{t.points.toFixed(1)} / {t.enabled ? t.weight : 0}</td></tr>)}
      <tr><td><b>Total</b></td><td /><td className="mono" data-testid="twin-total"><b>{g.total.toFixed(1)} / 100</b></td></tr>
    </tbody></table>
  );

  const panel = (() => {
    switch (stage) {
      case 0: return (
        <>
          <Callout kind="edu" title="Your mission">
            A factory wants a <b>digital twin</b> and a <b>monitoring system</b>. You have a budget of credits. Choose LiDARs and cameras, place and calibrate them, process the measurements, and complete six tasks: build the twin, find objects, read colour-coded labels, detect changes between two surveys, clean the data, and check safety zones. The grader compares your results with the hidden truth. <b>There is no single right answer and no time limit.</b>
          </Callout>
          <Section title="Team">
            <div className="field"><label htmlFor="twin-team">Team name</label><input id="twin-team" data-testid="twin-team" value={T.team} onChange={(e) => T.set({ team: e.target.value })} placeholder="e.g. Lidar Legends" /></div>
            <div className="field"><label htmlFor="twin-members">Members (optional, comma separated)</label><input id="twin-members" value={T.members.join(', ')} onChange={(e) => T.set({ members: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
            <p className="hint">Saved in this browser only. Nothing is sent anywhere.</p>
          </Section>
          <Section title="The six tasks and how they are graded" open={false}>
            <table className="table"><tbody>{TASK_KEYS.map((k) => <tr key={k}><td>{TASK_NAMES[k]}</td><td className="mono">{T.settings.enabled[k] ? T.settings.weights[k] : '–'}</td></tr>)}</tbody></table>
            <p className="hint" data-testid="twin-settings-note">Budget {T.settings.budget} credits · prices ×{T.settings.priceScale} · {T.settings.maxSubmissions > 0 ? `${T.settings.maxSubmissions} final evaluations` : 'as many evaluations as you like'}. These settings are the same for everyone.</p>
            <p className="hint">Scores come from what your system actually measured and found, compared with the hidden truth. The budget score is scaled by how well the system performed, so doing nothing cheaply earns nothing. The final evaluation uses different scenario variants than practice.</p>
          </Section>
          <Btn variant="primary" onClick={() => T.set({ stage: 1 })} testId="twin-start">Start: choose equipment</Btn>
        </>
      );
      case 1: return (
        <>
          {budgetBox}
          <Section title="LiDAR scanners">
            {LIDARS.map((it) => <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}><div><b style={{ fontSize: '0.875rem' }}>{it.name}</b><div className="caption">{it.blurb}</div></div><Btn sm icon={<Plus size={14} />} onClick={() => buyLidar(it.id)} disabled={d.lidars.length >= LIMITS.lidars || !affordable(lidarPlan(it.id).f)} title={affordable(lidarPlan(it.id).f) ? `Add to your equipment` : `Not enough credits (needs ${extra(lidarPlan(it.id).f)}, you have ${cost.remaining})`} testId={`twin-buy-${it.id}`}>{Math.round(it.cost * T.settings.priceScale)}</Btn></div>)}
            <p className="hint">The model decides the resolution: more channels, more points, higher price. The same model can be bought more than once: these are fixed units for monitoring, so each one stays where you put it.</p>
          </Section>
          <Section title="Cameras">
            {CAMERAS.map((it) => <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}><div><b style={{ fontSize: '0.875rem' }}>{it.name}</b><div className="caption">{it.blurb}</div></div><Btn sm icon={<Plus size={14} />} onClick={() => buyCamera(it.id)} disabled={d.cameras.length >= LIMITS.cameras || !affordable(cameraPlan(it.id))} title={affordable(cameraPlan(it.id)) ? 'Add to your equipment' : `Not enough credits (needs ${extra(cameraPlan(it.id))}, you have ${cost.remaining})`} testId={`twin-buy-${it.id}`}>{Math.round(it.cost * T.settings.priceScale)}</Btn></div>)}
          </Section>
          <Section title="Extras">
            <Btn sm icon={<Plus size={14} />} onClick={() => setDesign((q) => ({ ...q, lights: [...q.lights, { id: newId('lamp'), x: q.lights.length ? freshSpot()[0] : 8, y: q.lights.length ? freshSpot()[1] : 5, z: 3 }] }))} disabled={d.lights.length >= LIMITS.lights || !affordable((q) => ({ ...q, lights: [...q.lights, { id: 'x', x: 0, y: 0, z: 3 }] }))} testId="twin-buy-light">Lighting unit ({Math.round(LIGHT_UNIT.cost * T.settings.priceScale)})</Btn>
            <Toggle label={`Mobile scanning platform (${Math.round(MOBILE_PLATFORM.cost * T.settings.priceScale)})`} checked={d.platform} onChange={(v) => { if (!v && d.lidars.some(isMobile)) { lab.notify('Remove the mobile LiDAR first: it needs the platform.', 'warn'); return; } setDesign((q) => ({ ...q, platform: v })); }} hint="Needed for the mobile LiDAR (it is added for you)." />
            <p className="hint">Installing each device has a small cost too. Prices are fictional educational credits.</p>
          </Section>
          <Section title="Your bill" hint="Your choices are kept. Come back any time to remove something or add more: the other items keep their place and calibration.">
            {(() => {
              const k = T.settings.priceScale, c = (v: number) => Math.round(v * k);
              type Row = { label: string; amount: number; sub?: boolean; remove?: { id: string; test: string; what: string; onClick?: () => void } };
              const rows: Row[] = [];
              d.lidars.forEach((u, i) => {
                const it = lidarItem(u.item);
                rows.push({ label: `LiDAR ${i + 1}: ${it.name}${u.res !== 'standard' ? ` · ${u.res}` : ''}`, amount: c(it.cost * RES_TIERS[u.res].cost), remove: { id: u.id, test: `l${i + 1}`, what: `LiDAR ${i + 1}` } });
                rows.push({ label: 'Installation', amount: c(INSTALL.lidar), sub: true });
              });
              d.cameras.forEach((u, i) => {
                const it = cameraItem(u.item);
                rows.push({ label: `Camera ${i + 1}: ${it.name}`, amount: c(it.cost), remove: { id: u.id, test: `c${i + 1}`, what: `Camera ${i + 1}` } });
                if (u.kit) rows.push({ label: 'Low-light kit', amount: c(LOWLIGHT_KIT.cost), sub: true });
                rows.push({ label: 'Installation', amount: c(INSTALL.camera), sub: true });
              });
              d.lights.forEach((u, i) => { rows.push({ label: `Lighting unit ${i + 1}`, amount: c(LIGHT_UNIT.cost), remove: { id: u.id, test: `lamp${i + 1}`, what: `Lighting unit ${i + 1}` } }); rows.push({ label: 'Installation', amount: c(INSTALL.light), sub: true }); });
              if (d.platform) rows.push({ label: 'Mobile scanning platform', amount: c(MOBILE_PLATFORM.cost), remove: d.lidars.some(isMobile) ? undefined : { id: 'platform', test: 'platform', what: 'the platform', onClick: () => setDesign((q) => ({ ...q, platform: false })) } });
              return (
                <div className="bill" data-testid="twin-owned" role="table" aria-label="Your bill">
                  <div className="bill-head"><span>Item</span><span>Credits</span></div>
                  {rows.length === 0 && <div className="bill-empty">Nothing yet. Add equipment above.</div>}
                  {rows.map((r, i) => (
                    <div key={i} className={`bill-row ${r.sub ? 'sub' : ''}`} role="row">
                      <span className="bill-label">{r.label}</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{r.amount}</span>
                      <span className="bill-x-slot">{r.remove && <button className="bill-x" aria-label={`Remove ${r.remove.what}`} title={`Remove ${r.remove.what}`} onClick={r.remove.onClick ?? (() => remove(r.remove!.id))} data-testid={`twin-remove-${r.remove.test}`}>✕</button>}</span>
                    </div>
                  ))}
                  <div className="bill-total"><span>Total</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt" data-testid="twin-bill-total">{cost.total}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row sub"><span className="bill-label">Budget</span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt">{T.settings.budget}</span><span className="bill-x-slot" /></div>
                  <div className="bill-row"><span className="bill-label"><b>Remaining</b></span><span className="bill-dots" aria-hidden="true" /><span className="bill-amt"><b>{cost.remaining}</b></span><span className="bill-x-slot" /></div>
                </div>
              );
            })()}
          </Section>
        </>
      );
      case 2: return (
        <>
          {budgetBox}
          <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })} testId="twin-back-equipment">← Change equipment</Btn></div>
          <Section title="Place your equipment">
            {unitList}
            <Btn sm variant={placeMode ? 'primary' : ''} icon={<Crosshair size={15} />} onClick={() => { setPlaceMode((v) => !v); setRouteMode(false); }} disabled={!sel} testId="twin-place">{placeMode ? 'Click the scene or plan…' : 'Move selected by clicking'}</Btn>
            {SelectedUnitEditor()}
          </Section>
          {d.lidars.some(isMobile) && (
            <Section title="Mobile route">
              <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                <Btn sm variant={routeMode ? 'primary' : ''} onClick={() => { setRouteMode((v) => !v); setPlaceMode(false); }} testId="twin-route-tool">{routeMode ? 'Click to add route points…' : 'Edit route'}</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [] }))} disabled={!d.route.length}>Clear</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [[-9, -0.3], [9, -0.3]] }))}>Straight</Btn>
                <Btn sm onClick={() => setDesign((q) => ({ ...q, route: [[-9, -0.3], [9, -0.3], [9, -5], [-9, -5]] }))}>Loop</Btn>
              </div>
              <Slider label="Scans along the route" value={d.routeSteps} min={4} max={16} step={1} onChange={(v) => setDesign((q) => ({ ...q, routeSteps: v }))} hint="More scans overlap more but take longer. The platform only knows its position by dead reckoning, so it drifts." />
              <Toggle label="Motion distortion (the platform moves during a sweep)" checked={d.distortion} onChange={(v) => setDesign((q) => ({ ...q, distortion: v }))} />
            </Section>
          )}
          <p className="hint">The plan (top left of the view) shows where everything stands: click it to move the selected unit, or to add route points. Coverage and equipment numbers are in the Live statistics card below the view.</p>
          {cov && <p className="hint" data-testid="twin-coverage-note">Coverage is geometry, not points: the share of the surface with a clear straight line from at least one scanner, inside its range and field of view. Red dots are not seen by any LiDAR. A coarse sensor can see a surface and still measure it poorly.</p>}
          <Toggle label="Show the safety zones" checked={showZones} onChange={setShowZones} />
        </>
      );
      case 3: return (
        <>
          <div className="btn-row"><Btn sm onClick={() => T.set({ stage: 1 })}>← Change equipment</Btn></div>
          <Callout kind="edu" title="How calibration works: 4 steps">
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 3 }}>
              <li><b>Connect a camera to a LiDAR:</b> drag a wire from the dot of a camera to a LiDAR (or pick a camera and click a LiDAR). Each camera has one LiDAR, and several cameras can share the same one. The pair is your choice (the nearest by default; the orange dashed line in the view joins them). Camera 1 can go with LiDAR 2 if those two are close together.</li>
              <li><b>Match the red crosses to the green squares</b> on the calibration board (or press the automatic button).</li>
              <li><b>Watch the view:</b> that LiDAR's points are coloured by this camera. When it is right, colours (the red, green and yellow labels) land on the right objects.</li>
            </ol>
            <div className="hint" style={{ marginTop: 6 }}>Only cameras are calibrated. After registration all LiDARs share one frame, so a camera is calibrated once for the whole system; the LiDAR you choose is only the one you watch.</div>
          </Callout>
          {d.cameras.length === 0 ? <p className="hint">You have no cameras. They are optional, but colour-coded labels cannot be read without one.</p> : (
            <>
              <PairBoard cams={d.cameras.map((u) => ({ id: u.id, label: `Camera ${d.cameras.indexOf(u) + 1}`, sub: cameraItem(u.item).name, done: u.cal.done, to: pairedLidar(u)?.id ?? null }))} lids={d.lidars.map((u, i) => ({ id: u.id, label: `LiDAR ${i + 1}`, sub: lidarItem(u.item).name, nearestOf: d.cameras.filter((c) => nearestLidar(c)?.id === u.id).map((c) => c.id) }))} selected={sel} onSelect={(id) => T.set({ selectedUnit: id })} onPair={(cid, lid) => setCalPair((q) => ({ ...q, [cid]: lid }))} />
              {selC && d.lidars.length > 0 && (
                <>

                  {calLid && <FovOverlapChart cam={selC} lid={calLid} camNo={d.cameras.indexOf(selC) + 1} lidNo={d.lidars.indexOf(calLid) + 1} dist={fovDist} onDist={setFovDist} />}
                  <div className="caption" data-testid="twin-cal-colour">{calBusy ? 'Preparing the LiDAR scan and the colours…' : calCloud ? `${connected.length > 1 ? `Cameras ${connected.map((c) => d.cameras.indexOf(c) + 1).join(' + ')} together colour` : `Camera ${d.cameras.indexOf(selC) + 1} colours`} ${calCloud.coloured.toLocaleString()} of ${calCloud.total.toLocaleString()} points of LiDAR ${calLid ? d.lidars.indexOf(calLid) + 1 : ''} (${calCloud.total ? Math.round((100 * calCloud.coloured) / calCloud.total) : 0} %). Grey points are not in ${connected.length > 1 ? 'any of their' : "this camera's"} view.` : ''}</div>
                </>
              )}
              {selC ? <CalPanel key={selC.id + JSON.stringify([selC.x, selC.y, selC.z, selC.yaw, selC.pitch, selC.kit])} unit={selC} index={d.cameras.indexOf(selC)} lights={d.lights} onChange={(c) => setDesign((q) => ({ ...q, cameras: q.cameras.map((x) => (x.id === c.id ? c : x)) }))} /> : <p className="hint">Pick a camera above. A ✓ means it is calibrated.</p>}
            </>
          )}
        </>
      );
      case 4: return (
        <>
          {budgetBox}
          <Callout kind="edu" title="Acquire a survey">Every LiDAR measures with range noise, lost returns and a few floating points. Fixed scanners are recorded where you put them, with a small installation error. A mobile scanner only knows its route by dead reckoning, so its scans drift apart. Registration (a block in your pipeline) joins the scans into one frame.</Callout>
          <Btn variant="primary" icon={<Play size={16} />} onClick={acquire} busy={T.busy === 'Acquiring the survey…'} disabled={!cost.ok} testId="twin-acquire">Acquire the practice survey</Btn>
          {survey && (
            <table className="table" data-testid="twin-survey"><thead><tr><td>Scan</td><td>Points</td><td>Coloured by a camera</td></tr></thead><tbody>
              {survey.visible.scans.map((s2, i) => <tr key={s2.index}><td>{s2.name}</td><td className="mono">{s2.cloud.count.toLocaleString()}</td><td className="mono">{surveyView?.[i]?.cam ? `${surveyView[i].coloured.toLocaleString()} (${Math.round((100 * surveyView[i].coloured) / Math.max(1, s2.cloud.count))} %)` : d.cameras.length ? '…' : 'no camera'}</td></tr>)}
              <tr><td><b>All</b></td><td className="mono"><b>{survey.visible.stats.points.toLocaleString()}</b></td><td className="mono"><b>{surveyView ? surveyView.reduce((a, v) => a + v.coloured, 0).toLocaleString() : ''}</b></td></tr>
            </tbody></table>
          )}
          {survey && <Toggle label="As delivered: each scan in its own coordinate system" checked={ownFrames} onChange={setOwnFrames} hint="A scanner knows nothing about the building: every scan is centred on its own scanner, so they pile up around one point. Turn this off to place them where you put the scanners (roughly). Registration, in the pipeline, joins them properly." />}
          {survey && d.cameras.length > 0 && <Toggle label="Colour the points that a camera sees" checked={camColour} onChange={setCamColour} hint="Only those points take the camera's colours (with your calibration). The rest stay in their scanner's colour. A camera that is badly calibrated puts the colours in the wrong places." />}
          <p className="hint">Practice survey = Time A. A second survey (Time B, after changes) is taken automatically when your pipeline compares surveys.</p>
        </>
      );
      case 5: {
        const names = (ks: BlockKind[]) => ks.map((k) => BLOCKS[k].name.replace(/ \(.*\)$/, ''));
        const has = (kinds: BlockKind[]) => T.pipeline.some((x) => kinds.includes(x.kind) && !x.bypass);
        const checklist: { ok: boolean; text: string }[] = [
          { ok: has(['icp', 'mobileicp', 'merge']), text: 'The scans are joined (registration)' },
          { ok: has(['euclid', 'dbscan']), text: 'Points are grouped into objects' },
          { ok: has(['classify']), text: 'Objects are named' },
          { ok: has(['diff', 'objmatch']), text: 'Changes are compared (optional)' },
          { ok: has(['safety']), text: 'Safety zones are checked (optional)' },
        ];
        const setParam = (id: string, k: string, v: number) => T.set({ pipeline: T.pipeline.map((x) => (x.id === id ? { ...x, params: { ...x.params, [k]: v } } : x)), practice: null });
        const blockCard = (b: (typeof T.pipeline)[number]) => {
          const i = T.pipeline.indexOf(b), info = BLOCKS[b.kind], err = chk.perBlock[i], st = practice?.steps.find((x) => x.id === b.id), isReg = phaseIndex(b.kind) === 0, open = openBlock === b.id;
          const phase = phaseIndex(b.kind), samePhase = T.pipeline.filter((x) => phaseIndex(x.kind) === phase), pos = samePhase.indexOf(b);
          const swap = (d2: number) => { const o = samePhase[pos + d2]; if (!o) return; const p = [...T.pipeline], a2 = p.indexOf(b), b2 = p.indexOf(o); [p[a2], p[b2]] = [p[b2], p[a2]]; T.set({ pipeline: p, practice: null }); };
          const reg = isReg ? (regTest?.id === b.id ? regTest.report : st?.reg) : undefined;
          return (
            <div key={b.id} data-testid={`twin-block-${i + 1}`} style={{ border: `1px solid ${err ? '#ff453a' : 'var(--sep)'}`, borderRadius: 12, padding: 8, display: 'grid', gap: 4, opacity: b.bypass ? 0.55 : 1, background: 'var(--bg-elev, #fff)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: '0.875rem' }} title={`From the ${BLOCK_TAB[b.kind]} tab`}>{info.name}</b></div>
                <button className="btn sm" aria-label="Move up" disabled={pos === 0} onClick={() => swap(-1)} title="Earlier in this phase">↑</button>
                <button className="btn sm" aria-label="Move down" disabled={pos === samePhase.length - 1} onClick={() => swap(1)} title="Later in this phase">↓</button>
                <button className="btn sm" aria-pressed={!!b.bypass} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, bypass: !x.bypass } : x)), practice: null })} data-testid={`twin-bypass-${i + 1}`} title="Keep it in the list but skip it">{b.bypass ? 'Off' : 'On'}</button>
                <button className="bill-x" aria-label={`Remove ${info.name}`} title="Remove this block" onClick={() => T.set({ pipeline: T.pipeline.filter((x) => x.id !== b.id), practice: null })} data-testid={`twin-remove-${i + 1}`}>✕</button>
              </div>
              <div className="caption">{info.help}</div>
              {(() => { const cur = st && !st.bypassed && !st.error ? { before: st.before, after: st.after, stale: false } : lastRun[b.id] && !b.bypass ? { ...lastRun[b.id], stale: lastRun[b.id].sig !== blockSig(b) } : null; if (!cur || cur.before === cur.after) return null; const drop = cur.after < cur.before, share = cur.after / Math.max(1, cur.before), pc = Math.round(Math.abs(cur.after - cur.before) / Math.max(1, cur.before) * 100); return (
                <div className={`pointchange ${drop ? 'down' : 'up'} ${cur.stale ? 'stale' : ''}`} data-testid={`twin-points-${i + 1}`} title={`${cur.before.toLocaleString()} points before this block, ${cur.after.toLocaleString()} after`}>
                  <span className="pc-line"><span className="pc-badge">{drop ? '▼' : '▲'} {drop ? '−' : '+'}{pc} %</span><span className="pc-nums">{cur.before.toLocaleString()} → {cur.after.toLocaleString()} points{cur.stale ? ' · test again' : ''}</span></span>
                  <span className="pc-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} /></span>
                </div>); })()}
              {(() => {
                const pk = st && !st.bypassed ? st.pick : lastPick[b.id]; if (!pk || b.bypass || !pk.items.length) return null;
                const off = b.off ?? [], setOff = (n: string[]) => { T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, off: n } : x)), practice: null }); setRerunAt(Date.now()); };
                return (
                  <div className="picklist" data-testid={`twin-pick-${i + 1}`}>
                    <div className="picklist-head"><b>{pk.mode === 'remove' ? `${pk.items.length} planes found` : `${pk.items.length + pk.hidden} clusters found`}</b><span>tick the ones to {pk.mode === 'remove' ? 'remove' : 'keep'}</span>
                      <button type="button" className="picklist-all" onClick={() => setOff([])}>All</button><button type="button" className="picklist-all" onClick={() => setOff(pk.items.map((x) => x.key))} data-testid={`twin-pick-none-${i + 1}`}>None</button></div>
                    <ul>{pk.items.map((it, k) => <li key={it.key}><label><input type="checkbox" checked={!off.includes(it.key)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== it.key) : [...off, it.key])} data-testid={`twin-pick-${i + 1}-${k + 1}`} /><span className="pk-name">{it.label}</span><small>{it.pts.toLocaleString()} pts</small></label></li>)}</ul>
                    {pk.hidden > 0 && <div className="caption">{pk.hidden} smaller clusters are not listed.</div>}
                  </div>
                );
              })()}
              {canRunParallel(b.kind) && (
                <div className="seg" role="group" aria-label="How this block runs" style={{ justifySelf: 'start' }}>
                  <button aria-pressed={!b.parallel} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, parallel: false } : x)), practice: null })} data-testid={`twin-seq-${i + 1}`} title="Runs after the block before it">In sequence</button>
                  <button aria-pressed={!!b.parallel} onClick={() => T.set({ pipeline: T.pipeline.map((x) => (x.id === b.id ? { ...x, parallel: true } : x)), practice: null })} data-testid={`twin-par-${i + 1}`} title="Runs at the same time as the parallel blocks next to it; their results are joined">In parallel</button>
                </div>
              )}
              {err && <div className="caption" style={{ color: '#ff453a' }} data-testid={`twin-block-error-${i + 1}`}>⚠ {err}</div>}
              {st && !st.bypassed && st.note && <div className="caption" style={{ color: '#30a14e' }}>Last run: {st.before === st.after ? `${st.after.toLocaleString()} points (unchanged) · ` : ''}{st.note}</div>}
              {info.params.length > 0 && <button className="btn sm" onClick={() => setOpenBlock(open ? null : b.id)} aria-expanded={open} data-testid={`twin-settings-${i + 1}`} style={{ justifySelf: 'start' }}>{open ? '▾ Hide settings' : '▸ Settings'}</button>}
              {open && info.params.map((p) => p.options
                ? <Select<string> key={p.key} label={p.label} value={String(b.params[p.key] ?? p.def)} options={p.options.map((o) => ({ value: String(o.value), label: o.label }))} onChange={(v) => setParam(b.id, p.key, Number(v))} hint={p.hint} />
                : <Slider key={p.key} label={p.label} value={b.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} unit={p.unit} format={(v) => (p.step < 1 ? v.toFixed(p.step < 0.05 ? 2 : 1) : String(v))} onChange={(v) => setParam(b.id, p.key, v)} hint={p.hint} />)}
              {isReg && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <Btn sm variant="primary" onClick={() => testRegistration(b)} busy={regBusy} disabled={b.bypass || !!err} testId={`twin-test-reg-${i + 1}`}>Test this registration</Btn>
                  {reg && Number.isFinite(reg.rmse) && (
                    <div data-testid="twin-reg-result" style={{ display: 'grid', gap: 3 }}>
                      <div style={{ fontWeight: 650 }}>RMSE <span className="mono">{(reg.rmse * 100).toFixed(1)} cm</span> · overlap <span className="mono">{Math.round(reg.overlap * 100)} %</span> · <span style={{ color: reg.rmse < 0.03 && reg.overlap > 0.3 ? '#30a14e' : reg.rmse < 0.06 ? '#b36b00' : '#ff453a' }}>{reg.rmse < 0.03 && reg.overlap > 0.3 ? 'Excellent' : reg.rmse < 0.06 ? 'Fair: keep tuning' : 'Poor: scans do not fit'}</span></div>
                      <table className="table"><thead><tr><td>Scan</td><td>RMSE before → after</td><td>Overlap</td></tr></thead><tbody>{reg.scans.map((s2) => <tr key={s2.name}><td>{s2.name}{!s2.accepted && reg.mode !== 'merge' ? ' ⚠' : ''}</td><td className="mono">{(s2.rmseBefore * 100).toFixed(1)} → {(s2.rmseAfter * 100).toFixed(1)} cm</td><td className="mono">{Math.round(s2.overlapAfter * 100)} %</td></tr>)}</tbody></table>
                      <div className="caption">RMSE = how far apart matching points of two scans still are. Lower is better. Judged the same way whatever match distance you choose. These settings are used in your evaluation.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        };
        const groups = parallelGroups(T.pipeline);
        /** one phase: its blocks one after the other (↓), with runs of parallel blocks side by side between a fork and a join */
        const laneBody = (ph: (typeof PHASES)[number], pi: number) => {
          const inPhase = T.pipeline.filter((x) => phaseIndex(x.kind) === pi), items: ReactNode[] = [];
          for (let k = 0; k < inPhase.length;) {
            const g = groups[T.pipeline.indexOf(inPhase[k])];
            if (g >= 0) {
              let j = k; while (j < inPhase.length && groups[T.pipeline.indexOf(inPhase[j])] === g) j++;
              items.push(<div key={`g${k}`} className="pipe-par" data-testid="twin-parallel-group"><div className="pipe-par-label">⑂ at the same time · results joined</div><div className="pipe-par-row" style={{ gridTemplateColumns: `repeat(${j - k}, minmax(0, 1fr))` }}>{inPhase.slice(k, j).map(blockCard)}</div><div className="pipe-par-label">⑃ joined: {ph.id === 'compare' ? 'findings combined' : 'points kept by every block'}</div></div>);
              k = j;
            } else { items.push(blockCard(inPhase[k])); k++; }
            if (k < inPhase.length) items.push(<div key={`a${k}`} className="pipe-arrow" aria-hidden="true">↓</div>);
          }
          return (
            <>
              {items}
              <select aria-label={`Add to phase ${pi + 1}`} value="" onChange={(e) => { if (e.target.value) T.set({ pipeline: insertBlock(T.pipeline, newBlock(e.target.value as BlockKind)), practice: null }); }} data-testid={`twin-add-phase-${pi + 1}`}>
                <option value="">+ Add a block…</option>
                {[...new Set(ph.kinds.map((k) => BLOCK_TAB[k]))].map((tab) => <optgroup key={tab} label={`From ${tab}`}>{ph.kinds.filter((k) => BLOCK_TAB[k] === tab).map((k) => <option key={k} value={k}>{BLOCKS[k].name}</option>)}</optgroup>)}
              </select>
            </>
          );
        };
        const lanesView = (wide: boolean) => (
          <div className={wide ? 'pipe-cols' : 'pipe-stack'} data-testid={wide ? 'twin-lanes-wide' : 'twin-lanes'}>
            {PHASES.map((ph, pi) => (
              <Fragment key={ph.id}>
                <div className={`pipe-lane ${T.pipeline.some((x) => phaseIndex(x.kind) === pi) ? 'has' : ''}`} data-testid={`twin-phase-${pi + 1}`}>
                  <div className="pipe-lane-head"><b>{ph.title}</b>{ph.required && <span className="pipe-req">required</span>}<div className="caption">{ph.why}</div></div>
                  {laneBody(ph, pi)}
                </div>
                {pi < PHASES.length - 1 && <div className="pipe-link" aria-hidden="true"><span>{wide ? '→' : '↓'}</span></div>}
              </Fragment>
            ))}
          </div>
        );
        const expandedView = pipeExpanded && createPortal(
          <div className="pipe-overlay" role="dialog" aria-label="Pipeline builder (expanded)" data-testid="twin-pipe-overlay">
            <div className="pipe-overlay-head">
              <div style={{ flex: 1, minWidth: 260 }}><b style={{ fontSize: '1.15rem' }}>Your pipeline</b>
                <div className="caption">Each phase feeds the next (→). Inside a phase, blocks run one after another (↓), or side by side when you set them to parallel.</div></div>
              <Btn sm variant="primary" icon={<Play size={14} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-wide">Run practice</Btn>
              <Btn sm onClick={() => setPipeExpanded(false)} testId="twin-collapse-builder">Collapse ⤡</Btn>
            </div>
            <div data-testid="twin-checklist-wide" className="pipe-chips">{checklist.map((c) => <span key={c.text} className={`pipe-chip ${c.ok ? 'ok' : ''}`}>{c.ok ? '✓' : '○'} {c.text}</span>)}</div>
            {lanesView(true)}
          </div>, document.body);
        return (
          <>
            {expandedView}
            <Callout kind="edu" title="Build your pipeline: 5 phases, top to bottom">You build it yourself, block by block. Work down the phases. Each block does one job; the phases keep the blocks in a sensible order for you. Registration is first because every scan arrives in <b>its own scanner's coordinate system</b>. When the checklist is ready, press <b>Run practice</b>.</Callout>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn variant="primary" icon={<Play size={16} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run">Run practice</Btn>
              <Btn sm onClick={() => setPipeExpanded(true)} testId="twin-expand-builder" title="Open the builder full size">Expand ⤢</Btn>
              <Btn sm onClick={() => T.set({ pipeline: [], practice: null })}>Clear</Btn>
            </div>
            <div data-testid="twin-checklist" style={{ display: 'grid', gap: 2 }}>{checklist.map((c) => <div key={c.text} className="caption" style={{ color: c.ok ? '#30a14e' : undefined }}>{c.ok ? '✓' : '○'} {c.text}</div>)}</div>
            {chk.global.map((g) => <div key={g} className="caption" style={{ color: '#ff453a' }}>⚠ {g}</div>)}
            {!chk.ok && !chk.global.length && <p className="hint">Fix the ⚠ messages in the blocks below to run.</p>}
            {pipeExpanded ? <p className="hint" data-testid="twin-expanded-note">The builder is open full size. Press Collapse to bring it back here.</p> : lanesView(false)}
            {practice && (
              <Section title="What each block did">
                <table className="table" data-testid="twin-steps"><thead><tr><td>Block</td><td>Points</td></tr></thead><tbody>
                  {practice.steps.map((s2, i) => <tr key={i} style={{ cursor: s2.preview ? 'pointer' : 'default', background: T.selectedStep === i ? 'rgba(10,132,255,.12)' : undefined }} onClick={() => s2.preview && T.set({ selectedStep: i })}><td>{BLOCKS[s2.kind].name.replace(/ \(.*\)$/, '')}{s2.error ? ' ⚠' : ''}</td><td className="mono">{s2.bypassed ? 'off' : `${s2.before.toLocaleString()} → ${s2.after.toLocaleString()}`}</td></tr>)}
                </tbody></table>
                <p className="hint">Click a row to see the points after that block, in the 3D view.</p>
              </Section>
            )}
            <Section title="Saved pipelines" open={false}>
              <div className="btn-row"><input aria-label="Pipeline name" value={pname} onChange={(e) => setPname(e.target.value)} style={{ flex: 1 }} /><Btn sm onClick={() => T.set({ saved: [...T.saved.filter((x) => x.name !== pname), { name: pname, blocks: T.pipeline }] })} testId="twin-save-pipe">Save</Btn></div>
              {T.saved.map((sv) => <div key={sv.name} className="btn-row"><Btn sm onClick={() => T.set({ pipeline: sv.blocks, practice: null })}>{sv.name}</Btn><Btn sm onClick={() => T.set({ saved: T.saved.filter((x) => x.name !== sv.name) })}>✕</Btn></div>)}
            </Section>
          </>
        );
      }
      case 6: return !practice ? <><p className="hint">Run the practice pipeline first (stage 6).</p><Btn onClick={() => T.set({ stage: 5 })}>Go to the pipeline</Btn></> : (
        <>
          <Callout kind="edu" title="Your digital twin">The cloud before any wall or object removal, compared with the true surfaces below 3 m. <b style={{ color: '#ff453a' }}>Red dots</b> are true surfaces your cloud does not cover.</Callout>
          <div className="stats-grid" data-testid="twin-twin">
            <div className="stat"><div className="k">Covered</div><div className="v">{pct(practice.tasks.twin.coverage)}</div></div>
            <div className="stat"><div className="k">Median error</div><div className="v">{num(practice.tasks.twin.medianErr * 100)} cm</div></div>
            <div className="stat"><div className="k">Scans agree to</div><div className="v">{num(practice.tasks.twin.poseErrCm)} cm</div></div>
            <div className="stat"><div className="k">Points</div><div className="v">{practice.tasks.twin.points.toLocaleString()}</div></div>
          </div>
          <Toggle label="Show the missing surfaces" checked={showMissing} onChange={setShowMissing} />
          {fb?.twin.map((x, i) => <p key={i} className="hint">{x}</p>)}
        </>
      );
      case 7: return !practice ? <><p className="hint">Run the practice pipeline first.</p><Btn onClick={() => T.set({ stage: 5 })}>Go to the pipeline</Btn></> : (
        <>
          <Seg value={taskTab} onChange={setTaskTab} label="Task" options={[{ value: 'detect', label: 'Objects' }, { value: 'colour', label: 'Colour' }, { value: 'change', label: 'Change' }, { value: 'quality', label: 'Noise' }, { value: 'safety', label: 'Safety' }]} />
          {taskTab === 'detect' && (
            <>
              <div className="stats-grid" data-testid="twin-detect"><div className="stat"><div className="k">Found</div><div className="v">{practice.tasks.detect.tp}/{practice.tasks.detect.refs}</div></div><div className="stat"><div className="k">Precision</div><div className="v">{pct(practice.tasks.detect.precision)}</div></div><div className="stat"><div className="k">Recall</div><div className="v">{pct(practice.tasks.detect.recall)}</div></div><div className="stat"><div className="k">Small found</div><div className="v">{pct(practice.tasks.detect.smallRecall)}</div></div></div>
              <table className="table"><thead><tr><td>Class</td><td>Right / real</td></tr></thead><tbody>{TWIN_CLASSES.filter((c) => practice.tasks.detect.byClass[c].ref > 0).map((c) => <tr key={c}><td>{c}</td><td className="mono">{practice.tasks.detect.byClass[c].found} / {practice.tasks.detect.byClass[c].ref}</td></tr>)}</tbody></table>
              <p className="hint">3D: green = found with the right class, amber = found but misnamed, red = missed, grey dashed = reported but not real.</p>
            </>
          )}
          {taskTab === 'colour' && (
            <>
              <div className="stats-grid" data-testid="twin-colour"><div className="stat"><div className="k">Correct</div><div className="v">{practice.tasks.colour.correct}/{practice.tasks.colour.total}</div></div><div className="stat"><div className="k">No reading</div><div className="v">{practice.tasks.colour.unknown}</div></div><div className="stat"><div className="k">Macro F1</div><div className="v">{pct(practice.tasks.colour.macroF1)}</div></div></div>
              <table className="table"><thead><tr><td>Container</td><td>True</td><td>Read</td></tr></thead><tbody>{practice.tasks.colour.rows.map((r) => <tr key={r.id}><td>{r.id.replace('container-', '')}</td><td>{r.truth}</td><td style={{ color: r.got === r.truth ? '#30d158' : '#ff453a' }}>{r.got}</td></tr>)}</tbody></table>
            </>
          )}
          {taskTab === 'change' && (
            <>
              <div className="stats-grid" data-testid="twin-change"><div className="stat"><div className="k">Reported</div><div className="v">{practice.tasks.change.found}</div></div><div className="stat"><div className="k">Real</div><div className="v">{practice.tasks.change.truth}</div></div><div className="stat"><div className="k">Right kind & place</div><div className="v">{practice.tasks.change.kindOk}</div></div></div>
              <table className="table"><thead><tr><td>Real change</td><td>Your answer</td></tr></thead><tbody>{practice.tasks.change.rows.map((r, i) => <tr key={i}><td>{r.truth}</td><td style={{ color: r.got === 'missed' ? '#ff453a' : undefined }}>{r.got}</td></tr>)}</tbody></table>
              <p className="hint">3D: green markers are the real changes, orange the ones you found.</p>
            </>
          )}
          {taskTab === 'quality' && <div className="stats-grid" data-testid="twin-quality"><div className="stat"><div className="k">Floating points removed</div><div className="v">{pct(practice.tasks.quality.outlierRemoval)}</div></div><div className="stat"><div className="k">Real points kept</div><div className="v">{pct(practice.tasks.quality.retention)}</div></div><div className="stat"><div className="k">Small-object points kept</div><div className="v">{pct(practice.tasks.quality.smallRetention)}</div></div></div>}
          {taskTab === 'safety' && (
            <>
              <Callout kind="warn" title="Educational only">This is a teaching simulation, not a certified safety system.</Callout>
              <table className="table" data-testid="twin-safety"><thead><tr><td>Zone</td><td>Truth</td><td>Yours</td></tr></thead><tbody>{practice.tasks.safety.rows.map((r) => <tr key={r.zone}><td>{r.zone}</td><td>{r.truth}</td><td style={{ color: r.got.startsWith('violated') === r.truth.startsWith('violated') ? '#30d158' : '#ff453a' }}>{r.got}</td></tr>)}</tbody></table>
            </>
          )}
          {fb && <div className="hint">{fb[taskTab === 'detect' ? 'detect' : taskTab].map((x, i) => <div key={i}>• {x}</div>)}</div>}
        </>
      );
      default: return (
        <>
          {budgetBox}
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <Btn variant="primary" icon={<Play size={16} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-2">Run practice</Btn>
            <Btn variant="good" onClick={submitFinal} busy={!!T.busy} disabled={!cost.ok || !chk.ok || (T.settings.maxSubmissions > 0 && finalsUsed >= T.settings.maxSubmissions)} testId="twin-final">Final evaluation{T.settings.maxSubmissions > 0 ? ` (${Math.max(0, T.settings.maxSubmissions - finalsUsed)} left)` : ''}</Btn>
          </div>
          <p className="hint">Grade as often as you like. Practice shows every detail. The final evaluation runs your current system, unchanged, on 2 other scenario variants and averages the scores. When you are happy, send the result below.</p>
          {T.busy && <p className="hint" data-testid="twin-busy">{T.busy}</p>}
          {T.final && <Section title="Final evaluation"><div data-testid="twin-final-result">{gradeRows(T.final.grade)}</div><p className="hint">Averaged over scenario variants {T.final.runs.map((r) => r.seed).join(' and ')}.</p></Section>}
          {practice && (
            <>
              <Section title="Practice grade">{gradeRows(practice.grade)}</Section>
              {fb && TASK_KEYS.map((k) => <Section key={k} title={TASK_NAMES[k]} open={false}>{fb[k].map((x, i) => <p key={i} className="hint">{x}</p>)}</Section>)}
            </>
          )}
          <Section title="Attempts">
            <table className="table" data-testid="twin-attempts"><thead><tr><td>When</td><td>Kind</td><td>Score</td><td>Cost</td></tr></thead><tbody>{[...T.attempts].reverse().slice(0, 12).map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleTimeString()}</td><td>{a.kind}</td><td className="mono">{a.total.toFixed(1)}</td><td className="mono">{a.cost}</td></tr>)}</tbody></table>
          </Section>
          <Section title="Send my score">
            <p className="hint">Grade as many times as you like. When you are happy, send the result with your name and index number. What is sent: your name, index number, the score, the time, the network address (IP) of this computer and the approximate place it connects from, and a short summary of the equipment and blocks you used. No point clouds are sent.</p>
            {!workshopConfigured() ? <p className="hint" data-testid="twin-send-off">Sending is not set up in this copy of the lab. Use “Results report” below to save your result.</p> : (
              <>
                <div className="field"><label htmlFor="twin-sname">Name</label><input id="twin-sname" data-testid="twin-sname" value={T.student.name} maxLength={60} autoComplete="name" onChange={(e) => T.set({ student: { ...T.student, name: e.target.value } })} /></div>
                <div className="field"><label htmlFor="twin-sindex">Index number</label><input id="twin-sindex" data-testid="twin-sindex" value={T.student.index} maxLength={24} onChange={(e) => T.set({ student: { ...T.student, index: e.target.value } })} placeholder="e.g. z1234567" /></div>
                <Seg value={kindToSend} onChange={setSendKind} label="Which result" options={[{ value: 'final', label: 'Final evaluation', disabled: !canSendFinal }, { value: 'practice', label: 'Latest practice', disabled: !canSendPractice }]} />
                <p className="hint" data-testid="twin-accepting" style={{ color: accept.known ? (accept.accepting ? '#30a14e' : '#b36b00') : undefined }}>{!accept.known ? 'Checking whether scores are being accepted…' : accept.accepting ? `Scores are being accepted${accept.until ? ' until ' + new Date(accept.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}.` : 'Scores are not being accepted right now. You can keep grading and see every result. Sending opens when collection is started.'}</p>
                <Toggle label="I agree to send my name, index number and this score. The network address of this computer is recorded with it." checked={consent} onChange={setConsent} />
                <Btn variant="primary" onClick={sendScore} busy={sending} disabled={(!canSendFinal && !canSendPractice) || (accept.known && !accept.accepting)} testId="twin-send">Send my score</Btn>
                {sendMsg && <p className="hint" data-testid="twin-send-msg" style={{ color: sendMsg.ok ? '#30a14e' : '#ff453a' }}>{sendMsg.text}</p>}
                {T.sent.length > 0 && <p className="hint" data-testid="twin-sent">Sent {T.sent.length} time{T.sent.length > 1 ? 's' : ''}; the last was {T.sent[T.sent.length - 1].kind} {T.sent[T.sent.length - 1].total.toFixed(1)} at {new Date(T.sent[T.sent.length - 1].at).toLocaleTimeString()}.</p>}
              </>
            )}
          </Section>
          <Section title="Save, share and report">
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <Btn sm icon={<Download size={14} />} onClick={exportConfig} testId="twin-export">Export configuration</Btn>
              <Btn sm icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Import</Btn>
              <Btn sm icon={<Download size={14} />} onClick={exportReport} disabled={!practice} testId="twin-report">Results report</Btn>
              <Btn sm onClick={() => { if (confirm('Clear the whole workspace (equipment, pipeline, attempts)?')) T.reset(); }}>Start over</Btn>
            </div>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => importConfig(e.target.files?.[0])} data-testid="twin-import" />
          </Section>
          <Section title="Next" open={false}><Btn sm onClick={() => { const i = tabIndex('TLS Scanning'); if (i >= 0) lab.setTab(i); }}>Review TLS scanning</Btn></Section>
          <p className="hint">Educational simulation: sensor, camera, light and SLAM models are simplified. The safety check is not a certified system.</p>
        </>
      );
    }
  })();

  const controls = (
    <>
      {stageNav}
      <div style={{ fontWeight: 650, margin: '4px 0' }} data-testid="twin-stage-title">Stage {stage + 1} of 9 · {STAGES[stage]}</div>
      <div key={stage} style={{ display: 'grid', gap: 12 }}>{panel}</div>
    </>
  );
  const basePlan = { markers: [...d.lidars.map((u, i) => ({ x: u.x, y: u.y, color: UNIT_COLOURS[i % 6], label: `L${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.cameras.map((u, i) => ({ x: u.x, y: u.y, color: '#0a84ff', label: `C${i + 1}`, yaw: u.yaw, r: u.id === sel ? 8 : 5 })), ...d.lights.map((u, i) => ({ x: u.x, y: u.y, color: '#ffcc00', label: `Lamp ${i + 1}`, r: 5 })), ...(d.lidars.some(isMobile) ? d.route.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: `${i + 1}`, r: 4 })) : [])], paths: d.lidars.some(isMobile) && d.route.length > 1 ? [{ pts: d.route, color: '#ff9f0a', dashed: true }] : [] };
  /** later stages keep the plan and add what that stage is about: where the real objects were found or missed, and where changes happened */
  const taskMarks = stage === 7 && practice ? (taskTab === 'detect'
    ? refs.map((r, i) => ({ x: r.centre[0], y: r.centre[1], color: matchRef?.get(i) === undefined ? '#ff453a' : matchRef.get(i) ? '#30d158' : '#ff9f0a', r: 3 }))
    : taskTab === 'change' ? [...practice.truth.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#30d158', r: 5 })), ...practice.found.changes.map((c) => ({ x: c.centre[0], y: c.centre[1], color: '#ff9f0a', r: 3 }))] : []) : [];
  const planLayers = { ...basePlan, markers: [...basePlan.markers, ...taskMarks] };
  const stats = stage >= 1 ? [
    { group: 'Budget & equipment', k: 'Cost', v: `${cost.total}`, s: `of ${T.settings.budget}` }, { group: 'Budget & equipment', k: 'Left', v: `${cost.remaining}`, s: 'credits' },
    { group: 'Budget & equipment', k: 'LiDARs', v: String(d.lidars.length) }, { group: 'Budget & equipment', k: 'Cameras', v: String(d.cameras.length) },
    ...(stage === 2 && cov ? [{ group: 'LiDAR coverage', k: 'Observed', v: pct(cov.stats.coverage) }, { group: 'LiDAR coverage', k: 'Seen twice+', v: pct(cov.stats.overlap) }, { group: 'LiDAR coverage', k: 'Unobserved', v: pct(cov.stats.unobserved) }] : []),
    ...(practice ? [{ group: 'Result', k: 'Practice score', v: <ScoreMeter value={practice.grade.total} tasks={practice.grade.perTask} /> }] : []),
  ] : undefined;
  const legend = stage === 2 ? [{ color: HEAT[0], label: 'No LiDAR sees it' }, { color: HEAT[1], label: 'One LiDAR' }, { color: HEAT[2], label: 'Two or more' }] : stage === 6 ? [{ color: '#ff453a', label: 'True surface not covered' }] : stage === 7 ? [{ color: '#30d158', label: 'Found' }, { color: '#ff9f0a', label: 'Misnamed' }, { color: '#ff453a', label: 'Missed' }] : ZONES.map((z, i) => ({ color: ['#c7a28a', '#9ab', '#8ac', '#bb9', '#667'][i], label: z.name }));
  void STATUS_COLOURS;
  return <TabFrame title="Industrial Digital Twin Challenge" tab={17} viewport={viewport} controls={controls} learn={null} noPanelTabs noEnv stats={stats} overlays={<>{stage === 5 && (() => {
    const why = !cost.ok ? cost.errors[0] : chk.global[0] ?? (chk.perBlock.find(Boolean) as string | undefined) ?? (T.pipeline.length ? '' : 'Add a registration block to begin.'), withView = practice ? practice.steps.map((x, i) => (x.preview ? i : -1)).filter((i) => i >= 0) : [], at = withView.indexOf(T.selectedStep), go = (d2: number) => { if (!withView.length) return; const n = at < 0 ? (d2 > 0 ? 0 : withView.length - 1) : at + d2; if (n >= 0 && n < withView.length) T.set({ selectedStep: withView[n] }); };
    const cur = practice && T.selectedStep >= 0 ? practice.steps[T.selectedStep] : null;
    return (
      <div className="overlay glass card canvas-run" data-testid="twin-canvas-run">
        <Btn variant="primary" sm icon={<Play size={14} />} onClick={runPractice} busy={!!T.busy} disabled={!cost.ok || !chk.ok} testId="twin-run-canvas" title={why || 'Run the practice survey through your blocks and see the result here'}>Test pipeline</Btn>
        <label className="canvas-run-auto" title="Run the test again a moment after every change to your blocks"><input type="checkbox" checked={autoTest} onChange={(e) => setAutoTest(e.target.checked)} data-testid="twin-auto-test" /> Auto</label>
        {why ? <span className="canvas-run-note warn" data-testid="twin-canvas-why">{why}</span>
          : practice && withView.length ? (
            <span className="canvas-run-steps" data-testid="twin-canvas-steps">
              <button className="canvas-run-nav" aria-label="Previous block" disabled={at <= 0 && T.selectedStep >= 0} onClick={() => go(-1)}>‹</button>
              <span className="canvas-run-note">{cur ? <>After <b>{BLOCKS[cur.kind].name.replace(/ \(.*\)$/, '')}</b>: {cur.after.toLocaleString()} points</> : 'Step through the blocks'}</span>
              <button className="canvas-run-nav" aria-label="Next block" disabled={at >= withView.length - 1} onClick={() => go(1)}>›</button>
            </span>
          ) : <span className="canvas-run-note">Add blocks, then test them here.</span>}
      </div>
    );
  })()}{stage >= 2 && <div className="overlay glass card" style={{ left: 12, top: 10, width: planOpen ? 268 : 'auto', padding: 6 }} data-testid="twin-plan"><div className="plan-head"><b>Plan</b><button className="stats-toggle" onClick={() => setPlanOpen((o) => !o)} aria-expanded={planOpen} title={planOpen ? 'Fold the plan away' : 'Show the plan'} data-testid="twin-plan-toggle">{planOpen ? 'Hide' : 'Show'}</button></div>{planOpen && <Plan2D scene={scene} height={176} onClick={stage === 2 ? place : undefined} layers={planLayers} />}</div>}<KindLegend items={legend} top={66} side={stage >= 2 ? 'right' : 'left'} /></>}
    viewExtras={<Seg<'scene' | 'points' | 'both'> value={viewMode} onChange={setViewMode} block={false} label="What the 3D view shows" options={[{ value: 'scene', label: 'Scene' }, { value: 'points', label: 'Points' }, { value: 'both', label: 'Both' }]} />} />;
}
