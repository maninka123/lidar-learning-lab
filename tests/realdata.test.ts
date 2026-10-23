import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePointCloud } from '../src/io/load';

it('bundled real TLS tree (RIEGL VZ-400) parses', () => {
  const b = readFileSync('public/data/riegl_vz400_tree.ply');
  const c = parsePointCloud(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'riegl_vz400_tree.ply');
  expect(c.count).toBe(324064);
  for (let i = 0; i < c.positions.length; i += 997) expect(Number.isFinite(c.positions[i])).toBe(true);
});
