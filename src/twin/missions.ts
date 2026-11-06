import type { RunConfig, RunResult, FinalResult } from './runner';
import type { Block, BlockKind } from './pipeline';

import { usd } from './pricing';
import { CRITICAL_CAMERA_ZONE } from './factory';

/** A metric value for display: dollars for money, one decimal otherwise. */
export const fmtMetric = (value: number, unit: string) => (!Number.isFinite(value) ? '—' : unit === 'credits' ? usd(value) : unit === 'pts/m²' ? `${Math.round(value)} pts/m²` : unit === '°' ? `${value.toFixed(2)} °` : `${value.toFixed(1)} ${unit}`);

export type MissionLevel = 'needs-improvement' | 'passed' | 'excellent';
export interface MissionMetric { label: string; value: number; target: number; unit: '%' | 'cm' | 'px' | 'credits' | 'pts/m²' | '°'; lower?: boolean }
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
  { title: 'Design the sensing network', scenario: 'The factory has blind spots. Design an affordable LiDAR network that observes the critical production, inspection and loading areas.', objective: 'Mount fixed LiDARs where they see the critical areas, with enough points on each, within the budget.', tools: [1, 2], blocks: [] as BlockKind[], reference: 'Occlusion & Sensor Placement', hints: ['Use the red coverage samples to identify what remains unobserved.', 'A second viewing angle can resolve occlusion; more channels alone cannot see through equipment.', 'Mounting height matters: very high scanners see less of the floor-level work. Each critical area also needs a minimum number of points, so a denser or closer scanner may help. Keep some budget for cameras and lighting later.'] },
  { title: 'Align the LiDAR measurements', scenario: 'Installed scanners report in separate coordinate systems. Combine their measured point clouds into one usable factory map.', objective: 'Align the scans one at a time and check each against the surveyed position.', tools: [4, 5], blocks: ['merge', 'icp', 'mobileicp'] as BlockKind[], reference: 'Point Cloud Registration', hints: ['Acquire the scans and inspect their original coordinate frames.', 'ICP needs overlapping surfaces and a reasonable initial pose.', 'Compare both methods and trim distant pairs; a single installed scanner only needs placement.'] },
  { title: 'Clean the point cloud', scenario: 'Dust and imperfect returns leave floating measurements. Clean the map while preserving the small inspection objects.', objective: 'Remove outliers and retain both valid surfaces and small-object measurements.', tools: [5], blocks: ['crop', 'voxel', 'random', 'sor', 'ror', 'normals'] as BlockKind[], reference: 'Point Cloud Processing', hints: ['Compare the input and output using the preview steps.', 'Aggressive downsampling can destroy the small objects you will need later.', 'Try a modest voxel size with statistical or radius filtering and inspect all three quality metrics.'] },
  { title: 'Detect industrial objects', scenario: 'The map contains geometry but no inventory. Find and name machines, pallets, containers and small objects.', objective: 'Separate building surfaces, cluster objects and test the rule-based shape classifier.', tools: [5, 7], blocks: ['ground', 'planes', 'euclid', 'dbscan', 'classify'] as BlockKind[], reference: 'Unsupervised Learning', hints: ['Building surfaces can connect otherwise separate objects.', 'A large clustering radius merges neighbours; a high minimum size loses small objects.', 'Inspect missed classes and bounding boxes, then tune plane removal and clustering. Classification uses shape rules, not a neural network.'] },
  { title: 'Add cameras and colour', scenario: 'Identically shaped containers have different colour labels. Integrate cameras, illumination and calibration to distinguish them.', objective: 'Cover the critical visual inspection bay with a camera and its explicitly paired LiDAR, then calibrate and read the colour labels.', tools: [1, 2, 3, 5, 7], blocks: ['colour'] as BlockKind[], reference: 'LiDAR + Camera Fusion', hints: ['The specified 720p camera is already in your equipment. Mount and aim it at the highlighted inspection bay; one camera–LiDAR pair must cover at least 80% of its six label stations.', 'More pixels cannot compensate for darkness or miscalibration.', 'Inspect red versus green markers and try a manual correction. Assisted optimisation is available after inspecting the error.'] },
  { title: 'Detect changes and safety problems', scenario: 'The factory has changed since commissioning. Some objects moved, appeared or disappeared; some changes affect safety zones.', objective: 'Compare Time A and Time B and pass both change detection and safety assessment.', tools: [5, 7], blocks: ['diff', 'objmatch', 'safety'] as BlockKind[], reference: 'Change Detection', hints: ['Compare both surveys and their detected changes.', 'Small thresholds flag noise as change; large thresholds miss real movement.', 'Inspect false positives and each safety zone separately. This is an educational simulation, not a certified industrial safety system.'] },
  { title: 'Commission the digital twin', scenario: 'Management wants evidence that your complete system works under new conditions. Commission the equipment and pipeline you have refined.', objective: 'Evaluate two unseen deterministic scenarios, inspect the engineering report and export or submit your result.', tools: [8, 6, 7], blocks: [] as BlockKind[], reference: 'Industrial Digital Twin Challenge', hints: ['Revalidate any mission marked stale before commissioning.', 'The final uses your current equipment, calibration and processing on two different scenarios.', 'Inspect the individual scenario results and remaining limitations before exporting your report.'] },
] as const;
export const MISSION_TARGETS = [
  'Pass: ≥70% measured coverage of the critical areas and at least 100 (production), 80 (inspection) and 80 (loading) points per m²; stay within budget.',
  'Pass: scans aligned to within 2 cm and 0.15° of the surveyed scanner positions, with ≥20% overlap. One scanner is judged by its surface accuracy.',
  'Pass: remove ≥60% of outliers; retain ≥80% of valid and ≥60% of small-object points.',
  'Pass: detection F1 ≥55%; small-object recall ≥25%.',
  'Pass: ≥80% of the critical inspection bay covered by one calibrated camera–LiDAR pair; ≥70% labels correct; marker error ≤4 px at 720p.',
  'Pass: change F1 ≥50% and safety zone accuracy ≥75%, measured separately.',
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
  return { ...progress, results: progress.results.map((r, i) => r ? { ...r, stale: r.fingerprint !== missionFingerprint(cfg, i) } : null) };
}
export const currentPass = (r: MissionResult | null | undefined) => !!r && !r.stale && (r.level === 'passed' || r.level === 'excellent');
export const readyForFinal = (p: MissionProgress) => p.results.length >= 6 && p.results.slice(0, 6).every(currentPass);
export function recordMission(progress: MissionProgress, mission: number, result: MissionResult): MissionProgress {
  if (mission > progress.unlocked) return progress;
  const results = [...progress.results], attempts = [...progress.attempts]; results[mission] = result; attempts[mission] = (attempts[mission] ?? 0) + 1;
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
    const thin = Object.entries(ZONE_DENSITY_MIN).filter(([z, m]) => (r.coverage?.zoneDensity?.[z] ?? 0) < m).map(([z]) => z);
    if (thin.length) feedback.push(`Too few points in the ${thin.join(' and ')} area${thin.length > 1 ? 's' : ''}. A denser or better placed scanner, or a lower mounting height, adds points there.`);
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
    metrics.push(percent('Detection F1', t.detect.f1, 0.55), percent('Small-object recall', t.detect.smallRecall, 0.25));
    feedback.push(`Precision ${Math.round(100 * t.detect.precision)}%; recall ${Math.round(100 * t.detect.recall)}%. Missed classes: ${Object.entries(t.detect.byClass).filter(([, v]) => v.ref && v.found < v.ref / 2).map(([k]) => k).join(', ') || 'none below half recall'}. Inspect cluster distances and sizes.`);
  } else if (mission === 4) {
    metrics.push(percent('Correct label recognition', t.colour.accuracy, 0.7));
    const cal = r.calibration;
    metrics.push({ label: 'Worst paired-camera marker error (720p)', value: cal?.maxRms ?? Infinity, target: 4, unit: 'px', lower: true });
    metrics.push(percent('Paired cameras calibrated', cal?.validFraction ?? 0, 1));
    metrics.push(percent('Critical bay: camera coverage', r.inspection?.coverage ?? 0, CRITICAL_CAMERA_ZONE.target));
    metrics.push(percent('Critical bay: calibrated shared coverage', r.inspection?.calibratedCoverage ?? 0, CRITICAL_CAMERA_ZONE.target));
    feedback.push('The inspection bay needs one explicitly connected camera–LiDAR pair covering at least 5 of its 6 label stations. Mount both with a clear view, choose that LiDAR in Calibrate, and reduce marker error to ≤4 px.');
    feedback.push(`${t.colour.correct}/${t.colour.total} labels correct; ${t.colour.unknown} unknown. Inspect pairing, calibration, illumination and whether the label faces the camera.`);
  } else if (mission === 5) {
    metrics.push(percent('Change detection F1', t.change.f1, 0.5), percent('Safety zone accuracy', t.safety.accuracy, 0.75));
    feedback.push(`${t.change.fp} false changes; ${t.safety.missed} missed safety violations. Tune change thresholds and inspect safety findings separately.`);
  } else {
    metrics.push({ label: 'Final score', value: final?.grade.total ?? 0, target: 60, unit: '%' });
    metrics.push(percent('Critical bay: worst final scenario', final?.runs.length ? Math.min(...final.runs.map((run) => run.inspection?.calibratedCoverage ?? 0)) : 0, CRITICAL_CAMERA_ZONE.target));
    feedback.push('Final scores average the complete system across both unseen scenarios. Export the report to inspect each result.');
  }
  const passMetric = (m: MissionMetric) => Number.isFinite(m.value) && (m.lower ? m.value <= m.target : m.value >= m.target);
  const passed = r.ok && !r.steps.some((s) => s.error) && metrics.every(passMetric) && (mission !== 6 || !!final?.runs.every((x) => x.ok && !x.steps.some((s) => s.error)));
  const excellent = passed && metrics.every((m) => m.lower ? m.value <= m.target * 0.8 : m.value >= Math.min(100, m.target * 1.15));
  const scores = [(r.coverage?.critical ?? t.twin.coverage) * 100, Math.max(0, 1 - (r.registration?.rmse ?? 1) / 0.2) * 100, t.quality.score * 100, t.detect.score * 100, t.colour.score * 100, (t.change.score + t.safety.score) * 50, final?.grade.total ?? 0];
  if (!r.ok) feedback.unshift(r.error || 'The survey could not be evaluated. Check the equipment and budget.');
  return { at: Date.now(), fingerprint: missionFingerprint(cfg, mission), level: excellent ? 'excellent' : passed ? 'passed' : 'needs-improvement', score: r.ok && Number.isFinite(scores[mission]) ? Math.max(0, Math.min(100, scores[mission])) : 0, metrics, feedback };
}
