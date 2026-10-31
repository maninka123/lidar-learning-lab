import { describe, it, expect } from 'vitest';
import { clusterSteps, toyPoints } from '../src/ui/ClusterExplainer';

const last = (a: ReturnType<typeof clusterSteps>) => a[a.length - 1];
const groups = (l: number[]) => new Set(l.filter((x) => x >= 0)).size;

describe('cluster explainer', () => {
  const pts = toyPoints();
  it('finds the three blobs with a sensible radius (Euclidean)', () => {
    const s = last(clusterSteps(pts, 0.2, 3, 'euclidean'));
    expect(groups(s.labels)).toBeGreaterThanOrEqual(3);
    expect(s.labels.every((l) => l >= 0)).toBe(true); // Euclidean clustering leaves nothing out
  });
  it('splits the blobs with a tiny radius and merges them with a huge one', () => {
    expect(groups(last(clusterSteps(pts, 0.03, 3, 'euclidean')).labels)).toBeGreaterThan(8);
    expect(groups(last(clusterSteps(pts, 1.5, 3, 'euclidean')).labels)).toBe(1);
  });
  it('DBSCAN marks the stray points as noise', () => {
    const s = last(clusterSteps(pts, 0.2, 4, 'dbscan'));
    expect(s.labels.filter((l) => l === -1).length).toBeGreaterThanOrEqual(3);
    expect(groups(s.labels)).toBe(3);
  });
  it('every step labels at most all points and the story has a start and an end', () => {
    const st = clusterSteps(pts, 0.2, 4, 'dbscan');
    expect(st[0].labels.every((l) => l === -2)).toBe(true);
    expect(last(st).labels.every((l) => l !== -2)).toBe(true);
  });
});
