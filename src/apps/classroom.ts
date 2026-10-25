import { PointCloud, cloudBounds } from '../core/pointcloud';
import { parsePointCloud } from '../io/load';
import { voxelDownsample } from '../processing/ops';
import { euclideanClustering } from '../segmentation/clustering';

/** Class ids stored in classroom_scene.ply (semantic label per point). Names for 3-6 are best guesses from where the points sit. */
export const CLASSROOM_CLASSES: Record<number, { name: string; color: [number, number, number] }> = {
  0: { name: 'Ceiling', color: [190, 190, 200] },
  1: { name: 'Floor', color: [150, 120, 90] },
  2: { name: 'Wall', color: [225, 225, 215] },
  3: { name: 'Furniture A', color: [200, 120, 60] },
  4: { name: 'Furniture B', color: [90, 150, 200] },
  5: { name: 'Furniture C', color: [120, 90, 160] },
  6: { name: 'Other', color: [230, 180, 60] },
};

const cache = new Map<string, PointCloud>();

/** The classroom scan, moved so the floor is at z = 0 and the room is centred on x, y. `voxel` thins it (metres). */
export async function loadClassroom(voxel = 0): Promise<PointCloud> {
  const key = String(voxel);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}data/classroom_scene.ply`);
  if (!res.ok) throw new Error('Could not load classroom_scene.ply');
  let c = parsePointCloud(await res.arrayBuffer(), 'classroom_scene.ply');
  const b = cloudBounds(c);
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < c.count; i++) { c.positions[i * 3] -= cx; c.positions[i * 3 + 1] -= cy; c.positions[i * 3 + 2] -= b.min[2]; }
  if (voxel > 0) c = voxelDownsample(c, voxel);
  c.name = 'Classroom scan';
  cache.set(key, c);
  return c;
}

let withInstances: PointCloud | null = null;

/** The classroom for segmentation: thinned to 4 cm, with every piece of furniture given its own object id (the "true objects"). Floor, walls and ceiling stay id 0 and are ignored when scoring. */
export async function loadClassroomForSegmentation(): Promise<PointCloud> {
  if (withInstances) return withInstances;
  const base = await loadClassroom(0.04);
  const lab = base.labels!;
  const ids: number[] = []; for (let i = 0; i < base.count; i++) if (lab[i] >= 3) ids.push(i);
  const p = new Float32Array(ids.length * 3); ids.forEach((j, k) => p.set(base.positions.subarray(j * 3, j * 3 + 3), k * 3));
  const cl = euclideanClustering(p, ids.length, 0.09, 60);
  const instances = new Int32Array(base.count);
  ids.forEach((j, k) => { if (cl.labels[k] >= 0) instances[j] = cl.labels[k] + 1; });
  withInstances = { ...base, id: `${base.id}-seg`, name: 'Classroom scan', instances };
  return withInstances;
}

/** Colour every point by its class in the scan file (ceiling, floor, wall, furniture…). */
export function paintClasses(c: PointCloud): PointCloud {
  const col = new Uint8Array(c.count * 3);
  for (let i = 0; i < c.count; i++) { const k = CLASSROOM_CLASSES[c.labels![i]]?.color ?? [180, 180, 180]; col[i * 3] = k[0]; col[i * 3 + 1] = k[1]; col[i * 3 + 2] = k[2]; }
  return { ...c, colors: col };
}
