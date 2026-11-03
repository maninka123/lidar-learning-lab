import { eulerToR, transposeR, applyR, D2R, Vec3 } from '../core/math';
import { CameraUnit, LidarUnit, cameraItem, sensorFor } from './catalogue';
import { camPose, nominalOf } from './camera';

/** Where a camera and a LiDAR look at the same time. Both fields of view are cut by one flat screen that stands square to the camera, `dist` metres in front of it:
 *  the orange rectangle is what the camera sees, the blue area is what the LiDAR can reach, and the overlap is the part of the camera's picture that has LiDAR points behind it. */
export interface FovOverlap {
  dist: number;
  /** half width and half height of the camera's rectangle on the screen (m) */
  halfW: number; halfH: number;
  /** the drawn window is [-winW, winW] × [-winH, winH] (m) */
  winW: number; winH: number;
  nx: number; ny: number;
  /** nx × ny cells, row 0 at the top: 1 where the LiDAR's field of view reaches that point of the screen */
  lidar: Uint8Array;
  /** share of the camera's picture the LiDAR covers (0..1) */
  coverage: number;
  /** where the LiDAR sits on the screen (m), when it is in front of the camera's screen */
  lidarAt: { a: number; b: number } | null;
}

export function fovOverlap(cam: CameraUnit, lid: LidarUnit, dist: number, nx = 180): FovOverlap {
  const item = cameraItem(cam.item), aspect = item.w / item.h, tanH = Math.tan((item.fov * D2R) / 2);
  const halfW = dist * tanH, halfH = halfW / aspect, winW = halfW * 1.45, winH = halfH * 1.45;
  const ny = Math.max(2, Math.round((nx * winH) / winW)), pose = camPose(nominalOf(cam));
  const s = sensorFor(lid), R = transposeR(eulerToR(lid.yaw, lid.pitch, 0)), full = s.hFov >= 360;
  const lidar = new Uint8Array(nx * ny);
  const origin: Vec3 = [pose.pos[0] + pose.f[0] * dist, pose.pos[1] + pose.f[1] * dist, pose.pos[2] + pose.f[2] * dist];
  let inRect = 0, both = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = -winW + ((i + 0.5) / nx) * 2 * winW, b = winH - ((j + 0.5) / ny) * 2 * winH;
    const p: Vec3 = [origin[0] + pose.r[0] * a + pose.u[0] * b, origin[1] + pose.r[1] * a + pose.u[1] * b, origin[2] + pose.r[2] * a + pose.u[2] * b];
    const l = applyR(R, [p[0] - lid.x, p[1] - lid.y, p[2] - lid.z]), az = Math.atan2(l[1], l[0]) / D2R, el = Math.atan2(l[2], Math.hypot(l[0], l[1])) / D2R;
    const seen = (full || Math.abs(az) <= s.hFov / 2) && el >= s.vMin - 1e-9 && el <= s.vMax + 1e-9;
    if (seen) lidar[j * nx + i] = 1;
    if (Math.abs(a) <= halfW && Math.abs(b) <= halfH) { inRect++; if (seen) both++; }
  }
  const d: Vec3 = [lid.x - origin[0], lid.y - origin[1], lid.z - origin[2]];
  const lidarAt = Math.abs(d[0] * pose.f[0] + d[1] * pose.f[1] + d[2] * pose.f[2]) < 1e-6 * dist + 1 ? { a: d[0] * pose.r[0] + d[1] * pose.r[1] + d[2] * pose.r[2], b: d[0] * pose.u[0] + d[1] * pose.u[1] + d[2] * pose.u[2] } : null;
  return { dist, halfW, halfH, winW, winH, nx, ny, lidar, coverage: inRect ? both / inRect : 0, lidarAt };
}
