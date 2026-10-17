import { describe, it, expect } from 'vitest';
import { getScene, objectAABB } from '../src/scenes';
import { buildGraph, nodesFromScene, aabbGap, scannerGap } from '../src/graph/sceneGraph';
import { answerQuery, findNodes } from '../src/graph/query';
import { dist } from '../src/core/math';

const scene = getScene('A');
const scanner = { pos: [-0.2, 0.2, 1.4] as [number, number, number], yaw: 0 };
const graph = buildGraph(nodesFromScene(scene), scanner, scene.corridor, 0.5);
const node = (id: string) => graph.nodes.find((n) => n.id === id)!;

describe('scene graph', () => {
  it('node geometry uses world coordinates from the scene definition', () => {
    const t = node('table-1');
    const aabb = objectAABB(scene.objects.find((o) => o.id === 'table-1')!);
    expect(t.position[0]).toBeCloseTo((aabb.min[0] + aabb.max[0]) / 2, 9);
    expect(t.dimensions[0]).toBeCloseTo(1.6, 6); // table-1 is 1.6 m wide
    expect(t.dimensions[2]).toBeCloseTo(0.75, 6);
  });
  it('distances are computed from world coordinates', () => {
    const a = node('table-1'), b = node('table-2');
    const a1 = answerQuery(graph, 'What is the distance between table 1 and table 2?');
    expect(a1.answer).toContain(dist(a.position, b.position).toFixed(2));
    expect(a1.answer).toContain(aabbGap(a, b).toFixed(2));
  });
  it('relations: chair near table, box blocks the corridor, cube does not', () => {
    expect(graph.edges.some((e) => e.type === 'near' && [e.from, e.to].includes('chair-2') && [e.from, e.to].includes('table-1'))).toBe(true);
    const blockers = graph.edges.filter((e) => e.type === 'blocks_path').map((e) => e.from);
    expect(blockers).toContain('box-corridor');
    expect(blockers).not.toContain('calibration-cube');
  });
  it('closest-to-scanner matches a brute-force check', () => {
    const objs = graph.nodes.filter((n) => !n.structural);
    const best = objs.reduce((a, b) => (scannerGap(scanner.pos, a) < scannerGap(scanner.pos, b) ? a : b));
    const r = answerQuery(graph, 'Which object is closest to the scanner?');
    expect(r.nodeIds[0]).toBe(best.id);
  });
  it('left/right depend on the scanner heading', () => {
    const rot = buildGraph(nodesFromScene(scene), { ...scanner, yaw: Math.PI }, scene.corridor, 0.5);
    const l = graph.edges.filter((e) => e.type === 'left_of').length, r2 = rot.edges.filter((e) => e.type === 'left_of').length;
    expect(l).toBeGreaterThan(0);
    const a = graph.edges.find((e) => e.type === 'left_of')!;
    expect(rot.edges.some((e) => e.type === 'right_of' && e.from === a.from && e.to === a.to)).toBe(true);
    void r2;
  });
  it('name resolution and unknown questions are handled', () => {
    expect(findNodes(graph, 'the table').length).toBeGreaterThanOrEqual(2);
    expect(answerQuery(graph, 'what is the meaning of life').intent).toBe('unrecognised');
  });
});
