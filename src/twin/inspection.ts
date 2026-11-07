import { project } from '../apps/fusion';
import { D2R, type Vec3 } from '../core/math';
import { inFov, raySceneFor, toSensorAngles } from '../occlusion/coverage';
import { newHit } from '../scenes/geometry';
import { camPose, nominalOf, trueExtrinsic, CAL_MAX_PX } from './camera';
import { cameraItem, HW_SEED, pairedLidarsOf, sensorFor, type TwinDesign } from './catalogue';
import type { Survey } from './acquire';
import type { Factory } from './factory';

export interface InspectionCoverage {
  total: number; coverage: number; sharedCoverage: number; calibratedCoverage: number;
  cameras: { id: string; paired: boolean; visible: number; shared: number; rms: number | null }[];
}

/** Label-facing coverage, including occlusion and readability. Grading also requires real, non-outlier returns from the explicitly paired LiDAR. */
export function inspectionCoverage(f: Factory, design: TwinDesign, survey?: Survey, errors?: number[]): InspectionCoverage {
  const targets = f.targets.filter((t) => t.id.startsWith('container-i'));
  const rs = raySceneFor(f.scene), hit = newHit();
  const clear = (origin: Vec3, point: Vec3) => {
    const delta = point.map((v, i) => v - origin[i]), distance = Math.hypot(...delta);
    return distance > .06 && !rs.cast(...origin, delta[0] / distance, delta[1] / distance, delta[2] / distance, .01, distance - .04, hit);
  };
  // Each scan retains provenance into the hidden truth. Floating outliers never count as observed objects.
  const measured = new Map<string, Set<number>>();
  if (survey) for (const scan of survey.visible.scans) {
    const ids = measured.get(scan.unit) ?? new Set<number>();
    for (const prov of scan.cloud.instances ?? []) if (!survey.hidden.truth.outlier[prov]) ids.add(survey.hidden.truth.obj[prov]);
    measured.set(scan.unit, ids);
  }
  const cameras = design.cameras.map((c, index) => {
    const item = cameraItem(c.item), actual = survey ? trueExtrinsic(c, HW_SEED, index) : null;
    const pose = camPose(actual?.e ?? nominalOf(c)), fov = actual?.fov ?? item.fov;
    // Undefined is reserved for old saves' nearest-scanner fallback. This mission requires a deliberate pairing.
    const lidars = c.pairedLidarId ? pairedLidarsOf(c, design) : []; // an older camera with no explicit connection has no partner; // the combined cloud: any of the LiDARs may be the one that reaches a label
    let visible = 0, shared = 0;
    for (const t of targets) {
      const p: Vec3 = [t.centre[0], t.max[1] + .002, t.min[2] + .75];
      const q = project(pose, p, item.w, item.h, fov);
      if (!q || q.u < 0 || q.v < 0 || q.u >= item.w || q.v >= item.h || q.z > 20 || pose.pos[1] <= p[1]) continue;
      const labelPixels = .3 * item.w / (2 * q.z * Math.tan(fov * D2R / 2));
      if (labelPixels < 8 || !clear(pose.pos, p)) continue;
      visible++;
      const reached = lidars.some((lidar) => {
        const sensor = sensorFor(lidar); if (lidar.y <= p[1]) return false;
        const origin: Vec3 = [lidar.x, lidar.y, lidar.z], angles = toSensorAngles(lidar, ...p), distance = Math.hypot(...p.map((v, i) => v - origin[i]));
        if (distance < sensor.minRange || distance > sensor.maxRange || !inFov(sensor, angles.az, angles.el) || !clear(origin, p)) return false;
        return !survey || !!measured.get(lidar.id)?.has(t.instanceId);
      });
      if (reached) shared++;
    }
    const error = errors?.[index];
    return { id: c.id, paired: lidars.length > 0, visible, shared, rms: error !== undefined && Number.isFinite(error) ? error : null };
  });
  const fraction = (select: (c: InspectionCoverage['cameras'][number]) => number) => targets.length ? Math.max(0, ...cameras.map(select)) / targets.length : 0;
  return { total: targets.length, coverage: fraction((c) => c.visible), sharedCoverage: fraction((c) => c.shared), calibratedCoverage: fraction((c) => c.rms !== null && c.rms < CAL_MAX_PX ? c.shared : 0), cameras };
}
