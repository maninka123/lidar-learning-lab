import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '../state/store';
import { getScene } from '../scenes';
import { Viewport } from '../ui/Viewport';
import { SceneLayer, CloudLayer, SensorMarker } from '../ui/three';
import { FAMILIES, FAMILY_GROUPS, familyLabel, getPreset, presetToConfig } from '../sensor/presets';
import { staticPose } from '../sensor/simulate';
import { runTask } from '../engine/client';
import { autoRays } from '../state/actions';
import { PointCloud } from '../core/pointcloud';
import { fmtN } from '../ui/controls';
import { X } from '../ui/icons';

export interface CmpPanel { key: number; preset: string }

/** Several viewports of the same environment, each scanned by a different sensor from the same pose. */
export function CompareSensors({ panels, onChange }: { panels: CmpPanel[]; onChange: (p: CmpPanel[]) => void }) {
  const sceneId = useLab((s) => s.sceneId);
  const pose = useLab((s) => s.pose);
  const seed = useLab((s) => s.scanOpts.seed);
  const scene = getScene(sceneId);
  const [clouds, setClouds] = useState<Record<number, { cloud: PointCloud; ms: number } | 'busy'>>({});
  const tokens = useRef<Record<number, number>>({});
  const poseKey = `${sceneId}|${pose.x}|${pose.y}|${pose.z}|${pose.yaw}|${pose.pitch}`;

  useEffect(() => {
    const timers = panels.map((p) => {
      const t = setTimeout(async () => {
        const cfg = presetToConfig(getPreset(p.preset));
        const tok = (tokens.current[p.key] = (tokens.current[p.key] ?? 0) + 1);
        setClouds((c) => ({ ...c, [p.key]: 'busy' }));
        const sweeps = cfg.pattern === 'risley' || cfg.pattern === 'solidstate' ? 6 : 1; // non-repeating patterns need several sweeps to fill in
        const t0 = performance.now();
        const res = await runTask('scan', { scene, sensor: cfg, trajectory: staticPose(pose.x, pose.y, pose.z, pose.yaw, -pose.pitch), sweeps, seed, maxRays: autoRays(cfg, sweeps), distortion: false, scanId: 0, name: cfg.name });
        if (tok !== tokens.current[p.key]) return;
        setClouds((c) => ({ ...c, [p.key]: { cloud: res.cloud, ms: performance.now() - t0 } }));
      }, 120);
      return t;
    });
    return () => timers.forEach(clearTimeout);
  }, [panels.map((p) => `${p.key}:${p.preset}`).join(','), poseKey, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = panels.length;
  const cols = n <= 2 ? n : 2;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: '1fr', gap: 2 }} data-testid="compare-sensors">
      {panels.map((p, i) => {
        const entry = clouds[p.key];
        const cfg = getPreset(p.preset);
        const cloud = entry && entry !== 'busy' ? entry.cloud : null;
        return (
          <div key={p.key} style={{ position: 'relative', minHeight: 0 }} data-testid={`cmp-panel-${i}`}>
            <Viewport id={`cmp-${p.key}`} group="cmp" primary={i === 0} home={scene.cameraHome} target={scene.cameraTarget}>
              <SceneLayer scene={scene} opacity={0.14} showCeiling={false} interactive={false} />
              {cloud && <CloudLayer cloud={cloud} mode={cfg.pattern === 'panoramic' && cloud.colors ? 'rgb' : 'flat'} colorOpts={{ flat: [230, 30, 40] }} size={2.5} budget={500000} pickable={false} />}
              <SensorMarker x={pose.x} y={pose.y} z={pose.z} yaw={pose.yaw} pitch={pose.pitch} sensor={presetToConfig(cfg)} showFov={false} />
            </Viewport>
            <div className="overlay glass card" style={{ left: 10, top: 10, display: 'flex', gap: 6, alignItems: 'center', padding: '0.3rem 0.4rem' }}>
              <select value={p.preset} onChange={(e) => onChange(panels.map((q) => (q.key === p.key ? { ...q, preset: e.target.value } : q)))} aria-label={`Sensor for view ${i + 1}`} data-testid={`cmp-select-${i}`} style={{ width: 'auto', minWidth: 190, minHeight: '2rem' }}>
                {FAMILY_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.ids.flatMap((id) => FAMILIES.find((f) => f.id === id)!.models.map((m) => <option key={m} value={m}>{`${getPreset(m).name} · ${familyLabel(id).replace('Mechanical · ', '')}`}</option>))}
                  </optgroup>
                ))}
              </select>
              {n > 2 && <button className="btn sm icon" style={{ width: 30 }} onClick={() => onChange(panels.filter((q) => q.key !== p.key))} aria-label="Remove this view"><X size={14} /></button>}
            </div>
            <div className="overlay glass card" style={{ left: 10, bottom: 10, padding: '0.3rem 0.7rem', fontWeight: 600 }}>
              {entry === 'busy' || !entry ? 'Scanning…' : <>{fmtN(entry.cloud.count)} points <span className="caption">· {cfg.group}</span></>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
