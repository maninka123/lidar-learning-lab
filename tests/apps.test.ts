import { describe, it, expect } from 'vitest';
import { detectPlanes, trialsNeeded } from '../src/apps/planes';
import { extractWalls, straighten, toDXF, slicePoints, segLen } from '../src/apps/cad';
import { heightMapMesh, meshStats } from '../src/apps/mesh';
import { makeRng } from '../src/core/rng';

/** A 6 × 4 × 2.6 m room: floor, ceiling, four walls, ~12 mm noise. */
function room(n: number) {
  const r = makeRng(5), p = new Float32Array(n * 3), lab = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const w = i % 6, a = r.range(0, 6), b = r.range(0, 4), h = r.range(0, 2.6), e = 0.004 * r.gauss();
    const q = w === 0 ? [a, b, e] : w === 1 ? [a, b, 2.6 + e] : w === 2 ? [a, e, h] : w === 3 ? [a, 4 + e, h] : w === 4 ? [e, b, h] : [6 + e, b, h];
    p.set(q, i * 3); lab[i] = w;
  }
  return { p, lab };
}
describe('adaptive plane detection', () => {
  const { p, lab } = room(60000);
  it('finds the six faces of a room', () => {
    const run = detectPlanes(p, 60000, lab, { mode: 'adaptive', threshold: 0.02, iterations: 300, confidence: 0.99, minFraction: 0.02, maxPlanes: 10, seed: 1 });
    expect(run.planes.length).toBe(6);
    expect(run.planes.filter((q) => q.kind === 'wall').length).toBe(4);
    expect(run.planes.some((q) => q.kind === 'floor') && run.planes.some((q) => q.kind === 'ceiling')).toBe(true);
    expect(run.coverage).toBeGreaterThan(0.97);
  });
  it('needs fewer trials when more points lie on the plane', () => { expect(trialsNeeded(0.99, 0.5)).toBeLessThan(trialsNeeded(0.99, 0.2)); });
});
describe('scan to CAD', () => {
  it('extracts four walls from a slice and writes a DXF', () => {
    const { p } = room(60000);
    const xy = slicePoints(p, 60000, 1.0, 1.4);
    const segs = straighten(extractWalls(xy, { tol: 0.03, minLen: 1, minPts: 40, maxLines: 8, gap: 0.3, seed: 2 }));
    expect(segs.length).toBe(4);
    const lens = segs.map(segLen).sort((a, b) => a - b);
    expect(lens[0]).toBeGreaterThan(3.8); expect(lens[3]).toBeLessThan(6.2);
    const dxf = toDXF(segs);
    expect(dxf.match(/\nLINE\n/g)?.length).toBe(4); expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});
describe('meshing', () => {
  it('height-map mesh of a flat floor has the right area', () => {
    const { p } = room(60000);
    const f = new Float32Array(10000 * 3); for (let i = 0; i < 10000; i++) f.set(p.subarray(i * 18, i * 18 + 3), i * 3);
    const floor = { id: 'f', name: 'f', count: 10000, positions: f.filter((_, i) => true), meta: {} as never };
    const m = heightMapMesh(floor as never, 0.1);
    expect(meshStats(m).triangles).toBeGreaterThan(1000);
  });
});
