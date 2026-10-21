import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePointCloud } from '../src/io/load';

it('bundled real SICK LMS400 scan parses (binary_compressed, intensity)', () => {
  const b = readFileSync('public/data/table_scene_lms400.pcd');
  const c = parsePointCloud(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'table_scene_lms400.pcd');
  expect(c.count).toBe(460400);
  expect(c.intensity).toBeTruthy();
  for (let i = 0; i < c.positions.length; i += 997) expect(Number.isFinite(c.positions[i])).toBe(true);
});

it('bundled real TLS (RIEGL VZ-400) and MLS (FARO Orbis / HESAI XT32) trees parse', () => {
  for (const [f, n, rgb] of [['riegl_vz400_tree.ply', 324064, false], ['faro_orbis_mls_tree.ply', 266407, true]] as const) {
    const b = readFileSync(`public/data/${f}`);
    const c = parsePointCloud(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f);
    expect(c.count).toBe(n);
    expect(!!c.colors).toBe(rgb);
  }
});
