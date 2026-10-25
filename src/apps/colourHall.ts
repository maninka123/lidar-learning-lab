import { PointCloud, concatClouds } from '../core/pointcloud';
import { PRESETS, presetToConfig } from '../sensor/presets';
import { runTask } from '../engine/client';
import { staticPose } from '../sensor/simulate';
import { renderView } from '../recon/recon';
import { buildFusionHall } from '../scenes/fusion';
import { FOV, IMG_H, IMG_W, Keyframe, TRUTH, cameraPose, colourMoving } from './fusion';

let cache: PointCloud | null = null;

/**
 * A good coloured point cloud made from the calibration hall: a LiDAR scan from four stations, and four photos at every station
 * (looking forward, left, back and right) painted onto the points with the true camera mounting.
 */
export async function buildColourHall(onProgress?: (text: string) => void): Promise<PointCloud> {
  if (cache) return cache;
  const scene = buildFusionHall();
  const sensor = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.35, noise: 0.003 };
  const stations: [number, number][] = [[-3, 0], [1.5, -2.6], [1.5, 2.6], [-4, 3]];
  const parts: PointCloud[] = [];
  for (let k = 0; k < stations.length; k++) {
    onProgress?.(`Scanning station ${k + 1} of ${stations.length}…`);
    const [x, y] = stations[k];
    const r = await runTask('scan', { scene, sensor, trajectory: staticPose(x, y, 1.4, 0), sweeps: 1, seed: 60 + k, maxRays: 160000, distortion: false, scanId: k + 1, name: `Station ${k + 1}` });
    onProgress?.(`Taking photos at station ${k + 1}…`);
    const frames: Keyframe[] = [];
    for (let q = 0; q < 4; q++) {
      const rig = { x, y, z: 1.4, yaw: (q * Math.PI) / 2 }, cam = cameraPose(rig, TRUTH);
      const v = renderView(scene, { pos: cam.pos, target: [cam.pos[0] + cam.f[0], cam.pos[1] + cam.f[1], cam.pos[2] + cam.f[2]], fovDeg: FOV }, IMG_W, IMG_H);
      frames.push({ t: 0, rig, img: { w: IMG_W, h: IMG_H, fovDeg: FOV, rgb: v.rgb, depth: v.depth, hitMask: v.hitMask } });
      await new Promise((ok) => setTimeout(ok, 0));
    }
    const col = colourMoving(r.cloud.positions, undefined, r.cloud.count, frames, TRUTH);
    parts.push({ ...r.cloud, colors: col.colors });
  }
  const merged = concatClouds(parts, 'Coloured hall (LiDAR + camera)', { kind: 'simulated' });
  cache = merged;
  return merged;
}
