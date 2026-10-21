import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePointCloud } from '../src/io/load';

const load = (f: string) => { const b = readFileSync(`public/data/${f}`); return parsePointCloud(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f); };
it('bundled real PCL sample clouds parse (ascii, binary_compressed)', () => {
  const a = load('room_scan1.pcd'), b = load('room_scan2.pcd'), l = load('lamppost.pcd');
  expect(a.count).toBe(112586); expect(b.count).toBe(112624); expect(l.count).toBe(1771);
  for (const c of [a, b, l]) for (let i = 0; i < c.positions.length; i += 997) expect(Number.isFinite(c.positions[i])).toBe(true);
  console.log('ok', a.count, b.count, l.count);
});
