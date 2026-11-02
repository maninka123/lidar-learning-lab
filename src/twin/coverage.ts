import { project } from '../apps/fusion';
import { newHit } from '../scenes/geometry';
import type { SceneDef } from '../scenes/geometry';
import { camPose, nominalOf } from './camera';
import { CameraUnit, cameraItem, LidarUnit, lidarItem } from './catalogue';
import { raySceneFor, samplesFor, Scanner } from '../occlusion/coverage';
import type { Target } from './factory';
import { D2R } from '../core/math';

/** Planning aids for the Deploy stage. They use the intended (nominal) camera pose and the scene geometry: geometric visibility, not measured points. */

export const lidarAsScanner = (u: LidarUnit, i: number): Scanner => ({ id: i, x: u.x, y: u.y, z: u.z, yaw: u.yaw, pitch: u.pitch, preset: lidarItem(u.item).preset });

export interface CameraView { coverage: number; sharp: number; containers: { id: string; label: string; px: number | null }[]; smalls: number; smallTotal: number }
/** What a camera can see: the share of the surface in view with a clear line of sight, the share seen sharply (enough pixels per metre to read a label), and the pixel size of each container label. */
export function cameraView(scene: SceneDef, c: CameraUnit, targets: Target[]): CameraView {
  const it = cameraItem(c.item), pose = camPose(nominalOf(c)), rs = raySceneFor(scene), hit = newHit(), s = samplesFor(scene, 9000), tan = Math.tan((it.fov * D2R) / 2);
  const seen = (p: [number, number, number], normal?: [number, number, number]) => {
    const q = project(pose, p, it.w, it.h, it.fov); if (!q || q.u < 0 || q.v < 0 || q.u >= it.w || q.v >= it.h || q.z > 20) return null;
    const dx = p[0] - pose.pos[0], dy = p[1] - pose.pos[1], dz = p[2] - pose.pos[2], d = Math.hypot(dx, dy, dz);
    if (normal && -(dx * normal[0] + dy * normal[1] + dz * normal[2]) <= 0) return null;
    if (rs.cast(pose.pos[0], pose.pos[1], pose.pos[2], dx / d, dy / d, dz / d, 0.05, d - 0.08, hit)) return null;
    return it.w / (2 * q.z * tan); // pixels per metre at that distance
  };
  let tot = 0, cov = 0, sharp = 0;
  for (let i = 0; i < s.count; i++) {
    const a = s.area[i]; tot += a;
    const px = seen([s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]], [s.normal[i * 3], s.normal[i * 3 + 1], s.normal[i * 3 + 2]]);
    if (px !== null) { cov += a; if (px >= 25) sharp += a; }
  }
  const containers = targets.filter((t) => t.cls === 'container').map((t) => { // a point on the side of the container that faces the camera, at label height
    const dx = pose.pos[0] - t.centre[0], dy = pose.pos[1] - t.centre[1], l = Math.hypot(dx, dy) || 1, px = seen([t.centre[0] + (dx / l) * 0.3, t.centre[1] + (dy / l) * 0.3, t.min[2] + 0.75]);
    return { id: t.id, label: t.label, px: px === null ? null : px * 0.3 };
  });
  const smalls = targets.filter((t) => t.small), sm = smalls.filter((t) => seen(t.centre) !== null).length;
  return { coverage: tot ? cov / tot : 0, sharp: tot ? sharp / tot : 0, containers, smalls: sm, smallTotal: smalls.length };
}
