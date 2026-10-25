import { useEffect, useMemo, useState } from 'react';
import { Viewport } from '../ui/Viewport';
import { Btn, Section, Seg, Slider } from '../ui/controls';
import { CloudLayer, PolyLine, SceneLayer } from '../ui/three';
import { Plan2D } from '../ui/Plan2D';
import { Play, Trash2, X, Download } from '../ui/icons';
import { PRESETS, presetToConfig, SensorConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { PoseSample } from '../sensor/simulate';
import { PointCloud } from '../core/pointcloud';
import { renderView } from '../recon/recon';
import { buildFusionHall } from '../scenes/fusion';
import { autoRays } from '../state/actions';
import { downloadCloud } from '../io/load';
import { useLab } from '../state/store';
import { FOV, IMG_H, IMG_W, Keyframe, SavedCalibration, TRUTH, ZERO, cameraPose, colourMoving } from '../apps/fusion';

const PRESET_PATHS: { label: string; pts: [number, number][] }[] = [
  { label: 'Walk round the room', pts: [[-4, -2.2], [3.2, -2.2], [3.2, 2.2], [-4, 2.2], [-4, -2.2]] },
  { label: 'Straight pass', pts: [[-5, -0.2], [2.2, -0.2]] },
  { label: 'Zig-zag', pts: [[-5, -2.5], [-1, 2.5], [2, -2.5], [4.5, 2.5]] },
];
const HEIGHT = 1.4;

function buildTrajectory(wps: [number, number][], speed: number): { traj: PoseSample[]; duration: number; length: number } {
  const traj: PoseSample[] = []; let t = 0, len = 0;
  wps.forEach((w, i) => {
    if (i > 0) { const d = Math.hypot(w[0] - wps[i - 1][0], w[1] - wps[i - 1][1]); len += d; t += d / speed; }
    const a = wps[Math.min(i, wps.length - 2)], b = wps[Math.min(i + 1, wps.length - 1)];
    traj.push({ t, x: w[0], y: w[1], z: HEIGHT, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]), pitch: 0, roll: 0 });
  });
  return { traj, duration: t, length: len };
}
function poseAt(traj: PoseSample[], t: number): PoseSample {
  for (let i = 0; i < traj.length - 1; i++) if (t <= traj[i + 1].t || i === traj.length - 2) { const a = traj[i], b = traj[i + 1], f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0; return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: HEIGHT, yaw: Math.atan2(b.y - a.y, b.x - a.x), pitch: 0, roll: 0 }; }
  return traj[0];
}

/** Pop-up: map a walk through the hall with the saved camera calibration and get a coloured, registered point cloud. The sensor is fixed (LiDAR + camera); only the path is chosen. */
export default function FusionMapping({ calib, onClose }: { calib: SavedCalibration; onClose: () => void }) {
  const notify = useLab((s) => s.notify);
  const scene = useMemo(() => buildFusionHall(), []);
  const lidar: SensorConfig = useMemo(() => ({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), hRes: 0.4, noise: 0.003 }), []);
  const [wps, setWps] = useState<[number, number][]>(PRESET_PATHS[0].pts);
  const [tool, setTool] = useState(false);
  const [speed, setSpeed] = useState(1.2);
  const [use, setUse] = useState<'saved' | 'perfect' | 'none'>('saved');
  const [layer, setLayer] = useState<'colour' | 'height'>('colour');
  const [res, setRes] = useState<{ cloud: PointCloud; frames: Keyframe[]; duration: number; length: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const { traj, duration, length } = useMemo(() => (wps.length > 1 ? buildTrajectory(wps, speed) : { traj: [] as PoseSample[], duration: 0, length: 0 }), [wps, speed]);

  async function scan() {
    if (wps.length < 2) return;
    setBusy(true); setRes(null);
    try {
      const sweeps = Math.max(1, Math.ceil(duration * lidar.frequency));
      const r = await runTask('scan', { scene, sensor: lidar, trajectory: traj, sweeps, seed: 31, maxRays: Math.min(900000, autoRays(lidar, sweeps)), distortion: false, scanId: 0, name: 'Mobile scan' });
      // a photo every second or so along the path, taken by the camera as mounted (the true offset)
      const K = Math.min(18, Math.max(4, Math.ceil(duration / 1.0))), frames: Keyframe[] = [];
      for (let k = 0; k < K; k++) {
        const t = (duration * (k + 0.5)) / K, p = poseAt(traj, t), rig = { x: p.x, y: p.y, z: p.z, yaw: p.yaw }, cam = cameraPose(rig, TRUTH);
        const v = renderView(scene, { pos: cam.pos, target: [cam.pos[0] + cam.f[0], cam.pos[1] + cam.f[1], cam.pos[2] + cam.f[2]], fovDeg: FOV }, IMG_W, IMG_H);
        frames.push({ t, rig, img: { w: IMG_W, h: IMG_H, fovDeg: FOV, rgb: v.rgb, depth: v.depth, hitMask: v.hitMask } });
        await new Promise((ok) => setTimeout(ok, 0)); // let the page breathe between photos
      }
      setRes({ cloud: r.cloud, frames, duration, length }); setLayer('colour');
    } catch (e) { notify((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const colours = useMemo(() => (res ? colourMoving(res.cloud.positions, res.cloud.times, res.cloud.count, res.frames, use === 'saved' ? calib.e : use === 'perfect' ? TRUTH : ZERO) : null), [res, use, calib]);
  const shown = useMemo<PointCloud | null>(() => (res && colours ? { ...res.cloud, colors: colours.colors } : null), [res, colours]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Mobile mapping with the camera" data-testid="fusion-mapping" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1280px, 100%)', height: 'min(860px, 100%)', background: '#fff', borderRadius: 18, display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #e1e1e6' }}>
          <b style={{ fontSize: '1.125rem', flex: 1 }}>Mobile mapping with LiDAR + camera</b>
          <span className="caption">Sensor: LiDAR (16 channels) + camera, as calibrated</span>
          <button className="btn sm icon" onClick={onClose} aria-label="Close" data-testid="mapping-close"><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 0 }}>
          <div style={{ position: 'relative', minHeight: 0 }}>
            <Viewport id="mapping-3d" hideGrid bgOverride="#ffffff" label={res ? (layer === 'colour' ? 'Coloured, registered point cloud' : 'Point cloud before colouring') : 'Choose a path, then press Scan and colour'} labelPos="tl" labelTop={12} home={[-9, -8, 7]} target={[0, 0, 1]} threshold={0.05}>
              <SceneLayer scene={scene} opacity={res ? 0.08 : 0.35} showCeiling={false} interactive={false} />
              {wps.length > 1 && <PolyLine pts={wps.map((w) => [w[0], w[1], 0.05] as [number, number, number])} color="#ff9f0a" width={3} dashed />}
              {shown && <CloudLayer cloud={layer === 'colour' ? shown : res!.cloud} mode={layer === 'colour' ? 'rgb' : 'height'} size={2} budget={350000} pickable={false} />}
            </Viewport>
          </div>
          <div style={{ overflowY: 'auto', padding: 14, display: 'grid', gap: 14, alignContent: 'start', borderLeft: '1px solid #e1e1e6' }}>
            <Section title="1 · Choose the path">
              <p className="hint">The sensor is fixed: a LiDAR with the camera mounted as in your saved calibration ({(calib.e.tx * 100).toFixed(1)}, {(calib.e.ty * 100).toFixed(1)}, {(calib.e.tz * 100).toFixed(1)} cm, {calib.e.yawDeg.toFixed(1)}°, {calib.e.pitchDeg.toFixed(1)}°). You only decide where it walks.</p>
              <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                {PRESET_PATHS.map((p) => <Btn key={p.label} sm onClick={() => { setWps(p.pts); setRes(null); }} testId={`path-${p.pts.length}`}>{p.label}</Btn>)}
              </div>
              <Plan2D scene={scene} height={210} onClick={(x, y) => tool && (setWps((l) => [...l, [+x.toFixed(2), +y.toFixed(2)]]), setRes(null))} layers={{ paths: wps.length > 1 ? [{ pts: wps, color: '#ff9f0a', dashed: true }] : [], markers: wps.map(([x, y], i) => ({ x, y, color: '#ff9f0a', label: String(i + 1), r: 5 })) }} />
              <div className="btn-row">
                <Btn sm variant={tool ? 'primary' : ''} onClick={() => setTool((v) => !v)}>{tool ? 'Click the plan to add points' : 'Add points'}</Btn>
                <Btn sm icon={<Trash2 size={15} />} onClick={() => { setWps([]); setRes(null); }} disabled={!wps.length}>Clear</Btn>
              </div>
              <Slider label="Walking speed" value={speed} min={0.5} max={2.5} step={0.1} unit=" m/s" format={(v) => v.toFixed(1)} onChange={(v) => { setSpeed(v); setRes(null); }} />
              {wps.length > 1 && <p className="hint">{length.toFixed(1)} m · {duration.toFixed(1)} s</p>}
            </Section>
            <Section title="2 · Scan and colour">
              <Btn variant="primary" icon={<Play size={16} />} onClick={scan} busy={busy} disabled={wps.length < 2} testId="mapping-scan">Scan and colour</Btn>
              {busy && <p className="hint">Scanning along the path and taking photos…</p>}
            </Section>
            {res && colours && (
              <Section title="3 · Result">
                <table className="table"><tbody>
                  <tr><td>Points</td><td className="mono">{res.cloud.count.toLocaleString()}</td></tr>
                  <tr><td>Coloured</td><td className="mono" data-testid="mapping-coloured">{((100 * colours.count) / res.cloud.count).toFixed(0)} %</td></tr>
                  <tr><td>Photos used</td><td className="mono">{res.frames.length}</td></tr>
                </tbody></table>
                <Seg value={use} onChange={setUse} label="Calibration" options={[{ value: 'saved', label: 'Yours' }, { value: 'perfect', label: 'Perfect' }, { value: 'none', label: 'None' }]} />
                <p className="hint">{use === 'saved' ? 'Colours use the calibration you saved.' : use === 'perfect' ? 'Colours use the true mounting: the best possible result.' : 'No calibration: the camera is assumed to sit exactly on the LiDAR. Look how colours slip off the edges.'}</p>
                <Seg value={layer} onChange={setLayer} options={[{ value: 'colour', label: 'Coloured' }, { value: 'height', label: 'Points only' }]} />
                <Btn icon={<Download size={16} />} onClick={() => shown && downloadCloud(shown, 'ply')}>Download PLY</Btn>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
