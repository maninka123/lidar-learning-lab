import type { RunConfig, RunResult, FinalResult } from './runner';
import type { Block, BlockKind } from './pipeline';

import { usd } from './pricing';
import { CRITICAL_CAMERA_ZONE } from './factory';

/** A metric value for display: dollars for money, one decimal otherwise. */
export const fmtMetric = (value: number, unit: string) => (!Number.isFinite(value) ? '—' : unit === 'credits' ? usd(value) : unit === 'n' ? `${Math.round(value)}` : unit === 'pts/m²' ? `${Math.round(value)} pts/m²` : unit === '°' ? `${value.toFixed(2)} °` : `${value.toFixed(1)} ${unit}`);

export type MissionLevel = 'needs-improvement' | 'passed' | 'excellent';
export interface MissionMetric { label: string; value: number; target: number; unit: '%' | 'cm' | 'px' | 'credits' | 'pts/m²' | '°' | 'n'; lower?: boolean; /** shown for information: it has no target and does not decide the result */ info?: boolean }
export interface MissionResult { at: number; fingerprint: string; level: MissionLevel; score: number; metrics: MissionMetric[]; feedback: string[]; stale?: boolean }
/** Saved measurements keep their history; financial displays always use the current project. */
export const currentMissionMetrics = (result: MissionResult, cost: number, budget: number): MissionMetric[] => result.metrics.map((metric) => metric.unit === 'credits' ? { ...metric, value: cost, target: budget } : metric);
export interface MissionProgress { current: number; unlocked: number; results: (MissionResult | null)[]; attempts: number[] }
export const emptyProgress = (): MissionProgress => ({ current: 0, unlocked: 0, results: Array(7).fill(null), attempts: Array(7).fill(0) });
/** The critical zones need enough measured points to see detail, not only to be seen: the least points per square metre of surface (up to 3 m high). */
export const ZONE_DENSITY_MIN = { production: 100, inspection: 80, loading: 80 } as const;
/** Mission 2 passes when the aligned scans sit within this of the surveyed scanner positions. */
export const ALIGN_MAX_CM = 2, ALIGN_MAX_DEG = 0.15;
export const MISSIONS = [
  { title: 'Design the sensing network', scenario: 'The factory has blind spots. Design an affordable LiDAR network that sees the critical production, inspection and loading areas.', objective: 'Mount fixed LiDARs where they see the critical areas, with enough points on each, within the budget.', tools: [1, 2], blocks: [] as BlockKind[], reference: 'Occlusion & Sensor Placement', hints: ['Use the red coverage samples to identify what remains unobserved.', 'A second viewing angle can resolve occlusion; more channels alone cannot see through equipment.', 'Mount height matters: very high scanners see less of the floor. Each critical area also needs enough points, so a denser or closer scanner may help. Keep some budget for the camera.'] },
  { title: 'Align the LiDAR measurements', scenario: 'Installed scanners report in separate coordinate systems. Combine their measured point clouds into one usable factory map.', objective: 'Align the scans one at a time and check each against the surveyed position.', tools: [4, 5], blocks: ['merge', 'icp', 'mobileicp'] as BlockKind[], reference: 'Point Cloud Registration', hints: ['Acquire the scans and inspect their original coordinate frames.', 'ICP needs overlapping surfaces and a reasonable initial pose.', 'Compare both methods and trim distant pairs; a single installed scanner only needs placement.'] },
  { title: 'Clean the point cloud', scenario: 'Dust and imperfect returns leave floating measurements. Clean the map while preserving the small inspection objects.', objective: 'Remove outliers and retain both valid surfaces and small-object measurements.', tools: [5], blocks: ['crop', 'voxel', 'random', 'sor', 'ror', 'normals'] as BlockKind[], reference: 'Point Cloud Processing', hints: ['Compare the input and output using the preview steps.', 'Aggressive downsampling can destroy the small objects you will need later.', 'Try a modest voxel size with statistical or radius filtering and inspect all three quality metrics.'] },
  { title: 'Detect industrial objects', scenario: 'The map contains geometry but no inventory. Find and name the machines, pallets, containers and other objects.', objective: 'Remove the building, group the points into objects and name them. Find at least 70% of the objects in the factory.', tools: [5, 7], blocks: ['ground', 'planes', 'euclid', 'dbscan', 'classify'] as BlockKind[], reference: 'Unsupervised Learning', hints: ['Building surfaces can connect otherwise separate objects.', 'A large clustering radius merges neighbours; a high minimum size loses small objects.', 'Objects without a green box in 3D were missed. Tune plane removal and clustering. Naming uses shape rules, not a neural network.'] },
  { title: 'Add cameras and colour', scenario: 'Identical containers carry different colour labels. Use a calibrated camera to tell them apart.', objective: 'Aim the camera at the critical inspection bay, register it with the combined LiDAR point cloud, then read the colour labels.', tools: [2, 3, 5, 7, 1], blocks: ['colour'] as BlockKind[], reference: 'LiDAR + Camera Fusion', hints: ['The 720p camera is already yours. Aim it at the highlighted bay: it must see at least 80% of its six label stations. The LiDARs stay where they are.', 'More pixels cannot compensate for darkness or miscalibration.', 'Match the red markers to the green ones. Assistance opens once the error is below 10 px.'] },
  { title: 'See what changed', scenario: 'The factory has changed since commissioning. Some objects moved, appeared or disappeared; some changes affect safety zones.', objective: 'Find what changed between Time A and Time B, and which changes put an object inside a safety zone.', tools: [5], blocks: ['diff', 'objmatch', 'safety'] as BlockKind[], reference: 'Change Detection', hints: ['Compare both surveys and their detected changes.', 'Small thresholds flag noise as change; large thresholds miss real movement.', 'Inspect false positives and each safety zone separately. This is an educational simulation, not a certified industrial safety system.'] },
  { title: 'Final score and certificate', scenario: 'Show that your complete system works under new conditions, then celebrate.', objective: 'Evaluate two unseen deterministic scenarios, inspect the engineering report and export or submit your result.', tools: [8, 6, 7], blocks: [] as BlockKind[], reference: 'Industrial Digital Twin Challenge', hints: ['Revalidate any mission marked stale before commissioning.', 'The final uses your current equipment, calibration and processing on two different scenarios.', 'Inspect the individual scenario results and remaining limitations before exporting your report.'] },
] as const;
export const MISSION_TARGETS = [
  'Pass: ≥70% measured coverage of the critical areas and at least 100 (production), 80 (inspection) and 80 (loading) points per m²; stay within budget.',
  'Pass: aligned within 2 cm and 0.15°, overlap ≥20%. One scanner: judged by surface accuracy.',
  'Pass: remove ≥60% of outliers; retain ≥80% of valid and ≥60% of small-object points.',
  'Pass: find ≥70% of the objects in the factory. Naming is automatic and shown for information.',
  'Pass: the calibrated camera sees ≥80% of the inspection bay, with marker error below 3 px (720p).',
  'Nothing to tune: press Show to see the changes and the safety zones they affect. The best settings are chosen for you.',
  'Pass: all prior missions current; final score ≥60/100 across two unseen variants.',
];
export const TOOL_NAMES: Record<number, string> = { 1: 'Equipment', 2: 'Deploy', 3: 'Calibrate', 4: 'Acquire', 5: 'Process', 6: 'Digital twin', 7: 'Inspect results', 8: 'Evaluate & report' };
export const pipelineForMission = (blocks: Block[], mission: number) => blocks.filter((b) => MISSIONS.slice(0, mission + 1).some((m) => m.blocks.includes(b.kind)));
const blockStage = (kind: BlockKind) => MISSIONS.findIndex((m) => m.blocks.includes(kind));
export function missionFingerprint(cfg: RunConfig, mission: number): string {
  const d = cfg.design;
  // Camera purchases do not alter LiDAR data or invalidate the completed cleaning and detection work.
  const design = mission !== 4 && mission !== 6 ? { lidars: d.lidars, platform: d.platform, route: d.route, routeSteps: d.routeSteps, distortion: d.distortion } : d;
  const pipeline = mission === 0 ? [] : cfg.pipeline.filter((b) => blockStage(b.kind) <= mission && blockStage(b.kind) >= 0 && (mission !== 5 || b.kind !== 'colour')); 
  const fingerprint: unknown[] = [design, pipeline.map(({ id, ...b }) => b), cfg.settings];
  if (mission === 4 || mission === 6) fingerprint.push('camera-inspection-v1');
  return JSON.stringify(fingerprint);
}
export function invalidateProgress(progress: MissionProgress, cfg: RunConfig): MissionProgress {
  // a detection result saved with the earlier scoring (F1 and small-object recall) is not comparable with the current one: it is dropped, so the task is measured again
  const oldScoring = (r: MissionResult, i: number) => i === 5 && r.metrics.some((m) => m.label === 'Change detection F1') || i === 4 && r.metrics.some((m) => m.label === 'Correct label recognition') || i === 3 && r.metrics.some((m) => m.label === 'Detection F1' || m.label === 'Small-object recall' || (m.label === 'Named correctly' && !m.info));
  return { ...progress, results: progress.results.map((r, i) => r && !oldScoring(r, i) ? { ...r, stale: r.fingerprint !== missionFingerprint(cfg, i) } : null) };
}
export const currentPass = (r: MissionResult | null | undefined) => !!r && !r.stale && (r.level === 'passed' || r.level === 'excellent');
export const readyForFinal = (p: MissionProgress) => p.results.length >= 6 && p.results.slice(0, 6).every(currentPass);
/** `countAttempt` is false for the automatic recalculation of the first mission, which is not an attempt the student made. */
export function recordMission(progress: MissionProgress, mission: number, result: MissionResult, countAttempt = true): MissionProgress {
  if (mission > progress.unlocked) return progress;
  const results = [...progress.results], attempts = [...progress.attempts]; results[mission] = result; if (countAttempt) attempts[mission] = (attempts[mission] ?? 0) + 1;
  return { ...progress, results, attempts, unlocked: result.level !== 'needs-improvement' && results.slice(0, mission).every(currentPass) ? Math.max(progress.unlocked, Math.min(6, mission + 1)) : progress.unlocked };
}
const percent = (label: string, value: number, target: number): MissionMetric => ({ label, value: value * 100, target: target * 100, unit: '%' });
export function evaluateMission(mission: number, r: RunResult, cfg: RunConfig, final?: FinalResult | null): MissionResult {
  const metrics: MissionMetric[] = [], feedback: string[] = [];
  const t = r.tasks;
  if (mission === 0) {
    metrics.push(percent('Critical-area measured coverage', r.coverage?.critical ?? t.twin.coverage, 0.7));
    metrics.push({ label: 'Equipment cost', value: r.cost.total, target: cfg.settings.budget, unit: 'credits', lower: true });
    for (const [zone, min] of Object.entries(ZONE_DENSITY_MIN)) metrics.push({ label: `${zone[0].toUpperCase()}${zone.slice(1)} point density`, value: r.coverage?.zoneDensity?.[zone] ?? 0, target: min, unit: 'pts/m²' });
    if (r.coverage) feedback.push(`Whole-factory measured coverage: ${Math.round(r.coverage.overall * 100)}%; multi-sensor overlap: ${Math.round(r.coverage.overlap * 100)}%; ${Math.round(r.coverage.density)} measured points per observed square metre.`);
    feedback.push(`Unobserved critical surface: ${Math.round(100 * (1 - (r.coverage?.critical ?? t.twin.coverage)))}%. Try another viewing angle or denser measurements where samples remain red.`);
  } else if (mission === 1) {
    const single = r.registration?.scans.length === 0;
    if (single) {
      metrics.push({ label: 'Single-scan surface error', value: 100 * t.twin.medianErr, target: 8, unit: 'cm', lower: true });
      feedback.push('One scanner needs no multi-scan registration. Its measured surface accuracy is evaluated.');
    } else {
      // judged against the surveyed scanner positions, which the simulation knows: this separates good alignment from poor, where the scan-to-scan gap barely changes
      metrics.push({ label: 'Alignment error (position)', value: Number.isFinite(t.twin.poseErrCm) ? t.twin.poseErrCm : Infinity, target: ALIGN_MAX_CM, unit: 'cm', lower: true });
      metrics.push({ label: 'Alignment error (angle)', value: Number.isFinite(t.twin.poseErrDeg) ? t.twin.poseErrDeg : Infinity, target: ALIGN_MAX_DEG, unit: '°', lower: true });
      metrics.push(percent('Scan overlap', r.registration?.overlap ?? 0, 0.2));
      feedback.push(!Number.isFinite(t.twin.poseErrCm) ? 'The scans have not been aligned yet. Align them one at a time, then evaluate.' : t.twin.poseErrCm > ALIGN_MAX_CM || t.twin.poseErrDeg > ALIGN_MAX_DEG ? 'The scans still sit a little apart. Try point-to-plane matching, a match distance of about half a metre, and keep most of the pairs (trim 60% or more).' : 'The scans line up with the surveyed positions.');
    }
  } else if (mission === 2) {
    metrics.push(percent('Outliers removed', t.quality.outlierRemoval, 0.6), percent('Valid points retained', t.quality.retention, 0.8), percent('Small-object points retained', t.quality.smallRetention, 0.6));
    feedback.push(t.quality.smallRetention < 0.6 ? 'Small-object measurements are being removed. Reduce voxel size or filtering strength.' : 'Balance all three metrics; removing noise alone is insufficient.');
  } else if (mission === 3) {
    const active = pipelineForMission(cfg.pipeline, 3).filter((b) => !b.bypass), hasCluster = active.some((b) => b.kind === 'euclid' || b.kind === 'dbscan'), hasNaming = active.some((b) => b.kind === 'classify');
    if (!hasCluster || !hasNaming) { // nothing can be measured yet: show that, not a misleading 0%
      metrics.push({ label: 'Objects found', value: NaN, target: 70, unit: '%' }, { label: 'Named correctly', value: NaN, target: 0, unit: '%', info: true });
      feedback.push(!hasCluster ? 'Not measured yet: add a clustering block (Euclidean or DBSCAN) to group the points into objects, then Classify to name them.' : 'Clusters are ready: add Classify objects so each group gets a name.');
    } else {
    metrics.push(percent('Objects found', t.detect.recall, 0.7), { ...percent('Named correctly', t.detect.classAcc, 0), info: true });
    const missed = Object.entries(t.detect.byClass).filter(([, v]) => v.ref && v.found < v.ref / 2).map(([k]) => k);
    feedback.push(`Found ${t.detect.tp} of ${t.detect.refs} objects.${t.detect.recall < 0.7 ? ' Try a smaller link distance and smaller minimum sizes.' : ''}${t.detect.classAcc < 0.65 ? ' Many names are wrong: objects were probably merged, so reduce the link distance.' : ''}${missed.length ? ` Least found: ${missed.join(', ')}.` : ''}`);
    }
  } else if (mission === 4) {
    const cal = r.calibration;
    metrics.push({ label: 'Worst camera marker error (720p)', value: cal?.maxRms ?? Infinity, target: 3, unit: 'px', lower: true });
    metrics.push(percent('Cameras calibrated', cal?.validFraction ?? 0, 1));
    metrics.push(percent('Critical bay: camera coverage', r.inspection?.coverage ?? 0, CRITICAL_CAMERA_ZONE.target));
    metrics.push(percent('Critical bay: calibrated shared coverage', r.inspection?.calibratedCoverage ?? 0, CRITICAL_CAMERA_ZONE.target));
    feedback.push('Aim the camera so it sees at least 5 of the six label stations of the bay, then bring the marker error below 3 px.');
    feedback.push('Keep the camera aimed at the label fronts, with enough light.');
  } else if (mission === 5) {
    // this task is for looking, not for grading: it is complete once the changes and the safety zones have been shown
    const active = pipelineForMission(cfg.pipeline, 5).filter((b) => !b.bypass), shown = active.some((b) => b.kind === 'diff') && active.some((b) => b.kind === 'safety');
    metrics.push({ label: 'Changes found', value: shown ? (r.found.changes.length) : NaN, target: 0, unit: 'n', info: true }, { label: 'Safety zones affected', value: shown ? (r.found.safety ?? []).filter((z) => z.violated).length : NaN, target: 0, unit: 'n', info: true });
    feedback.push(shown ? `${r.found.changes.length} changes found; ${(r.found.safety ?? []).filter((z) => z.violated).length} of ${(r.found.safety ?? []).length} safety zones affected.` : 'Press Show to compare Time A with Time B.');
  } else {
    metrics.push({ label: 'Final score', value: final?.grade.total ?? 0, target: 60, unit: '%' });
    metrics.push(percent('Critical bay: worst final scenario', final?.runs.length ? Math.min(...final.runs.map((run) => run.inspection?.calibratedCoverage ?? 0)) : 0, CRITICAL_CAMERA_ZONE.target));
    feedback.push('Final scores average the complete system across both unseen scenarios. Export the report to inspect each result.');
  }
  const passMetric = (m: MissionMetric) => m.info || Number.isFinite(m.value) && (m.lower ? m.value <= m.target : m.value >= m.target);
  const passed = r.ok && !r.steps.some((s) => s.error) && metrics.every(passMetric) && !(mission === 5 && metrics.some((m) => m.info && !Number.isFinite(m.value))) && (mission !== 6 || !!final?.runs.every((x) => x.ok && !x.steps.some((s) => s.error)));
  const excellent = passed && mission !== 5 && metrics.every((m) => m.info || (m.lower ? m.value <= m.target * 0.8 : m.value >= Math.min(100, m.target * 1.15)));
  const scores = [(r.coverage?.critical ?? t.twin.coverage) * 100, Math.max(0, 1 - (r.registration?.rmse ?? 1) / 0.2) * 100, t.quality.score * 100, t.detect.score * 100, t.colour.score * 100, (t.change.score + t.safety.score) * 50, final?.grade.total ?? 0];
  if (mission === 4 && passed) feedback.length = 0; // nothing left to fix: the camera task passes without a list of advice
  if (!r.ok) feedback.unshift(r.error || 'The survey could not be evaluated. Check the equipment and budget.');
  return { at: Date.now(), fingerprint: missionFingerprint(cfg, mission), level: excellent ? 'excellent' : passed ? 'passed' : 'needs-improvement', score: mission === 5 ? (passed ? 100 : 0) : r.ok && Number.isFinite(scores[mission]) ? Math.max(0, Math.min(100, scores[mission])) : 0, /* the looking task is complete or not: it has no score */ metrics, feedback };
}
