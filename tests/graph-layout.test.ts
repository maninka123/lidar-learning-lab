import { describe, it, expect } from 'vitest';
import { forceLayout } from '../src/graph/layout';
import { nameObject } from '../src/apps/classroom';

describe('force layout', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
  const edges = ids.flatMap((id, i) => (i % 3 ? [{ a: id, b: ids[i - (i % 3)] }] : []));
  it('keeps every node inside the frame and apart from the others', () => {
    const L = forceLayout(ids, edges, 560, 640, 64);
    expect(L).toHaveLength(30);
    for (const p of L) { expect(p.x).toBeGreaterThanOrEqual(40); expect(p.x).toBeLessThanOrEqual(520); expect(p.y).toBeGreaterThanOrEqual(36); expect(p.y).toBeLessThanOrEqual(604); }
    let nearest = Infinity; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) nearest = Math.min(nearest, Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y));
    expect(nearest).toBeGreaterThan(36);
  });
  it('pulls linked nodes closer than unlinked ones', () => {
    const L = new Map(forceLayout(ids, edges, 560, 640, 64).map((p) => [p.id, p]));
    const d = (a: string, b: string) => Math.hypot(L.get(a)!.x - L.get(b)!.x, L.get(a)!.y - L.get(b)!.y);
    const linked = edges.reduce((s, e) => s + d(e.a, e.b), 0) / edges.length;
    let all = 0, c = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { all += d(ids[i], ids[j]); c++; }
    expect(linked).toBeLessThan(all / c);
  });
  it('is the same every time', () => { expect(forceLayout(ids, edges, 560, 640)).toEqual(forceLayout(ids, edges, 560, 640)); });
  it('copes with no nodes and one node', () => { expect(forceLayout([], [], 100, 100)).toEqual([]); expect(forceLayout(['a'], [], 300, 300)).toHaveLength(1); });
});

describe('naming classroom objects', () => {
  it('tells a whiteboard, a door, a wall item and a bin from a cabinet', () => {
    expect(nameObject(4, [1.48, 0.44, 1.32], 0.71)).toBe('Whiteboard');
    expect(nameObject(4, [0.34, 0.30, 0.39], 1.18)).toBe('Wall item');
    expect(nameObject(4, [0.33, 0.36, 0.41], 0.27)).toBe('Bin');
    expect(nameObject(4, [0.97, 0.47, 0.97], 0.6)).toBe('Cabinet');
    expect(nameObject(6, [0.2, 0.7, 1.53], 0.88)).toBe('Door');
    expect(nameObject(6, [0.5, 0.5, 0.5], 0.3)).toBe('Other');
    expect(nameObject(3, [0.4, 0.4, 0.57], 0.4)).toBe('Chair');
    expect(nameObject(5, [0.9, 0.8, 0.55], 0.45)).toBe('Table');
  });
});
