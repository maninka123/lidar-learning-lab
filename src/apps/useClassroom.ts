import { useEffect, useState } from 'react';
import { PointCloud } from '../core/pointcloud';
import { loadClassroom } from './classroom';

/** The classroom scan, thinned to `voxel` metres, loaded once and cached. */
export function useClassroom(voxel: number) {
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    loadClassroom(voxel).then((c) => on && setCloud(c)).catch((e) => on && setError((e as Error).message));
    return () => { on = false; };
  }, [voxel]);
  return { cloud, error };
}

export const PLANE_COLOURS: [number, number, number][] = [[230, 57, 70], [29, 120, 220], [40, 170, 90], [244, 162, 30], [140, 80, 200], [0, 180, 190], [220, 90, 160], [120, 140, 40], [90, 90, 220], [200, 120, 60], [60, 60, 60], [180, 60, 120]];
