import type { SceneId } from '../scenes';
import type { CoverageStats } from './coverage';

export interface Challenge {
  id: 'easy' | 'medium' | 'hard';
  level: string;
  scene: SceneId;
  preset: string;
  maxScanners: number;
  /** share of the surface (0..1) that must be observed */
  target: number;
  title: string;
  goal: string;
  /** a placement known to reach the target: used to check that every challenge can be won (and as the answer to show) */
  reference: { x: number; y: number }[];
  height: number;
}

export const CHALLENGES: Challenge[] = [
  { id: 'easy', level: 'Easy', scene: 'A', preset: 'tls', maxScanners: 3, target: 0.9, title: 'The room', goal: 'Observe at least 90 % of the room with up to 3 scanners.', reference: [{ x: -3.6, y: -2 }, { x: 3.2, y: 2.7 }], height: 1.5 },
  { id: 'medium', level: 'Medium', scene: 'B', preset: 'tls', maxScanners: 3, target: 0.88, title: 'The workshop', goal: 'Machines and shelves cast shadows. Observe at least 88 % with up to 3 scanners.', reference: [{ x: -6.2, y: -0.9 }, { x: 6.1, y: 3.8 }, { x: -0.3, y: -4.6 }], height: 1.6 },
  { id: 'hard', level: 'Hard', scene: 'C', preset: 'rot32', maxScanners: 3, target: 0.88, title: 'The street', goal: 'A long street with cars and buildings, and a scanner that sees only ±22° up and down. Observe at least 88 % with just 3 scanners.', reference: [{ x: -0.5, y: 5.1 }, { x: -14.2, y: -5.4 }, { x: 14.2, y: -5.4 }], height: 1.8 },
];

export interface ChallengeState { used: number; coverage: number; target: number; progress: number; done: boolean; overLimit: boolean }
export function evaluateChallenge(c: Challenge, scanners: number, stats: CoverageStats | null): ChallengeState {
  const coverage = stats?.coverage ?? 0;
  return { used: scanners, coverage, target: c.target, progress: Math.min(1, coverage / c.target), done: scanners > 0 && scanners <= c.maxScanners && coverage >= c.target, overLimit: scanners > c.maxScanners };
}

/** Plain-words reasons why the current placement falls short. */
export function advice(c: Challenge, stats: CoverageStats | null): string[] {
  if (!stats || stats.scanners === 0) return ['Place a scanner to begin.'];
  const out: string[] = [];
  if (stats.coverage >= c.target) return ['Target reached. Fewer scanners or less overlap would also work: try to do it with one fewer.'];
  const weak = stats.perScanner.findIndex((p) => p.unique < 0.02);
  if (stats.scanners > 1 && weak >= 0) out.push(`Scanner ${weak + 1} adds almost nothing new (under 2 % that no other scanner sees). Move it somewhere that sees different surfaces.`);
  if (stats.overlap > 0.6 * stats.coverage && stats.scanners > 1) out.push('Your scanners see mostly the same surfaces. Spread them out: overlap is useful, but this much is wasted.');
  const { hidden, outFov, outRange } = stats.why;
  if (hidden >= outFov && hidden >= outRange) out.push('Most of what is missing is hidden behind objects. A scanner has to stand where it has a clear line to those surfaces: look at the red dots and move next to them.');
  else if (outFov >= outRange) out.push('Most of what is missing is outside the sensor’s field of view. Turn the scanner, or raise or lower it.');
  else out.push('Most of what is missing is too far away for the sensor. Move a scanner closer to it.');
  if (stats.scanners < c.maxScanners) out.push(`You still have ${c.maxScanners - stats.scanners} scanner${c.maxScanners - stats.scanners > 1 ? 's' : ''} to place.`);
  return out;
}
