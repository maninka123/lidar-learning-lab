import type { LabState } from '../state/store';
import { getScene } from '../scenes';

export interface CheckResult { done: boolean; detail: string }
export interface Challenge {
  id: number;
  tab: number;
  title: string;
  goal: string;
  steps: string[];
  outcome: string;
  check: (s: LabState) => CheckResult;
}

const lastScan = (s: LabState) => s.clouds['scan'];

export const CHALLENGES: Challenge[] = [
  {
    id: 1, tab: 1, title: 'Configure the scanner to capture a small object',
    goal: 'Place and configure the scanner so the target object (the small calibration object of the current scene) is hit by at least 150 points.',
    steps: ['Open LiDAR Fundamentals and run a scan.', 'Move the scanner closer / change angular resolution and channels.', 'Watch the “Target object hits” statistic until it reaches 150.'],
    outcome: 'Point count on an object depends on distance, angular resolution and channel spacing — not just total point count.',
    check: (s) => {
      const c = lastScan(s), sc = getScene(s.sceneId), obj = sc.objects.find((o) => o.id === sc.targetObjectId);
      if (!c?.instances || !obj) return { done: false, detail: 'Run a scan first.' };
      let n = 0;
      for (let i = 0; i < c.count; i++) if (c.instances[i] === obj.instanceId) n++;
      return { done: n >= 150, detail: `${obj.name}: ${n} points (need ≥ 150).` };
    },
  },
  {
    id: 2, tab: 3, title: 'Explore real LiDAR scans',
    goal: 'Open a real Ouster frame and the real terrestrial laser scan in the Point Cloud Gallery and orbit both.',
    steps: ['Open Point Cloud Gallery.', 'Orbit and zoom into the branches.', 'Read the scanner type and field of view.'],
    outcome: 'A real TLS scan is extremely dense: individual branches are visible.',
    check: (s) => { const a = s.galleryViewed.some((x) => x.startsWith('os')), b = s.galleryViewed.includes('riegl'); return { done: a && b, detail: `Ouster frame opened: ${a ? 'yes' : 'no'}; TLS scan opened: ${b ? 'yes' : 'no'}.` }; },
  },
  {
    id: 3, tab: 3, title: 'Read a point cloud file',
    goal: 'Open the Raw view of the real scan and find the header and the first data rows.',
    steps: ['In the Point Cloud Gallery press Raw.', 'Find FIELDS, POINTS and DATA in the blue header.', 'Read the first few rows: one point per row.'],
    outcome: 'A point cloud file is a header plus one row of numbers per point.',
    check: (s) => ({ done: s.galleryRaw, detail: s.galleryRaw ? 'Raw view opened.' : 'Open the Raw view.' }),
  },
  {
    id: 4, tab: 5, title: 'Scan with a moving sensor (MLS)',
    goal: 'Draw a trajectory with at least three waypoints and generate a moving scan of the room.',
    steps: ['Open SLAM & Mobile Scanning → Mobile scanning.', 'Add waypoints (or use a preset) and generate the moving scan.', 'Turn on motion distortion and compare.'],
    outcome: 'A moving scanner gives every point its own pose; coverage depends on the path.',
    check: (s) => { const ok = !!s.mls && s.waypoints.length >= 3 && s.mls.sceneId === s.sceneId; return { done: ok, detail: `MLS scan: ${s.mls ? `${s.mls.cloud.count.toLocaleString()} pts` : 'not generated'}; waypoints: ${s.waypoints.length} (need 3).` }; },
  },
  {
    id: 5, tab: 4, title: 'Correct a misaligned scan',
    goal: 'Move cloud B away from cloud A, run ICP, and reduce the RMSE by at least 50 % with a recovered pose within 3 cm and 1° of the truth.',
    steps: ['Open Point Cloud Registration and move cloud B with the sliders.', 'Pick an algorithm and a match distance, then run ICP.', 'Scrub through the iterations and compare runs.'],
    outcome: 'ICP needs a reasonable initial guess and enough overlap; the residual RMSE does not reach zero because of noise and sampling.',
    check: (s) => {
      const r = s.reg;
      if (!r.before || !r.after || !r.recoveredErr) return { done: false, detail: 'Run ICP first.' };
      const imp = 1 - r.after.rmse / r.before.rmse;
      return { done: imp >= 0.5 && r.recoveredErr.t < 0.03 && r.recoveredErr.deg < 1, detail: `RMSE ${r.before.rmse.toFixed(3)} → ${r.after.rmse.toFixed(3)} m (${(imp * 100).toFixed(0)} % better); pose error ${(r.recoveredErr.t * 100).toFixed(1)} cm, ${r.recoveredErr.deg.toFixed(2)}°.` };
    },
  },
  {
    id: 6, tab: 6, title: 'Add noise, then clean the point cloud',
    goal: 'Inject noise and outliers, then clean them so ≥ 90 % of the outliers are removed while ≥ 85 % of the original points survive.',
    steps: ['Add “Inject outliers” (and optionally Gaussian noise).', 'Add Statistical or Radius outlier removal.', 'Tune parameters until the quality bar is met.'],
    outcome: 'Filters trade removing outliers against deleting real geometry. Parameters depend on point density.',
    check: (s) => {
      const q = s.proc.quality;
      if (!q || q.injected === 0) return { done: false, detail: 'Inject outliers, add a filter and run the pipeline.' };
      const removed = 1 - q.injectedLeft / q.injected;
      return { done: removed >= 0.9 && q.originalKept >= 0.85, detail: `Outliers removed: ${(removed * 100).toFixed(0)} %; original points kept: ${(q.originalKept * 100).toFixed(0)} %.` };
    },
  },
  {
    id: 7, tab: 7, title: 'Segment the floor and three objects',
    goal: 'Remove the ground with RANSAC and cluster so that at least three ground-truth objects are recovered (IoU ≥ 0.5, purity ≥ 0.7).',
    steps: ['Use a simulated scan as input.', 'Enable ground removal; pick Euclidean clustering or DBSCAN.', 'Tune radius / epsilon and min cluster size.'],
    outcome: 'Geometric clustering does not know object classes; parameter choices cause over- or under-segmentation.',
    check: (s) => {
      const g = s.seg.gt, r = s.seg.result;
      if (!r || !g) return { done: false, detail: 'Run segmentation on a simulated scan.' };
      const ground = r.planes.some((p) => p.kind === 'ground');
      return { done: ground && g.recovered.length >= 3, detail: `Ground plane: ${ground ? 'found' : 'missing'}; objects recovered: ${g.recovered.length} / ${g.gtObjects}; over-segmented ${g.overSegmented}, merged ${g.underSegmented}.` };
    },
  },
  {
    id: 8, tab: 8, title: 'Compare LiDAR with reconstructed 3D geometry',
    goal: 'Align the image-derived reconstruction to the LiDAR cloud, read the error statistics, and tick the four observations you can verify.',
    steps: ['Generate LiDAR and a reconstruction.', 'Align them (scale + ICP).', 'Inspect the error map and tick observations: occlusion, missing geometry, texture differences, geometric inaccuracy.'],
    outcome: 'Distances are only meaningful after valid alignment (including scale). Each method fails differently.',
    check: (s) => {
      const r = s.recon, obs = Object.values(r.observations).filter(Boolean).length;
      return { done: !!r.cmp && obs === 4, detail: `${r.cmp ? 'Aligned ✓' : 'Not aligned yet'}; observations ticked: ${obs} / 4.` };
    },
  },
  {
    id: 9, tab: 9, title: 'Answer a spatial question with the scene graph',
    goal: 'Ask the graph a question and answer: “Which object is closest to the scanner?”',
    steps: ['Build the scene graph.', 'Ask the closest-object question.', 'Pick your answer in the quiz box.'],
    outcome: 'Answers come from computed geometry, not guesses; measurements are traceable to node positions.',
    check: (s) => {
      const g = s.graph.graph;
      if (!g) return { done: false, detail: 'Build the graph first.' };
      const objs = g.nodes.filter((n) => !n.structural);
      let best = objs[0], bd = Infinity;
      for (const n of objs) {
        let d2 = 0;
        for (let k = 0; k < 3; k++) { const d = Math.max(0, n.bbox.min[k] - g.scanner.pos[k], g.scanner.pos[k] - n.bbox.max[k]); d2 += d * d; }
        if (d2 < bd) { bd = d2; best = n; }
      }
      const ok = s.graph.quizAnswer === best?.id;
      return { done: ok && s.graph.queried, detail: s.graph.quizAnswer ? (ok ? `Correct: ${best.label} (${Math.sqrt(bd).toFixed(2)} m).` : 'Not yet — check the closest-to-scanner query.') : 'Choose an answer.' };
    },
  },
];

export function summary(s: LabState) {
  return {
    app: 'LiDAR Learning Lab', generated: new Date().toISOString(), scene: s.sceneId,
    challenges: CHALLENGES.map((c) => { const r = c.check(s); return { id: c.id, title: c.title, done: r.done, detail: r.detail }; }),
    settings: { sensor: s.sensor.id ?? s.sensorPresetId, seed: s.scanOpts.seed, sensorConfig: s.sensor },
  };
}
