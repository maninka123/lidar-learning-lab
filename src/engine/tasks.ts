import { simulateScan, ScanRequest } from '../sensor/simulate';
import { runPipeline, OpSpec } from '../processing/pipeline';
import { segment, SegParams, SegResult, evaluateAgainstGT } from '../segmentation/segment';
import { icp, IcpOptions, evaluateAlignment } from '../registration/icp';
import { runSlam, SlamParams } from '../registration/slam';
import { reconstruct, ReconParams, scanObject, alignToLidar, compareReconstruction, ReconObjectId } from '../recon/recon';
import { sampleSurfaces, coveredMask, singleStationVisibility } from '../scenes/surface';
import { PointCloud } from '../core/pointcloud';
import { SceneDef } from '../scenes/geometry';
import { SensorConfig } from '../sensor/presets';
import { Rigid } from '../core/math';

export const tasks = {
  scan: (req: ScanRequest) => simulateScan(req),
  pipeline: (p: { original: PointCloud; steps: OpSpec[]; seed: number }) => runPipeline(p.original, p.steps, p.seed),
  segment: (p: { cloud: PointCloud; params: SegParams; ignore: number[]; fromPlanes?: SegResult }) => {
    const result = segment(p.cloud, p.params, p.fromPlanes);
    const gt = evaluateAgainstGT(p.cloud, result, new Set(p.ignore));
    return { result, gt };
  },
  icp: (p: { src: Float32Array; nSrc: number; dst: Float32Array; nDst: number; opts: IcpOptions }) => icp(p.src, p.nSrc, p.dst, p.nDst, p.opts),
  evalAlign: (p: { src: Float32Array; nSrc: number; dst: Float32Array; nDst: number; T: Rigid; maxDist: number }) => evaluateAlignment(p.src, p.nSrc, p.dst, p.nDst, p.T, p.maxDist),
  slam: (p: { scene: SceneDef; sensor: SensorConfig; params: SlamParams }) => runSlam(p.scene, p.sensor, p.params),
  recon: (p: { params: ReconParams }) => reconstruct(p.params),
  reconLidar: (p: { object: ReconObjectId; seed: number; stations: number }) => scanObject(p.object, p.seed, p.stations),
  reconCompare: (p: { object: ReconObjectId; recon: PointCloud; lidar: PointCloud }) => {
    const align = alignToLidar(p.recon, p.lidar);
    const cmp = align.valid ? compareReconstruction(p.object, align.aligned, p.lidar) : null;
    return { align, cmp };
  },
  coverage: (p: { scene: SceneDef; clouds: { positions: Float32Array; count: number }[]; radius: number; pose?: { x: number; y: number; z: number; yaw: number }; sensor?: SensorConfig }) => {
    const samples = sampleSurfaces(p.scene, 30000);
    const masks = p.clouds.map((c) => coveredMask(samples, c.positions, c.count, p.radius));
    const union = new Uint8Array(samples.count);
    const times = new Uint8Array(samples.count);
    masks.forEach((m) => m.forEach((v, i) => { if (v) { union[i] = 1; times[i]++; } }));
    let area = 0, covered = 0, overlap = 0, coveredArea = 0, overlapArea = 0;
    for (let i = 0; i < samples.count; i++) { area += samples.area[i]; if (union[i]) { covered++; coveredArea += samples.area[i]; } if (times[i] > 1) { overlap++; overlapArea += samples.area[i]; } }
    const vis = p.pose && p.sensor ? singleStationVisibility(p.scene, samples, union, p.pose, p.sensor) : null;
    return { samples, union, times, perStation: masks.map((m) => m.reduce((a, v) => a + v, 0)), total: samples.count, covered, overlap, area, coveredArea, overlapArea, vis };
  },
};
export type TaskName = keyof typeof tasks;
